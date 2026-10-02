-- Phase 5 — Change-Aware Regression, Smart Test Selection & Release Certification v1.
--
-- Phase 5 deliberately reuses cycles/cycle_items/executions for actual testing. These tables
-- store only the change/build registry, explicit change→QA mapping rules, governed regression-plan
-- decisions and release certifications.

CREATE TABLE qa_build_registry (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    repository            VARCHAR(1024) NOT NULL,
    source_provider       VARCHAR(32) NOT NULL DEFAULT 'manual'
                          CHECK (source_provider IN ('manual','github','gitlab','bitbucket','ci','api','mcp','other')),
    source_url            VARCHAR(1024),
    git_sha               VARCHAR(64) NOT NULL,
    base_sha              VARCHAR(64),
    branch_name           VARCHAR(255),
    pr_number             INTEGER,
    release_name          VARCHAR(128) NOT NULL DEFAULT '',
    build_version         VARCHAR(128) NOT NULL DEFAULT '',
    environment           VARCHAR(128) NOT NULL DEFAULT '',
    config_fingerprint    VARCHAR(64) NOT NULL DEFAULT '',
    deployment_timestamp  TIMESTAMPTZ,
    changed_files         JSONB NOT NULL DEFAULT '[]'::jsonb,
    dependency_changes    JSONB NOT NULL DEFAULT '[]'::jsonb,
    change_stats          JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by            UUID REFERENCES actors(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT qa_build_repository_nonempty CHECK (btrim(repository) <> ''),
    CONSTRAINT qa_build_git_sha_nonempty CHECK (btrim(git_sha) <> ''),
    CONSTRAINT qa_build_git_sha_length CHECK (char_length(git_sha) BETWEEN 7 AND 64),
    CONSTRAINT qa_build_pr_number_check CHECK (pr_number IS NULL OR pr_number > 0),
    CONSTRAINT qa_build_changed_files_array CHECK (jsonb_typeof(changed_files) = 'array'),
    CONSTRAINT qa_build_dependency_changes_array CHECK (jsonb_typeof(dependency_changes) = 'array'),
    CONSTRAINT qa_build_change_stats_object CHECK (jsonb_typeof(change_stats) = 'object'),
    CONSTRAINT qa_build_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX idx_qa_build_registry_identity
    ON qa_build_registry(project_id, repository, git_sha, build_version, environment, config_fingerprint);
CREATE INDEX idx_qa_build_registry_project_created
    ON qa_build_registry(project_id, created_at DESC);
CREATE INDEX idx_qa_build_registry_release
    ON qa_build_registry(project_id, release_name, build_version, environment, created_at DESC);
CREATE INDEX idx_qa_build_registry_deployed
    ON qa_build_registry(project_id, repository, environment, deployment_timestamp DESC)
    WHERE deployment_timestamp IS NOT NULL;

CREATE TABLE change_impact_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    path_pattern    VARCHAR(512) NOT NULL,
    component       VARCHAR(255),
    suite_id        UUID REFERENCES suites(id) ON DELETE CASCADE,
    requirement_id  UUID REFERENCES requirements(id) ON DELETE CASCADE,
    testcase_id     UUID REFERENCES testcases(id) ON DELETE CASCADE,
    risk_weight     SMALLINT NOT NULL DEFAULT 5 CHECK (risk_weight BETWEEN 0 AND 30),
    mandatory       BOOLEAN NOT NULL DEFAULT false,
    active          BOOLEAN NOT NULL DEFAULT true,
    created_by      UUID REFERENCES actors(id) ON DELETE SET NULL,
    updated_by      UUID REFERENCES actors(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,

    CONSTRAINT change_impact_rule_name_nonempty CHECK (btrim(name) <> ''),
    CONSTRAINT change_impact_rule_pattern_nonempty CHECK (btrim(path_pattern) <> ''),
    CONSTRAINT change_impact_rule_target CHECK (
      NULLIF(btrim(COALESCE(component,'')),'') IS NOT NULL
      OR suite_id IS NOT NULL
      OR requirement_id IS NOT NULL
      OR testcase_id IS NOT NULL
    )
);

CREATE INDEX idx_change_impact_rules_project
    ON change_impact_rules(project_id, active, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_change_impact_rules_requirement
    ON change_impact_rules(requirement_id)
    WHERE requirement_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_change_impact_rules_testcase
    ON change_impact_rules(testcase_id)
    WHERE testcase_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE qa_regression_plans (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    build_id          UUID NOT NULL REFERENCES qa_build_registry(id) ON DELETE CASCADE,
    version           INTEGER NOT NULL CHECK (version > 0),
    name              VARCHAR(255) NOT NULL,
    status            VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','TESTING','BLOCKED','READY','COMPLETED')),
    risk_score        SMALLINT NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
    risk_band         VARCHAR(16) NOT NULL
                      CHECK (risk_band IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    risk_factors      JSONB NOT NULL DEFAULT '[]'::jsonb,
    impact_snapshot   JSONB NOT NULL DEFAULT '{}'::jsonb,
    selection_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    matrix            JSONB NOT NULL DEFAULT '[]'::jsonb,
    selected_test_count INTEGER NOT NULL DEFAULT 0 CHECK (selected_test_count >= 0),
    coverage_pct      NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (coverage_pct BETWEEN 0 AND 100),
    generated_by      UUID REFERENCES actors(id) ON DELETE SET NULL,
    generated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,

    CONSTRAINT qa_regression_plan_name_nonempty CHECK (btrim(name) <> ''),
    CONSTRAINT qa_regression_risk_factors_array CHECK (jsonb_typeof(risk_factors) = 'array'),
    CONSTRAINT qa_regression_impact_object CHECK (jsonb_typeof(impact_snapshot) = 'object'),
    CONSTRAINT qa_regression_summary_object CHECK (jsonb_typeof(selection_summary) = 'object'),
    CONSTRAINT qa_regression_matrix_array CHECK (jsonb_typeof(matrix) = 'array'),
    UNIQUE(build_id, version)
);

CREATE INDEX idx_qa_regression_plans_project
    ON qa_regression_plans(project_id, generated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_qa_regression_plans_build
    ON qa_regression_plans(build_id, version DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE qa_regression_plan_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id           UUID NOT NULL REFERENCES qa_regression_plans(id) ON DELETE CASCADE,
    testcase_id       UUID NOT NULL REFERENCES testcases(id) ON DELETE CASCADE,
    selection_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
    reasons           JSONB NOT NULL DEFAULT '[]'::jsonb,
    risk_weight       SMALLINT NOT NULL DEFAULT 0 CHECK (risk_weight BETWEEN 0 AND 100),
    mandatory         BOOLEAN NOT NULL DEFAULT false,
    selected          BOOLEAN NOT NULL DEFAULT true,
    override_state    VARCHAR(16) NOT NULL DEFAULT 'none'
                      CHECK (override_state IN ('none','included','excluded')),
    override_note     TEXT,
    override_by       UUID REFERENCES actors(id) ON DELETE SET NULL,
    override_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT qa_regression_sources_array CHECK (jsonb_typeof(selection_sources) = 'array'),
    CONSTRAINT qa_regression_reasons_array CHECK (jsonb_typeof(reasons) = 'array'),
    UNIQUE(plan_id, testcase_id)
);

CREATE INDEX idx_qa_regression_plan_items_selected
    ON qa_regression_plan_items(plan_id, selected, mandatory);
CREATE INDEX idx_qa_regression_plan_items_testcase
    ON qa_regression_plan_items(testcase_id);

CREATE TABLE qa_regression_plan_overrides (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id        UUID NOT NULL REFERENCES qa_regression_plans(id) ON DELETE CASCADE,
    testcase_id    UUID NOT NULL REFERENCES testcases(id) ON DELETE CASCADE,
    previous_state JSONB NOT NULL,
    new_state      JSONB NOT NULL,
    reason         TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 5000),
    actor_id       UUID REFERENCES actors(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_qa_regression_plan_overrides_plan
    ON qa_regression_plan_overrides(plan_id, created_at DESC);

CREATE TABLE qa_regression_plan_runs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id           UUID NOT NULL REFERENCES qa_regression_plans(id) ON DELETE CASCADE,
    cycle_id          UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
    environment       VARCHAR(128) NOT NULL DEFAULT '',
    browser           VARCHAR(64) NOT NULL DEFAULT '',
    target_type       VARCHAR(16) NOT NULL
                      CHECK (target_type IN ('browser','api','manual','production-safe')),
    source_kind       VARCHAR(16) NOT NULL DEFAULT 'initial'
                      CHECK (source_kind IN ('initial','rerun')),
    failure_signature VARCHAR(64),
    created_by        UUID REFERENCES actors(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(cycle_id)
);

CREATE INDEX idx_qa_regression_plan_runs_plan
    ON qa_regression_plan_runs(plan_id, created_at DESC);

CREATE TABLE release_certifications (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    build_id            UUID NOT NULL REFERENCES qa_build_registry(id) ON DELETE CASCADE,
    version             INTEGER NOT NULL CHECK (version > 0),
    plan_id             UUID NOT NULL REFERENCES qa_regression_plans(id) ON DELETE RESTRICT,
    release_gate_id     UUID REFERENCES release_quality_gates(id) ON DELETE SET NULL,
    state               VARCHAR(16) NOT NULL DEFAULT 'DRAFT'
                        CHECK (state IN ('DRAFT','TESTING','BLOCKED','READY','APPROVED','CERTIFIED','REVOKED')),
    validity_status     VARCHAR(16) NOT NULL DEFAULT 'current'
                        CHECK (validity_status IN ('current','stale','superseded','expired')),
    evidence_snapshot   JSONB NOT NULL DEFAULT '{}'::jsonb,
    evidence_digest     VARCHAR(64),
    certificate_digest  VARCHAR(64),
    signed_by           UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at         TIMESTAMPTZ,
    certified_at        TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ,
    invalidated_at      TIMESTAMPTZ,
    invalidation_reason TEXT,
    revoked_at          TIMESTAMPTZ,
    revoked_reason      TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT release_certification_evidence_object CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
    CONSTRAINT release_certification_digest_length CHECK (evidence_digest IS NULL OR char_length(evidence_digest) = 64),
    CONSTRAINT release_certificate_digest_length CHECK (certificate_digest IS NULL OR char_length(certificate_digest) = 64),
    UNIQUE(build_id, version)
);

CREATE INDEX idx_release_certifications_project
    ON release_certifications(project_id, created_at DESC);
CREATE INDEX idx_release_certifications_build
    ON release_certifications(build_id, version DESC);
CREATE INDEX idx_release_certifications_state
    ON release_certifications(project_id, state, validity_status, updated_at DESC);

CREATE TABLE release_certification_events (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    certification_id UUID NOT NULL REFERENCES release_certifications(id) ON DELETE CASCADE,
    event_type       VARCHAR(32) NOT NULL,
    details          JSONB NOT NULL DEFAULT '{}'::jsonb,
    actor_id         UUID REFERENCES actors(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT release_certification_event_details_object CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX idx_release_certification_events_cert
    ON release_certification_events(certification_id, created_at DESC);

CREATE OR REPLACE FUNCTION qa_lock_certified_release_evidence() RETURNS trigger AS $$
BEGIN
  IF OLD.state = 'CERTIFIED' AND (
       NEW.build_id IS DISTINCT FROM OLD.build_id
    OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
    OR NEW.release_gate_id IS DISTINCT FROM OLD.release_gate_id
    OR NEW.evidence_snapshot IS DISTINCT FROM OLD.evidence_snapshot
    OR NEW.evidence_digest IS DISTINCT FROM OLD.evidence_digest
    OR NEW.certificate_digest IS DISTINCT FROM OLD.certificate_digest
    OR NEW.signed_by IS DISTINCT FROM OLD.signed_by
    OR NEW.certified_at IS DISTINCT FROM OLD.certified_at
  ) THEN
    RAISE EXCEPTION 'Certified release evidence is immutable; revoke/supersede instead of rewriting it';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER release_certification_lock_evidence
BEFORE UPDATE ON release_certifications
FOR EACH ROW EXECUTE PROCEDURE qa_lock_certified_release_evidence();

CREATE OR REPLACE FUNCTION qa_supersede_certifications_on_deploy() RETURNS trigger AS $$
DECLARE
  cert_id UUID;
BEGIN
  IF NEW.deployment_timestamp IS NOT NULL THEN
    FOR cert_id IN
      UPDATE release_certifications rc
         SET validity_status='superseded',
             invalidated_at=COALESCE(rc.invalidated_at, now()),
             invalidation_reason=COALESCE(
               rc.invalidation_reason,
               'Superseded by deployed build ' || COALESCE(NULLIF(NEW.build_version,''), left(NEW.git_sha, 12))
             ),
             updated_at=now()
        FROM qa_build_registry old_build
       WHERE rc.build_id=old_build.id
         AND rc.project_id=NEW.project_id
         AND rc.state='CERTIFIED'
         AND rc.validity_status='current'
         AND old_build.id<>NEW.id
         AND old_build.repository=NEW.repository
         AND old_build.environment=NEW.environment
         AND NEW.deployment_timestamp > COALESCE(old_build.deployment_timestamp, old_build.created_at)
         AND (
              old_build.git_sha<>NEW.git_sha
           OR old_build.config_fingerprint<>NEW.config_fingerprint
         )
      RETURNING rc.id
    LOOP
      INSERT INTO release_certification_events(certification_id,event_type,details)
      VALUES (
        cert_id,
        'superseded',
        jsonb_build_object(
          'supersedingBuildId', NEW.id,
          'gitSha', NEW.git_sha,
          'buildVersion', NEW.build_version,
          'environment', NEW.environment
        )
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER qa_build_supersede_certifications
AFTER INSERT OR UPDATE OF deployment_timestamp, git_sha, config_fingerprint, environment
ON qa_build_registry
FOR EACH ROW EXECUTE PROCEDURE qa_supersede_certifications_on_deploy();

COMMENT ON TABLE qa_build_registry IS
  'Phase-5 release/build/commit registry. Actual test execution remains in cycles/executions.';
COMMENT ON TABLE change_impact_rules IS
  'User-maintained path-glob rules mapping source changes to QA components/suites/requirements/testcases.';
COMMENT ON TABLE qa_regression_plans IS
  'Versioned deterministic regression selection/risk decision for one registered build.';
COMMENT ON TABLE qa_regression_plan_runs IS
  'Links normal RUN-n cycles to a regression plan and one environment/browser/API/manual matrix target.';
COMMENT ON TABLE release_certifications IS
  'Release certification lifecycle. Evidence becomes immutable at CERTIFIED; later change invalidates via revoke/stale/supersede.';
