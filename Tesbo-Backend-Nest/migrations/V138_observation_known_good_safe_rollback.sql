-- Phase 7 — Slice 4: Observation Window, Known-Good Promotion & Safe Rollback
-- Adds durable observation evidence, explicit observation failure state, human Known-Good
-- promotion metadata, and rollback recovery lineage/state.

ALTER TABLE release_promotions
  DROP CONSTRAINT release_promotions_status_check;

ALTER TABLE release_promotions
  ADD CONSTRAINT release_promotions_status_check CHECK (
    status IN (
      'draft','awaiting_qa','ready_for_approval','approved',
      'deploying','verifying','observation','successful','known_good',
      'deployment_failed','verification_failed','observation_failed','rolled_back',
      'rejected','cancelled','blocked'
    )
  );

ALTER TABLE release_promotions
  ADD COLUMN observation_status VARCHAR(24),
  ADD COLUMN observation_checked_at TIMESTAMPTZ,
  ADD COLUMN observation_check_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN observation_consecutive_failures INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN observation_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN rollback_promotion_id UUID REFERENCES release_promotions(id) ON DELETE SET NULL,
  ADD COLUMN rollback_started_at TIMESTAMPTZ,
  ADD COLUMN rollback_completed_at TIMESTAMPTZ,
  ADD COLUMN rollback_recovery_status VARCHAR(24);

ALTER TABLE release_promotions
  ADD CONSTRAINT release_promotion_observation_status CHECK (
    observation_status IS NULL OR observation_status IN (
      'pending','healthy','unhealthy','passed','failed'
    )
  ),
  ADD CONSTRAINT release_promotion_observation_counts CHECK (
    observation_check_count >= 0 AND observation_consecutive_failures >= 0
  ),
  ADD CONSTRAINT release_promotion_observation_summary_object CHECK (
    jsonb_typeof(observation_summary)='object'
  ),
  ADD CONSTRAINT release_promotion_rollback_recovery_status CHECK (
    rollback_recovery_status IS NULL OR rollback_recovery_status IN (
      'deploying','verifying','passed','failed'
    )
  );

CREATE TABLE release_observation_checks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id          UUID NOT NULL REFERENCES release_promotions(id) ON DELETE CASCADE,
  health_status         VARCHAR(16) NOT NULL CHECK (health_status IN ('healthy','unhealthy')),
  health_url            VARCHAR(2048),
  http_status           INTEGER,
  provider_state        VARCHAR(24),
  provider_status       VARCHAR(128),
  expected_git_sha      VARCHAR(64),
  observed_git_sha      VARCHAR(64),
  details               JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT release_observation_check_details_object CHECK (jsonb_typeof(details)='object')
);

CREATE INDEX idx_release_observation_checks_promotion
  ON release_observation_checks(promotion_id,checked_at,id);

CREATE INDEX idx_release_promotions_observation_pending
  ON release_promotions(observation_ends_at,updated_at)
  WHERE status='observation';

CREATE INDEX idx_release_promotions_rollback_parent
  ON release_promotions(rollback_of_promotion_id,created_at DESC)
  WHERE rollback_of_promotion_id IS NOT NULL;

CREATE OR REPLACE FUNCTION release_observation_checks_prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'release_observation_checks is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_release_observation_checks_no_update
  BEFORE UPDATE ON release_observation_checks
  FOR EACH ROW EXECUTE PROCEDURE release_observation_checks_prevent_mutation();

CREATE TRIGGER trg_release_observation_checks_no_delete
  BEFORE DELETE ON release_observation_checks
  FOR EACH ROW EXECUTE PROCEDURE release_observation_checks_prevent_mutation();

COMMENT ON TABLE release_observation_checks IS
  'Append-only Phase-7 Slice-4 health/provider evidence collected while a verified promotion is in its observation window.';
COMMENT ON COLUMN release_promotions.observation_status IS
  'Cached Slice-4 observation state for release operations UI and lifecycle reconciliation.';
COMMENT ON COLUMN release_promotions.rollback_promotion_id IS
  'Most recent child recovery promotion created to restore this failed release to its previous Known-Good build.';
COMMENT ON COLUMN release_promotions.rollback_of_promotion_id IS
  'For rollback recovery promotions, the failed promotion whose previous Known-Good build is being restored.';
COMMENT ON COLUMN release_promotions.rollback_recovery_status IS
  'Recovery state of the most recent safe rollback attempt: deploying, verifying, passed, or failed.';
