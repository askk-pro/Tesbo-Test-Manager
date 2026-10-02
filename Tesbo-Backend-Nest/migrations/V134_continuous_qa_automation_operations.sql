-- Phase 6 — Continuous QA Automation, Scheduling & Regression Operations v1
-- PostgreSQL remains the operational source of truth; BullMQ is transport/scheduling only.

CREATE TABLE qa_automation_schedules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                  VARCHAR(255) NOT NULL,
  schedule_type         VARCHAR(24) NOT NULL
                        CHECK (schedule_type IN ('one_time','daily','interval','event')),
  enabled               BOOLEAN NOT NULL DEFAULT true,
  repository            VARCHAR(1024),
  branch_filter         VARCHAR(255),
  event_type            VARCHAR(32)
                        CHECK (event_type IS NULL OR event_type IN ('build_registered','build_deployed','pr_updated')),
  timezone              VARCHAR(64) NOT NULL DEFAULT 'UTC',
  daily_time            VARCHAR(5),
  interval_minutes      INTEGER CHECK (interval_minutes IS NULL OR interval_minutes BETWEEN 5 AND 10080),
  run_at                TIMESTAMPTZ,
  next_run_at           TIMESTAMPTZ,
  last_run_at           TIMESTAMPTZ,
  last_status           VARCHAR(24),
  environment           VARCHAR(128) NOT NULL DEFAULT '',
  matrix                JSONB NOT NULL DEFAULT '[]'::jsonb,
  desired_shards        SMALLINT NOT NULL DEFAULT 1 CHECK (desired_shards BETWEEN 1 AND 32),
  max_parallelism       SMALLINT NOT NULL DEFAULT 4 CHECK (max_parallelism BETWEEN 1 AND 32),
  retry_limit           SMALLINT NOT NULL DEFAULT 1 CHECK (retry_limit BETWEEN 0 AND 5),
  retry_backoff_seconds INTEGER NOT NULL DEFAULT 30 CHECK (retry_backoff_seconds BETWEEN 1 AND 3600),
  stuck_after_minutes   INTEGER NOT NULL DEFAULT 30 CHECK (stuck_after_minutes BETWEEN 5 AND 1440),
  auto_prepare_certification BOOLEAN NOT NULL DEFAULT true,
  notify_on             JSONB NOT NULL DEFAULT '["failed","blocked","stuck","certification_changed"]'::jsonb,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by            UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ,

  CONSTRAINT qa_automation_schedule_name_nonempty CHECK (btrim(name) <> ''),
  CONSTRAINT qa_automation_schedule_matrix_array CHECK (jsonb_typeof(matrix)='array'),
  CONSTRAINT qa_automation_schedule_notify_array CHECK (jsonb_typeof(notify_on)='array'),
  CONSTRAINT qa_automation_schedule_metadata_object CHECK (jsonb_typeof(metadata)='object'),
  CONSTRAINT qa_automation_schedule_shape CHECK (
    (schedule_type='one_time' AND run_at IS NOT NULL)
    OR (schedule_type='daily' AND daily_time IS NOT NULL)
    OR (schedule_type='interval' AND interval_minutes IS NOT NULL)
    OR (schedule_type='event' AND event_type IS NOT NULL)
  )
);

CREATE INDEX idx_qa_automation_schedules_due
  ON qa_automation_schedules(enabled,next_run_at)
  WHERE deleted_at IS NULL AND enabled=true AND schedule_type<>'event';
CREATE INDEX idx_qa_automation_schedules_event
  ON qa_automation_schedules(project_id,event_type,enabled)
  WHERE deleted_at IS NULL AND enabled=true AND schedule_type='event';


CREATE TABLE qa_automation_event_outbox (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id      UUID REFERENCES qa_build_registry(id) ON DELETE CASCADE,
  event_type    VARCHAR(32) NOT NULL
                CHECK (event_type IN ('build_registered','build_deployed','pr_updated')),
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  available_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at    TIMESTAMPTZ,
  processed_at  TIMESTAMPTZ,
  attempts      INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT qa_automation_outbox_payload_object CHECK (jsonb_typeof(payload)='object')
);

CREATE INDEX idx_qa_automation_event_outbox_pending
  ON qa_automation_event_outbox(available_at,created_at)
  WHERE processed_at IS NULL;

CREATE OR REPLACE FUNCTION qa_emit_build_automation_event() RETURNS trigger AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO qa_automation_event_outbox(project_id,build_id,event_type,payload)
    VALUES (
      NEW.project_id,
      NEW.id,
      'build_registered',
      jsonb_build_object(
        'repository',NEW.repository,
        'gitSha',NEW.git_sha,
        'branchName',NEW.branch_name,
        'releaseName',NEW.release_name,
        'buildVersion',NEW.build_version,
        'environment',NEW.environment
      )
    );
    IF NEW.deployment_timestamp IS NOT NULL THEN
      INSERT INTO qa_automation_event_outbox(project_id,build_id,event_type,payload)
      VALUES (
        NEW.project_id,
        NEW.id,
        'build_deployed',
        jsonb_build_object(
          'repository',NEW.repository,
          'gitSha',NEW.git_sha,
          'environment',NEW.environment,
          'deploymentTimestamp',NEW.deployment_timestamp
        )
      );
    END IF;
  ELSIF TG_OP='UPDATE'
    AND NEW.deployment_timestamp IS NOT NULL
    AND OLD.deployment_timestamp IS DISTINCT FROM NEW.deployment_timestamp THEN
    INSERT INTO qa_automation_event_outbox(project_id,build_id,event_type,payload)
    VALUES (
      NEW.project_id,
      NEW.id,
      'build_deployed',
      jsonb_build_object(
        'repository',NEW.repository,
        'gitSha',NEW.git_sha,
        'environment',NEW.environment,
        'deploymentTimestamp',NEW.deployment_timestamp
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER qa_build_automation_event_outbox
AFTER INSERT OR UPDATE OF deployment_timestamp
ON qa_build_registry
FOR EACH ROW EXECUTE PROCEDURE qa_emit_build_automation_event();

CREATE TABLE qa_automation_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  schedule_id           UUID REFERENCES qa_automation_schedules(id) ON DELETE SET NULL,
  build_id              UUID REFERENCES qa_build_registry(id) ON DELETE SET NULL,
  plan_id               UUID REFERENCES qa_regression_plans(id) ON DELETE SET NULL,
  trigger_source        VARCHAR(24) NOT NULL
                        CHECK (trigger_source IN ('schedule','event','manual','mcp','recovery')),
  trigger_key           VARCHAR(255) NOT NULL,
  trigger_payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                VARCHAR(24) NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','planning','waiting_workers','running','passed','failed','blocked','partial','stuck','cancelled')),
  scheduled_for         TIMESTAMPTZ,
  queued_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  heartbeat_at          TIMESTAMPTZ,
  desired_shards        SMALLINT NOT NULL DEFAULT 1 CHECK (desired_shards BETWEEN 1 AND 32),
  max_parallelism       SMALLINT NOT NULL DEFAULT 4 CHECK (max_parallelism BETWEEN 1 AND 32),
  retry_limit           SMALLINT NOT NULL DEFAULT 1 CHECK (retry_limit BETWEEN 0 AND 5),
  retry_backoff_seconds INTEGER NOT NULL DEFAULT 30 CHECK (retry_backoff_seconds BETWEEN 1 AND 3600),
  stuck_after_minutes   INTEGER NOT NULL DEFAULT 30 CHECK (stuck_after_minutes BETWEEN 5 AND 1440),
  certification_before  JSONB,
  certification_after   JSONB,
  summary               JSONB NOT NULL DEFAULT '{}'::jsonb,
  error                 TEXT,
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT qa_automation_run_trigger_key_nonempty CHECK (btrim(trigger_key) <> ''),
  CONSTRAINT qa_automation_run_payload_object CHECK (jsonb_typeof(trigger_payload)='object'),
  CONSTRAINT qa_automation_run_summary_object CHECK (jsonb_typeof(summary)='object'),
  UNIQUE(project_id,trigger_key)
);

CREATE INDEX idx_qa_automation_runs_project
  ON qa_automation_runs(project_id,created_at DESC);
CREATE INDEX idx_qa_automation_runs_status
  ON qa_automation_runs(status,heartbeat_at,created_at);

CREATE TABLE qa_automation_shards (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_run_id     UUID NOT NULL REFERENCES qa_automation_runs(id) ON DELETE CASCADE,
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id               UUID NOT NULL REFERENCES qa_regression_plans(id) ON DELETE CASCADE,
  cycle_id              UUID REFERENCES cycles(id) ON DELETE SET NULL,
  environment           VARCHAR(128) NOT NULL DEFAULT '',
  browser               VARCHAR(64) NOT NULL DEFAULT '',
  target_type           VARCHAR(16) NOT NULL
                        CHECK (target_type IN ('browser','api','manual','production-safe')),
  shard_index           SMALLINT NOT NULL CHECK (shard_index >= 0),
  shard_total           SMALLINT NOT NULL CHECK (shard_total BETWEEN 1 AND 32),
  estimated_duration_ms BIGINT NOT NULL DEFAULT 0 CHECK (estimated_duration_ms >= 0),
  testcase_ids          JSONB NOT NULL DEFAULT '[]'::jsonb,
  status                VARCHAR(24) NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','claimed','running','passed','failed','blocked','cancelled','stuck')),
  attempts              SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts          SMALLINT NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 6),
  worker_id             VARCHAR(255),
  claim_token_hash      VARCHAR(64),
  claimed_at            TIMESTAMPTZ,
  started_at            TIMESTAMPTZ,
  heartbeat_at          TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  next_attempt_at       TIMESTAMPTZ,
  result_summary        JSONB NOT NULL DEFAULT '{}'::jsonb,
  error                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT qa_automation_shard_testcases_array CHECK (jsonb_typeof(testcase_ids)='array'),
  CONSTRAINT qa_automation_shard_result_object CHECK (jsonb_typeof(result_summary)='object'),
  UNIQUE(automation_run_id,environment,browser,target_type,shard_index)
);

CREATE INDEX idx_qa_automation_shards_claim
  ON qa_automation_shards(status,next_attempt_at,created_at);
CREATE INDEX idx_qa_automation_shards_run
  ON qa_automation_shards(automation_run_id,status,created_at);

CREATE TABLE qa_automation_alerts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  automation_run_id UUID REFERENCES qa_automation_runs(id) ON DELETE CASCADE,
  schedule_id       UUID REFERENCES qa_automation_schedules(id) ON DELETE SET NULL,
  severity          VARCHAR(16) NOT NULL CHECK (severity IN ('info','warning','high','critical')),
  alert_type        VARCHAR(32) NOT NULL,
  status            VARCHAR(16) NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','acknowledged','resolved')),
  dedupe_key        VARCHAR(255) NOT NULL,
  title             VARCHAR(255) NOT NULL,
  body              TEXT,
  details           JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at   TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT qa_automation_alert_details_object CHECK (jsonb_typeof(details)='object'),
  UNIQUE(project_id,dedupe_key)
);

CREATE INDEX idx_qa_automation_alerts_open
  ON qa_automation_alerts(project_id,status,severity,created_at DESC);

ALTER TABLE release_certifications
  ADD COLUMN last_continuous_check_at TIMESTAMPTZ;

CREATE INDEX idx_release_certifications_continuous_check
  ON release_certifications(validity_status,state,last_continuous_check_at)
  WHERE validity_status='current' AND state='CERTIFIED';

ALTER TABLE qa_regression_plan_runs
  ADD COLUMN automation_run_id UUID REFERENCES qa_automation_runs(id) ON DELETE SET NULL,
  ADD COLUMN shard_index SMALLINT,
  ADD COLUMN shard_total SMALLINT,
  ADD COLUMN automation_attempt SMALLINT,
  ADD COLUMN estimated_duration_ms BIGINT;

ALTER TABLE qa_regression_plan_runs
  ADD CONSTRAINT qa_regression_plan_runs_shard_pair CHECK (
    (shard_index IS NULL AND shard_total IS NULL)
    OR (shard_index IS NOT NULL AND shard_total IS NOT NULL AND shard_index >= 0 AND shard_total BETWEEN 1 AND 32 AND shard_index < shard_total)
  ),
  ADD CONSTRAINT qa_regression_plan_runs_automation_attempt CHECK (
    automation_attempt IS NULL OR automation_attempt BETWEEN 0 AND 6
  ),
  ADD CONSTRAINT qa_regression_plan_runs_estimated_duration CHECK (
    estimated_duration_ms IS NULL OR estimated_duration_ms >= 0
  );

CREATE INDEX idx_qa_regression_plan_runs_automation
  ON qa_regression_plan_runs(automation_run_id,shard_index)
  WHERE automation_run_id IS NOT NULL;

CREATE UNIQUE INDEX idx_qa_regression_plan_runs_automation_target_shard_attempt
  ON qa_regression_plan_runs(automation_run_id,environment,browser,target_type,shard_index,automation_attempt)
  WHERE automation_run_id IS NOT NULL AND shard_index IS NOT NULL AND automation_attempt IS NOT NULL;

COMMENT ON TABLE qa_automation_schedules IS
  'Phase-6 persisted QA schedules/triggers. Redis job schedulers wake the orchestrator; PostgreSQL is authoritative.';
COMMENT ON TABLE qa_automation_runs IS
  'One continuous-QA orchestration attempt from schedule/event/manual/MCP through regression and certification refresh.';
COMMENT ON TABLE qa_automation_shards IS
  'Duration-balanced worker units. External Playwright/API workers claim these and report through the existing automation ingest API.';
COMMENT ON TABLE qa_automation_alerts IS
  'Operational alerts/escalations for continuous QA runs; in-app user notifications are emitted separately.';
