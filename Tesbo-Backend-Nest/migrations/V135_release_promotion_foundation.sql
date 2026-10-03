-- Phase 7 — Release Readiness, Environment Promotion & Post-Deploy Verification v1
-- Foundation: durable release environments, governed promotion requests, append-only promotion timeline.

CREATE TABLE release_environments (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                         VARCHAR(128) NOT NULL,
  slug                         VARCHAR(96) NOT NULL,
  environment_type             VARCHAR(24) NOT NULL DEFAULT 'custom'
                               CHECK (environment_type IN ('development','qa','staging','uat','production','custom')),
  url                          VARCHAR(1024),
  provider                     VARCHAR(64) NOT NULL DEFAULT 'manual',
  provider_project_ref         VARCHAR(255),
  branch_name                  VARCHAR(255),
  protected                    BOOLEAN NOT NULL DEFAULT false,
  required_certification_state VARCHAR(16) NOT NULL DEFAULT 'READY'
                               CHECK (required_certification_state IN ('NONE','READY','APPROVED','CERTIFIED')),
  required_approvals           INTEGER NOT NULL DEFAULT 1 CHECK (required_approvals BETWEEN 1 AND 20),
  require_no_p0_p1             BOOLEAN NOT NULL DEFAULT true,
  min_regression_coverage      NUMERIC(5,2) NOT NULL DEFAULT 100.00
                               CHECK (min_regression_coverage BETWEEN 0 AND 100),
  require_smoke                BOOLEAN NOT NULL DEFAULT true,
  allowed_browsers             JSONB NOT NULL DEFAULT '[]'::jsonb,
  observation_minutes          INTEGER NOT NULL DEFAULT 0 CHECK (observation_minutes BETWEEN 0 AND 10080),
  current_build_id             UUID REFERENCES qa_build_registry(id) ON DELETE SET NULL,
  current_git_sha              VARCHAR(64),
  known_good_build_id          UUID REFERENCES qa_build_registry(id) ON DELETE SET NULL,
  known_good_git_sha           VARCHAR(64),
  last_verified_at             TIMESTAMPTZ,
  settings                     JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order                   INTEGER NOT NULL DEFAULT 0,
  created_by                   UUID REFERENCES users(id) ON DELETE SET NULL,
  archived_at                  TIMESTAMPTZ,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT release_environment_browsers_array CHECK (jsonb_typeof(allowed_browsers) = 'array'),
  CONSTRAINT release_environment_settings_object CHECK (jsonb_typeof(settings) = 'object')
);

CREATE UNIQUE INDEX uq_release_environments_project_name
  ON release_environments(project_id, lower(name))
  WHERE archived_at IS NULL;
CREATE UNIQUE INDEX uq_release_environments_project_slug
  ON release_environments(project_id, slug)
  WHERE archived_at IS NULL;
CREATE INDEX idx_release_environments_project
  ON release_environments(project_id, sort_order, created_at)
  WHERE archived_at IS NULL;

-- Backfill the lightweight project.settings.testRunEnvironments entries into the durable
-- release environment registry so Phase 7 extends existing project configuration instead of
-- making teams re-enter environment names and URLs.
INSERT INTO release_environments (
  project_id,name,slug,environment_type,url,protected,required_certification_state,
  required_approvals,require_no_p0_p1,min_regression_coverage,require_smoke,
  observation_minutes,sort_order
)
SELECT
  p.id,
  left(trim(item->>'name'),128),
  left(
    trim(both '-' from regexp_replace(lower(trim(item->>'name')), '[^a-z0-9]+', '-', 'g')),
    96
  ),
  CASE lower(trim(item->>'name'))
    WHEN 'development' THEN 'development'
    WHEN 'dev' THEN 'development'
    WHEN 'qa' THEN 'qa'
    WHEN 'staging' THEN 'staging'
    WHEN 'stage' THEN 'staging'
    WHEN 'uat' THEN 'uat'
    WHEN 'production' THEN 'production'
    WHEN 'prod' THEN 'production'
    ELSE 'custom'
  END,
  NULLIF(trim(item->>'url'),''),
  lower(trim(item->>'name')) IN ('production','prod'),
  'READY',
  1,
  lower(trim(item->>'name')) IN ('production','prod'),
  CASE WHEN lower(trim(item->>'name')) IN ('production','prod') THEN 100.00 ELSE 0.00 END,
  lower(trim(item->>'name')) IN ('production','prod'),
  CASE WHEN lower(trim(item->>'name')) IN ('production','prod') THEN 15 ELSE 0 END,
  ord::int
FROM projects p
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(COALESCE(p.settings,'{}'::jsonb)->'testRunEnvironments')='array'
      THEN COALESCE(p.settings,'{}'::jsonb)->'testRunEnvironments'
    ELSE '[]'::jsonb
  END
) WITH ORDINALITY AS env(item,ord)
WHERE p.archived_at IS NULL
  AND trim(COALESCE(item->>'name','')) <> ''
ON CONFLICT DO NOTHING;

CREATE TABLE release_promotions (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_environment_id        UUID REFERENCES release_environments(id) ON DELETE SET NULL,
  target_environment_id        UUID NOT NULL REFERENCES release_environments(id) ON DELETE RESTRICT,
  build_id                     UUID NOT NULL REFERENCES qa_build_registry(id) ON DELETE RESTRICT,
  certification_id             UUID REFERENCES release_certifications(id) ON DELETE SET NULL,
  status                       VARCHAR(32) NOT NULL DEFAULT 'draft'
                               CHECK (status IN (
                                 'draft','awaiting_qa','ready_for_approval','approved',
                                 'deploying','verifying','observation','successful','known_good',
                                 'deployment_failed','verification_failed','rolled_back',
                                 'rejected','cancelled','blocked'
                               )),
  requested_by                 UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by                  UUID REFERENCES users(id) ON DELETE SET NULL,
  requested_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at                  TIMESTAMPTZ,
  deployment_started_at        TIMESTAMPTZ,
  deployed_at                  TIMESTAMPTZ,
  verification_started_at      TIMESTAMPTZ,
  verified_at                  TIMESTAMPTZ,
  observation_started_at       TIMESTAMPTZ,
  observation_ends_at          TIMESTAMPTZ,
  completed_at                 TIMESTAMPTZ,
  provider_deployment_id       VARCHAR(255),
  deployed_git_sha             VARCHAR(64),
  artifact_digest              VARCHAR(255),
  config_fingerprint           VARCHAR(255),
  previous_known_good_build_id UUID REFERENCES qa_build_registry(id) ON DELETE SET NULL,
  previous_known_good_git_sha  VARCHAR(64),
  policy_snapshot              JSONB NOT NULL DEFAULT '{}'::jsonb,
  policy_digest                VARCHAR(64),
  evidence                     JSONB NOT NULL DEFAULT '{}'::jsonb,
  failure_reason               TEXT,
  rollback_of_promotion_id     UUID REFERENCES release_promotions(id) ON DELETE SET NULL,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT release_promotion_policy_object CHECK (jsonb_typeof(policy_snapshot) = 'object'),
  CONSTRAINT release_promotion_policy_digest_length CHECK (policy_digest IS NULL OR char_length(policy_digest) = 64),
  CONSTRAINT release_promotion_evidence_object CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE INDEX idx_release_promotions_project
  ON release_promotions(project_id, created_at DESC);
CREATE INDEX idx_release_promotions_target
  ON release_promotions(target_environment_id, created_at DESC);
CREATE INDEX idx_release_promotions_status
  ON release_promotions(project_id,status,updated_at DESC);
CREATE INDEX idx_release_promotions_build
  ON release_promotions(build_id,created_at DESC);

CREATE TABLE release_promotion_approvals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id  UUID NOT NULL REFERENCES release_promotions(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision      VARCHAR(16) NOT NULL CHECK (decision IN ('approved','rejected')),
  policy_digest VARCHAR(64) NOT NULL CHECK (char_length(policy_digest) = 64),
  comment       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(promotion_id,user_id,policy_digest)
);

CREATE INDEX idx_release_promotion_approvals_promotion
  ON release_promotion_approvals(promotion_id,created_at);

CREATE TABLE release_promotion_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id  UUID NOT NULL REFERENCES release_promotions(id) ON DELETE CASCADE,
  event_type    VARCHAR(64) NOT NULL,
  from_status   VARCHAR(32),
  to_status     VARCHAR(32),
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id      UUID REFERENCES actors(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT release_promotion_event_details_object CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX idx_release_promotion_events_promotion
  ON release_promotion_events(promotion_id,created_at,id);

CREATE OR REPLACE FUNCTION release_promotion_events_prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'release_promotion_events is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_release_promotion_events_no_update
  BEFORE UPDATE ON release_promotion_events
  FOR EACH ROW EXECUTE PROCEDURE release_promotion_events_prevent_mutation();

CREATE TRIGGER trg_release_promotion_events_no_delete
  BEFORE DELETE ON release_promotion_events
  FOR EACH ROW EXECUTE PROCEDURE release_promotion_events_prevent_mutation();

COMMENT ON TABLE release_environments IS
  'Phase-7 durable environment registry with release protection policy and current/Known-Good provenance.';
COMMENT ON TABLE release_promotions IS
  'Phase-7 governed request to promote one registered QA build into a target release environment.';
COMMENT ON TABLE release_promotion_approvals IS
  'Human approval/rejection decisions for a Phase-7 promotion; one immutable decision per user.';
COMMENT ON TABLE release_promotion_events IS
  'Append-only Phase-7 promotion timeline. Human approvals, deployment and verification transitions are recorded here.';
