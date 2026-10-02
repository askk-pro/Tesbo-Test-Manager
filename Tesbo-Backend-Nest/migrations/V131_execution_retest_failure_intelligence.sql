-- Phase 3 — Test Execution Workspace, Retest Lifecycle & Failure Intelligence v1
--
-- Keep one canonical execution model. Retest lineage points at the existing cycles/executions
-- records; step outcomes refine an execution instead of creating a parallel runner schema.

CREATE TABLE ticket_retests (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ticket_id         UUID NOT NULL REFERENCES bugs(id) ON DELETE RESTRICT,
    cycle_id          UUID NOT NULL REFERENCES cycles(id) ON DELETE RESTRICT,
    previous_cycle_id UUID REFERENCES cycles(id) ON DELETE SET NULL,
    requested_by      UUID REFERENCES actors(id) ON DELETE SET NULL,
    decision          VARCHAR(16) NOT NULL DEFAULT 'pending',
    decision_note     TEXT,
    decided_by        UUID REFERENCES actors(id) ON DELETE SET NULL,
    decided_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ticket_retests_decision_check CHECK (
      decision IN ('pending', 'passed', 'failed', 'blocked')
    ),
    UNIQUE (ticket_id, cycle_id)
);

CREATE UNIQUE INDEX idx_ticket_retests_cycle
  ON ticket_retests(cycle_id);

CREATE INDEX idx_ticket_retests_ticket
  ON ticket_retests(ticket_id, created_at DESC);

CREATE INDEX idx_ticket_retests_project
  ON ticket_retests(project_id, created_at DESC);

CREATE TABLE execution_step_results (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    execution_id    UUID NOT NULL REFERENCES executions(id) ON DELETE RESTRICT,
    step_number     INTEGER NOT NULL,
    action          TEXT NOT NULL DEFAULT '',
    expected_result TEXT NOT NULL DEFAULT '',
    status          VARCHAR(16) NOT NULL DEFAULT 'Untested',
    actual_result   TEXT,
    error_message   TEXT,
    reported_by     VARCHAR(16) NOT NULL DEFAULT 'human',
    executed_by     UUID REFERENCES actors(id) ON DELETE SET NULL,
    executed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT execution_step_results_step_check CHECK (step_number > 0),
    CONSTRAINT execution_step_results_status_check CHECK (
      status IN ('Untested', 'Passed', 'Failed', 'Blocked', 'Skipped')
    ),
    CONSTRAINT execution_step_results_reported_by_check CHECK (
      reported_by IN ('human', 'automation')
    ),
    UNIQUE (execution_id, step_number)
);

CREATE INDEX idx_execution_step_results_execution
  ON execution_step_results(execution_id, step_number);

CREATE INDEX idx_execution_step_results_project_status
  ON execution_step_results(project_id, status);

ALTER TABLE attachments
  ADD COLUMN execution_step_result_id UUID REFERENCES execution_step_results(id) ON DELETE SET NULL;

CREATE INDEX idx_attachments_execution_step
  ON attachments(execution_step_result_id)
  WHERE execution_step_result_id IS NOT NULL;

COMMENT ON TABLE ticket_retests IS
  'Ticket-centred retest lineage over canonical cycles/executions. Decision is derived/confirmed after the run, never a second result store.';

COMMENT ON TABLE execution_step_results IS
  'Per-step execution outcomes shared by manual and automation channels; one row per execution+step number.';

COMMENT ON COLUMN attachments.execution_step_result_id IS
  'Optional refinement for evidence tied to one execution step; entity_type/entity_id remain the canonical execution attachment scope.';
