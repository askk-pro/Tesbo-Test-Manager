# Phase 1 — Fork Hardening, Clean CI & QA Domain Foundation v1

Date: 2026-10-02  
Baseline upstream SHA: `0154e4510fc651e2b419689f86a3478aa5947e3c`

## Outcome

Phase 1 hardens the Tesbo fork into a clean QA-platform foundation with green local gates, High/Critical dependency findings removed, private service networking, smaller production images, human-readable QA IDs, governed ticket/requirement primitives, and an expanded MCP contract.

## Verification

- Backend typecheck: PASS
- Backend tests: **52/52 suites, 1092/1092 tests PASS**
- Backend production build: PASS
- Frontend lint: PASS
- Frontend production build: PASS
- Playwright reporter: **106/106 tests PASS**
- Reporter typecheck/build: PASS
- `git diff --check`: PASS
- Docker Compose config validation: PASS
- Fresh database migrations: **129/129**
- QA domain schema verifier: PASS
- Backend runtime health: PASS
- Frontend HTTP: 200
- Frontend Docker health: healthy
- Redis: internal-only; no host-published port

## Dependency security

High/Critical findings are blocked by CI.

Current audit state:
- Backend full dependency tree: 17 total — 1 Low, 16 Moderate, **0 High, 0 Critical**
- Backend production-only tree: Moderate findings remain, **0 High, 0 Critical**
- Frontend: 2 Moderate, **0 High, 0 Critical**
- Playwright reporter: **0 findings**

Remaining Moderate findings are documented and intentionally not force-upgraded because several remediations require breaking major-version changes (including NestJS major upgrades). No `npm audit fix --force` was used.

## Docker/runtime hardening

Node runtime standardized on Node 22.

Image sizes:

| Image | Phase 0 | Phase 1 |
| --- | ---: | ---: |
| Backend | ~1.23 GB | ~880 MB |
| Frontend | ~1.85 GB | ~361 MB |
| Migrator | ~1.23 GB | ~331 MB |

Additional improvements:
- Next.js standalone runtime image.
- Dedicated minimal migration image target.
- Removed recursive `chown -R /app` build bottleneck; writable ownership is limited to `/app/uploads`.
- Backend/frontend host publishing restricted to `127.0.0.1` in the self-host Compose topology.
- Redis changed from host-published port to Docker-network-only `expose`.
- Frontend container healthcheck corrected to `127.0.0.1` for Alpine/IPv4 compatibility.
- Production TLS/reverse-proxy requirements documented in `docs/PRODUCTION_SECURITY.md`.

Public TLS/domain deployment itself is not part of Phase 1; the topology is prepared for KPS/Coolify/reverse-proxy ingress.

## QA human-readable IDs

Migration `V129_qa_domain_human_ids.sql` adds project-scoped IDs:

- tickets: `QA-n`
- test cases: `TC-n`
- internal requirements: `REQ-n`
- runs/cycles: `RUN-n`

Existing UUIDs/external IDs remain supported.

Fresh-schema acceptance proved:
- `QA-1, QA-2`
- `TC-1, TC-2`
- `REQ-1, REQ-2`
- `RUN-1, RUN-2`
- ticket comments
- requirement↔test-case links
- sequential ticket allocation through `QA-12` in a multi-row insert with no duplicates

The acceptance is automated in:
`Tesbo-Backend-Nest/scripts/verify-qa-domain-schema.js`

## Ticket and audit foundation

The existing `bugs` table remains the canonical QA ticket store rather than introducing a duplicate ticket system.

Phase 1 adds:
- human-reference ticket lookup
- QA-domain REST aliases
- ticket comments
- ticket↔test-case linking
- governed retest creation
- internal requirements and requirement↔test-case traceability
- activity/audit events for mutations
- separate authorization identity (token owner) and audit identity (MCP actor)

AI/MCP clients do not receive direct SQL access.

## MCP implemented in Phase 1

New/expanded tool surface includes:

Read:
- `get_ticket`
- `list_ticket_comments`
- `get_testcase_by_ref`
- `get_test_run_by_ref`
- `list_internal_requirements`
- `get_internal_requirement`

Write:
- `update_ticket`
- `add_ticket_comment`
- `link_ticket_to_testcase`
- `request_ticket_retest`
- `create_internal_requirement`
- `update_internal_requirement`
- `link_internal_requirement_to_testcase`
- `unlink_internal_requirement_from_testcase`

The detailed contract is in `docs/MCP_TICKET_CONTRACT.md`.

Future operations such as evidence attachment, AI failure analysis, testcase generation, release-readiness queries and guarded close-after-retest are defined but intentionally not claimed as implemented in Phase 1.

## CI

GitHub Actions now gates:
- backend typecheck/test/build/audit
- fresh pgvector migration + QA-domain schema acceptance
- frontend lint/build/audit
- Playwright reporter typecheck/test/build/audit
- backend/frontend container builds

High/Critical dependency findings fail CI.

## Phase 1 status

1. Billing test failures — DONE
2. Frontend lint errors/warnings — DONE
3. Critical/High dependency findings — DONE; Moderate/Low documented
4. Docker slimming / Node standardization — DONE
5. Redis exposure removal / TLS topology — DONE for topology; public TLS deployment deferred
6. Clean CI gates — DONE
7. Human-readable QA IDs — DONE
8. Ticket domain and audit model — DONE
9. Expanded MCP ticket contract — DONE
