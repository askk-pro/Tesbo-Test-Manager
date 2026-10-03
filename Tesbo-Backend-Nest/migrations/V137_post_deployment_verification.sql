-- Phase 7 — Slice 3: Post-Deployment Verification & Phase-6 Worker Integration
-- Links a provenance-verified promotion to exactly one Continuous-QA automation run.

ALTER TABLE release_promotions
  ADD COLUMN verification_automation_run_id UUID REFERENCES qa_automation_runs(id) ON DELETE SET NULL,
  ADD COLUMN verification_status VARCHAR(24),
  ADD COLUMN verification_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN verification_checked_at TIMESTAMPTZ,
  ADD COLUMN rollback_eligible BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE release_promotions
  ADD CONSTRAINT release_promotion_verification_status CHECK (
    verification_status IS NULL OR verification_status IN (
      'queued','planning','waiting_workers','running',
      'passed','failed','blocked','partial','stuck','cancelled'
    )
  ),
  ADD CONSTRAINT release_promotion_verification_summary_object CHECK (
    jsonb_typeof(verification_summary)='object'
  );

CREATE UNIQUE INDEX uq_release_promotions_verification_run
  ON release_promotions(verification_automation_run_id)
  WHERE verification_automation_run_id IS NOT NULL;

CREATE INDEX idx_release_promotions_verification_pending
  ON release_promotions(status,verification_status,verification_checked_at)
  WHERE status='verifying' AND verification_automation_run_id IS NOT NULL;

CREATE OR REPLACE FUNCTION qa_lock_release_promotion_verification_run() RETURNS trigger AS $$
BEGIN
  IF OLD.verification_automation_run_id IS NOT NULL
     AND NEW.verification_automation_run_id IS DISTINCT FROM OLD.verification_automation_run_id THEN
    RAISE EXCEPTION 'release promotion verification_automation_run_id is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_release_promotions_verification_run_immutable
BEFORE UPDATE ON release_promotions
FOR EACH ROW EXECUTE PROCEDURE qa_lock_release_promotion_verification_run();

COMMENT ON COLUMN release_promotions.verification_automation_run_id IS
  'Phase-7 Slice-3 Continuous-QA run that verifies the exact deployed promotion.';
COMMENT ON COLUMN release_promotions.verification_status IS
  'Cached status of the linked Phase-6 automation run for release UI/operations.';
COMMENT ON COLUMN release_promotions.verification_summary IS
  'Bound post-deployment verification summary copied from the authoritative Phase-6 run.';
COMMENT ON COLUMN release_promotions.rollback_eligible IS
  'True when verification failed and a previous Known-Good release is available for rollback.';
