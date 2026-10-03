-- Phase 7 Slice 2 — KPS/Coolify Deployment Adapter & Deployment Provenance.
-- Adds provider workload identity and fail-closed deployment provenance state.

ALTER TABLE release_environments
  ADD COLUMN provider_workload_ref VARCHAR(255);

ALTER TABLE release_promotions
  ADD COLUMN requested_git_sha VARCHAR(64),
  ADD COLUMN provider_deployment_status VARCHAR(64),
  ADD COLUMN provider_artifact_ref VARCHAR(255),
  ADD COLUMN provider_configuration_hash VARCHAR(255),
  ADD COLUMN provenance_status VARCHAR(24) NOT NULL DEFAULT 'pending'
    CHECK (provenance_status IN ('pending','matched','mismatch','unavailable')),
  ADD COLUMN provenance_checked_at TIMESTAMPTZ;

UPDATE release_promotions p
   SET requested_git_sha = b.git_sha
  FROM qa_build_registry b
 WHERE b.id = p.build_id
   AND p.requested_git_sha IS NULL;

ALTER TABLE release_promotions
  ALTER COLUMN requested_git_sha SET NOT NULL;

CREATE OR REPLACE FUNCTION qa_lock_release_promotion_requested_sha() RETURNS trigger AS $$
BEGIN
  IF NEW.requested_git_sha IS DISTINCT FROM OLD.requested_git_sha THEN
    RAISE EXCEPTION 'release promotion requested_git_sha is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_release_promotions_requested_sha_immutable
  BEFORE UPDATE ON release_promotions
  FOR EACH ROW EXECUTE PROCEDURE qa_lock_release_promotion_requested_sha();

CREATE INDEX idx_release_promotions_provider_deployment
  ON release_promotions(provider_deployment_id)
  WHERE provider_deployment_id IS NOT NULL;

CREATE INDEX idx_release_promotions_deploying
  ON release_promotions(status, updated_at)
  WHERE status='deploying';

COMMENT ON COLUMN release_environments.provider_workload_ref IS
  'Provider-owned workload/application identifier. For provider=kps this is the KPS workload id.';
COMMENT ON COLUMN release_promotions.requested_git_sha IS
  'Immutable Git SHA requested from the deployment provider for this promotion.';
COMMENT ON COLUMN release_promotions.provenance_status IS
  'Phase-7 comparison of requested build provenance with the deployment provider observation.';
