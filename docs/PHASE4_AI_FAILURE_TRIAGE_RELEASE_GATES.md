# Phase 4 — AI Failure Triage, Flake Detection & Release QA Gates v1

## Goal

Phase 4 turns Phase 3 execution evidence into repeatable QA reasoning and release governance.

The controlled flow is:

**execution history → repeated-failure detection → flaky/deterministic classification → evidence clustering → failure signature → probable subsystem/owner → source-grounded AI hypotheses → rerun recommendation → release blocker evaluation → QA readiness gate → human release approval**

The platform intentionally separates deterministic facts from AI interpretation and from human release authority.

## Deterministic failure intelligence

Failure signatures are calculated from stored execution evidence: execution error message, compact error stack, Failed/Blocked step action, step error, and step actual result. Volatile request IDs, UUIDs, timestamps, paths and ordinary numeric values are normalized before SHA-256 signing so repeated instances can be correlated.

The signature is an evidence fingerprint, not a root-cause identifier.

## Execution-history classification

For each testcase, Phase 4 analyzes the most recent settled executions (Passed, Failed, Blocked), with a v1 history window of 20.

- Fewer than 3 settled observations → insufficient_history
- No failures in settled history → stable_pass
- Both pass and failure observations → flaky
- Repeated matching failure signature with no pass → deterministic
- Otherwise → unknown

The classifier also records settled/pass/fail/blocked counts, result flips, flip rate, retry-pass evidence, current signature occurrences, distinct failure signatures, and a 0–100 flake score.

The existing Reports flaky-test surface now consumes this same classifier rather than maintaining a second status-flip-only definition.

## Evidence clustering

Recent Failed/Blocked executions are grouped by normalized failure signature. A cluster exposes the signature, human-readable label, occurrence count, testcase count, first/last seen timestamps, execution IDs, and run IDs.

Matching signatures support correlation; they do not prove an identical root cause.

## Probable subsystem and owner

Phase 4 does not ask AI to guess ownership.

- subsystem → testcase suite
- owner → testcase owner when present
- fallback owner → execution assignee
- otherwise → unassigned

The API returns the source used for each mapping.

## Rerun recommendation

Rerun guidance is deterministic.

### Flaky
Run the same testcase in isolation on the same build three times, capturing Playwright trace, video and log.

### Deterministic
Do not repeatedly execute an unchanged build just to create more identical evidence. Run a targeted verification after a code or configuration change.

### Insufficient history / unknown
Run one targeted execution with complete diagnostics.

### Stable pass
No failure-confirmation rerun is indicated.

## Source-grounded AI hypothesis layer

AI receives the deterministic evidence bundle and an explicit allow-list of evidence references, including testcase, run, execution, step, evidence attachment and history references.

The model is instructed to return hypotheses, not root-cause conclusions. A hypothesis is persisted only when it contains at least one exact evidence reference supplied by the platform. Unsupported references are removed before storage.

Stored AI snapshots include deterministic classification, flake score, evidence snapshot, hypotheses, rerun recommendations, provider/model, input digest, creator and timestamp.

If no AI key is available, deterministic triage remains fully usable.

## Release QA gate

A release gate is evaluated for release name, build version and optionally one environment.

The evidence snapshot contains matching runs, execution results, linked QA blockers and recent testcase failure patterns.

### Hard blockers

Readiness is blocked by:

- no matching test run
- no completed matching run
- incomplete matching runs
- pending Untested/Retest executions
- Failed executions
- Blocked executions
- open/reopened Critical or High QA tickets linked to matching runs
- open/reopened P0 or P1 QA tickets linked to matching runs

### Warnings

Warnings do not automatically block readiness:

- skipped executions
- high-confidence flaky tests
- historical deterministic failures when current release evidence has no failed execution

A gate therefore has one deterministic readiness state: blocked or ready_for_approval.

## Evidence-bound human release decision

AI cannot approve or reject a release.

Approval/rejection is available only through the authenticated application to a project owner or manager.

Before recording a decision, the backend verifies:

1. the selected gate is the newest evaluation for that release/build/environment;
2. the current evidence digest still matches the evaluated digest;
3. approval is requested only when readiness is ready_for_approval.

If evidence changes after evaluation, the gate becomes needs_re_evaluation and the old evaluation cannot be approved.

Human decisions are approved or rejected. A decision note may be recorded.

There is intentionally no MCP release-approval tool.

## MCP operations

Phase 4 exposes:

- get_ticket_failure_triage
- analyze_ticket_failure
- list_release_qa_gate_candidates
- evaluate_release_qa_gate
- get_release_qa_gate
- list_release_qa_gate_history

The MCP agent can inspect and evaluate QA readiness. It cannot approve or reject a release.

As with earlier phases:

**token owner = authorization principal**

**MCP agent = audit actor**

## Storage

Migration V132_ai_failure_triage_flake_release_gates.sql adds:

- qa_failure_triage_snapshots — auditable AI hypothesis snapshots tied to deterministic evidence.
- release_quality_gates — evidence-bound release QA evaluations and human decisions.

Failure signatures themselves are derived from current execution evidence instead of being maintained as mutable source-of-truth rows.

## UI

### QA ticket → Failure triage

Shows classification, flake score, signature, recent run history, probable subsystem, probable owner, rerun recommendation, failure clusters, and the separately labeled source-grounded AI hypothesis snapshot.

### Reports → AI Insights → Release QA gate

Shows release/build/environment selection, deterministic readiness, evidence counts, hard blockers, warnings, stale-evidence status and owner/manager approval or rejection.

## Governance invariants

1. AI hypotheses never become deterministic facts automatically.
2. Unsupported AI evidence references are discarded.
3. Flakiness requires execution history; one failure is never labeled flaky.
4. A flaky warning alone does not block a release.
5. Failed, Blocked or Pending release evidence does block approval.
6. AI never decides release readiness.
7. AI never approves a release.
8. Human approval is bound to one exact evidence digest.
9. Evidence changes invalidate the old approval path until re-evaluation.
10. MCP cannot perform release approval.
