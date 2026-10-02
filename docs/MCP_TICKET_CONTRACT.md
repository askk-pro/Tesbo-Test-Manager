# MCP Ticket Operations Contract v1

## Goal

This contract defines how ChatGPT or another MCP client may operate the QA platform without bypassing application authorization, workflow rules, or audit logging.

Endpoint:

`POST /api/projects/:projectId/mcp`

Authentication remains project-scoped bearer API tokens.

## Security model

Every MCP request is constrained by:
- project scope from the URL/token;
- token validity;
- token read/write scope;
- the token owner's application permissions;
- application service validation;
- audit attribution to an MCP actor.

The token owner is the authorization principal. The MCP actor is the audit principal.

No MCP tool receives raw SQL capability.

## Human references

Where a `ref` is accepted, the client should prefer human IDs:
- tickets: `QA-184`
- test cases: `TC-291`
- requirements: `REQ-93`
- runs: `RUN-42`

UUIDs and supported legacy/external IDs remain valid for compatibility.

## Implemented Phase-1 tools

### Read

- `get_ticket` — resolve and return a QA ticket.
- `list_ticket_comments` — return ticket discussion history.
- `get_testcase_by_ref` — resolve TC/UUID/legacy test-case references.
- `get_test_run_by_ref` — resolve RUN/UUID/legacy run references.
- `list_internal_requirements`
- `get_internal_requirement`

Existing Tesbo MCP read tools for test cases, suites, cycles/executions, defects, requirement matrix, knowledge base, and related entities remain available.

### Write

- `update_ticket` — governed ticket mutation through application services.
- `add_ticket_comment`
- `link_ticket_to_testcase`
- `request_ticket_retest`
- `create_internal_requirement`
- `update_internal_requirement`
- `link_internal_requirement_to_testcase`
- `unlink_internal_requirement_from_testcase`

Existing write tools for test cases, suites, cycles/runs, execution results, bugs and bug links continue to work.

## Expected ChatGPT workflow

A typical issue flow is:

1. User says: "Open QA-184."
2. ChatGPT calls `get_ticket`.
3. ChatGPT may inspect linked tests and comments.
4. With user intent and write scope, ChatGPT can call `update_ticket` or `add_ticket_comment`.
5. ChatGPT can link an existing test with `link_ticket_to_testcase`.
6. ChatGPT can request a governed retest with `request_ticket_retest`.
7. Execution tools record test outcomes.
8. The resulting audit/activity history attributes writes to the MCP actor while preserving the authorizing user.

## Ticket mutation semantics

`update_ticket` is the general mutation surface for ticket fields supported by the existing ticket service, including fields such as:
- title/description
- status
- severity
- priority
- assignee when supported by the underlying DTO/service

MCP must not synthesize unsupported enum values or bypass service validation.

## Approval boundaries

Read operations may run immediately when the token has read scope.

Write operations require:
- an MCP token with write scope;
- user-level permission to perform the underlying operation;
- explicit user intent in the conversation for consequential mutation.

Destructive operations should remain separately explicit even when a token has write scope.

## Reserved contract for later phases

The following capabilities are intentionally defined as future MCP operations rather than being represented as direct database access:

### `create_ticket`
Create a QA ticket using the canonical ticket service. Existing `create_bug` functionality is available today; a QA-domain alias should normalize naming.

### `assign_ticket`
Convenience alias for assignment through `update_ticket`.

### `generate_testcases_for_ticket`
Generate candidate test cases from ticket/requirement context. Creation should remain reviewable and source-grounded.

### `attach_ticket_evidence`
Attach screenshots, logs, traces, files, video, or other governed evidence using the attachment/storage service. It must return stable evidence metadata and checksums where available.

### `analyze_ticket_failure`
Read execution results, logs, evidence and linked knowledge; return source-grounded failure analysis. It must not silently mutate the ticket.

### `record_retest_result`
Convenience workflow over existing execution-result tools, preserving the run/test linkage and audit identity.

### `get_ticket_traceability`
Return ticket ↔ requirement ↔ test case ↔ run/result ↔ evidence relationships.

### `get_release_readiness`
Return factual release/readiness evidence based on current test/run/ticket state. It should expose evidence and blockers rather than make an autonomous release decision.

### `close_ticket_after_retest`
A guarded workflow that verifies required retest state before invoking the normal ticket update path. Closure should not be inferred merely from an AI analysis.

## Output contract

MCP tools should return:
- canonical UUID
- human-readable ID
- project ID
- relevant current state
- timestamps
- linked entity human IDs where practical
- clear structured errors for not-found, permission, validation, and conflict states

Write responses should also return the resulting entity state so ChatGPT can confirm what actually changed.

## Audit contract

For every MCP mutation, record:
- authorizing user
- MCP actor/channel
- project
- entity UUID and human ID
- operation/action
- timestamp
- resulting state or meaningful delta where supported

Secrets, bearer tokens, and provider credentials must never be written into activity payloads.

## Non-goals

MCP v1 does not provide:
- arbitrary SQL
- unrestricted filesystem access
- infrastructure shell access
- automatic production-release approval
- unreviewed deletion of QA history
