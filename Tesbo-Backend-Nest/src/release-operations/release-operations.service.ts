import { InjectQueue } from "@nestjs/bullmq";
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Queue } from "bullmq";
import { createHash } from "crypto";
import { AppConfigService } from "../config/app-config.service";
import { DatabaseService } from "../database/database.service";
import { LegacyService, isUuid } from "../legacy/legacy.service";
import { QaAutomationService } from "../qa-automation/qa-automation.service";
import { KpsDeploymentProvider } from "./kps-deployment.provider";
import {
  RELEASE_DEPLOYMENT_MONITOR_JOB,
  RELEASE_VERIFICATION_MONITOR_JOB,
  RELEASE_DEPLOYMENT_QUEUE,
} from "./release-deployment.constants";
import { evaluateDeploymentProvenance } from "./release-provenance.policy";
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
    private readonly kps: KpsDeploymentProvider,
    private readonly config: AppConfigService,
    private readonly qaAutomation: QaAutomationService,
    @InjectQueue(RELEASE_DEPLOYMENT_QUEUE) private readonly deploymentQueue: Queue,
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
      providerWorkloadRef: bounded(body.providerWorkloadRef, "providerWorkloadRef", 255) || null,
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
           (project_id,name,slug,environment_type,url,provider,provider_project_ref,provider_workload_ref,branch_name,protected,
            required_certification_state,required_approvals,require_no_p0_p1,min_regression_coverage,
            require_smoke,allowed_browsers,observation_minutes,settings,sort_order,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18::jsonb,$19,$20)
         RETURNING *`,
        [
          projectId, values.name, values.slug, values.environmentType, values.url, values.provider,
          values.providerProjectRef, values.providerWorkloadRef, values.branchName, values.protected,
          values.requiredCertificationState, values.requiredApprovals, values.requireNoP0P1,
          values.minRegressionCoverage, values.requireSmoke, JSON.stringify(values.allowedBrowsers),
          values.observationMinutes, JSON.stringify(values.settings), values.sortOrder, uid,
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
      providerWorkloadRef: body.providerWorkloadRef !== undefined ? body.providerWorkloadRef : current.provider_workload_ref,
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
           name=$3,slug=$4,environment_type=$5,url=$6,provider=$7,provider_project_ref=$8,provider_workload_ref=$9,branch_name=$10,
           protected=$11,required_certification_state=$12,required_approvals=$13,require_no_p0_p1=$14,
           min_regression_coverage=$15,require_smoke=$16,allowed_browsers=$17::jsonb,
           observation_minutes=$18,settings=$19::jsonb,sort_order=$20,updated_at=now()
         WHERE id=$1 AND project_id=$2 AND archived_at IS NULL
         RETURNING *`,
        [
          environmentId, projectId, name, bounded(merged.slug || slugify(name), "slug", 96, true).toLowerCase(),
          environmentType, validUrl(merged.url), bounded(merged.provider || "manual", "provider", 64, true).toLowerCase(),
          bounded(merged.providerProjectRef, "providerProjectRef", 255) || null,
          bounded(merged.providerWorkloadRef, "providerWorkloadRef", 255) || null,
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
          requested_by,previous_known_good_build_id,previous_known_good_git_sha,policy_snapshot,policy_digest,requested_git_sha)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
       RETURNING *`,
      [
        projectId, sourceEnvironmentId, targetEnvironmentId, buildId, certification?.id || null, status, uid,
        target.known_good_build_id || null, target.known_good_git_sha || null, JSON.stringify(snapshot), digest,
        String(build.git_sha),
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
          SET certification_id=$3,policy_snapshot=$4::jsonb,policy_digest=$5,status=$6::varchar,
              approved_by=CASE WHEN $6::varchar='approved' THEN approved_by ELSE NULL END,
              approved_at=CASE WHEN $6::varchar='approved' THEN approved_at ELSE NULL END,
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
          SET certification_id=$3,policy_snapshot=$4::jsonb,policy_digest=$5,status=$6::varchar,
              approved_by=CASE WHEN $6::varchar='approved' THEN $7::uuid ELSE NULL END,
              approved_at=CASE WHEN $6::varchar='approved' THEN now() ELSE NULL END,
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
  private deploymentJobOptions() {
    return {
      attempts: Math.max(1, Math.min(2_000, this.config.releaseDeploymentMonitorMaxAttempts)),
      backoff: {
        type: "fixed" as const,
        delay: Math.max(1_000, Math.min(60_000, this.config.releaseDeploymentMonitorIntervalMs)),
      },
      removeOnComplete: true,
      removeOnFail: 100,
    };
  }

  private deploymentJobId(promotionId: string): string {
    return "release-promotion-" + promotionId;
  }

  private async enqueueDeploymentMonitor(promotionId: string): Promise<boolean> {
    const jobId = this.deploymentJobId(promotionId);
    const existing = await this.deploymentQueue.getJob(jobId);
    if (existing) return false;
    await this.deploymentQueue.add(
      RELEASE_DEPLOYMENT_MONITOR_JOB,
      { promotionId },
      { jobId, ...this.deploymentJobOptions() },
    );
    return true;
  }

  async recoverDeploymentMonitors(): Promise<number> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM release_promotions
        WHERE status='deploying' AND provider_deployment_id IS NOT NULL
        ORDER BY updated_at`,
    );
    let recovered = 0;
    for (const row of rows.rows) {
      if (await this.enqueueDeploymentMonitor(row.id)) recovered++;
    }
    return recovered;
  }

  private kpsReference(environment: Body) {
    const provider = String(environment.provider || "").trim().toLowerCase();
    if (provider !== "kps") {
      throw new ConflictException({
        error: provider
          ? `Deployment provider "${provider}" is not supported by Phase 7 Slice 2. Configure this release environment with provider "kps".`
          : 'Configure this release environment with provider "kps".',
      });
    }
    const projectRef = String(environment.provider_project_ref || "").trim();
    const workloadRef = String(environment.provider_workload_ref || "").trim();
    if (!projectRef || !workloadRef) {
      throw new ConflictException({
        error: "KPS deployment requires both providerProjectRef and providerWorkloadRef on the target release environment.",
      });
    }
    return { projectRef, workloadRef };
  }

  private async invalidateDeploymentApproval(
    projectId: string,
    promotion: Body,
    certification: Body | null,
    snapshot: Body,
    digest: string,
    nextStatus: "awaiting_qa" | "ready_for_approval",
    reason: string,
    actorId: string,
  ) {
    await this.db.query(
      `UPDATE release_promotions
          SET certification_id=$3,policy_snapshot=$4::jsonb,policy_digest=$5,status=$6,
              approved_by=NULL,approved_at=NULL,updated_at=now()
        WHERE id=$1 AND project_id=$2 AND status='approved'`,
      [promotion.id, projectId, certification?.id || null, JSON.stringify(snapshot), digest, nextStatus],
    );
    await this.insertEvent(
      String(promotion.id),
      "approval_invalidated",
      "approved",
      nextStatus,
      { reason, policyDigest: digest, blockers: snapshot.evaluation?.blockers || [] },
      actorId,
    );
  }

  async startDeployment(
    userId: string | null | undefined,
    projectId: string,
    promotionId: string,
  ) {
    await this.requireManager(userId, projectId);
    const uid = this.userId(userId);
    const promotion = await this.promotionDetail(projectId, promotionId) as Body;
    if (promotion.status !== "approved") {
      throw new ConflictException({ error: "Only an approved promotion can start deployment." });
    }

    const target = await this.requireEnvironment(projectId, String(promotion.targetEnvironmentId));
    const build = await this.requireBuild(projectId, String(promotion.buildId));
    const requestedGitSha = String(promotion.requestedGitSha || "").trim().toLowerCase();
    const buildGitSha = String(build.git_sha || "").trim().toLowerCase();
    if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(requestedGitSha)) {
      throw new ConflictException({
        error: "Exact deployment requires a full 40- or 64-character Git SHA. Register this build with its full commit SHA.",
      });
    }
    if (requestedGitSha !== buildGitSha) {
      throw new ConflictException({
        error: "The promotion's immutable requested SHA no longer matches its registered QA build. Deployment is blocked.",
      });
    }

    const certification = await this.latestCertification(String(promotion.buildId));
    const snapshot = this.policySnapshot(target, certification) as Body;
    const digest = this.policyDigest(snapshot);
    const evaluation = snapshot.evaluation as Body;
    if (!evaluation?.passed || digest !== String(promotion.policyDigest || "")) {
      const nextStatus = evaluation?.passed ? "ready_for_approval" : "awaiting_qa";
      await this.invalidateDeploymentApproval(
        projectId,
        promotion,
        certification,
        snapshot,
        digest,
        nextStatus,
        digest === String(promotion.policyDigest || "")
          ? "Release policy is no longer satisfied."
          : "Release evidence/policy changed after human approval.",
        uid,
      );
      throw new ConflictException({
        error: "Release evidence changed or no longer satisfies the target policy. Refresh and approve the promotion again.",
        blockers: evaluation?.blockers || [],
      });
    }

    const approvalCount = await this.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM release_promotion_approvals
        WHERE promotion_id=$1 AND decision='approved' AND policy_digest=$2`,
      [promotionId, digest],
    );
    const requiredApprovals = Number(target.required_approvals || 1);
    if (Number(approvalCount.rows[0]?.count || 0) < requiredApprovals) {
      await this.invalidateDeploymentApproval(
        projectId,
        promotion,
        certification,
        snapshot,
        digest,
        "ready_for_approval",
        "The required human approval count is no longer satisfied.",
        uid,
      );
      throw new ConflictException({ error: "Required human approvals are not satisfied." });
    }

    const ref = this.kpsReference(target);
    const claimed = await this.db.query(
      `UPDATE release_promotions
          SET status='deploying',deployment_started_at=now(),provider_deployment_status='requesting',
              provenance_status='pending',failure_reason=NULL,updated_at=now()
        WHERE id=$1 AND project_id=$2 AND status='approved'
        RETURNING id`,
      [promotionId, projectId],
    );
    if (!claimed.rows[0]) {
      throw new ConflictException({ error: "Promotion state changed; refresh before deploying." });
    }
    await this.insertEvent(
      promotionId,
      "deployment_requested",
      "approved",
      "deploying",
      {
        provider: "kps",
        providerProjectRef: ref.projectRef,
        providerWorkloadRef: ref.workloadRef,
        requestedGitSha,
      },
      uid,
    );

    let started;
    try {
      started = await this.kps.start({ ...ref, requestedGitSha });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.db.query(
        `UPDATE release_promotions
            SET status='deployment_failed',provider_deployment_status='request_failed',
                provenance_status='unavailable',provenance_checked_at=now(),
                failure_reason=$3,completed_at=now(),updated_at=now()
          WHERE id=$1 AND project_id=$2 AND status='deploying'`,
        [promotionId, projectId, reason],
      );
      await this.insertEvent(
        promotionId,
        "deployment_failed",
        "deploying",
        "deployment_failed",
        { stage: "provider_request", reason },
        uid,
      );
      throw new BadGatewayException({ error: "KPS deployment request failed: " + reason });
    }

    await this.db.query(
      `UPDATE release_promotions
          SET provider_deployment_id=$3,provider_deployment_status=$4,
              evidence=COALESCE(evidence,'{}'::jsonb) || $5::jsonb,updated_at=now()
        WHERE id=$1 AND project_id=$2 AND status='deploying'`,
      [
        promotionId,
        projectId,
        started.deploymentId,
        started.providerStatus,
        JSON.stringify({
          deploymentProvider: "kps",
          providerStart: {
            deploymentStrategy: started.deploymentStrategy,
            persistentVolumeCount: started.persistentVolumeCount,
            ...started.metadata,
          },
        }),
      ],
    );
    await this.insertEvent(
      promotionId,
      "deployment_queued",
      "deploying",
      "deploying",
      {
        provider: "kps",
        providerDeploymentId: started.deploymentId,
        providerStatus: started.providerStatus,
        deploymentStrategy: started.deploymentStrategy,
        persistentVolumeCount: started.persistentVolumeCount,
      },
      uid,
    );

    try {
      await this.enqueueDeploymentMonitor(promotionId);
    } catch (queueError) {
      const queueReason = queueError instanceof Error ? queueError.message : String(queueError);
      await this.db.query(
        `UPDATE release_promotions
            SET evidence=COALESCE(evidence,'{}'::jsonb) || $3::jsonb,updated_at=now()
          WHERE id=$1 AND project_id=$2 AND status='deploying'`,
        [promotionId, projectId, JSON.stringify({ monitorQueueWarning: queueReason })],
      );
      await this.insertEvent(
        promotionId,
        "monitor_queue_warning",
        "deploying",
        "deploying",
        { reason: queueReason },
        uid,
      );
    }

    await this.legacy.logProjectActivity(
      projectId,
      uid,
      "release_deployment_started",
      "release_promotion",
      promotionId,
      null,
      {
        provider: "kps",
        providerDeploymentId: started.deploymentId,
        requestedGitSha,
      },
    );
    return this.promotionDetail(projectId, promotionId);
  }

  private async deploymentMonitorRow(promotionId: string): Promise<Body | null> {
    const result = await this.db.query(
      `SELECT p.*,e.provider,e.provider_project_ref,e.provider_workload_ref,
              b.metadata AS build_metadata,b.config_fingerprint AS build_config_fingerprint
         FROM release_promotions p
         JOIN release_environments e ON e.id=p.target_environment_id
         JOIN qa_build_registry b ON b.id=p.build_id
        WHERE p.id=$1`,
      [promotionId],
    );
    return (result.rows[0] as Body | undefined) || null;
  }

  private async markDeploymentFailed(
    row: Body,
    reason: string,
    details: Record<string, unknown>,
    provenanceStatus: "pending" | "mismatch" | "unavailable" = "unavailable",
  ) {
    const updated = await this.db.query(
      `UPDATE release_promotions
          SET status='deployment_failed',provider_deployment_status=COALESCE($2,provider_deployment_status),
              provenance_status=$3,provenance_checked_at=now(),failure_reason=$4,
              completed_at=now(),updated_at=now()
        WHERE id=$1 AND status='deploying'
        RETURNING id`,
      [
        row.id,
        details.providerStatus ? String(details.providerStatus) : null,
        provenanceStatus,
        reason,
      ],
    );
    if (updated.rows[0]) {
      await this.insertEvent(
        String(row.id),
        provenanceStatus === "mismatch" ? "provenance_mismatch" : "deployment_failed",
        "deploying",
        "deployment_failed",
        { reason, ...details },
        null,
      );
    }
    return { status: "failed" as const, reason };
  }

  async monitorDeployment(promotionId: string) {
    const row = await this.deploymentMonitorRow(promotionId);
    if (!row) return { status: "terminal" as const, reason: "promotion_not_found" };
    if (row.status !== "deploying") {
      return { status: "terminal" as const, promotionStatus: String(row.status) };
    }
    if (!row.provider_deployment_id) {
      return { status: "pending" as const, providerStatus: "awaiting_provider_deployment_id" };
    }

    const ref = this.kpsReference(row);
    const observed = await this.kps.observe({
      ...ref,
      deploymentId: String(row.provider_deployment_id),
    });

    if (observed.state === "pending" || observed.state === "unknown") {
      await this.db.query(
        `UPDATE release_promotions
            SET provider_deployment_status=$2,
                evidence=COALESCE(evidence,'{}'::jsonb) || $3::jsonb,updated_at=now()
          WHERE id=$1 AND status='deploying'`,
        [
          promotionId,
          observed.providerStatus,
          JSON.stringify({ providerObservation: observed.metadata }),
        ],
      );
      return { status: "pending" as const, providerStatus: observed.providerStatus };
    }

    if (observed.state === "failed" || observed.state === "cancelled") {
      return this.markDeploymentFailed(
        row,
        "KPS/Coolify deployment ended with provider state " + observed.state + ".",
        {
          providerStatus: observed.providerStatus,
          providerState: observed.state,
          providerDeploymentId: row.provider_deployment_id,
        },
      );
    }

    const metadata =
      row.build_metadata && typeof row.build_metadata === "object" && !Array.isArray(row.build_metadata)
        ? row.build_metadata as Body
        : {};
    const expectedArtifactRef =
      String(metadata.providerArtifactRef || metadata.artifactRef || "").trim() || null;
    const expectedConfigurationHash =
      String(row.build_config_fingerprint || metadata.providerConfigurationHash || "").trim() || null;
    const provenance = evaluateDeploymentProvenance({
      requestedGitSha: String(row.requested_git_sha || ""),
      deployedGitSha: observed.deployedGitSha,
      expectedArtifactRef,
      providerArtifactRef: observed.artifactRef,
      expectedConfigurationHash,
      providerConfigurationHash: observed.configurationHash,
    });
    const artifactDigest =
      observed.artifactRef && /^sha256:[0-9a-f]{64}$/i.test(observed.artifactRef)
        ? observed.artifactRef
        : null;

    if (!provenance.matched) {
      await this.db.query(
        `UPDATE release_promotions
            SET deployed_git_sha=$2,provider_deployment_status=$3,
                provider_artifact_ref=$4,provider_configuration_hash=$5,artifact_digest=$6,
                provenance_status=$7,provenance_checked_at=now(),
                evidence=COALESCE(evidence,'{}'::jsonb) || $8::jsonb,updated_at=now()
          WHERE id=$1 AND status='deploying'`,
        [
          promotionId,
          observed.deployedGitSha,
          observed.providerStatus,
          observed.artifactRef,
          observed.configurationHash,
          artifactDigest,
          provenance.status,
          JSON.stringify({
            providerObservation: observed.metadata,
            provenance: { reasons: provenance.reasons },
          }),
        ],
      );
      return this.markDeploymentFailed(
        { ...row, id: promotionId },
        "Deployment provenance verification failed.",
        {
          providerStatus: observed.providerStatus,
          providerDeploymentId: row.provider_deployment_id,
          requestedGitSha: row.requested_git_sha,
          deployedGitSha: observed.deployedGitSha,
          providerArtifactRef: observed.artifactRef,
          providerConfigurationHash: observed.configurationHash,
          reasons: provenance.reasons,
        },
        provenance.status === "unavailable" ? "unavailable" : "mismatch",
      );
    }

    const changed = await this.db.query(
      `UPDATE release_promotions
          SET status='verifying',provider_deployment_status=$2,deployed_git_sha=$3,
              provider_artifact_ref=$4,provider_configuration_hash=$5,artifact_digest=$6,
              provenance_status='matched',provenance_checked_at=now(),deployed_at=now(),
              verification_started_at=now(),
              evidence=COALESCE(evidence,'{}'::jsonb) || $7::jsonb,updated_at=now()
        WHERE id=$1 AND status='deploying'
        RETURNING project_id,target_environment_id,build_id`,
      [
        promotionId,
        observed.providerStatus,
        observed.deployedGitSha,
        observed.artifactRef,
        observed.configurationHash,
        artifactDigest,
        JSON.stringify({
          providerObservation: observed.metadata,
          provenance: {
            matched: true,
            requestedGitSha: row.requested_git_sha,
            deployedGitSha: observed.deployedGitSha,
            providerArtifactRef: observed.artifactRef,
            providerConfigurationHash: observed.configurationHash,
          },
        }),
      ],
    );
    if (!changed.rows[0]) {
      return { status: "terminal" as const, promotionStatus: "state_changed" };
    }

    await this.db.query(
      `UPDATE release_environments
          SET current_build_id=$2,current_git_sha=$3,updated_at=now()
        WHERE id=$1`,
      [changed.rows[0].target_environment_id, changed.rows[0].build_id, observed.deployedGitSha],
    );
    await this.db.query(
      `UPDATE qa_build_registry
          SET deployment_timestamp=COALESCE(deployment_timestamp,now()),updated_at=now()
        WHERE id=$1`,
      [changed.rows[0].build_id],
    );
    await this.insertEvent(
      promotionId,
      "provenance_verified",
      "deploying",
      "verifying",
      {
        providerDeploymentId: row.provider_deployment_id,
        requestedGitSha: row.requested_git_sha,
        deployedGitSha: observed.deployedGitSha,
        providerArtifactRef: observed.artifactRef,
        providerConfigurationHash: observed.configurationHash,
      },
      null,
    );
    await this.enqueueVerificationMonitor(promotionId);
    return { status: "verified" as const, promotionStatus: "verifying" };
  }

  async failDeploymentTimeout(promotionId: string, reason: string) {
    const row = await this.deploymentMonitorRow(promotionId);
    if (!row || row.status !== "deploying") {
      return { status: "terminal" as const };
    }
    return this.markDeploymentFailed(
      row,
      reason,
      {
        providerStatus: row.provider_deployment_status || "monitor_timeout",
        providerDeploymentId: row.provider_deployment_id || null,
      },
      "unavailable",
    );
  }

  async refreshDeployment(
    userId: string | null | undefined,
    projectId: string,
    promotionId: string,
  ) {
    await this.requireManager(userId, projectId);
    const promotion = await this.promotionDetail(projectId, promotionId) as Body;
    if (promotion.status !== "deploying") return promotion;
    await this.monitorDeployment(promotionId);
    return this.promotionDetail(projectId, promotionId);
  }

  private verificationJobId(promotionId: string): string {
    return "release-verification-" + promotionId;
  }

  private async enqueueVerificationMonitor(promotionId: string): Promise<boolean> {
    const jobId = this.verificationJobId(promotionId);
    const existing = await this.deploymentQueue.getJob(jobId);
    if (existing) return false;
    await this.deploymentQueue.add(
      RELEASE_VERIFICATION_MONITOR_JOB,
      { promotionId },
      { jobId, ...this.deploymentJobOptions() },
    );
    return true;
  }

  async recoverVerificationMonitors(): Promise<number> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM release_promotions
        WHERE status='verifying' AND provenance_status='matched'
        ORDER BY updated_at`,
    );
    let recovered = 0;
    for (const row of rows.rows) {
      if (await this.enqueueVerificationMonitor(row.id)) recovered++;
    }
    return recovered;
  }

  private async verificationMonitorRow(promotionId: string): Promise<Body | null> {
    const res = await this.db.query(
      `SELECT p.*,
              te.name AS target_environment_name,
              te.slug AS target_environment_slug,
              te.environment_type AS target_environment_type,
              te.url AS target_environment_url,
              te.allowed_browsers AS target_allowed_browsers,
              te.settings AS target_settings,
              te.observation_minutes AS target_observation_minutes,
              te.known_good_build_id AS target_known_good_build_id,
              te.known_good_git_sha AS target_known_good_git_sha,
              b.repository,b.git_sha,b.branch_name,b.release_name,b.build_version
         FROM release_promotions p
         JOIN release_environments te ON te.id=p.target_environment_id
         JOIN qa_build_registry b ON b.id=p.build_id
        WHERE p.id=$1`,
      [promotionId],
    );
    return (res.rows[0] as Body | undefined) || null;
  }

  private verificationTarget(row: Body) {
    const baseUrl = String(row.target_environment_url || "").trim();
    if (!baseUrl) {
      throw new ConflictException({
        error: "Post-deployment verification requires a target environment URL.",
      });
    }
    const settings =
      row.target_settings && typeof row.target_settings === "object" && !Array.isArray(row.target_settings)
        ? row.target_settings as Body
        : {};
    const healthPath = String(settings.verificationHealthPath || settings.healthPath || "").trim();
    let healthUrl = baseUrl;
    if (healthPath) {
      try {
        healthUrl = new URL(healthPath, baseUrl.endsWith("/") ? baseUrl : baseUrl + "/").toString();
      } catch {
        throw new ConflictException({ error: "Release environment verification health path is invalid." });
      }
    }
    const browsers = (Array.isArray(row.target_allowed_browsers) ? row.target_allowed_browsers : [])
      .map((item: unknown) => String(item || "").trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 10);
    const environment = String(row.target_environment_slug || row.target_environment_name || "release").slice(0, 128);
    const matrix: Body[] = [
      { environment, browser: "", targetType: "production-safe", required: true },
      { environment, browser: "", targetType: "api", required: true },
      ...browsers.map((browser: string) => ({ environment, browser, targetType: "browser", required: true })),
    ];
    return { baseUrl, healthUrl, browsers, environment, matrix };
  }

  private async ensureVerificationRun(promotionId: string, actorId?: string | null) {
    let row = await this.verificationMonitorRow(promotionId);
    if (!row) throw new NotFoundException({ error: "Promotion not found" });
    if (row.status !== "verifying" || row.provenance_status !== "matched") {
      throw new ConflictException({
        error: "Post-deployment verification can start only after deployment provenance has matched.",
      });
    }
    if (row.verification_automation_run_id) {
      return { runId: String(row.verification_automation_run_id), created: false };
    }

    const target = this.verificationTarget(row);
    const actor = String(actorId || row.approved_by || row.requested_by || "").trim();
    if (!isUuid(actor)) {
      throw new ConflictException({ error: "Promotion has no valid project user available to start verification." });
    }
    const run = await this.qaAutomation.triggerManual(actor, String(row.project_id), {
      buildId: String(row.build_id),
      triggerKey:
        "release-verification:" +
        promotionId +
        ":" +
        String(row.provider_deployment_id || row.requested_git_sha || "deployment"),
      matrix: target.matrix,
      desiredShards: 2,
      maxParallelism: 4,
      retryLimit: 1,
      retryBackoffSeconds: 15,
      stuckAfterMinutes: 20,
      autoPrepareCertification: false,
      notifyOn: ["failed", "blocked", "stuck"],
      payload: {
        releaseVerification: {
          promotionId,
          targetEnvironmentId: row.target_environment_id,
          environmentName: row.target_environment_name,
          environmentType: row.target_environment_type,
          baseUrl: target.baseUrl,
          healthUrl: target.healthUrl,
          expectedGitSha: row.requested_git_sha,
          deployedGitSha: row.deployed_git_sha,
          providerDeploymentId: row.provider_deployment_id,
          providerArtifactRef: row.provider_artifact_ref,
          providerConfigurationHash: row.provider_configuration_hash,
          requiredPreflight: {
            kind: "http",
            url: target.healthUrl,
            expectedStatusMin: 200,
            expectedStatusMax: 399,
          },
        },
      },
    }) as Body;

    const updated = await this.db.query(
      `UPDATE release_promotions
          SET verification_automation_run_id=$2,
              verification_status=$3,
              verification_started_at=COALESCE(verification_started_at,now()),
              verification_checked_at=now(),
              failure_reason=NULL,
              updated_at=now()
        WHERE id=$1 AND status='verifying' AND verification_automation_run_id IS NULL
        RETURNING id`,
      [promotionId, run.id, String(run.status || "queued")],
    );
    if (updated.rows[0]) {
      await this.insertEvent(
        promotionId,
        "verification_requested",
        "verifying",
        "verifying",
        {
          automationRunId: run.id,
          targetEnvironmentId: row.target_environment_id,
          baseUrl: target.baseUrl,
          healthUrl: target.healthUrl,
          matrix: target.matrix,
          expectedGitSha: row.requested_git_sha,
          providerDeploymentId: row.provider_deployment_id,
        },
        actor,
      );
      return { runId: String(run.id), created: true };
    }

    row = await this.verificationMonitorRow(promotionId);
    if (row?.verification_automation_run_id) {
      return { runId: String(row.verification_automation_run_id), created: false };
    }
    throw new ConflictException({ error: "Promotion verification state changed while the QA run was being attached." });
  }

  async startVerification(
    userId: string | null | undefined,
    projectId: string,
    promotionId: string,
  ) {
    await this.requireManager(userId, projectId);
    const promotion = await this.promotionDetail(projectId, promotionId) as Body;
    if (promotion.status !== "verifying" || promotion.provenanceStatus !== "matched") {
      throw new ConflictException({
        error: "Verification can start only after exact deployment provenance has matched.",
      });
    }
    await this.ensureVerificationRun(promotionId, this.userId(userId));
    await this.enqueueVerificationMonitor(promotionId);
    return this.promotionDetail(projectId, promotionId);
  }

  async monitorVerification(promotionId: string) {
    let row = await this.verificationMonitorRow(promotionId);
    if (!row || row.status !== "verifying") {
      return { status: "terminal" as const, promotionStatus: row?.status || "missing" };
    }
    if (row.provenance_status !== "matched") {
      return this.failVerificationTimeout(
        promotionId,
        "Post-deployment verification was blocked because deployment provenance is not matched.",
      );
    }

    const attached = await this.ensureVerificationRun(promotionId);
    const runRes = await this.db.query(
      `SELECT id,status,plan_id,summary,error,trigger_payload,started_at,completed_at,updated_at
         FROM qa_automation_runs
        WHERE id=$1 AND project_id=$2`,
      [attached.runId, row.project_id],
    );
    const run = runRes.rows[0] as Body | undefined;
    if (!run) {
      return this.failVerificationTimeout(
        promotionId,
        "The linked Continuous-QA verification run no longer exists.",
      );
    }

    const runStatus = String(run.status || "");
    const summary = {
      automationRunId: run.id,
      planId: run.plan_id || null,
      status: runStatus,
      runSummary: run.summary || {},
      error: run.error || null,
      startedAt: run.started_at || null,
      completedAt: run.completed_at || null,
      providerDeploymentId: row.provider_deployment_id || null,
      expectedGitSha: row.requested_git_sha || null,
      deployedGitSha: row.deployed_git_sha || null,
    };
    await this.db.query(
      `UPDATE release_promotions
          SET verification_status=$2,verification_summary=$3::jsonb,
              verification_checked_at=now(),updated_at=now()
        WHERE id=$1 AND status='verifying'`,
      [promotionId, runStatus, JSON.stringify(summary)],
    );

    if (!["passed","failed","blocked","partial","stuck","cancelled"].includes(runStatus)) {
      return { status: "pending" as const, verificationStatus: runStatus, automationRunId: run.id };
    }

    if (runStatus === "passed") {
      const observationMinutes = Math.max(0, Math.min(10080, Number(row.target_observation_minutes || 0)));
      const changed = await this.db.query(
        `UPDATE release_promotions
            SET status='observation',verification_status='passed',
                verification_summary=$2::jsonb,verification_checked_at=now(),verified_at=now(),
                observation_started_at=now(),
                observation_ends_at=now()+($3::text || ' minutes')::interval,
                failure_reason=NULL,rollback_eligible=false,updated_at=now()
          WHERE id=$1 AND status='verifying'
          RETURNING id`,
        [promotionId, JSON.stringify(summary), observationMinutes],
      );
      if (changed.rows[0]) {
        await this.insertEvent(
          promotionId,
          "verification_passed",
          "verifying",
          "observation",
          {
            automationRunId: run.id,
            planId: run.plan_id || null,
            summary: run.summary || {},
            observationMinutes,
            providerDeploymentId: row.provider_deployment_id || null,
            deployedGitSha: row.deployed_git_sha || null,
          },
          null,
        );
      }
      return { status: "passed" as const, promotionStatus: "observation", automationRunId: run.id };
    }

    const rollbackEligible = Boolean(
      row.previous_known_good_build_id ||
      row.previous_known_good_git_sha ||
      row.target_known_good_build_id ||
      row.target_known_good_git_sha
    );
    const reason =
      "Post-deployment verification ended with Continuous-QA status " + runStatus +
      (run.error ? ": " + String(run.error) : ".");
    const changed = await this.db.query(
      `UPDATE release_promotions
          SET status='verification_failed',verification_status=$2,
              verification_summary=$3::jsonb,verification_checked_at=now(),
              failure_reason=$4,rollback_eligible=$5,completed_at=now(),updated_at=now()
        WHERE id=$1 AND status='verifying'
        RETURNING id`,
      [promotionId, runStatus, JSON.stringify(summary), reason, rollbackEligible],
    );
    if (changed.rows[0]) {
      await this.insertEvent(
        promotionId,
        "verification_failed",
        "verifying",
        "verification_failed",
        {
          automationRunId: run.id,
          planId: run.plan_id || null,
          verificationStatus: runStatus,
          summary: run.summary || {},
          error: run.error || null,
          rollbackEligible,
          providerDeploymentId: row.provider_deployment_id || null,
          deployedGitSha: row.deployed_git_sha || null,
        },
        null,
      );
    }
    return {
      status: "failed" as const,
      promotionStatus: "verification_failed",
      verificationStatus: runStatus,
      rollbackEligible,
      automationRunId: run.id,
    };
  }

  async failVerificationTimeout(promotionId: string, reason: string) {
    const row = await this.verificationMonitorRow(promotionId);
    if (!row || row.status !== "verifying") return { status: "terminal" as const };

    const rollbackEligible = Boolean(
      row.previous_known_good_build_id ||
      row.previous_known_good_git_sha ||
      row.target_known_good_build_id ||
      row.target_known_good_git_sha
    );
    const changed = await this.db.query(
      `UPDATE release_promotions
          SET status='verification_failed',
              verification_status=COALESCE(verification_status,'stuck'),
              verification_checked_at=now(),failure_reason=$2,
              rollback_eligible=$3,completed_at=now(),updated_at=now()
        WHERE id=$1 AND status='verifying'
        RETURNING id`,
      [promotionId, reason, rollbackEligible],
    );
    if (changed.rows[0]) {
      await this.insertEvent(
        promotionId,
        "verification_failed",
        "verifying",
        "verification_failed",
        { reason, rollbackEligible, stage: "verification_monitor" },
        null,
      );
    }
    return { status: "failed" as const, promotionStatus: "verification_failed", rollbackEligible };
  }

  async refreshVerification(
    userId: string | null | undefined,
    projectId: string,
    promotionId: string,
  ) {
    await this.requireManager(userId, projectId);
    const promotion = await this.promotionDetail(projectId, promotionId) as Body;
    if (promotion.status !== "verifying") return promotion;
    await this.monitorVerification(promotionId);
    return this.promotionDetail(projectId, promotionId);
  }

}
