# Phase 3 — Test Execution Workspace, Retest Lifecycle & Failure Intelligence v1

Date: 2026-10-02

## Goal

Phase 3 moves the QA platform from managing QA work into executing and reasoning over verification work while retaining one canonical execution model.

Core lifecycle:

QA ticket → linked testcase → governed retest run → manual or Playwright execution → step outcomes → evidence → automatic ticket correlation → previous/current comparison → evidence-first failure intelligence → computed Passed/Failed/Blocked decision → controlled ticket close/reopen.

## Canonical execution model

Phase 3 does not create a second manual or automation result store.

Both manual and Playwright work use:

cycles → cycle_items → executions

Phase 3 adds:
- ticket_retests for ticket-centred run lineage and final decision state;
- execution_step_results for per-step observations;
- optional attachment → execution_step_result linkage.

## Manual execution

The existing execution page now loads stored step outcomes or seeds them from the governed testcase steps.

Each step can record:
- status: Untested / Passed / Failed / Blocked / Skipped;
- actual result;
- error information where present.

When step results exist, the overall execution status is derived:
- any Failed → Failed;
- otherwise any Blocked → Blocked;
- all Skipped → Skipped;
- all Passed/Skipped → Passed;
- otherwise → Untested.

The page disables the independent overall status buttons when step results exist so a tester cannot save contradictory step and execution outcomes.

## Playwright execution

The Playwright reporter can declare a ticket retest using:
- reporter option: ticketRef;
- environment variable: TESBO_TICKET_REF.

The backend validates the ticket reference before creating or mutating an automation run.

Meaningful Playwright test/expect steps are sent as execution step observations. Hook and fixture plumbing is excluded.

A correlated automation run automatically creates:
- ticket_retests lineage;
- ticket ↔ testcase ↔ run ↔ execution links.

This makes Playwright evidence and results visible in the same ticket traceability graph as manual work.

## Evidence

Execution evidence keeps the existing governed attachment/storage model.

Supported evidence kinds remain:
- screenshot;
- video;
- trace;
- log.

Human uploads can target either:
- the whole execution; or
- one specific stored execution step.

The backend validates the selected step belongs to that execution before storing the evidence link.

Automation evidence remains execution-scoped unless the reporter/provider has explicit step association data.

## Retest lifecycle

Creating a ticket retest:
1. reads the ticket's linked test cases;
2. creates a normal run with RUN-n human ID;
3. seeds executions;
4. records previous retest lineage;
5. automatically correlates ticket/test/run/execution records.

The ticket workspace now includes a Retests tab showing:
- run human ID and source;
- environment/build metadata;
- pass/fail/blocked/pending counts;
- decision state;
- previous vs current testcase comparison;
- fixed / regressed / changed / unchanged / new classification.

## Controlled decision

Ticket resolution is not an unrestricted AI or UI action.

The server refuses a retest decision while Untested or Retest executions remain.

For a complete run the server computes:
- any Failed → failed;
- otherwise any Blocked or Skipped → blocked;
- otherwise → passed.

A caller cannot override the computed decision.

Resulting ticket state:
- passed → Closed;
- failed → Reopened;
- blocked → Reopened.

The run is marked Completed and the decision/audit actor is persisted.

## Failure intelligence

The Failure Intelligence view/API returns:
- previous/current testcase result comparison;
- Failed and Blocked executions;
- error message/stack metadata;
- step outcomes;
- evidence count;
- change classification;
- attention flags for missing evidence or missing step results;
- analysis guidance.

The system does not manufacture a root-cause verdict. ChatGPT must distinguish observed facts from hypotheses and treat root cause as unknown unless logs, traces, screenshots, steps or run metadata support it.

## REST surface

Phase 3 adds:
- GET /api/cycles/:cycleId/executions/:executionId/steps
- PUT /api/cycles/:cycleId/executions/:executionId/steps
- GET /api/projects/:projectId/qa-tickets/:ticketRef/retests
- GET /api/projects/:projectId/qa-tickets/:ticketRef/retest-comparison
- GET /api/projects/:projectId/qa-tickets/:ticketRef/failure-intelligence
- POST /api/projects/:projectId/qa-tickets/:ticketRef/retests/:runRef/decision

Existing execution attachment upload also accepts optional stepNumber.

## MCP

Phase 3 adds:
- get_execution_steps
- record_execution_steps
- list_ticket_retests
- get_ticket_retest_comparison
- get_ticket_failure_intelligence
- decide_ticket_retest

Write operations retain the Phase-2 authorization/audit split:
- token owner = authorization principal;
- MCP actor = mutation/audit principal.

## Migration

V131_execution_retest_failure_intelligence.sql adds:
- ticket_retests;
- execution_step_results;
- attachments.execution_step_result_id and supporting indexes/checks.

## Acceptance criteria

Phase 3 is Known Good only when:
- all backend tests pass;
- MCP Phase-3 scope/actor tests pass;
- reporter tests pass including Playwright step mapping;
- frontend lint/typecheck/build pass;
- fresh database applies through migration 131;
- schema verifier proves retest lineage, step results and step evidence;
- isolated backend/frontend runtime is healthy;
- no new High/Critical dependency finding is introduced;
- the Phase-0 baseline remains untouched and healthy.
