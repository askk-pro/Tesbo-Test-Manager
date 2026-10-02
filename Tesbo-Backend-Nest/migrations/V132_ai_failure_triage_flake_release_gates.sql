-- Phase 4 — AI Failure Triage, Flake Detection & Release QA Gates v1.
--
-- Failure signatures themselves are derived from immutable execution evidence at read-time so they
-- cannot go stale when a tester edits a step result or an automation retry replaces an error.
-- What must be durable is (a) the AI analysis snapshot a human saw and (b) the exact release-gate
-- evidence a human approved/rejected.

CREATE TABLE qa_failure_triage_snapshots (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ticket_id           UUID REFERENCES bugs(id) ON DELETE SET NULL,
    testcase_id         UUID REFERENCES testcases(id) ON DELETE SET NULL,
    execution_id        UUID REFERENCES executions(id) ON DELETE SET NULL,
    failure_signature   VARCHAR(64) NOT NULL,
    signature_version   INTEGER NOT NULL DEFAULT 1,
    classification      VARCHAR(32) NOT NULL,
    flake_score         INTEGER NOT NULL DEFAULT 0,
    evidence_snapshot   JSONB NOT NULL DEFAULT '{}'::jsonb,
    hypotheses          JSONB NOT NULL DEFAULT '[]'::jsonb,
    rerun_recommendation JSONB NOT NULL DEFAULT '{}'::jsonb,
    provider            VARCHAR(64),
    model               VARCHAR(255),
    input_digest        VARCHAR(64) NOT NULL,
    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT qa_failure_triage_classification_check CHECK (
      classification IN ('flaky', 'deterministic', 'stable_pass', 'insufficient_history', 'unknown')
    ),
    CONSTRAINT qa_failure_triage_flake_score_check CHECK (flake_score >= 0 AND flake_score <= 100),
    CONSTRAINT qa_failure_triage_signature_version_check CHECK (signature_version > 0)
);

CREATE INDEX idx_qa_failure_triage_project_created
    ON qa_failure_triage_snapshots(project_id, created_at DESC);
CREATE INDEX idx_qa_failure_triage_ticket_created
    ON qa_failure_triage_snapshots(ticket_id, created_at DESC)
    WHERE ticket_id IS NOT NULL;
CREATE INDEX idx_qa_failure_triage_testcase_created
    ON qa_failure_triage_snapshots(testcase_id, created_at DESC)
    WHERE testcase_id IS NOT NULL;
CREATE INDEX idx_qa_failure_triage_signature
    ON qa_failure_triage_snapshots(project_id, failure_signature, created_at DESC);

CREATE TABLE release_quality_gates (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    release_name      VARCHAR(128) NOT NULL,
    build_version     VARCHAR(128) NOT NULL DEFAULT '',
    environment       VARCHAR(128) NOT NULL DEFAULT '',
    readiness         VARCHAR(32) NOT NULL,
    blockers          JSONB NOT NULL DEFAULT '[]'::jsonb,
    warnings          JSONB NOT NULL DEFAULT '[]'::jsonb,
    evidence_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    evidence_digest   VARCHAR(64) NOT NULL,
    evaluated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    evaluated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    decision          VARCHAR(16),
    decision_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at        TIMESTAMPTZ,
    decision_note     TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT release_quality_gate_release_name_nonempty CHECK (btrim(release_name) <> ''),
    CONSTRAINT release_quality_gate_readiness_check CHECK (
      readiness IN ('blocked', 'ready_for_approval')
    ),
    CONSTRAINT release_quality_gate_decision_check CHECK (
      decision IS NULL OR decision IN ('approved', 'rejected')
    )
);

CREATE INDEX idx_release_quality_gates_lookup
    ON release_quality_gates(project_id, release_name, build_version, environment, evaluated_at DESC);
CREATE INDEX idx_release_quality_gates_latest
    ON release_quality_gates(project_id, evaluated_at DESC);

COMMENT ON TABLE qa_failure_triage_snapshots IS
  'Auditable Phase-4 AI triage snapshots. Observed evidence and deterministic classification are stored separately from model hypotheses.';
COMMENT ON COLUMN qa_failure_triage_snapshots.hypotheses IS
  'Model-proposed hypotheses only; every surfaced evidence reference is validated against evidence_snapshot before persistence.';
COMMENT ON TABLE release_quality_gates IS
  'Immutable release/build QA evidence evaluations. Human approval/rejection attaches to one exact evidence_digest; changed evidence requires a new evaluation.';
