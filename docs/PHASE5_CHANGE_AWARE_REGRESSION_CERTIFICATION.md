# Phase 5 — Change-Aware Regression, Smart Test Selection & Release Certification v1

## Goal

Phase 5 makes QA scope change-aware and turns the Phase-4 release gate into an evidence-bound certification workflow.

Controlled flow:

Git commit / PR / build → changed files/components → impacted requirements/features → affected testcases → deterministic risk scoring → governed regression plan → environment/browser/API/manual execution → Phase-4 failure triage → Phase-4 QA gate → human approval → immutable release certification.

AI may explain why a testcase is recommended or suggest missing coverage, but AI does not control selection, gate readiness, certification, revocation, or release authority.

## Build and commit registry

The QA build registry records repository, Git SHA, base SHA, branch, PR number, release/build, environment, configuration fingerprint, deployment timestamp, changed-file evidence, dependency changes and source metadata.

Registration is idempotent for the same project/repository/SHA/build/environment/configuration identity.

Marking a build deployed can supersede older current certificates for the same repository/environment when Git SHA or configuration fingerprint changed.

## Change-impact rules

Owner/Manager maintained path-glob rules map code paths to one or more QA domains:

- product component
- test suite
- internal requirement
- testcase

Rules carry a bounded risk weight and can mark selected tests mandatory.

## Smart regression selection

The selector is deterministic and explainable. Current signals are:

- mandatory smoke coverage
- explicit changed-path impact rules
- changed automated testcase implementation
- recent Failed/Blocked history
- Phase-4 flaky classification
- historical linked QA defects
- dependency manifest/lockfile changes
- impacted P0/P1 or Critical/High tests

Every selected testcase stores selection sources and human-readable reasons.

## Transparent risk scoring

Risk is calculated from bounded factors rather than a model-generated opaque score:

- change size
- dependency changes
- impacted high-risk testcases
- open high-priority/high-severity defects
- recent execution failures
- impacted-requirement coverage gap
- repeated change frequency across recent registered builds

The result is a 0–100 score plus LOW, MEDIUM, HIGH, or CRITICAL.

## Governed regression plan

Each generated plan is versioned and stores the exact impact snapshot, risk factors, recommended scope, matrix and selected test count used at generation time.

Plan scope starts at 100% of the recommended selection.

While a plan is DRAFT, a user/agent may include or exclude a testcase only with an audit reason. Mandatory tests cannot be excluded. Every override is append-audited and changes the displayed recommended-scope coverage percentage.

## Execution matrix

Default matrix:

- staging / Chrome
- staging / Edge
- staging / Firefox
- staging / API
- staging / manual

Custom targets may include production-safe verification.

Only matrix targets with applicable selected tests are treated as required for certification.

## Execution

Phase 5 does not introduce another execution engine.

Starting a regression plan creates normal RUN-n cycles and normal cycle items/executions. Existing manual execution, Playwright reporter, step evidence, screenshots, video, logs, traces, Phase-3 retest behavior and Phase-4 failure intelligence therefore remain authoritative.

## Selective reruns

A plan can generate reruns containing only:

- current Failed/Blocked executions, or
- Failed/Blocked executions matching one Phase-4 normalized failure signature cluster.

Selective reruns are normal RUN-n cycles and retain environment/browser/target context.

## Certification lifecycle

Certification versions use:

DRAFT → TESTING → BLOCKED / READY → APPROVED → CERTIFIED

Later invalidation does not rewrite signed evidence:

- CERTIFIED → REVOKED when current QA evidence now contains a hard blocker
- current → stale when evidence changed but is not currently blocked
- current → superseded when a newer deployed commit/configuration replaces it
- current → expired when an explicit expiry is reached

A new certification version may later be prepared for the same build instead of rewriting an immutable prior certificate.

## Phase-4 integration

Certification facts include the current Phase-4 release QA gate and recomputed deterministic gate evidence.

A release can only be CERTIFIED when:

1. applicable required regression matrix targets are represented;
2. initial regression runs are complete;
3. no Failed, Blocked, or Pending regression execution remains;
4. current Phase-4 QA evidence is not blocked or stale;
5. the bound Phase-4 QA gate has a human decision of approved;
6. the certification evidence digest is current.

## Immutable certificate

At certification time the platform stores:

- exact evidence snapshot
- evidence digest
- build / commit / configuration identity
- regression plan/version
- bound Phase-4 release-gate ID
- signer
- certified timestamp
- optional expiry
- certificate digest

A database trigger prevents rewriting the evidence, digest, signer, plan/build/gate identity, or certification timestamp of a CERTIFIED record.

## Human authority

Owner/Manager only:

- maintain reusable impact rules
- final release certification
- manual certification revocation

ChatGPT/MCP can register builds, evaluate change impact, generate/adjust/start regression plans, create selective reruns and prepare/inspect certification evidence.

There is intentionally no MCP certify-release or revoke-certification tool.

## Release QA workspace

The new Release QA page provides:

- Dashboard
- Builds & Impact
- Regression Plan
- Certification
- Impact Rules

The dashboard answers the requested operational questions: build, commit, risk, selected tests, pass/fail/blocked/pending counts, flaky count, regression coverage, Phase-4 QA gate and certification state.

## Acceptance criteria

Phase 5 is accepted only after proving:

real Git SHA/build evidence → impact calculation → smart plan → normal RUN-n execution linkage → Phase-4 evidence/gate linkage → human-certification governance → immutable certificate → newer deployed SHA/configuration supersedes the older current certificate.

Fresh-database acceptance also verifies the V133 schema, certification immutability trigger and deployment supersession event.
