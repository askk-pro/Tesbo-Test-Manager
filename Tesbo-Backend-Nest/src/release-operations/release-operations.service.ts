import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "crypto";
import { DatabaseService } from "../database/database.service";
import { LegacyService, isUuid } from "../legacy/legacy.service";
import {
  evaluateReleasePolicy,
  type ReleaseCertificationEvidence,
  type ReleaseEnvironmentPolicy,
} from "./release-operations.policy";

type Body = Record<string, any>;

const ENVIRONMENT_TYPES = new Set(["development", "qa", "staging", "uat", "production", "custom"]);
const CERTIFICATION_STATES = new Set(["NONE", "READY", "APPROVED", "CERTIFIED"]);
const ACTIVE_PROMOTION_STATES = [
  "draft",
  "awaiting_qa",
  "ready_for_approval",
  "approved",
  "deploying",
  "verifying",
  "observation",
];

function camelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function camelRow<T extends Record<string, any>>(row: T): Record<string, any> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [camelKey(key), value]));
}

function bounded(value: unknown, field: string, max: number, required = false): string {
  const text = String(value ?? "").trim();
  if (required && !text) throw new BadRequestException({ error: `${field} is required` });
  if (text.length > max) throw new BadRequestException({ error: `${field} must be ${max} characters or fewer` });
  return text;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return value === undefined || value === null ? fallback : Boolean(value);
}

function numberValue(value: unknown, field: string, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new BadRequestException({ error: `${field} must be between ${min} and ${max}` });
  }
  return n;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return slug || "environment";
}

function validUrl(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length > 1024) throw new BadRequestException({ error: "url must be 1024 characters or fewer" });
  try {
    const parsed = new URL(text);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("protocol");
  } catch {
    throw new BadRequestException({ error: "url must be an http:// or https:// URL" });
  }
  return text;
}

function stringArray(value: unknown, field: string, max = 20): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new BadRequestException({ error: `${field} must be an array` });
  const list = [...new Set(value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))];
  if (list.length > max) throw new BadRequestException({ error: `${field} accepts at most ${max} values` });
  return list;
}

function plainObject(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException({ error: `${field} must be an object` });
  }
  return value as Record<string, unknown>;
}

@Injectable()
export class ReleaseOperationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly legacy: LegacyService,
  ) {}

  private userId(userId: string | null | undefined): string {
    return String(userId || "");
  }

  private async requireManager(userId: string | null | undefined, projectId: string) {
    const project = await this.legacy.requireProjectAccess(userId, projectId);
    if (this.legacy.normalizeRole(String(project.caller_role || "")) === "qa_engineer") {
      throw new ForbiddenException({ error: "Only a project owner or manager can manage release environments or approvals" });
    }
    return project;
  }

  private environmentPolicy(row: Body): ReleaseEnvironmentPolicy {
    return {
      protected: Boolean(row.protected),
      requiredCertificationState: String(row.required_certification_state || "NONE") as ReleaseEnvironmentPolicy["requiredCertificationState"],
      requiredApprovals: Number(row.required_approvals || 0),
      requireNoP0P1: Boolean(row.require_no_p0_p1),
      minRegressionCoverage: Number(row.min_regression_coverage || 0),
      requireSmoke: Boolean(row.require_smoke),
      observationMinutes: Number(row.observation_minutes || 0),
    };
  }

  private async requireEnvironment(projectId: string, environmentId: string) {
    if (!isUuid(environmentId)) throw new NotFoundException({ error: "Release environment not found" });
    const res = await this.db.query(
      "SELECT * FROM release_environments WHERE id=$1 AND project_id=$2 AND archived_at IS NULL",
      [environmentId, projectId],
    );
    if (!res.rows[0]) throw new NotFoundException({ error: "Release environment not found" });
    return res.rows[0] as Body;
  }

  private async requireBuild(projectId: string, buildId: string) {
    if (!isUuid(buildId)) throw new NotFoundException({ error: "QA build not found" });
    const res = await this.db.query(
      "SELECT * FROM qa_build_registry WHERE id=$1 AND project_id=$2",
      [buildId, projectId],
    );
    if (!res.rows[0]) throw new NotFoundException({ error: "QA build not found" });
    return res.rows[0] as Body;
  }

  private async latestCertification(buildId: string): Promise<Body | null> {
    const res = await this.db.query(
      `SELECT * FROM release_certifications
        WHERE build_id=$1
        ORDER BY version DESC
        LIMIT 1`,
      [buildId],
    );
    return (res.rows[0] as Body | undefined) ?? null;
  }

  private certificationForPolicy(row: Body | null): ReleaseCertificationEvidence | null {
    if (!row) return null;
    return {
      state: row.state,
      validityStatus: row.validity_status,
      evidenceDigest: row.evidence_digest,
      evidenceSnapshot: row.evidence_snapshot,
    };
  }

  private policySnapshot(environment: Body, certification: Body | null) {
    const policy = this.environmentPolicy(environment);
    const evaluation = evaluateReleasePolicy(policy, this.certificationForPolicy(certification));
    return {
      environment: {
        id: environment.id,
        name: environment.name,
        environmentType: environment.environment_type,
        protected: Boolean(environment.protected),
      },
      rules: policy,
      certification: certification
        ? {
            id: certification.id,
            version: certification.version,
            state: certification.state,
            validityStatus: certification.validity_status,
            evidenceDigest: certification.evidence_digest,
          }
        : null,
      evaluation,
    };
  }

  private policyDigest(snapshot: Record<string, unknown>): string {
    return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  }

  private async insertEvent(
    promotionId: string,
    eventType: string,
    fromStatus: string | null,
    toStatus: string | null,
    details: Record<string, unknown>,
    actorId: string | null,
  ) {
    await this.db.query(
      `INSERT INTO release_promotion_events
         (promotion_id,event_type,from_status,to_status,details,actor_id)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [promotionId, eventType, fromStatus, toStatus, JSON.stringify(details), actorId || null],
    );
  }

  private async promotionDetail(projectId: string, promotionId: string) {
    if (!isUuid(promotionId)) throw new NotFoundException({ error: "Promotion not found" });
    const res = await this.db.query(
      `SELECT p.*,
              se.name AS source_environment_name,
              te.name AS target_environment_name,
              te.environment_type AS target_environment_type,
              te.protected AS target_protected,
              b.repository,b.git_sha,b.branch_name,b.release_name,b.build_version,b.environment AS build_environment,
              rc.state AS certification_state,rc.validity_status AS certification_validity,
              COALESCE(a.approval_count,0)::int AS approval_count,
              COALESCE(a.rejection_count,0)::int AS rejection_count
         FROM release_promotions p
         LEFT JOIN release_environments se ON se.id=p.source_environment_id
         JOIN release_environments te ON te.id=p.target_environment_id
         JOIN qa_build_registry b ON b.id=p.build_id
         LEFT JOIN release_certifications rc ON rc.id=p.certification_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (WHERE decision='approved' AND policy_digest=p.policy_digest)::int AS approval_count,
                  COUNT(*) FILTER (WHERE decision='rejected' AND policy_digest=p.policy_digest)::int AS rejection_count
             FROM release_promotion_approvals pa
            WHERE pa.promotion_id=p.id
         ) a ON true
        WHERE p.id=$1 AND p.project_id=$2`,
      [promotionId, projectId],
    );
    if (!res.rows[0]) throw new NotFoundException({ error: "Promotion not found" });

    const approvals = await this.db.query(
      `SELECT pa.*,u.email,u.name
         FROM release_promotion_approvals pa
         JOIN users u ON u.id=pa.user_id
        WHERE pa.promotion_id=$1
        ORDER BY pa.created_at,pa.id`,
      [promotionId],
    );
    const events = await this.db.query(
      `SELECT * FROM release_promotion_events
        WHERE promotion_id=$1
        ORDER BY created_at,id`,
      [promotionId],
    );
    return {
      ...camelRow(res.rows[0] as Body),
      approvals: approvals.rows.map((row) => camelRow(row as Body)),
      events: events.rows.map((row) => camelRow(row as Body)),
    };
  }

  async listEnvironments(userId: string | null | undefined, projectId: string) {
    await this.legacy.requireProjectAccess(userId, projectId);
    const res = await this.db.query(
      `SELECT e.*,
              cb.git_sha AS current_build_git_sha,
              kb.git_sha AS known_good_build_git_sha
         FROM release_environments e
         LEFT JOIN qa_build_registry cb ON cb.id=e.current_build_id
         LEFT JOIN qa_build_registry kb ON kb.id=e.known_good_build_id
        WHERE e.project_id=$1 AND e.archived_at IS NULL
        ORDER BY e.sort_order,e.created_at,e.name`,
      [projectId],
    );
    return res.rows.map((row) => camelRow(row as Body));
  }

  async createEnvironment(userId: string | null | undefined, projectId: string, body: Body) {
    await this.requireManager(userId, projectId);
    const uid = this.userId(userId);
    const name = bounded(body.name, "name", 128, true);
    const environmentType = bounded(body.environmentType || "custom", "environmentType", 24, true).toLowerCase();
    if (!ENVIRONMENT_TYPES.has(environmentType)) {
      throw new BadRequestException({ error: "environmentType must be development, qa, staging, uat, production, or custom" });
    }
    const production = environmentType === "production";
    const protectedEnvironment = booleanValue(body.protected, production);
    const requiredCertificationState = bounded(
      body.requiredCertificationState ?? (protectedEnvironment ? "READY" : "NONE"),
      "requiredCertificationState",
      16,
      true,
    ).toUpperCase();
    if (!CERTIFICATION_STATES.has(requiredCertificationState)) {
      throw new BadRequestException({ error: "requiredCertificationState must be NONE, READY, APPROVED, or CERTIFIED" });
    }

    const values = {
      name,
      slug: bounded(body.slug || slugify(name), "slug", 96, true).toLowerCase(),
      environmentType,
      url: validUrl(body.url),
      provider: bounded(body.provider || "manual", "provider", 64, true).toLowerCase(),
      providerProjectRef: bounded(body.providerProjectRef, "providerProjectRef", 255) || null,
      branchName: bounded(body.branchName, "branchName", 255) || null,
      protected: protectedEnvironment,
      requiredCertificationState,
      requiredApprovals: Math.round(numberValue(body.requiredApprovals, "requiredApprovals", 1, 1, 20)),
      requireNoP0P1: booleanValue(body.requireNoP0P1, production),
      minRegressionCoverage: numberValue(body.minRegressionCoverage, "minRegressionCoverage", production ? 100 : 0, 0, 100),
      requireSmoke: booleanValue(body.requireSmoke, production),
      allowedBrowsers: stringArray(body.allowedBrowsers, "allowedBrowsers"),
      observationMinutes: Math.round(numberValue(body.observationMinutes, "observationMinutes", production ? 15 : 0, 0, 10080)),
      settings: plainObject(body.settings, "settings"),
      sortOrder: Math.round(numberValue(body.sortOrder, "sortOrder", 0, -100000, 100000)),
    };

    try {
      const res = await this.db.query(
        `INSERT INTO release_environments
           (project_id,name,slug,environment_type,url,provider,provider_project_ref,branch_name,protected,
            required_certification_state,required_approvals,require_no_p0_p1,min_regression_coverage,
            require_smoke,allowed_browsers,observation_minutes,settings,sort_order,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17::jsonb,$18,$19)
         RETURNING *`,
        [
          projectId, values.name, values.slug, values.environmentType, values.url, values.provider,
          values.providerProjectRef, values.branchName, values.protected, values.requiredCertificationState,
          values.requiredApprovals, values.requireNoP0P1, values.minRegressionCoverage, values.requireSmoke,
          JSON.stringify(values.allowedBrowsers), values.observationMinutes, JSON.stringify(values.settings),
          values.sortOrder, uid,
        ],
      );
      const created = camelRow(res.rows[0] as Body);
      await this.legacy.logProjectActivity(projectId, uid, "release_environment_created", "release_environment", created.id, name, { after: created });
      return created;
    } catch (error: any) {
      if (String(error?.code || "") === "23505") {
        throw new ConflictException({ error: "A release environment with that name or slug already exists" });
      }
      throw error;
    }
  }

  async updateEnvironment(userId: string | null | undefined, projectId: string, environmentId: string, body: Body) {
    await this.requireManager(userId, projectId);
    const uid = this.userId(userId);
    const current = await this.requireEnvironment(projectId, environmentId);
    const merged = {
      name: body.name !== undefined ? body.name : current.name,
      slug: body.slug !== undefined ? body.slug : current.slug,
      environmentType: body.environmentType !== undefined ? body.environmentType : current.environment_type,
      url: body.url !== undefined ? body.url : current.url,
      provider: body.provider !== undefined ? body.provider : current.provider,
      providerProjectRef: body.providerProjectRef !== undefined ? body.providerProjectRef : current.provider_project_ref,
      branchName: body.branchName !== undefined ? body.branchName : current.branch_name,
      protected: body.protected !== undefined ? body.protected : current.protected,
      requiredCertificationState: body.requiredCertificationState !== undefined ? body.requiredCertificationState : current.required_certification_state,
      requiredApprovals: body.requiredApprovals !== undefined ? body.requiredApprovals : current.required_approvals,
      requireNoP0P1: body.requireNoP0P1 !== undefined ? body.requireNoP0P1 : current.require_no_p0_p1,
      minRegressionCoverage: body.minRegressionCoverage !== undefined ? body.minRegressionCoverage : current.min_regression_coverage,
      requireSmoke: body.requireSmoke !== undefined ? body.requireSmoke : current.require_smoke,
      allowedBrowsers: body.allowedBrowsers !== undefined ? body.allowedBrowsers : current.allowed_browsers,
      observationMinutes: body.observationMinutes !== undefined ? body.observationMinutes : current.observation_minutes,
      settings: body.settings !== undefined ? body.settings : current.settings,
      sortOrder: body.sortOrder !== undefined ? body.sortOrder : current.sort_order,
    };
    const name = bounded(merged.name, "name", 128, true);
    const environmentType = bounded(merged.environmentType, "environmentType", 24, true).toLowerCase();
    if (!ENVIRONMENT_TYPES.has(environmentType)) throw new BadRequestException({ error: "Invalid environmentType" });
    const requiredCertificationState = bounded(merged.requiredCertificationState, "requiredCertificationState", 16, true).toUpperCase();
    if (!CERTIFICATION_STATES.has(requiredCertificationState)) throw new BadRequestException({ error: "Invalid requiredCertificationState" });

    try {
      const res = await this.db.query(
        `UPDATE release_environments SET
           name=$3,slug=$4,environment_type=$5,url=$6,provider=$7,provider_project_ref=$8,branch_name=$9,
           protected=$10,required_certification_state=$11,required_approvals=$12,require_no_p0_p1=$13,
           min_regression_coverage=$14,require_smoke=$15,allowed_browsers=$16::jsonb,
           observation_minutes=$17,settings=$18::jsonb,sort_order=$19,updated_at=now()
         WHERE id=$1 AND project_id=$2 AND archived_at IS NULL
         RETURNING *`,
        [
          environmentId, projectId, name, bounded(merged.slug || slugify(name), "slug", 96, true).toLowerCase(),
          environmentType, validUrl(merged.url), bounded(merged.provider || "manual", "provider", 64, true).toLowerCase(),
          bounded(merged.providerProjectRef, "providerProjectRef", 255) || null,
          bounded(merged.branchName, "branchName", 255) || null, Boolean(merged.protected), requiredCertificationState,
          Math.round(numberValue(merged.requiredApprovals, "requiredApprovals", 1, 1, 20)),
          Boolean(merged.requireNoP0P1), numberValue(merged.minRegressionCoverage, "minRegressionCoverage", 0, 0, 100),
          Boolean(merged.requireSmoke), JSON.stringify(stringArray(merged.allowedBrowsers, "allowedBrowsers")),
          Math.round(numberValue(merged.observationMinutes, "observationMinutes", 0, 0, 10080)),
          JSON.stringify(plainObject(merged.settings, "settings")),
          Math.round(numberValue(merged.sortOrder, "sortOrder", 0, -100000, 100000)),
        ],
      );
      if (!res.rows[0]) throw new NotFoundException({ error: "Release environment not found" });
      const updated = camelRow(res.rows[0] as Body);
      await this.legacy.logProjectActivity(projectId, uid, "release_environment_updated", "release_environment", environmentId, name, {
        before: camelRow(current),
        after: updated,
      });
      return updated;
    } catch (error: any) {
      if (String(error?.code || "") === "23505") {
        throw new ConflictException({ error: "A release environment with that name or slug already exists" });
      }
      throw error;
    }
  }

  async archiveEnvironment(userId: string | null | undefined, projectId: string, environmentId: string) {
    await this.requireManager(userId, projectId);
    const uid = this.userId(userId);
    const environment = await this.requireEnvironment(projectId, environmentId);
    const active = await this.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM release_promotions
        WHERE project_id=$1 AND (source_environment_id=$2 OR target_environment_id=$2)
          AND status = ANY($3::varchar[])`,
      [projectId, environmentId, ACTIVE_PROMOTION_STATES],
    );
    if (Number(active.rows[0]?.count || 0) > 0) {
      throw new ConflictException({ error: "This environment has active promotion requests and cannot be archived" });
    }
    await this.db.query(
      "UPDATE release_environments SET archived_at=now(),updated_at=now() WHERE id=$1 AND project_id=$2",
      [environmentId, projectId],
    );
    await this.legacy.logProjectActivity(projectId, uid, "release_environment_archived", "release_environment", environmentId, environment.name, {});
    return { ok: true, id: environmentId };
  }

  async listPromotions(userId: string | null | undefined, projectId: string, limit = 100) {
    await this.legacy.requireProjectAccess(userId, projectId);
    const safeLimit = Math.max(1, Math.min(250, Math.floor(Number(limit) || 100)));
    const res = await this.db.query(
      `SELECT p.*,
              se.name AS source_environment_name,
              te.name AS target_environment_name,
              te.environment_type AS target_environment_type,
              b.repository,b.git_sha,b.branch_name,b.release_name,b.build_version,
              rc.state AS certification_state,rc.validity_status AS certification_validity,
              COALESCE(a.approval_count,0)::int AS approval_count,
              COALESCE(a.rejection_count,0)::int AS rejection_count
         FROM release_promotions p
         LEFT JOIN release_environments se ON se.id=p.source_environment_id
         JOIN release_environments te ON te.id=p.target_environment_id
         JOIN qa_build_registry b ON b.id=p.build_id
         LEFT JOIN release_certifications rc ON rc.id=p.certification_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (WHERE decision='approved' AND policy_digest=p.policy_digest)::int AS approval_count,
                  COUNT(*) FILTER (WHERE decision='rejected' AND policy_digest=p.policy_digest)::int AS rejection_count
             FROM release_promotion_approvals pa
            WHERE pa.promotion_id=p.id
         ) a ON true
        WHERE p.project_id=$1
        ORDER BY p.created_at DESC
        LIMIT $2`,
      [projectId, safeLimit],
    );
    return res.rows.map((row) => camelRow(row as Body));
  }

  async getPromotion(userId: string | null | undefined, projectId: string, promotionId: string) {
    await this.legacy.requireProjectAccess(userId, projectId);
    return this.promotionDetail(projectId, promotionId);
  }

  async createPromotion(userId: string | null | undefined, projectId: string, body: Body) {
    await this.legacy.requireProjectAccess(userId, projectId);
    const uid = this.userId(userId);
    const buildId = bounded(body.buildId, "buildId", 64, true);
    const targetEnvironmentId = bounded(body.targetEnvironmentId, "targetEnvironmentId", 64, true);
    const sourceEnvironmentId = body.sourceEnvironmentId ? bounded(body.sourceEnvironmentId, "sourceEnvironmentId", 64, true) : null;
    const build = await this.requireBuild(projectId, buildId);
    const target = await this.requireEnvironment(projectId, targetEnvironmentId);
    if (sourceEnvironmentId) {
      if (sourceEnvironmentId === targetEnvironmentId) {
        throw new BadRequestException({ error: "Source and target environments must be different" });
      }
      await this.requireEnvironment(projectId, sourceEnvironmentId);
    }

    const duplicate = await this.db.query(
      `SELECT id FROM release_promotions
        WHERE project_id=$1 AND build_id=$2 AND target_environment_id=$3
          AND status = ANY($4::varchar[])
        ORDER BY created_at DESC LIMIT 1`,
      [projectId, buildId, targetEnvironmentId, ACTIVE_PROMOTION_STATES],
    );
    if (duplicate.rows[0]) {
      throw new ConflictException({ error: "An active promotion for this build and target environment already exists", promotionId: duplicate.rows[0].id });
    }

    const certification = await this.latestCertification(buildId);
    const snapshot = this.policySnapshot(target, certification);
    const digest = this.policyDigest(snapshot);
    const evaluation = (snapshot as Body).evaluation as Body;
    const status = evaluation.passed ? "ready_for_approval" : "awaiting_qa";
    const inserted = await this.db.query(
      `INSERT INTO release_promotions
         (project_id,source_environment_id,target_environment_id,build_id,certification_id,status,
          requested_by,previous_known_good_build_id,previous_known_good_git_sha,policy_snapshot,policy_digest)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
       RETURNING *`,
      [
        projectId, sourceEnvironmentId, targetEnvironmentId, buildId, certification?.id || null, status, uid,
        target.known_good_build_id || null, target.known_good_git_sha || null, JSON.stringify(snapshot), digest,
      ],
    );
    const promotionId = String(inserted.rows[0].id);
    await this.insertEvent(promotionId, "requested", null, status, {
      buildId,
      targetEnvironmentId,
      policyDigest: digest,
      blockers: evaluation.blockers || [],
    }, uid);
    await this.legacy.logProjectActivity(projectId, uid, "release_promotion_requested", "release_promotion", promotionId, build.release_name || build.build_version || String(build.git_sha).slice(0, 12), {
      targetEnvironmentId,
      buildId,
      status,
      policyDigest: digest,
      blockers: evaluation.blockers || [],
    });
    return this.promotionDetail(projectId, promotionId);
  }

  async refreshPromotion(userId: string | null | undefined, projectId: string, promotionId: string) {
    await this.legacy.requireProjectAccess(userId, projectId);
    const uid = this.userId(userId);
    const promotion = await this.promotionDetail(projectId, promotionId) as Body;
    if (!["awaiting_qa", "ready_for_approval", "approved"].includes(String(promotion.status))) {
      throw new ConflictException({ error: "Only a pending or approved promotion can refresh its release policy" });
    }
    const target = await this.requireEnvironment(projectId, String(promotion.targetEnvironmentId));
    const certification = await this.latestCertification(String(promotion.buildId));
    const snapshot = this.policySnapshot(target, certification);
    const digest = this.policyDigest(snapshot);
    const evaluation = (snapshot as Body).evaluation as Body;
    const oldStatus = String(promotion.status);
    const nextStatus = evaluation.passed ? (oldStatus === "approved" && promotion.policyDigest === digest ? "approved" : "ready_for_approval") : "awaiting_qa";

    await this.db.query(
      `UPDATE release_promotions
          SET certification_id=$3,policy_snapshot=$4::jsonb,policy_digest=$5,status=$6,
              approved_by=CASE WHEN $6='approved' THEN approved_by ELSE NULL END,
              approved_at=CASE WHEN $6='approved' THEN approved_at ELSE NULL END,
              updated_at=now()
        WHERE id=$1 AND project_id=$2`,
      [promotionId, projectId, certification?.id || null, JSON.stringify(snapshot), digest, nextStatus],
    );
    await this.insertEvent(promotionId, "policy_refreshed", oldStatus, nextStatus, {
      policyDigest: digest,
      blockers: evaluation.blockers || [],
      certificationId: certification?.id || null,
    }, uid);
    return this.promotionDetail(projectId, promotionId);
  }

  async decidePromotion(userId: string | null | undefined, projectId: string, promotionId: string, body: Body) {
    await this.requireManager(userId, projectId);
    const uid = this.userId(userId);
    const decision = bounded(body.decision, "decision", 16, true).toLowerCase();
    if (!["approve", "reject"].includes(decision)) {
      throw new BadRequestException({ error: "decision must be approve or reject" });
    }
    const comment = bounded(body.comment, "comment", 5000);
    if (decision === "reject" && !comment) throw new BadRequestException({ error: "A rejection comment is required" });

    const promotion = await this.promotionDetail(projectId, promotionId) as Body;
    if (!["awaiting_qa", "ready_for_approval"].includes(String(promotion.status))) {
      throw new ConflictException({ error: "This promotion is not awaiting a decision" });
    }

    const target = await this.requireEnvironment(projectId, String(promotion.targetEnvironmentId));
    const certification = await this.latestCertification(String(promotion.buildId));
    const snapshot = this.policySnapshot(target, certification);
    const digest = this.policyDigest(snapshot);
    const evaluation = (snapshot as Body).evaluation as Body;

    if (decision === "approve" && !evaluation.passed) {
      if (promotion.policyDigest !== digest || promotion.status !== "awaiting_qa") {
        await this.db.query(
          `UPDATE release_promotions
              SET certification_id=$3,policy_snapshot=$4::jsonb,policy_digest=$5,status='awaiting_qa',
                  approved_by=NULL,approved_at=NULL,updated_at=now()
            WHERE id=$1 AND project_id=$2`,
          [promotionId, projectId, certification?.id || null, JSON.stringify(snapshot), digest],
        );
        await this.insertEvent(promotionId, "policy_blocked", String(promotion.status), "awaiting_qa", {
          policyDigest: digest,
          blockers: evaluation.blockers || [],
        }, uid);
      }
      throw new ConflictException({ error: "Promotion policy is not satisfied", blockers: evaluation.blockers || [] });
    }

    try {
      await this.db.query(
        `INSERT INTO release_promotion_approvals(promotion_id,user_id,decision,policy_digest,comment)
         VALUES ($1,$2,$3,$4,$5)`,
        [promotionId, uid, decision === "approve" ? "approved" : "rejected", digest, comment || null],
      );
    } catch (error: any) {
      if (String(error?.code || "") === "23505") {
        throw new ConflictException({ error: "You have already recorded a decision for this version of the promotion policy" });
      }
      throw error;
    }

    if (decision === "reject") {
      await this.db.query(
        `UPDATE release_promotions
            SET status='rejected',failure_reason=$3,completed_at=now(),updated_at=now()
          WHERE id=$1 AND project_id=$2`,
        [promotionId, projectId, comment],
      );
      await this.insertEvent(promotionId, "rejected", String(promotion.status), "rejected", { comment, policyDigest: digest }, uid);
      await this.legacy.logProjectActivity(projectId, uid, "release_promotion_rejected", "release_promotion", promotionId, null, { comment, policyDigest: digest });
      return this.promotionDetail(projectId, promotionId);
    }

    const counts = await this.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM release_promotion_approvals
        WHERE promotion_id=$1 AND decision='approved' AND policy_digest=$2`,
      [promotionId, digest],
    );
    const approvalCount = Number(counts.rows[0]?.count || 0);
    const requiredApprovals = Number(target.required_approvals || 0);
    const nextStatus = approvalCount >= requiredApprovals ? "approved" : "ready_for_approval";
    await this.db.query(
      `UPDATE release_promotions
          SET certification_id=$3,policy_snapshot=$4::jsonb,policy_digest=$5,status=$6,
              approved_by=CASE WHEN $6='approved' THEN $7 ELSE NULL END,
              approved_at=CASE WHEN $6='approved' THEN now() ELSE NULL END,
              updated_at=now()
        WHERE id=$1 AND project_id=$2`,
      [promotionId, projectId, certification?.id || null, JSON.stringify(snapshot), digest, nextStatus, uid],
    );
    await this.insertEvent(promotionId, "approval_recorded", String(promotion.status), nextStatus, {
      comment: comment || null,
      approvalCount,
      requiredApprovals,
      policyDigest: digest,
    }, uid);
    await this.legacy.logProjectActivity(projectId, uid, "release_promotion_approval_recorded", "release_promotion", promotionId, null, {
      approvalCount,
      requiredApprovals,
      status: nextStatus,
      policyDigest: digest,
    });
    return this.promotionDetail(projectId, promotionId);
  }
}
