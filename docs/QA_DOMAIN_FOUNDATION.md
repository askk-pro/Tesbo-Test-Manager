# QA Domain Foundation v1

## Purpose

Phase 1 establishes stable QA-domain identifiers and a governed ticket/requirement model on top of the Tesbo fork without duplicating existing data.

The existing `bugs` table remains the canonical ticket store. The existing `testcases` and `cycles` tables remain canonical for tests and runs. Internal requirements are introduced as a first-class model.

## Human-readable IDs

IDs are project-scoped and allocated by database triggers backed by `qa_human_id_counters`.

| Entity | Canonical store | Human ID |
| --- | --- | --- |
| QA ticket | `bugs` | `QA-<n>` |
| Test case | `testcases` | `TC-<n>` |
| Requirement | `requirements` | `REQ-<n>` |
| Test run / cycle | `cycles` | `RUN-<n>` |

Human IDs are additive. Existing UUIDs and integration/external identifiers are retained for compatibility.

Resolvers accept:
- UUID
- human-readable ID
- existing legacy/external ID when supported by that entity

## Allocation guarantees

Migration `V129_qa_domain_human_ids.sql`:
- backfills human IDs for existing records deterministically per project;
- creates uniqueness constraints per project;
- validates ID formats;
- seeds counters after backfill;
- assigns IDs in `BEFORE INSERT` triggers;
- uses a PostgreSQL upsert counter so concurrent allocation is atomic.

## Ticket domain

`bugs` is the canonical QA ticket entity.

Phase 1 adds:
- `human_id`
- human-reference lookup
- ticket comments
- ticket-to-test-case links through the existing bug/test-case relationship model
- retest workflow creation
- REST aliases under `/api/projects/:projectId/qa-tickets/:ticketRef`

Ticket mutation preserves existing application authorization and uses actor-aware activity logging.

## Internal requirements

Phase 1 adds `requirements` for requirements owned by this QA platform.

It supports:
- `REQ-n` human IDs
- title and description
- status and priority
- optional external source metadata
- ownership
- soft deletion/audit actor columns
- links to test cases through `requirement_testcases`

External Jira/Linear requirement/ticket synchronization remains separate from this internal model.

## Comments and evidence trail

`ticket_comments` stores:
- project
- ticket
- body
- actor identity
- source: `ui`, `api`, `mcp`, `system`, or `integration`
- timestamps and soft deletion metadata

Attachments/evidence remain governed by the platform attachment/storage layer. A dedicated MCP evidence operation is reserved in the MCP contract rather than allowing arbitrary database writes.

## Audit identity

Application writes distinguish two identities:

1. **Authorization identity** — the user who owns the API/MCP token and whose permissions are checked.
2. **Audit actor identity** — the actor representing the execution channel, such as an MCP agent.

This lets ChatGPT/MCP act only within a real user's project permissions while still recording that the change was performed by an agent.

All AI writes must go through application services/MCP. Direct database writes by AI clients are not part of the product contract.

## Retest model

`request_ticket_retest`:
- resolves the ticket by QA/legacy/UUID reference;
- retrieves currently linked test cases;
- creates a new test cycle/run;
- adds those tests to the run;
- records an activity event.

The generated cycle receives a `RUN-n` human ID from the database.

## REST aliases

Phase 1 introduces QA-domain aliases while retaining legacy APIs:

- `GET /api/projects/:projectId/qa-tickets/:ticketRef`
- ticket comment GET/POST routes below that ticket alias
- internal requirement list/detail/create/update routes under `/api/projects/:projectId/qa-requirements`

## Acceptance criteria

A fresh database must:
- apply migration 129;
- automatically allocate `QA-1`, `TC-1`, `RUN-1`, and `REQ-1`;
- maintain unique sequential allocation across multi-row inserts;
- accept MCP-sourced ticket comments;
- support requirement-to-test-case links.

These checks are automated by `Tesbo-Backend-Nest/scripts/verify-qa-domain-schema.js` in CI.
