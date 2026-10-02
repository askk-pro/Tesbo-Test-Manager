-- Phase 1 QA domain foundation: stable human-readable ids, internal requirements, and ticket comments.
--
-- Existing external_id columns keep their original meanings:
--   testcases.external_id -> existing project-prefixed Tesbo id
--   bugs.external_id      -> existing project-prefixed BUG id
--   cycles.external_id    -> automation/CI idempotency key
-- Human-facing ids are deliberately separate so QA-184 / TC-291 / REQ-93 / RUN-42 can
-- evolve without breaking integrations, imports, Jira/Linear links, or automation ingest.

CREATE TABLE qa_human_id_counters (
    project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    entity_type  VARCHAR(32) NOT NULL CHECK (entity_type IN ('ticket', 'testcase', 'requirement', 'run')),
    next_value   BIGINT NOT NULL DEFAULT 1 CHECK (next_value > 0),
    PRIMARY KEY (project_id, entity_type)
);

CREATE OR REPLACE FUNCTION qa_allocate_human_id(
    p_project_id UUID,
    p_entity_type VARCHAR,
    p_prefix VARCHAR
) RETURNS VARCHAR AS $$
DECLARE
    allocated BIGINT;
BEGIN
    INSERT INTO qa_human_id_counters (project_id, entity_type, next_value)
    VALUES (p_project_id, p_entity_type, 2)
    ON CONFLICT (project_id, entity_type)
    DO UPDATE SET next_value = qa_human_id_counters.next_value + 1
    RETURNING next_value - 1 INTO allocated;

    RETURN p_prefix || '-' || allocated::text;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION qa_assign_human_id() RETURNS trigger AS $$
BEGIN
    -- Human ids are server-assigned. Ignore a caller-provided value so clients cannot skip
    -- ahead, collide with future allocations, or forge a different entity prefix.
    NEW.human_id := qa_allocate_human_id(NEW.project_id, TG_ARGV[0], TG_ARGV[1]);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE bugs ADD COLUMN human_id VARCHAR(32);
ALTER TABLE testcases ADD COLUMN human_id VARCHAR(32);
ALTER TABLE cycles ADD COLUMN human_id VARCHAR(32);

WITH ranked AS (
    SELECT id, 'QA-' || row_number() OVER (PARTITION BY project_id ORDER BY created_at, id)::text AS human_id
    FROM bugs
)
UPDATE bugs b SET human_id = ranked.human_id FROM ranked WHERE ranked.id = b.id;

WITH ranked AS (
    SELECT id, 'TC-' || row_number() OVER (PARTITION BY project_id ORDER BY created_at, id)::text AS human_id
    FROM testcases
)
UPDATE testcases t SET human_id = ranked.human_id FROM ranked WHERE ranked.id = t.id;

WITH ranked AS (
    SELECT id, 'RUN-' || row_number() OVER (PARTITION BY project_id ORDER BY created_at, id)::text AS human_id
    FROM cycles
)
UPDATE cycles c SET human_id = ranked.human_id FROM ranked WHERE ranked.id = c.id;

ALTER TABLE bugs ALTER COLUMN human_id SET NOT NULL;
ALTER TABLE testcases ALTER COLUMN human_id SET NOT NULL;
ALTER TABLE cycles ALTER COLUMN human_id SET NOT NULL;

ALTER TABLE bugs ADD CONSTRAINT bugs_human_id_format CHECK (human_id ~ '^QA-[1-9][0-9]*$');
ALTER TABLE testcases ADD CONSTRAINT testcases_human_id_format CHECK (human_id ~ '^TC-[1-9][0-9]*$');
ALTER TABLE cycles ADD CONSTRAINT cycles_human_id_format CHECK (human_id ~ '^RUN-[1-9][0-9]*$');

CREATE UNIQUE INDEX idx_bugs_project_human_id ON bugs(project_id, human_id);
CREATE UNIQUE INDEX idx_testcases_project_human_id ON testcases(project_id, human_id);
CREATE UNIQUE INDEX idx_cycles_project_human_id ON cycles(project_id, human_id);

INSERT INTO qa_human_id_counters (project_id, entity_type, next_value)
SELECT project_id, 'ticket', COUNT(*) + 1 FROM bugs GROUP BY project_id
ON CONFLICT (project_id, entity_type) DO UPDATE SET next_value = EXCLUDED.next_value;

INSERT INTO qa_human_id_counters (project_id, entity_type, next_value)
SELECT project_id, 'testcase', COUNT(*) + 1 FROM testcases GROUP BY project_id
ON CONFLICT (project_id, entity_type) DO UPDATE SET next_value = EXCLUDED.next_value;

INSERT INTO qa_human_id_counters (project_id, entity_type, next_value)
SELECT project_id, 'run', COUNT(*) + 1 FROM cycles GROUP BY project_id
ON CONFLICT (project_id, entity_type) DO UPDATE SET next_value = EXCLUDED.next_value;

CREATE TRIGGER bugs_assign_human_id
BEFORE INSERT ON bugs
FOR EACH ROW EXECUTE PROCEDURE qa_assign_human_id('ticket', 'QA');

CREATE TRIGGER testcases_assign_human_id
BEFORE INSERT ON testcases
FOR EACH ROW EXECUTE PROCEDURE qa_assign_human_id('testcase', 'TC');

CREATE TRIGGER cycles_assign_human_id
BEFORE INSERT ON cycles
FOR EACH ROW EXECUTE PROCEDURE qa_assign_human_id('run', 'RUN');

-- A first-class internal requirement does not replace Jira/Linear requirement references on
-- testcases. It gives the QA platform its own governed requirement record and stable REQ-n id.
CREATE TABLE requirements (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    human_id         VARCHAR(32) NOT NULL,
    title            VARCHAR(512) NOT NULL,
    description      TEXT,
    status           VARCHAR(32) NOT NULL DEFAULT 'Draft',
    priority         VARCHAR(8),
    source_provider  VARCHAR(32) NOT NULL DEFAULT 'internal'
                     CHECK (source_provider IN ('internal', 'jira', 'linear', 'other')),
    source_key       VARCHAR(256),
    source_url       VARCHAR(1024),
    owner_id         UUID REFERENCES actors(id) ON DELETE SET NULL,
    created_by       UUID REFERENCES actors(id) ON DELETE SET NULL,
    updated_by       UUID REFERENCES actors(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ,
    deleted_by       UUID REFERENCES actors(id) ON DELETE SET NULL,
    CONSTRAINT requirements_human_id_format CHECK (human_id ~ '^REQ-[1-9][0-9]*$')
);

CREATE UNIQUE INDEX idx_requirements_project_human_id ON requirements(project_id, human_id);
CREATE INDEX idx_requirements_project_active ON requirements(project_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_requirements_source ON requirements(project_id, source_provider, source_key)
WHERE source_key IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER requirements_assign_human_id
BEFORE INSERT ON requirements
FOR EACH ROW EXECUTE PROCEDURE qa_assign_human_id('requirement', 'REQ');

CREATE TABLE requirement_testcases (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requirement_id  UUID NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
    testcase_id     UUID NOT NULL REFERENCES testcases(id) ON DELETE CASCADE,
    created_by      UUID REFERENCES actors(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    deleted_by      UUID REFERENCES actors(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX idx_requirement_testcases_active
ON requirement_testcases(requirement_id, testcase_id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_requirement_testcases_testcase
ON requirement_testcases(testcase_id)
WHERE deleted_at IS NULL;

-- Bugs are the canonical QA ticket rows. Comments are separated from the ticket row so every
-- discussion entry has immutable author/source/time attribution and MCP can append without
-- rewriting the ticket body.
CREATE TABLE ticket_comments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ticket_id        UUID NOT NULL REFERENCES bugs(id) ON DELETE CASCADE,
    body             TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 20000),
    author_actor_id  UUID REFERENCES actors(id) ON DELETE SET NULL,
    source           VARCHAR(32) NOT NULL DEFAULT 'ui'
                     CHECK (source IN ('ui', 'api', 'mcp', 'system', 'integration')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ,
    deleted_by       UUID REFERENCES actors(id) ON DELETE SET NULL
);

CREATE INDEX idx_ticket_comments_ticket_active
ON ticket_comments(ticket_id, created_at)
WHERE deleted_at IS NULL;

CREATE INDEX idx_ticket_comments_project
ON ticket_comments(project_id, created_at DESC)
WHERE deleted_at IS NULL;

COMMENT ON COLUMN bugs.human_id IS 'Stable project-scoped QA ticket id, e.g. QA-184. Separate from external_id.';
COMMENT ON COLUMN testcases.human_id IS 'Stable project-scoped test-case id, e.g. TC-291. Separate from external_id.';
COMMENT ON COLUMN cycles.human_id IS 'Stable project-scoped run id, e.g. RUN-42. Separate from automation external_id.';
COMMENT ON TABLE requirements IS 'First-class internal QA requirements with stable REQ-n ids; Jira/Linear links remain supported.';
COMMENT ON TABLE ticket_comments IS 'Append-oriented QA ticket discussion entries attributed to a human or agent actor.';
