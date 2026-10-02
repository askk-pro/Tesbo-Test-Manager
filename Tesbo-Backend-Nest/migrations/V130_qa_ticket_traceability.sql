-- Phase 2 — QA Ticket Workspace, Traceability & Evidence Management v1
--
-- Tickets remain canonical in bugs. Requirements remain canonical in requirements.
-- This migration adds only the missing direct ticket <-> requirement relationship needed
-- for complete QA traceability. Testcase/run/execution/evidence relationships already exist.

CREATE TABLE ticket_requirements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ticket_id       UUID NOT NULL REFERENCES bugs(id) ON DELETE CASCADE,
    requirement_id  UUID NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
    created_by      UUID REFERENCES actors(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    deleted_by      UUID REFERENCES actors(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX idx_ticket_requirements_active
ON ticket_requirements(ticket_id, requirement_id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_ticket_requirements_project_ticket
ON ticket_requirements(project_id, ticket_id, created_at)
WHERE deleted_at IS NULL;

CREATE INDEX idx_ticket_requirements_requirement
ON ticket_requirements(requirement_id)
WHERE deleted_at IS NULL;

-- Ticket evidence is stored in the generic attachments table just like execution evidence.
-- V84 already added evidence_kind. This index makes the ticket workspace's evidence panel
-- efficient without introducing another evidence table.
CREATE INDEX idx_attachments_bug_evidence
ON attachments(project_id, entity_id, evidence_kind, created_at)
WHERE entity_type = 'bug' AND deleted_at IS NULL;
