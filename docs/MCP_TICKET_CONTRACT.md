# MCP Ticket Operations Contract v2

## Goal

This contract defines how ChatGPT or another MCP client may operate the QA platform without bypassing application authorization, workflow rules, storage controls, or audit logging.

Endpoint: `POST /api/projects/:projectId/mcp`

Authentication remains project-scoped bearer API tokens.

## Security model

Every MCP request is constrained by project scope, token validity, token read/write scope, the token owner's application permissions, application-service validation, and audit attribution to an MCP actor.

The token owner is the authorization principal. The MCP actor is the audit principal. MCP clients never receive raw SQL, unrestricted filesystem, or infrastructure-shell capability.

## Human references

Prefer governed human IDs wherever a `ref` is accepted:

- tickets: `QA-184`
- test cases: `TC-291`
- requirements: `REQ-93`
- runs: `RUN-42`

UUIDs and supported legacy/external identifiers remain valid for compatibility.

## Implemented ticket workspace tools

### Read

- `get_ticket` — resolve and return a QA ticket.
- `get_ticket_workspace` — return ticket, requirements, linked tests/runs/results, evidence, comments, activity and graph.
- `get_ticket_traceability` — return ticket ↔ requirement ↔ test case ↔ run ↔ execution ↔ evidence graph.
- `list_ticket_comments` — return discussion history.
- `list_ticket_evidence` — return direct ticket evidence plus evidence inherited from linked executions.
- `get_ticket_analysis_context` — return fact-grounded context for ChatGPT-assisted analysis without mutating the ticket.
- `search_qa_references` — search QA/TC/REQ/RUN IDs, legacy IDs and titles within the token project.
- `get_testcase_by_ref`
- `get_test_run_by_ref`
- `list_internal_requirements`
- `get_internal_requirement`

Existing MCP reads for test cases, suites, cycles/executions, bugs, requirement matrix and knowledge base remain available.

### Write

- `update_ticket`
- `add_ticket_comment`
- `link_ticket_to_testcase`
- `link_ticket_to_requirement`
- `unlink_ticket_from_requirement`
- `request_ticket_retest`
- `attach_ticket_evidence`
- `create_internal_requirement`
- `update_internal_requirement`
- `link_internal_requirement_to_testcase`
- `unlink_internal_requirement_from_testcase`

Existing write tools for test cases, suites, cycles/runs, execution results, bugs and links remain available.

## Evidence contract

`attach_ticket_evidence` accepts:
- `ticketRef`
- `fileName`
- `contentBase64`
- optional `contentType`
- optional `evidenceKind`: `screenshot`, `video`, `trace`, or `log`

MCP uploads are limited to 5 MB per file. Larger files use the authenticated workspace multipart upload route.

Evidence is stored through the normal attachment/storage service, not directly in the database. Ticket evidence views include:
- evidence attached directly to the ticket;
- evidence attached to linked executions, with test-case and run context.

## Traceability contract

The Phase-2 graph can express:

`QA ticket → requirement → test case → run → execution → evidence`

It also preserves direct ticket→testcase relationships.

Common relations are:
- `requires`
- `covered_by`
- `verified_by`
- `executed_in`
- `contains_result`
- `evidenced_by`

Every governed QA entity should expose a human ID when available.

## ChatGPT-assisted analysis

`get_ticket_analysis_context` intentionally returns evidence and facts rather than an autonomous root-cause verdict.

It includes:
- ticket state;
- linked requirement/test/run counts;
- failed and blocked execution counts;
- evidence and comment counts;
- traceability graph;
- recent comments;
- evidence metadata;
- structural attention flags.

Analysis guidance requires the client to distinguish observed facts from hypotheses and to treat root cause as unknown unless evidence supports it.

## Expected ChatGPT workflow

A normal workflow can be:

1. User: “Open QA-184.”
2. ChatGPT calls `get_ticket_workspace`.
3. It inspects requirements, tests, runs, results, comments and evidence.
4. It may call `get_ticket_analysis_context` for a fact-grounded analysis view.
5. With explicit user intent and write scope, it may add a comment, link REQ/TC records, attach evidence or request a retest.
6. Execution tools record retest outcomes.
7. The audit trail records the MCP actor while preserving the token owner as the authorizing user.

## Approval boundaries

Read operations may run with read scope.

Write operations require:
- write scope;
- the token owner's underlying application permission;
- explicit user intent for consequential mutation.

Destructive operations remain separately explicit even with write scope.

## Phase 3 execution and retest operations

Phase 3 adds these governed reads:

- `get_execution_steps` — read manual or Playwright step outcomes for one execution.
- `list_ticket_retests` — read a ticket's governed retest lineage and result counts.
- `get_ticket_retest_comparison` — compare current and previous retests testcase-by-testcase.
- `get_ticket_failure_intelligence` — return evidence-first Failed/Blocked context, step outcomes, comparison and analysis guidance.

Phase 3 adds these governed writes:

- `record_execution_steps` — save step outcomes; the execution status is derived from the steps.
- `decide_ticket_retest` — evaluate only a complete retest. The server computes Passed/Failed/Blocked; callers cannot override it. Passed closes the ticket, Failed/Blocked reopens it.

For Phase-3 mutations the token owner remains the authorization principal while the MCP agent actor is the audit/mutation principal.

Failure intelligence is factual context, not an autonomous root-cause verdict. Clients must separate observations from hypotheses and must not treat a proposed cause as established unless evidence supports it.

## Phase 4 failure triage and release QA gates

Phase 4 adds governed failure-history reads and evidence-bound release readiness evaluation.

### Read

- `get_ticket_failure_triage` — deterministic failure signatures, recent execution history, flaky/deterministic classification, evidence clusters, probable subsystem/owner from stored assignments, and rerun guidance.
- `list_release_qa_gate_candidates` — release/build combinations with execution history.
- `get_release_qa_gate` — latest deterministic gate plus stale-evidence detection.
- `list_release_qa_gate_history` — prior gate evaluations and any recorded human decisions.

### Write

- `analyze_ticket_failure` — persists an AI hypothesis snapshot. Hypotheses must cite exact platform-provided evidence references; unsupported citations are discarded.
- `evaluate_release_qa_gate` — creates an evidence-bound deterministic readiness evaluation for one release/build/environment.

Release readiness is computed by application rules, not by the model. AI may suggest hypotheses and reruns but cannot decide whether a release is ready.

There is intentionally no MCP tool that approves or rejects a release. Final release approval/rejection is restricted to an authenticated human project owner or manager in the application. Before a human decision is accepted, the backend recomputes the evidence digest; changed evidence forces re-evaluation.

## Still reserved for later phases

The following remain future operations:

- `create_ticket` QA-domain alias over canonical ticket creation.
- `assign_ticket` convenience alias over `update_ticket`.
- `generate_testcases_for_ticket` — reviewable/source-grounded candidate generation.

## Output and audit contract

Read/write responses should return stable canonical IDs, human IDs when available, project context, current state, timestamps, linked human references and structured not-found/permission/validation/conflict errors.

For every MCP mutation, record the authorizing user, MCP actor/channel, project, entity identity, action, timestamp and meaningful resulting state/delta where supported.

Secrets, bearer tokens and provider credentials must never enter activity/audit payloads.
