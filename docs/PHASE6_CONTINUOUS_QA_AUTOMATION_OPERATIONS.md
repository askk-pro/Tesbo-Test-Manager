# Phase 6 — Continuous QA Automation, Scheduling & Regression Operations v1

## Purpose

Phase 6 turns the Phase-5 change-aware regression and release-certification workflow into a continuously operated QA system.

The governed flow is:

**build event / schedule / manual trigger → Phase-5 impact analysis → regression plan → duration-balanced shards → external Playwright/API workers → normal RUN-n execution/evidence → retry/selective rerun → Phase-4 triage/gate evidence → certification refresh/revocation → alerts + QA Operations dashboard**

Final release certification and manual revocation remain human-governed.

## Architecture

### Source of truth

PostgreSQL is authoritative for schedules, orchestration runs, shards, retries, alerts and certification state. Redis/BullMQ is orchestration transport only.

This means Redis job loss or backend restart does not lose the QA operation. The dispatcher can requeue orphaned PostgreSQL runs.

### Queue

Queue: `qa-automation`

Recurring infrastructure jobs:

- dispatcher tick: every 1 minute
- stuck-worker / certification watchdog: every 5 minutes
- orchestration jobs: one idempotent BullMQ job per `qa_automation_runs.id`

### Execution safety boundary

The web backend does **not** clone repositories or execute arbitrary test code.

External Playwright/API workers:

1. authenticate with a project-scoped API token,
2. claim a compatible shard,
3. execute the supplied existing testcases,
4. report testcase results/evidence through the existing automation ingest API,
5. heartbeat while active,
6. complete the shard with its claim token.

The API token issuer remains the auditable human identity. Worker tokens cannot cross project boundaries or exceed their scopes.

## Persistence — V134

Phase 6 adds:

- `qa_automation_schedules`
- `qa_automation_event_outbox`
- `qa_automation_runs`
- `qa_automation_shards`
- `qa_automation_alerts`
- continuous certification check timestamp
- Phase-5 regression-run linkage:
  - automation run
  - shard index / total
  - automation attempt
  - estimated duration

A build-registry trigger emits durable `build_registered` and `build_deployed` events into the PostgreSQL outbox.

## Scheduling and triggers

Supported schedule types:

- one-time
- interval / recurring
- daily at an IANA-timezone wall clock
- event: build registered, build deployed, PR updated

Schedules can filter by repository, branch and environment and configure:

- matrix targets
- desired shards
- max parallel workers
- retry limit
- exponential backoff
- stuck-worker timeout
- certification preparation
- notification events

## Smart sharding

Phase 6 uses recent execution `duration_ms` history to estimate each testcase duration.

For each non-manual matrix target, longest-processing-time-first balancing distributes cases across up to 32 shards. Unknown cases default to 30 seconds.

The configured `maxParallelism` is enforced with a PostgreSQL transaction advisory lock per automation run, preventing concurrent worker claims from racing above the configured limit.

## Retry and stuck-run recovery

A failed or blocked shard retries only while its retry budget remains.

Retries are **new RUN-n cycles**, not overwrites:

- the previous attempt is closed and preserved,
- only Failed/Blocked cases are selected for a normal retry,
- interrupted infrastructure attempts mark unfinished cases Blocked,
- a new selective rerun cycle is created,
- the new cycle is linked to the same logical shard using `automation_attempt`.

The watchdog performs the same evidence-safe recovery if a claimed worker stops heartbeating.

This preserves Phase-3 previous/current comparison and Phase-4 failure evidence.

## Certification behavior

At orchestration start, Phase 6 snapshots the current certification state.

At terminal run state:

- a passed run can prepare/refresh certification evidence,
- failed/blocked/stuck evidence can cause existing Phase-5 certification refresh logic to mark a certificate stale/revoked,
- a certification-state change opens an operational alert.

Every current CERTIFIED record is periodically rechecked by the watchdog. Phase 5 remains the authority for certification validity and immutability.

Phase 6 does not expose final `certify` or manual `revoke` as autonomous worker actions.

## Alerts and notifications

Operational alerts are persisted in `qa_automation_alerts` with dedupe keys.

Examples:

- schedule failed
- run failed / blocked / stuck
- worker heartbeat recovered
- retry budget exhausted
- certification state changed

Alerts also create in-app notifications for relevant project users through the existing notification system.

## QA Operations UI

Project navigation includes **QA Operations** with:

- Overview
- Schedules & triggers
- Automation runs
- Alerts
- Workers & queue

The old Run Schedule URL redirects to the Schedules tab so existing navigation remains compatible.

## MCP / ChatGPT operations

Phase 6 exposes MCP operations for:

- list/create/update/delete continuous-QA schedules
- trigger continuous QA
- list/get automation runs
- list/acknowledge alerts
- read QA Operations dashboard

This lets ChatGPT operate the QA workflow while the final human release-certification decision remains controlled.

## Worker contract

Workers should use a project-scoped API token with required read/write scope.

Typical loop:

1. `POST /api/projects/:projectId/qa-automation/workers/claim`
2. If no shard is returned, back off.
3. Execute only the returned testcase set.
4. Report results/evidence using the returned normal RUN-n / automation-ingest paths.
5. Send heartbeat periodically.
6. Close the normal automation run when results are complete.
7. Complete the shard with its opaque claim token.

The claim token is stored only as SHA-256 in PostgreSQL.

## Recovery invariants

- PostgreSQL is authoritative; BullMQ can be reconstructed.
- A trigger key is unique per project, so repeated event delivery is idempotent.
- Build-event delivery uses an outbox, not an in-process fire-and-forget call.
- Worker claim tokens are scoped to one shard.
- Project API tokens cannot cross project boundaries.
- Max parallelism is transactionally enforced.
- Retries preserve previous RUN-n evidence.
- Certification evidence remains governed by Phase 5.

## Acceptance

Phase 6 must not close until all of the following pass:

1. backend typecheck/tests/build
2. frontend lint/typecheck/build
3. MCP tests
4. V1 → V134 migration on fresh pgvector PostgreSQL
5. V134 relational verifier:
   - build event outbox
   - schedule
   - automation run
   - shard
   - alert
   - normal RUN-n shard lineage
   - certification continuous-check field
6. production container builds
7. controlled V134 production migration with pre-deploy backup
8. exact production Git SHA health verification
9. authenticated route/UI acceptance
10. unchanged independent baseline stack
