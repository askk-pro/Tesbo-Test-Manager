import { InjectQueue } from "@nestjs/bullmq";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import type { Queue } from "bullmq";
import { DatabaseService } from "../database/database.service";
import { LegacyService } from "../legacy/legacy.service";
import {
  deriveAutomationRunStatus,
  durationAwareShards,
  nextScheduleAt,
  normalizeDailyTime,
  retryDelayMs,
  validateTimezone,
  type QaShardStatus,
} from "./qa-automation-intelligence";
import {
  QA_AUTOMATION_QUEUE,
  QA_AUTOMATION_RUN_JOB,
} from "./qa-automation.constants";

type Body = Record<string, any>;

function camelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function camelRow<T extends Body = Body>(row: Body): T {
  const out: Body = {};
  for (const [key, value] of Object.entries(row || {})) out[camelKey(key)] = value;
  return out as T;
}

function jsonArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function jsonObject(value: unknown): Body {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Body : {};
}

function boundedText(value: unknown, field: string, max: number, required = false): string {
  const text = String(value ?? "").trim();
  if (required && !text) throw new BadRequestException({ error: `${field} is required` });
  if (text.length > max) throw new BadRequestException({ error: `${field} must be ${max} characters or fewer` });
  return text;
}

@Injectable()
export class QaAutomationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly legacy: LegacyService,
    @InjectQueue(QA_AUTOMATION_QUEUE) private readonly queue: Queue,
  ) {}

  private normalizeScheduleType(value: unknown): "one_time" | "daily" | "interval" | "event" {
    const raw = String(value || "").trim().toLowerCase();
    if (raw === "recurring") return "interval";
    if (raw === "one_time" || raw === "daily" || raw === "interval" || raw === "event") return raw;
    throw new BadRequestException({ error: "scheduleType must be one_time, daily, interval/recurring, or event" });
  }

  private async requireManager(userId: string | null | undefined, projectId: string) {
    const project = await this.legacy.requireProjectAccess(userId, projectId);
    if (this.legacy.normalizeRole(String(project.caller_role || "")) === "qa_engineer") {
      throw new ForbiddenException({ error: "Only a project owner or manager can configure continuous QA schedules" });
    }
    return project;
  }

  private scheduleNext(input: {
    scheduleType: "one_time" | "daily" | "interval" | "event";
    timezone?: string | null;
    dailyTime?: string | null;
    intervalMinutes?: number | null;
    runAt?: string | Date | null;
    lastRunAt?: string | Date | null;
    currentNextRunAt?: string | Date | null;
  }, now = new Date()): Date | null {
    try {
      return nextScheduleAt(input, now);
    } catch (error) {
      throw new BadRequestException({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  private normalizeMatrix(value: unknown): Body[] {
    const rows = jsonArray(value).filter((row) => row && typeof row === "object").slice(0, 24) as Body[];
    const allowed = new Set(["browser", "api", "manual", "production-safe"]);
    const seen = new Set<string>();
    const out: Body[] = [];
    for (const row of rows) {
      const targetType = String(row.targetType || "").trim();
      if (!allowed.has(targetType)) continue;
      const environment = boundedText(row.environment || "", "matrix.environment", 128);
      const browser = boundedText(row.browser || "", "matrix.browser", 64);
      const key = [environment, browser, targetType].join("|").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ environment, browser, targetType, required: row.required !== false });
    }
    return out;
  }

  private normalizeNotifyOn(value: unknown): string[] {
    const allowed = new Set(["failed", "blocked", "stuck", "certification_changed", "recovered"]);
    const source = value === undefined
      ? ["failed", "blocked", "stuck", "certification_changed"]
      : jsonArray(value);
    return [...new Set(source.map((item) => String(item).toLowerCase()).filter((item) => allowed.has(item)))];
  }

  private schedulePayload(body: Body, current: Body = {}) {
    const scheduleType = this.normalizeScheduleType(body.scheduleType ?? current.scheduleType ?? "interval");
    const timezone = validateTimezone(body.timezone ?? current.timezone ?? "UTC");
    const dailyTime = scheduleType === "daily"
      ? normalizeDailyTime(body.dailyTime ?? current.dailyTime)
      : null;
    const intervalMinutes = scheduleType === "interval"
      ? Number(body.intervalMinutes ?? current.intervalMinutes ?? 1440)
      : null;
    if (intervalMinutes != null && (!Number.isInteger(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 10080)) {
      throw new BadRequestException({ error: "intervalMinutes must be an integer from 5 to 10080" });
    }
    const rawRunAt = scheduleType === "one_time" ? (body.runAt ?? current.runAt) : null;
    const runAt = rawRunAt ? new Date(String(rawRunAt)) : null;
    if (scheduleType === "one_time" && (!runAt || Number.isNaN(runAt.valueOf()) || runAt <= new Date())) {
      throw new BadRequestException({ error: "runAt must be a valid future date/time" });
    }
    const eventType = scheduleType === "event"
      ? boundedText(body.eventType ?? current.eventType, "eventType", 32, true)
      : null;
    if (eventType && !["build_registered", "build_deployed", "pr_updated"].includes(eventType)) {
      throw new BadRequestException({ error: "eventType must be build_registered, build_deployed, or pr_updated" });
    }
    const desiredShards = Number(body.desiredShards ?? current.desiredShards ?? 1);
    const maxParallelism = Number(body.maxParallelism ?? current.maxParallelism ?? 4);
    const retryLimit = Number(body.retryLimit ?? current.retryLimit ?? 1);
    const retryBackoffSeconds = Number(body.retryBackoffSeconds ?? current.retryBackoffSeconds ?? 30);
    const stuckAfterMinutes = Number(body.stuckAfterMinutes ?? current.stuckAfterMinutes ?? 30);
    if (!Number.isInteger(desiredShards) || desiredShards < 1 || desiredShards > 32) throw new BadRequestException({ error: "desiredShards must be 1-32" });
    if (!Number.isInteger(maxParallelism) || maxParallelism < 1 || maxParallelism > 32) throw new BadRequestException({ error: "maxParallelism must be 1-32" });
    if (!Number.isInteger(retryLimit) || retryLimit < 0 || retryLimit > 5) throw new BadRequestException({ error: "retryLimit must be 0-5" });
    if (!Number.isInteger(retryBackoffSeconds) || retryBackoffSeconds < 1 || retryBackoffSeconds > 3600) throw new BadRequestException({ error: "retryBackoffSeconds must be 1-3600" });
    if (!Number.isInteger(stuckAfterMinutes) || stuckAfterMinutes < 5 || stuckAfterMinutes > 1440) throw new BadRequestException({ error: "stuckAfterMinutes must be 5-1440" });

    const nextRunAt = scheduleType === "event"
      ? null
      : this.scheduleNext({
          scheduleType,
          timezone,
          dailyTime,
          intervalMinutes,
          runAt,
          lastRunAt: current.lastRunAt || null,
          currentNextRunAt: current.nextRunAt || null,
        });

    return {
      scheduleType,
      timezone,
      dailyTime,
      intervalMinutes,
      runAt,
      eventType,
      nextRunAt,
      desiredShards,
      maxParallelism,
      retryLimit,
      retryBackoffSeconds,
      stuckAfterMinutes,
      matrix: this.normalizeMatrix(body.matrix ?? current.matrix ?? []),
      notifyOn: this.normalizeNotifyOn(body.notifyOn ?? current.notifyOn),
      repository: boundedText(body.repository ?? current.repository ?? "", "repository", 1024) || null,
      branchFilter: boundedText(body.branchFilter ?? current.branchFilter ?? "", "branchFilter", 255) || null,
      environment: boundedText(body.environment ?? current.environment ?? "", "environment", 128),
      autoPrepareCertification: body.autoPrepareCertification ?? current.autoPrepareCertification ?? true,
      enabled: body.enabled ?? current.enabled ?? true,
      metadata: jsonObject(body.metadata ?? current.metadata ?? {}),
    };
  }

  private scheduleOutput(row: Body): Body {
    const item = camelRow(row);
    // Preserve the old schedule page contract while the Phase-6 page migrates to richer types.
    if (item.scheduleType === "interval") item.scheduleType = "recurring";
    item.matrix = jsonArray(row.matrix);
    item.notifyOn = jsonArray(row.notify_on);
    item.metadata = jsonObject(row.metadata);
    item.cycleId = null;
    item.lastError = row.last_status === "failed" ? String(row.metadata?.lastError || "") : null;
    return item;
  }

  async listSchedules(userId: string | null | undefined, projectId: string) {
    await this.legacy.requireProjectAccess(userId, projectId);
    const res = await this.db.query(
      `SELECT * FROM qa_automation_schedules
        WHERE project_id=$1 AND deleted_at IS NULL
        ORDER BY enabled DESC, COALESCE(next_run_at,created_at) ASC`,
      [projectId],
    );
    return res.rows.map((row) => this.scheduleOutput(row));
  }

  async createSchedule(userId: string | null | undefined, projectId: string, body: Body) {
    await this.requireManager(userId, projectId);
    const uid = String(userId);
    const name = boundedText(body.name, "name", 255, true);
    const p = this.schedulePayload(body);
    const res = await this.db.query(
      `INSERT INTO qa_automation_schedules
        (project_id,name,schedule_type,enabled,repository,branch_filter,event_type,timezone,daily_time,
         interval_minutes,run_at,next_run_at,environment,matrix,desired_shards,max_parallelism,retry_limit,
         retry_backoff_seconds,stuck_after_minutes,auto_prepare_certification,notify_on,metadata,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19,$20,$21::jsonb,$22::jsonb,$23,$23)
       RETURNING *`,
      [
        projectId, name, p.scheduleType, Boolean(p.enabled), p.repository, p.branchFilter, p.eventType,
        p.timezone, p.dailyTime, p.intervalMinutes, p.runAt?.toISOString() || null, p.nextRunAt?.toISOString() || null,
        p.environment, JSON.stringify(p.matrix), p.desiredShards, p.maxParallelism, p.retryLimit,
        p.retryBackoffSeconds, p.stuckAfterMinutes, Boolean(p.autoPrepareCertification),
        JSON.stringify(p.notifyOn), JSON.stringify(p.metadata), uid,
      ],
    );
    await this.legacy.logProjectActivity(projectId, uid, "qa_automation_schedule_created", "qa_automation_schedule", res.rows[0].id, name, {
      scheduleType: p.scheduleType,
      repository: p.repository,
      eventType: p.eventType,
      nextRunAt: p.nextRunAt?.toISOString() || null,
    });
    return this.scheduleOutput(res.rows[0]);
  }

  private async scheduleForUser(userId: string | null | undefined, scheduleId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(scheduleId)) throw new NotFoundException({ error: "Schedule not found" });
    const res = await this.db.query("SELECT * FROM qa_automation_schedules WHERE id=$1 AND deleted_at IS NULL", [scheduleId]);
    if (!res.rows[0]) throw new NotFoundException({ error: "Schedule not found" });
    await this.legacy.requireProjectAccess(userId, String(res.rows[0].project_id));
    return res.rows[0];
  }

  async updateSchedule(userId: string | null | undefined, scheduleId: string, body: Body) {
    const currentRaw = await this.scheduleForUser(userId, scheduleId);
    const projectId = String(currentRaw.project_id);
    await this.requireManager(userId, projectId);
    const current = this.scheduleOutput(currentRaw);
    // scheduleOutput aliases interval to recurring; translate back for validation.
    if (current.scheduleType === "recurring") current.scheduleType = "interval";
    const name = body.name !== undefined ? boundedText(body.name, "name", 255, true) : String(current.name);
    const p = this.schedulePayload(body, current);
    const res = await this.db.query(
      `UPDATE qa_automation_schedules SET
        name=$3,schedule_type=$4,enabled=$5,repository=$6,branch_filter=$7,event_type=$8,timezone=$9,daily_time=$10,
        interval_minutes=$11,run_at=$12,next_run_at=$13,environment=$14,matrix=$15::jsonb,desired_shards=$16,
        max_parallelism=$17,retry_limit=$18,retry_backoff_seconds=$19,stuck_after_minutes=$20,
        auto_prepare_certification=$21,notify_on=$22::jsonb,metadata=$23::jsonb,updated_by=$24,updated_at=now()
       WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL RETURNING *`,
      [
        scheduleId, projectId, name, p.scheduleType, Boolean(p.enabled), p.repository, p.branchFilter, p.eventType,
        p.timezone, p.dailyTime, p.intervalMinutes, p.runAt?.toISOString() || null,
        Boolean(p.enabled) ? p.nextRunAt?.toISOString() || null : null, p.environment, JSON.stringify(p.matrix),
        p.desiredShards, p.maxParallelism, p.retryLimit, p.retryBackoffSeconds, p.stuckAfterMinutes,
        Boolean(p.autoPrepareCertification), JSON.stringify(p.notifyOn), JSON.stringify(p.metadata), String(userId),
      ],
    );
    await this.legacy.logProjectActivity(projectId, String(userId), "qa_automation_schedule_updated", "qa_automation_schedule", scheduleId, name, {
      enabled: Boolean(p.enabled), nextRunAt: p.nextRunAt?.toISOString() || null,
    });
    return this.scheduleOutput(res.rows[0]);
  }

  async deleteSchedule(userId: string | null | undefined, scheduleId: string) {
    const current = await this.scheduleForUser(userId, scheduleId);
    const projectId = String(current.project_id);
    await this.requireManager(userId, projectId);
    await this.db.query(
      "UPDATE qa_automation_schedules SET deleted_at=now(),enabled=false,next_run_at=NULL,updated_by=$2,updated_at=now() WHERE id=$1",
      [scheduleId, String(userId)],
    );
    await this.legacy.logProjectActivity(projectId, String(userId), "qa_automation_schedule_deleted", "qa_automation_schedule", scheduleId, current.name, {});
    return { ok: true, id: scheduleId };
  }

  private async pickBuild(projectId: string, schedule: Body, explicitBuildId?: string | null): Promise<Body> {
    if (explicitBuildId) {
      const res = await this.db.query("SELECT * FROM qa_build_registry WHERE id=$1 AND project_id=$2", [explicitBuildId, projectId]);
      if (!res.rows[0]) throw new NotFoundException({ error: "Build not found" });
      return camelRow(res.rows[0]);
    }
    const params: any[] = [projectId];
    const where = ["project_id=$1"];
    if (schedule.repository) {
      params.push(schedule.repository);
      where.push(`repository=$${params.length}`);
    }
    if (schedule.environment) {
      params.push(schedule.environment);
      where.push(`environment=$${params.length}`);
    }
    if (schedule.branch_filter) {
      params.push(schedule.branch_filter);
      where.push(`branch_name=$${params.length}`);
    }
    const res = await this.db.query(
      `SELECT * FROM qa_build_registry WHERE ${where.join(" AND ")}
       ORDER BY COALESCE(deployment_timestamp,created_at) DESC LIMIT 1`,
      params,
    );
    if (!res.rows[0]) throw new ConflictException({ error: "No registered build matches this continuous-QA schedule" });
    return camelRow(res.rows[0]);
  }

  private async projectAutomationActor(projectId: string, preferred?: string | null): Promise<string> {
    if (preferred) {
      const member = await this.db.query("SELECT user_id FROM project_members WHERE project_id=$1 AND user_id=$2 LIMIT 1", [projectId, preferred]);
      if (member.rows[0]) return String(preferred);
    }
    const res = await this.db.query(
      `SELECT user_id FROM project_members
        WHERE project_id=$1
        ORDER BY CASE lower(role) WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, created_at ASC
        LIMIT 1`,
      [projectId],
    );
    if (!res.rows[0]) throw new ConflictException({ error: "Project has no member available to own automated QA operations" });
    return String(res.rows[0].user_id);
  }

  private async enqueueRun(automationRunId: string) {
    await this.queue.add(
      QA_AUTOMATION_RUN_JOB,
      { automationRunId },
      {
        jobId: `qa-run-${automationRunId}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    );
  }

  private async createAutomationRun(
    projectId: string,
    schedule: Body,
    triggerSource: "schedule" | "event" | "manual" | "mcp" | "recovery",
    triggerKey: string,
    buildId?: string | null,
    triggerPayload: Body = {},
    createdBy?: string | null,
    scheduledFor?: Date | null,
  ) {
    const build = await this.pickBuild(projectId, schedule, buildId);
    const actor = await this.projectAutomationActor(projectId, createdBy || schedule.created_by || null);
    const before = await this.legacy.getReleaseCertification(actor, projectId, String(build.id)).catch(() => ({ status: "not_prepared" }));
    const res = await this.db.query(
      `INSERT INTO qa_automation_runs
        (project_id,schedule_id,build_id,trigger_source,trigger_key,trigger_payload,status,scheduled_for,
         desired_shards,max_parallelism,retry_limit,retry_backoff_seconds,stuck_after_minutes,
         certification_before,created_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,'queued',$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
       ON CONFLICT (project_id,trigger_key) DO UPDATE SET updated_at=now()
       RETURNING *`,
      [
        projectId, schedule.id || null, build.id, triggerSource, triggerKey, JSON.stringify(triggerPayload),
        scheduledFor?.toISOString() || null,
        Number(schedule.desired_shards ?? schedule.desiredShards ?? 1),
        Number(schedule.max_parallelism ?? schedule.maxParallelism ?? 4),
        Number(schedule.retry_limit ?? schedule.retryLimit ?? 1),
        Number(schedule.retry_backoff_seconds ?? schedule.retryBackoffSeconds ?? 30),
        Number(schedule.stuck_after_minutes ?? schedule.stuckAfterMinutes ?? 30),
        JSON.stringify(before || {}), actor,
      ],
    );
    const run = camelRow(res.rows[0]);
    await this.enqueueRun(String(run.id));
    return run;
  }

  async triggerManual(userId: string | null | undefined, projectId: string, body: Body) {
    await this.legacy.requireProjectAccess(userId, projectId);
    const schedule = body.scheduleId
      ? await this.scheduleForUser(userId, String(body.scheduleId))
      : {
          id: null,
          project_id: projectId,
          repository: body.repository || null,
          branch_filter: body.branchFilter || null,
          environment: body.environment || "",
          matrix: this.normalizeMatrix(body.matrix),
          desired_shards: Math.max(1, Math.min(32, Number(body.desiredShards || 1))),
          max_parallelism: Math.max(1, Math.min(32, Number(body.maxParallelism || 4))),
          retry_limit: Math.max(0, Math.min(5, Number(body.retryLimit || 1))),
          retry_backoff_seconds: Math.max(1, Math.min(3600, Number(body.retryBackoffSeconds || 30))),
          stuck_after_minutes: Math.max(5, Math.min(1440, Number(body.stuckAfterMinutes || 30))),
          auto_prepare_certification: body.autoPrepareCertification !== false,
          notify_on: this.normalizeNotifyOn(body.notifyOn),
          created_by: userId,
        };
    const key = boundedText(body.triggerKey || `manual-${randomBytes(12).toString("hex")}`, "triggerKey", 255, true);
    return this.createAutomationRun(
      projectId,
      schedule,
      body.triggerSource === "mcp" ? "mcp" : "manual",
      key,
      body.buildId ? String(body.buildId) : null,
      {
        ...jsonObject(body.payload),
        automationMatrix: jsonArray(schedule.matrix),
      },
      String(userId),
      new Date(),
    );
  }

  async dispatchDueSchedules(limit = 50) {
    const now = new Date();
    const claimed = await this.db.transaction(async (client) => {
      const res = await client.query(
        `SELECT * FROM qa_automation_schedules
          WHERE deleted_at IS NULL AND enabled=true AND schedule_type<>'event'
            AND next_run_at IS NOT NULL AND next_run_at <= now()
          ORDER BY next_run_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1`,
        [Math.max(1, Math.min(200, limit))],
      );
      const rows: Body[] = [];
      for (const row of res.rows) {
        const scheduledFor = new Date(row.next_run_at);
        let next: Date | null = null;
        let enabled = true;
        if (row.schedule_type === "one_time") {
          enabled = false;
        } else {
          next = this.scheduleNext({
            scheduleType: row.schedule_type,
            timezone: row.timezone,
            dailyTime: row.daily_time,
            intervalMinutes: row.interval_minutes,
            runAt: row.run_at,
            lastRunAt: scheduledFor,
            currentNextRunAt: scheduledFor,
          }, new Date(Math.max(now.valueOf(), scheduledFor.valueOf())));
        }
        await client.query(
          `UPDATE qa_automation_schedules
            SET last_run_at=$2,last_status='queued',next_run_at=$3,enabled=$4,updated_at=now()
            WHERE id=$1`,
          [row.id, scheduledFor.toISOString(), next?.toISOString() || null, enabled],
        );
        rows.push({ ...row, _scheduledFor: scheduledFor, _nextRunAt: next });
      }
      return rows;
    });

    const results: Body[] = [];
    for (const schedule of claimed) {
      const scheduledFor = schedule._scheduledFor as Date;
      const triggerKey = `schedule:${schedule.id}:${scheduledFor.toISOString()}`;
      try {
        const run = await this.createAutomationRun(
          String(schedule.project_id),
          schedule,
          "schedule",
          triggerKey,
          null,
          { scheduleId: schedule.id, scheduledFor: scheduledFor.toISOString() },
          String(schedule.created_by),
          scheduledFor,
        );
        results.push({ scheduleId: schedule.id, runId: run.id, ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.db.query(
          `UPDATE qa_automation_schedules
            SET last_status='failed',metadata=metadata || jsonb_build_object('lastError',$2),updated_at=now()
            WHERE id=$1`,
          [schedule.id, message.slice(0, 5000)],
        );
        await this.openAlert(String(schedule.project_id), null, String(schedule.id), "high", "schedule_failed",
          `qa-schedule-failed:${schedule.id}:${scheduledFor.toISOString()}`,
          `Continuous QA schedule failed: ${schedule.name}`, message, { scheduledFor: scheduledFor.toISOString() });
        results.push({ scheduleId: schedule.id, ok: false, error: message });
      }
    }
    return results;
  }

  async dispatchOutboxEvents(limit = 50) {
    const events = await this.db.transaction(async (client) => {
      const res = await client.query(
        `SELECT * FROM qa_automation_event_outbox
          WHERE processed_at IS NULL AND available_at <= now()
            AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes')
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1`,
        [Math.max(1, Math.min(200, limit))],
      );
      if (res.rows.length) {
        await client.query(
          `UPDATE qa_automation_event_outbox
            SET claimed_at=now(),attempts=attempts+1
            WHERE id = ANY($1::uuid[])`,
          [res.rows.map((row) => row.id)],
        );
      }
      return res.rows;
    });

    const results: Body[] = [];
    for (const event of events) {
      try {
        const schedules = await this.db.query(
          `SELECT s.*, b.repository AS build_repository,b.branch_name AS build_branch,b.environment AS build_environment
             FROM qa_automation_schedules s
             JOIN qa_build_registry b ON b.id=$2 AND b.project_id=s.project_id
            WHERE s.project_id=$1 AND s.deleted_at IS NULL AND s.enabled=true
              AND s.schedule_type='event' AND s.event_type=$3
              AND (s.repository IS NULL OR s.repository=b.repository)
              AND (s.branch_filter IS NULL OR s.branch_filter=b.branch_name)
              AND (s.environment='' OR s.environment=b.environment)`,
          [event.project_id, event.build_id, event.event_type],
        );
        for (const schedule of schedules.rows) {
          await this.createAutomationRun(
            String(event.project_id),
            schedule,
            "event",
            `event:${event.id}:${schedule.id}`,
            String(event.build_id),
            { outboxEventId: event.id, eventType: event.event_type, ...jsonObject(event.payload) },
            String(schedule.created_by),
            new Date(event.created_at),
          );
        }
        await this.db.query(
          "UPDATE qa_automation_event_outbox SET processed_at=now(),claimed_at=NULL,last_error=NULL WHERE id=$1",
          [event.id],
        );
        results.push({ eventId: event.id, schedules: schedules.rows.length, ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const delaySeconds = Math.min(3600, 30 * 2 ** Math.min(6, Number(event.attempts || 0)));
        await this.db.query(
          `UPDATE qa_automation_event_outbox
            SET claimed_at=NULL,last_error=$2,available_at=now()+($3::text || ' seconds')::interval
            WHERE id=$1`,
          [event.id, message.slice(0, 5000), delaySeconds],
        );
        results.push({ eventId: event.id, ok: false, error: message });
      }
    }
    return results;
  }

  async requeueOrphanedAutomationRuns(limit = 50) {
    const res = await this.db.query(
      `SELECT id FROM qa_automation_runs
        WHERE status IN ('queued','planning')
          AND updated_at < now() - interval '1 minute'
        ORDER BY updated_at ASC LIMIT $1`,
      [Math.max(1, Math.min(200, limit))],
    );
    for (const row of res.rows) await this.enqueueRun(String(row.id)).catch(() => undefined);
    return res.rows.length;
  }

  private async automationRun(runId: string): Promise<Body> {
    const res = await this.db.query(
      `SELECT r.*,s.matrix AS schedule_matrix,s.auto_prepare_certification,s.notify_on,
              s.repository AS schedule_repository,s.environment AS schedule_environment
         FROM qa_automation_runs r
         LEFT JOIN qa_automation_schedules s ON s.id=r.schedule_id
        WHERE r.id=$1`,
      [runId],
    );
    if (!res.rows[0]) throw new NotFoundException({ error: "Automation run not found" });
    return res.rows[0];
  }

  async orchestrateRun(runId: string) {
    const run = await this.automationRun(runId);
    if (["passed","failed","blocked","partial","stuck","cancelled"].includes(String(run.status))) return { runId, status: run.status };
    const projectId = String(run.project_id);
    const actor = await this.projectAutomationActor(projectId, run.created_by ? String(run.created_by) : null);
    const buildId = String(run.build_id);

    await this.db.query(
      `UPDATE qa_automation_runs SET status='planning',started_at=COALESCE(started_at,now()),heartbeat_at=now(),updated_at=now()
        WHERE id=$1`,
      [runId],
    );

    let planId = run.plan_id ? String(run.plan_id) : "";
    let plan: Body;
    if (!planId) {
      const triggerPayload = jsonObject(run.trigger_payload);
      const scheduleMatrix = jsonArray(run.schedule_matrix);
      const manualMatrix = jsonArray(triggerPayload.automationMatrix);
      const matrix = scheduleMatrix.length ? scheduleMatrix : manualMatrix;
      const generated = await this.legacy.generateRegressionPlan(actor, projectId, buildId, { matrix }, actor) as Body;
      planId = String(generated.id);
      plan = generated;
      await this.db.query("UPDATE qa_automation_runs SET plan_id=$2,updated_at=now() WHERE id=$1", [runId, planId]);
    } else {
      plan = await this.legacy.getRegressionPlan(actor, projectId, planId) as Body;
    }

    const matrix = jsonArray(plan.matrix);
    let createdCount = 0;
    let skippedTargets = 0;
    for (const rawTarget of matrix) {
      const target = rawTarget as Body;
      const targetCases = await this.legacy.getAutomationRegressionTargetCases(actor, projectId, planId, target) as Body;
      const cases = jsonArray(targetCases.cases);
      if (!cases.length) {
        skippedTargets += 1;
        continue;
      }
      const desired = String(target.targetType) === "manual" ? 1 : Number(run.desired_shards || 1);
      const shards = durationAwareShards(
        cases.map((item: Body) => ({ testcaseId: String(item.testcaseId), estimatedDurationMs: Number(item.estimatedDurationMs || 30000) })),
        desired,
      );
      for (const shard of shards) {
        const env = String(target.environment || "");
        const browser = String(target.browser || "");
        const targetType = String(target.targetType || "manual");
        const placeholder = await this.db.query(
          `INSERT INTO qa_automation_shards
            (automation_run_id,project_id,plan_id,environment,browser,target_type,shard_index,shard_total,
             estimated_duration_ms,testcase_ids,status,max_attempts)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'queued',$11)
           ON CONFLICT (automation_run_id,environment,browser,target_type,shard_index) DO NOTHING
           RETURNING *`,
          [
            runId, projectId, planId, env, browser, targetType, shard.shardIndex, shards.length,
            shard.estimatedDurationMs, JSON.stringify(shard.testcaseIds), Number(run.retry_limit || 0) + 1,
          ],
        );
        let shardRow = placeholder.rows[0];
        if (!shardRow) {
          const existing = await this.db.query(
            `SELECT * FROM qa_automation_shards
              WHERE automation_run_id=$1 AND environment=$2 AND browser=$3 AND target_type=$4 AND shard_index=$5`,
            [runId, env, browser, targetType, shard.shardIndex],
          );
          shardRow = existing.rows[0];
        }
        if (!shardRow) continue;

        let cycleId = shardRow.cycle_id ? String(shardRow.cycle_id) : "";
        if (!cycleId) {
          const recovered = await this.db.query(
            `SELECT cycle_id FROM qa_regression_plan_runs
              WHERE automation_run_id=$1 AND environment=$2 AND browser=$3 AND target_type=$4 AND shard_index=$5
              LIMIT 1`,
            [runId, env, browser, targetType, shard.shardIndex],
          );
          cycleId = recovered.rows[0]?.cycle_id ? String(recovered.rows[0].cycle_id) : "";
        }
        if (!cycleId) {
          try {
            const created = await this.legacy.createAutomationRegressionShard(
              actor,
              projectId,
              planId,
              {
                target,
                testcaseIds: shard.testcaseIds,
                automationRunId: runId,
                shardIndex: shard.shardIndex,
                shardTotal: shards.length,
                estimatedDurationMs: shard.estimatedDurationMs,
                automationAttempt: 0,
              },
              actor,
            ) as Body;
            cycleId = String(created.cycleId);
          } catch (error: any) {
            if (String(error?.code || "") !== "23505") throw error;
            const recovered = await this.db.query(
              `SELECT cycle_id FROM qa_regression_plan_runs
                WHERE automation_run_id=$1 AND environment=$2 AND browser=$3 AND target_type=$4 AND shard_index=$5
                LIMIT 1`,
              [runId, env, browser, targetType, shard.shardIndex],
            );
            cycleId = recovered.rows[0]?.cycle_id ? String(recovered.rows[0].cycle_id) : "";
            if (!cycleId) throw error;
          }
        }
        await this.db.query(
          "UPDATE qa_automation_shards SET cycle_id=$2,updated_at=now() WHERE id=$1",
          [shardRow.id, cycleId],
        );
        createdCount += 1;
      }
    }

    if (!createdCount) {
      await this.db.query(
        "UPDATE qa_automation_runs SET status='blocked',completed_at=now(),error='No applicable regression shards could be created',updated_at=now() WHERE id=$1",
        [runId],
      );
      await this.openAlert(projectId, runId, run.schedule_id ? String(run.schedule_id) : null, "high", "blocked",
        `qa-run-blocked:${runId}`, "Continuous QA run blocked", "No applicable regression shards could be created.", { buildId, planId });
      return { runId, status: "blocked", createdShards: 0 };
    }

    await this.db.query(
      `UPDATE qa_automation_runs SET status='waiting_workers',heartbeat_at=now(),
        summary=jsonb_build_object('createdShards',$2::int,'skippedTargets',$3::int),updated_at=now()
        WHERE id=$1`,
      [runId, createdCount, skippedTargets],
    );
    await this.legacy.logProjectActivity(projectId, actor, "qa_automation_run_planned", "qa_automation_run", runId, null, {
      buildId, planId, createdShards: createdCount, skippedTargets,
    });
    return { runId, status: "waiting_workers", planId, createdShards: createdCount, skippedTargets };
  }

  private claimHash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  async claimShard(userId: string | null | undefined, projectId: string, body: Body) {
    await this.legacy.requireProjectAccess(userId, projectId);
    const workerId = boundedText(body.workerId, "workerId", 255, true);
    const browsers = jsonArray(body.browsers).map(String).filter(Boolean).slice(0, 20);
    const targetTypes = jsonArray(body.targetTypes).map(String).filter(Boolean).slice(0, 10);
    const token = randomBytes(32).toString("hex");
    const hash = this.claimHash(token);

    const shard = await this.db.transaction(async (client) => {
      const params: any[] = [projectId];
      const filters = [
        "s.project_id=$1",
        "s.status='queued'",
        "s.cycle_id IS NOT NULL",
        "s.target_type<>'manual'",
        "(s.next_attempt_at IS NULL OR s.next_attempt_at<=now())",
        `(SELECT COUNT(*) FROM qa_automation_shards active
            WHERE active.automation_run_id=s.automation_run_id AND active.status IN ('claimed','running')) < r.max_parallelism`,
      ];
      if (browsers.length) {
        params.push(browsers);
        filters.push(`(s.browser='' OR s.browser=ANY($${params.length}::text[]))`);
      }
      if (targetTypes.length) {
        params.push(targetTypes);
        filters.push(`s.target_type=ANY($${params.length}::text[])`);
      }
      const found = await client.query(
        `SELECT s.* FROM qa_automation_shards s
         JOIN qa_automation_runs r ON r.id=s.automation_run_id
         WHERE ${filters.join(" AND ")}
         ORDER BY s.created_at ASC,s.shard_index ASC
         FOR UPDATE OF s SKIP LOCKED LIMIT 1`,
        params,
      );
      const row = found.rows[0];
      if (!row) return null;

      // Serialize claims per automation run. Row-level SKIP LOCKED protects one shard, but two
      // workers can otherwise lock different shards from the same run and both observe free
      // capacity. The transaction advisory lock makes maxParallelism an actual invariant.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [String(row.automation_run_id)]);
      const capacity = await client.query(
        `SELECT r.max_parallelism,
                COUNT(s.id) FILTER (WHERE s.status IN ('claimed','running'))::int AS active
           FROM qa_automation_runs r
           LEFT JOIN qa_automation_shards s ON s.automation_run_id=r.id
          WHERE r.id=$1
          GROUP BY r.id`,
        [row.automation_run_id],
      );
      if (Number(capacity.rows[0]?.active || 0) >= Number(capacity.rows[0]?.max_parallelism || 1)) return null;

      const updated = await client.query(
        `UPDATE qa_automation_shards
          SET status='claimed',attempts=attempts+1,worker_id=$2,claim_token_hash=$3,
              claimed_at=now(),heartbeat_at=now(),next_attempt_at=NULL,updated_at=now()
          WHERE id=$1 RETURNING *`,
        [row.id, workerId, hash],
      );
      await client.query(
        "UPDATE qa_automation_runs SET status='running',heartbeat_at=now(),updated_at=now() WHERE id=$1",
        [row.automation_run_id],
      );
      return updated.rows[0];
    });

    if (!shard) return { shard: null };
    const runContextRes = await this.db.query(
      `SELECT trigger_source,trigger_key,trigger_payload,build_id
         FROM qa_automation_runs
        WHERE id=$1`,
      [shard.automation_run_id],
    );
    const runContext = runContextRes.rows[0] || {};
    const triggerPayload = jsonObject(runContext.trigger_payload);
    const cases = await this.db.query(
      `SELECT t.id,t.human_id,t.external_id,t.title,t.type,t.automation_status,t.automation_path,
              t.automation_framework,t.automation_tags
         FROM testcases t
        WHERE t.project_id=$1 AND t.id = ANY($2::uuid[]) AND t.deleted_at IS NULL
        ORDER BY array_position($2::uuid[],t.id)`,
      [projectId, jsonArray(shard.testcase_ids).map(String)],
    );
    return {
      shard: {
        ...camelRow(shard),
        claimToken: token,
        testcases: cases.rows.map(camelRow),
        automationContext: {
          triggerSource: runContext.trigger_source || null,
          triggerKey: runContext.trigger_key || null,
          buildId: runContext.build_id || null,
          payload: triggerPayload,
        },
        verificationContext: jsonObject(triggerPayload.releaseVerification),
        resultIngest: {
          runId: shard.cycle_id,
          resultsPath: `/api/projects/${projectId}/automation/runs/${shard.cycle_id}/results`,
          closePath: `/api/projects/${projectId}/automation/runs/${shard.cycle_id}/close`,
        },
      },
    };
  }

  private async requireClaim(projectId: string, shardId: string, claimToken: string) {
    const hash = this.claimHash(claimToken);
    const res = await this.db.query(
      `SELECT s.*,r.retry_backoff_seconds,r.stuck_after_minutes
         FROM qa_automation_shards s
         JOIN qa_automation_runs r ON r.id=s.automation_run_id
        WHERE s.id=$1 AND s.project_id=$2 AND s.claim_token_hash=$3`,
      [shardId, projectId, hash],
    );
    if (!res.rows[0]) throw new ForbiddenException({ error: "Invalid or expired shard claim token" });
    return res.rows[0];
  }

  async heartbeatShard(userId: string | null | undefined, projectId: string, shardId: string, body: Body) {
    await this.legacy.requireProjectAccess(userId, projectId);
    const claimToken = boundedText(body.claimToken, "claimToken", 128, true);
    const shard = await this.requireClaim(projectId, shardId, claimToken);
    if (!["claimed","running"].includes(String(shard.status))) throw new ConflictException({ error: "Shard is no longer active" });
    await this.db.query(
      "UPDATE qa_automation_shards SET status='running',heartbeat_at=now(),updated_at=now() WHERE id=$1",
      [shardId],
    );
    await this.db.query(
      "UPDATE qa_automation_runs SET status='running',heartbeat_at=now(),updated_at=now() WHERE id=$1",
      [shard.automation_run_id],
    );
    return { ok: true, shardId, status: "running" };
  }

  private async cycleSummary(cycleId: string) {
    const res = await this.db.query(
      `SELECT COUNT(e.id)::int AS total,
              COUNT(e.id) FILTER (WHERE e.status='Passed')::int AS passed,
              COUNT(e.id) FILTER (WHERE e.status='Failed')::int AS failed,
              COUNT(e.id) FILTER (WHERE e.status='Blocked')::int AS blocked,
              COUNT(e.id) FILTER (WHERE e.status='Skipped')::int AS skipped,
              COUNT(e.id) FILTER (WHERE e.status IN ('Untested','Retest'))::int AS pending
         FROM cycle_items ci
         JOIN executions e ON e.cycle_item_id=ci.id AND e.deleted_at IS NULL
        WHERE ci.cycle_id=$1 AND ci.deleted_at IS NULL`,
      [cycleId],
    );
    return camelRow(res.rows[0] || {});
  }

  async completeShard(userId: string | null | undefined, projectId: string, shardId: string, body: Body) {
    await this.legacy.requireProjectAccess(userId, projectId);
    const claimToken = boundedText(body.claimToken, "claimToken", 128, true);
    const shard = await this.requireClaim(projectId, shardId, claimToken);
    if (!["claimed","running"].includes(String(shard.status))) throw new ConflictException({ error: "Shard is no longer active" });
    const cycleId = String(shard.cycle_id || "");
    let summary = cycleId ? await this.cycleSummary(cycleId) : { total: 0, pending: 0, failed: 0, blocked: 0 };
    const infrastructureFailure = Boolean(body.infrastructureFailure);
    if (infrastructureFailure && cycleId && Number(summary.pending || 0) > 0) {
      const infrastructureError = boundedText(body.error || "Automation worker was interrupted", "error", 5000);
      await this.db.query(
        `UPDATE executions e
            SET status='Blocked',actual_result=COALESCE(NULLIF(actual_result,''),$2),
                error_message=COALESCE(NULLIF(error_message,''),$2),
                executed_at=COALESCE(executed_at,now()),reported_by='automation'
           FROM cycle_items ci
          WHERE ci.id=e.cycle_item_id AND ci.cycle_id=$1 AND ci.deleted_at IS NULL
            AND e.deleted_at IS NULL AND e.status IN ('Untested','Retest')`,
        [cycleId, infrastructureError],
      );
      summary = await this.cycleSummary(cycleId);
    }
    if (Number(summary.pending || 0) > 0 && !infrastructureFailure) {
      throw new ConflictException({
        error: "Shard still has pending executions. Report/close all results before completing the shard.",
        pending: Number(summary.pending || 0),
      });
    }

    let terminal: QaShardStatus = "passed";
    if (infrastructureFailure || Number(summary.blocked || 0) > 0) terminal = "blocked";
    else if (Number(summary.failed || 0) > 0) terminal = "failed";

    const canRetry = ["failed","blocked"].includes(terminal) &&
      Number(shard.attempts || 0) < Number(shard.max_attempts || 1) &&
      body.noRetry !== true;

    if (canRetry) {
      const delay = retryDelayMs(Number(shard.attempts || 1), Number(shard.retry_backoff_seconds || 30));
      const failedCases = cycleId
        ? await this.db.query(
            `SELECT ci.testcase_id
               FROM cycle_items ci
               JOIN executions e ON e.cycle_item_id=ci.id AND e.deleted_at IS NULL
              WHERE ci.cycle_id=$1 AND ci.deleted_at IS NULL AND e.status IN ('Failed','Blocked')
              ORDER BY ci.position`,
            [cycleId],
          )
        : { rows: [] as Body[] };
      const retryTestcaseIds = infrastructureFailure && !failedCases.rows.length
        ? jsonArray(shard.testcase_ids).map(String)
        : failedCases.rows.map((row) => String(row.testcase_id));
      if (!retryTestcaseIds.length) {
        throw new ConflictException({ error: "Retry was requested but no Failed/Blocked testcase could be selected" });
      }

      if (cycleId) {
        await this.db.query(
          "UPDATE cycles SET status='Completed',ended_at=COALESCE(ended_at,now()),updated_at=now() WHERE id=$1 AND deleted_at IS NULL",
          [cycleId],
        );
      }
      const actor = await this.projectAutomationActor(projectId, userId ? String(userId) : null);
      const retryRun = await this.legacy.createAutomationRegressionShard(
        actor,
        projectId,
        String(shard.plan_id),
        {
          target: { environment: shard.environment, browser: shard.browser, targetType: shard.target_type },
          testcaseIds: retryTestcaseIds,
          automationRunId: String(shard.automation_run_id),
          shardIndex: Number(shard.shard_index),
          shardTotal: Number(shard.shard_total),
          estimatedDurationMs: Number(shard.estimated_duration_ms || 0),
          automationAttempt: Number(shard.attempts || 1),
          sourceKind: "rerun",
        },
        actor,
      ) as Body;
      await this.db.query(
        `UPDATE qa_automation_shards SET status='queued',cycle_id=$5,testcase_ids=$6::jsonb,
          worker_id=NULL,claim_token_hash=NULL,claimed_at=NULL,started_at=NULL,heartbeat_at=NULL,completed_at=NULL,
          next_attempt_at=now()+($2::text || ' milliseconds')::interval,
          result_summary=$3::jsonb,error=$4,updated_at=now()
          WHERE id=$1`,
        [shardId, delay, JSON.stringify(summary), boundedText(body.error || "", "error", 5000) || null,
         retryRun.cycleId, JSON.stringify(retryTestcaseIds)],
      );
    } else {
      await this.db.query(
        `UPDATE qa_automation_shards SET status=$2,completed_at=now(),heartbeat_at=now(),
          result_summary=$3::jsonb,error=$4,updated_at=now()
          WHERE id=$1`,
        [shardId, terminal, JSON.stringify(summary), boundedText(body.error || "", "error", 5000) || null],
      );
      if (cycleId && Number(summary.pending || 0) === 0) {
        await this.db.query(
          "UPDATE cycles SET status='Completed',ended_at=COALESCE(ended_at,now()),updated_at=now() WHERE id=$1 AND deleted_at IS NULL",
          [cycleId],
        );
      }
    }

    return {
      shardId,
      status: canRetry ? "queued" : terminal,
      retryScheduled: canRetry,
      summary,
      run: await this.reconcileRun(String(shard.automation_run_id)),
    };
  }

  private async refreshManualShards(automationRunId: string) {
    const rows = await this.db.query(
      `SELECT id,cycle_id FROM qa_automation_shards
        WHERE automation_run_id=$1 AND target_type='manual' AND status='queued' AND cycle_id IS NOT NULL`,
      [automationRunId],
    );
    for (const row of rows.rows) {
      const summary = await this.cycleSummary(String(row.cycle_id));
      if (Number(summary.total || 0) > 0 && Number(summary.pending || 0) === 0) {
        const status: QaShardStatus = Number(summary.blocked || 0) > 0 ? "blocked" : Number(summary.failed || 0) > 0 ? "failed" : "passed";
        await this.db.query(
          "UPDATE qa_automation_shards SET status=$2,completed_at=now(),result_summary=$3::jsonb,updated_at=now() WHERE id=$1",
          [row.id, status, JSON.stringify(summary)],
        );
      }
    }
  }

  async reconcileRun(automationRunId: string) {
    await this.refreshManualShards(automationRunId);
    const run = await this.automationRun(automationRunId);
    const shards = await this.db.query("SELECT * FROM qa_automation_shards WHERE automation_run_id=$1 ORDER BY created_at", [automationRunId]);
    const statuses = shards.rows.map((row) => String(row.status) as QaShardStatus);
    const status = deriveAutomationRunStatus(statuses);
    const terminal = ["passed","failed","blocked","partial","stuck","cancelled"].includes(status);
    const summary = statuses.reduce((acc: Body, item) => {
      acc[item] = Number(acc[item] || 0) + 1;
      return acc;
    }, { totalShards: statuses.length });

    await this.db.query(
      `UPDATE qa_automation_runs SET status=$2,heartbeat_at=now(),
        completed_at=CASE WHEN $3 THEN COALESCE(completed_at,now()) ELSE NULL END,
        summary=$4::jsonb,updated_at=now() WHERE id=$1`,
      [automationRunId, status, terminal, JSON.stringify(summary)],
    );

    if (terminal && run.build_id) {
      const projectId = String(run.project_id);
      const actor = await this.projectAutomationActor(projectId, run.created_by ? String(run.created_by) : null);
      let certificationAfter: Body = await this.legacy.getReleaseCertification(actor, projectId, String(run.build_id)).catch(() => ({ status: "not_prepared" })) as Body;
      const schedule = run.schedule_id
        ? (await this.db.query("SELECT auto_prepare_certification,notify_on FROM qa_automation_schedules WHERE id=$1", [run.schedule_id])).rows[0]
        : null;
      if (status === "passed" && (schedule?.auto_prepare_certification ?? true) && run.plan_id) {
        certificationAfter = await this.legacy.prepareReleaseCertification(
          actor, projectId, String(run.build_id), { planId: String(run.plan_id) }, actor,
        ).catch((error) => ({ status: "blocked", error: error instanceof Error ? error.message : String(error) })) as Body;
      }
      await this.db.query(
        "UPDATE qa_automation_runs SET certification_after=$2::jsonb,updated_at=now() WHERE id=$1",
        [automationRunId, JSON.stringify(certificationAfter || {})],
      );

      const before = JSON.stringify(run.certification_before || {});
      const after = JSON.stringify(certificationAfter || {});
      if (before !== after) {
        await this.openAlert(projectId, automationRunId, run.schedule_id ? String(run.schedule_id) : null, "warning",
          "certification_changed", `qa-certification-changed:${automationRunId}`,
          "Release certification state changed", "Continuous QA changed or refreshed the release certification state.",
          { buildId: run.build_id, before: run.certification_before || {}, after: certificationAfter || {} });
      }
      if (["failed","blocked","partial","stuck"].includes(status)) {
        await this.openAlert(projectId, automationRunId, run.schedule_id ? String(run.schedule_id) : null,
          status === "stuck" ? "critical" : "high", status, `qa-run-terminal:${automationRunId}:${status}`,
          `Continuous QA run ${status}`, `Automation run ${automationRunId} finished with status ${status}.`,
          { buildId: run.build_id, planId: run.plan_id, summary });
      }
    }
    return { id: automationRunId, status, summary };
  }

  async watchdog() {
    const stale = await this.db.query(
      `SELECT s.*,r.project_id,r.retry_backoff_seconds,r.stuck_after_minutes
         FROM qa_automation_shards s
         JOIN qa_automation_runs r ON r.id=s.automation_run_id
        WHERE s.status IN ('claimed','running')
          AND COALESCE(s.heartbeat_at,s.claimed_at,s.updated_at) <
              now() - make_interval(mins => r.stuck_after_minutes)
        ORDER BY COALESCE(s.heartbeat_at,s.claimed_at,s.updated_at) ASC
        LIMIT 200`,
    );
    const affected = new Set<string>();
    for (const shard of stale.rows) {
      affected.add(String(shard.automation_run_id));
      if (Number(shard.attempts || 0) < Number(shard.max_attempts || 1)) {
        const delay = retryDelayMs(Number(shard.attempts || 1), Number(shard.retry_backoff_seconds || 30));
        const cycleId = String(shard.cycle_id || "");
        if (cycleId) {
          await this.db.query(
            `UPDATE executions e
                SET status='Blocked',actual_result=COALESCE(NULLIF(actual_result,''),'Worker heartbeat expired'),
                    error_message=COALESCE(NULLIF(error_message,''),'Worker heartbeat expired'),
                    executed_at=COALESCE(executed_at,now()),reported_by='automation'
               FROM cycle_items ci
              WHERE ci.id=e.cycle_item_id AND ci.cycle_id=$1 AND ci.deleted_at IS NULL
                AND e.deleted_at IS NULL AND e.status IN ('Untested','Retest')`,
            [cycleId],
          );
        }
        const failedCases = cycleId
          ? await this.db.query(
              `SELECT ci.testcase_id FROM cycle_items ci
               JOIN executions e ON e.cycle_item_id=ci.id AND e.deleted_at IS NULL
               WHERE ci.cycle_id=$1 AND ci.deleted_at IS NULL AND e.status IN ('Failed','Blocked')
               ORDER BY ci.position`,
              [cycleId],
            )
          : { rows: [] as Body[] };
        const retryTestcaseIds = failedCases.rows.length
          ? failedCases.rows.map((row) => String(row.testcase_id))
          : jsonArray(shard.testcase_ids).map(String);
        if (cycleId) {
          await this.db.query(
            "UPDATE cycles SET status='Completed',ended_at=COALESCE(ended_at,now()),updated_at=now() WHERE id=$1 AND deleted_at IS NULL",
            [cycleId],
          );
        }
        const actor = await this.projectAutomationActor(String(shard.project_id), null);
        const retryRun = await this.legacy.createAutomationRegressionShard(
          actor,
          String(shard.project_id),
          String(shard.plan_id),
          {
            target: { environment: shard.environment, browser: shard.browser, targetType: shard.target_type },
            testcaseIds: retryTestcaseIds,
            automationRunId: String(shard.automation_run_id),
            shardIndex: Number(shard.shard_index),
            shardTotal: Number(shard.shard_total),
            estimatedDurationMs: Number(shard.estimated_duration_ms || 0),
            automationAttempt: Number(shard.attempts || 1),
            sourceKind: "rerun",
          },
          actor,
        ) as Body;
        await this.db.query(
          `UPDATE qa_automation_shards SET status='queued',cycle_id=$3,testcase_ids=$4::jsonb,
            worker_id=NULL,claim_token_hash=NULL,claimed_at=NULL,started_at=NULL,heartbeat_at=NULL,
            next_attempt_at=now()+($2::text || ' milliseconds')::interval,
            error='Worker heartbeat expired; shard requeued by watchdog',updated_at=now()
            WHERE id=$1`,
          [shard.id, delay, retryRun.cycleId, JSON.stringify(retryTestcaseIds)],
        );
        await this.openAlert(String(shard.project_id), String(shard.automation_run_id), null, "warning", "recovered",
          `qa-shard-recovered:${shard.id}:${shard.attempts}`,
          "QA worker heartbeat expired; shard requeued",
          "A worker stopped heartbeating. A selective rerun was created for failed/interrupted cases.",
          { shardId: shard.id, attempts: shard.attempts, previousCycleId: cycleId || null, retryCycleId: retryRun.cycleId });
      } else {
        await this.db.query(
          `UPDATE qa_automation_shards SET status='stuck',completed_at=now(),
            error='Worker heartbeat expired and retry budget is exhausted',updated_at=now()
            WHERE id=$1`,
          [shard.id],
        );
        await this.openAlert(String(shard.project_id), String(shard.automation_run_id), null, "critical", "stuck",
          `qa-shard-stuck:${shard.id}`, "QA automation shard is stuck",
          "Worker heartbeat expired and the configured retry budget is exhausted.", { shardId: shard.id });
      }
    }
    for (const runId of affected) await this.reconcileRun(runId).catch(() => undefined);
    await this.requeueOrphanedAutomationRuns();

    const certs = await this.db.query(
      `SELECT rc.id,rc.project_id,rc.build_id,rc.signed_by
         FROM release_certifications rc
        WHERE rc.state='CERTIFIED' AND rc.validity_status='current'
          AND (rc.last_continuous_check_at IS NULL OR rc.last_continuous_check_at < now() - interval '5 minutes')
        ORDER BY rc.last_continuous_check_at ASC NULLS FIRST,rc.updated_at ASC
        LIMIT 50`,
    );
    let checkedCertifications = 0;
    for (const cert of certs.rows) {
      try {
        const actor = await this.projectAutomationActor(String(cert.project_id), cert.signed_by ? String(cert.signed_by) : null);
        const refreshed = await this.legacy.getReleaseCertification(actor, String(cert.project_id), String(cert.build_id)) as Body;
        await this.db.query("UPDATE release_certifications SET last_continuous_check_at=now() WHERE id=$1", [cert.id]);
        checkedCertifications += 1;
        const current = refreshed.certification || {};
        if (current.state === "REVOKED" || current.validityStatus === "stale" || current.validityStatus === "superseded" || current.validityStatus === "expired") {
          await this.openAlert(String(cert.project_id), null, null, "high", "certification_changed",
            `qa-cert-watchdog:${cert.id}:${current.state || current.validityStatus}`,
            "Release certification changed",
            `Continuous certification verification changed the certificate to ${current.state || current.validityStatus}.`,
            { certificationId: cert.id, buildId: cert.build_id, current });
        }
      } catch {
        // Keep last_continuous_check_at unchanged so a transient error is retried next watchdog cycle.
      }
    }
    return { staleShards: stale.rows.length, affectedRuns: affected.size, checkedCertifications };
  }

  private async openAlert(
    projectId: string,
    automationRunId: string | null,
    scheduleId: string | null,
    severity: "info" | "warning" | "high" | "critical",
    alertType: string,
    dedupeKey: string,
    title: string,
    body: string,
    details: Body,
  ) {
    const res = await this.db.query(
      `INSERT INTO qa_automation_alerts
        (project_id,automation_run_id,schedule_id,severity,alert_type,dedupe_key,title,body,details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       ON CONFLICT (project_id,dedupe_key) DO UPDATE SET
         severity=EXCLUDED.severity,status='open',title=EXCLUDED.title,body=EXCLUDED.body,
         details=EXCLUDED.details,updated_at=now()
       RETURNING id`,
      [projectId, automationRunId, scheduleId, severity, alertType, dedupeKey.slice(0, 255), title.slice(0, 255), body, JSON.stringify(details || {})],
    );

    const recipients = await this.db.query(
      `SELECT user_id FROM project_members
        WHERE project_id=$1 AND lower(role) IN ('owner','manager','admin','test_manager')`,
      [projectId],
    );
    for (const row of recipients.rows) {
      const key = `qa:${res.rows[0].id}`;
      await this.db.query(
        `INSERT INTO notifications(user_id,type,title,body,link_entity_type,link_entity_id,dedupe_key)
         VALUES ($1,'qa_automation',$2,$3,'qa_automation_alert',$4,$5)
         ON CONFLICT (user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
        [row.user_id, title.slice(0, 255), body, res.rows[0].id, key.slice(0, 128)],
      ).catch(() => undefined);
    }
    return res.rows[0].id;
  }

  async listRuns(userId: string | null | undefined, projectId: string, limit = 100) {
    await this.legacy.requireProjectAccess(userId, projectId);
    const safeLimit = Math.max(1, Math.min(250, Number(limit) || 100));
    const res = await this.db.query(
      `SELECT r.*,b.git_sha,b.release_name,b.build_version,b.environment AS build_environment,
              p.name AS plan_name,p.risk_score,p.risk_band,
              COALESCE(s.total,0)::int AS shard_total,
              COALESCE(s.queued,0)::int AS shards_queued,
              COALESCE(s.running,0)::int AS shards_running,
              COALESCE(s.passed,0)::int AS shards_passed,
              COALESCE(s.failed,0)::int AS shards_failed,
              COALESCE(s.blocked,0)::int AS shards_blocked,
              COALESCE(s.stuck,0)::int AS shards_stuck
         FROM qa_automation_runs r
         LEFT JOIN qa_build_registry b ON b.id=r.build_id
         LEFT JOIN qa_regression_plans p ON p.id=r.plan_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int total,
             COUNT(*) FILTER (WHERE status='queued')::int queued,
             COUNT(*) FILTER (WHERE status IN ('claimed','running'))::int running,
             COUNT(*) FILTER (WHERE status='passed')::int passed,
             COUNT(*) FILTER (WHERE status='failed')::int failed,
             COUNT(*) FILTER (WHERE status='blocked')::int blocked,
             COUNT(*) FILTER (WHERE status='stuck')::int stuck
           FROM qa_automation_shards sh WHERE sh.automation_run_id=r.id
         ) s ON true
        WHERE r.project_id=$1
        ORDER BY r.created_at DESC LIMIT $2`,
      [projectId, safeLimit],
    );
    return res.rows.map(camelRow);
  }

  async getRun(userId: string | null | undefined, projectId: string, runId: string) {
    await this.legacy.requireProjectAccess(userId, projectId);
    const res = await this.db.query("SELECT * FROM qa_automation_runs WHERE id=$1 AND project_id=$2", [runId, projectId]);
    if (!res.rows[0]) throw new NotFoundException({ error: "Automation run not found" });
    const shards = await this.db.query(
      `SELECT s.*,c.human_id AS run_human_id,c.name AS run_name,c.status AS run_status
         FROM qa_automation_shards s
         LEFT JOIN cycles c ON c.id=s.cycle_id
        WHERE s.automation_run_id=$1 ORDER BY s.environment,s.browser,s.target_type,s.shard_index`,
      [runId],
    );
    return { ...camelRow(res.rows[0]), shards: shards.rows.map(camelRow) };
  }

  async listAlerts(userId: string | null | undefined, projectId: string, status = "open") {
    await this.legacy.requireProjectAccess(userId, projectId);
    const res = await this.db.query(
      `SELECT * FROM qa_automation_alerts
        WHERE project_id=$1 AND ($2='' OR status=$2)
        ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,created_at DESC
        LIMIT 250`,
      [projectId, status],
    );
    return res.rows.map(camelRow);
  }

  async acknowledgeAlert(userId: string | null | undefined, projectId: string, alertId: string) {
    await this.legacy.requireProjectAccess(userId, projectId);
    const res = await this.db.query(
      `UPDATE qa_automation_alerts SET status='acknowledged',acknowledged_by=$3,acknowledged_at=now(),updated_at=now()
        WHERE id=$1 AND project_id=$2 AND status='open' RETURNING *`,
      [alertId, projectId, String(userId)],
    );
    if (!res.rows[0]) throw new NotFoundException({ error: "Open alert not found" });
    return camelRow(res.rows[0]);
  }

  async dashboard(userId: string | null | undefined, projectId: string) {
    await this.legacy.requireProjectAccess(userId, projectId);
    const [counts, trend, schedules, alerts, recent, queueCounts] = await Promise.all([
      this.db.query(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('queued','planning','waiting_workers','running'))::int AS active,
           COUNT(*) FILTER (WHERE status='passed')::int AS passed,
           COUNT(*) FILTER (WHERE status IN ('failed','blocked','partial','stuck'))::int AS unhealthy,
           COUNT(*) FILTER (WHERE created_at>=now()-interval '24 hours')::int AS last_24h
         FROM qa_automation_runs WHERE project_id=$1`,
        [projectId],
      ),
      this.db.query(
        `SELECT date_trunc('day',created_at)::date AS day,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status='passed')::int AS passed,
                COUNT(*) FILTER (WHERE status IN ('failed','blocked','partial','stuck'))::int AS unhealthy,
                AVG(EXTRACT(EPOCH FROM (completed_at-started_at))*1000)::bigint AS avg_duration_ms
         FROM qa_automation_runs
         WHERE project_id=$1 AND created_at>=now()-interval '30 days'
         GROUP BY 1 ORDER BY 1`,
        [projectId],
      ),
      this.db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE enabled=true)::int AS enabled,
                MIN(next_run_at) FILTER (WHERE enabled=true) AS next_run_at
         FROM qa_automation_schedules WHERE project_id=$1 AND deleted_at IS NULL`,
        [projectId],
      ),
      this.db.query(
        `SELECT COUNT(*)::int AS open,
                COUNT(*) FILTER (WHERE severity='critical')::int AS critical,
                COUNT(*) FILTER (WHERE severity='high')::int AS high
         FROM qa_automation_alerts WHERE project_id=$1 AND status='open'`,
        [projectId],
      ),
      this.listRuns(userId, projectId, 12),
      this.queue.getJobCounts("waiting","active","delayed","failed").catch(() => ({ waiting: 0, active: 0, delayed: 0, failed: 0 })),
    ]);
    return {
      counts: camelRow(counts.rows[0] || {}),
      schedules: camelRow(schedules.rows[0] || {}),
      alerts: camelRow(alerts.rows[0] || {}),
      queue: queueCounts,
      trend: trend.rows.map(camelRow),
      recent,
    };
  }
}
