# Phase 2 — QA Ticket Workspace, Traceability & Evidence Management v1

Date: 2026-10-02

## Scope delivered

Phase 2 turns the Phase-1 QA-domain foundation into the primary ticket working experience.

### QA ticket workspace

New routes:

- `/projects/:projectId/qa-tickets`
- `/projects/:projectId/qa-tickets/:ticketRef`

The main project navigation now opens **QA Tickets** instead of the legacy Bugs page. The existing Bugs route remains available for compatibility.

The workspace includes tabs for:
- Overview
- Traceability
- Evidence
- Comments
- Activity
- AI context

### Requirements and test links

Tickets can be linked/unlinked to internal requirements by human reference such as `REQ-93`.

Tickets can be linked/unlinked to test cases by references such as `TC-291`, optionally with a run reference such as `RUN-42`.

### Retests

A governed retest can be requested from the ticket workspace or MCP. It creates a new run using the currently linked test cases and receives a normal `RUN-n` human ID.

### Evidence

Phase 2 reuses the existing governed `attachments` storage model rather than creating a duplicate evidence store.

Supported ticket evidence kinds:
- screenshot
- video
- trace
- log
- ordinary attachment metadata where no evidence kind is supplied

Ticket evidence includes both:
- direct ticket files;
- files from linked executions.

The workspace supports multipart upload and authenticated download. MCP supports base64 evidence upload with a 5 MB per-file limit.

### Traceability graph

The backend returns a graph covering:

`QA → REQ → TC → RUN → execution → evidence`

Direct ticket→testcase links are retained too.

### Human-ID search

Project-scoped QA search covers:
- QA tickets
- test cases
- internal requirements
- runs

It matches human IDs, supported legacy IDs and titles, and returns navigation targets.

### ChatGPT-assisted analysis

Phase 2 does not fabricate a root-cause verdict.

The analysis context returns factual ticket state, linked entities, failed/blocked result counts, evidence/comments, graph data and structural attention flags. MCP clients are instructed to separate observed facts from hypotheses.

## Backend/API

Migration `V130_qa_ticket_traceability.sql` adds the ticket↔requirement relation and evidence lookup indexing.

REST endpoints cover:
- QA ticket list/search
- full workspace
- traceability
- analysis context
- requirement link/unlink
- testcase link/unlink
- retest request
- evidence list/upload/download

## MCP

Implemented in Phase 2:
- `get_ticket_workspace`
- `get_ticket_traceability`
- `list_ticket_evidence`
- `attach_ticket_evidence`
- `get_ticket_analysis_context`
- `link_ticket_to_requirement`
- `unlink_ticket_from_requirement`
- `search_qa_references`

New MCP regression coverage verifies read/write scope, token-user authorization, MCP actor attribution, evidence upload and project-scoped search.

## Acceptance evidence

Completed acceptance:
- Phase-1 GitHub CI green before Phase-2 continuation.
- Backend TypeScript check passes.
- MCP tests: 154/154 pass.
- Frontend full ESLint passes.
- Frontend TypeScript check passes.
- Next.js production build passes.
- New QA ticket list/detail routes generated successfully.
- Fresh pgvector database applied 130/130 migrations.
- Fresh schema verifier passes QA/TC/REQ/RUN IDs, comments, ticket↔requirement, requirement↔testcase, evidence and sequence checks.
- Isolated Phase-2 backend container healthy.
- Isolated Phase-2 frontend container healthy.
- Frontend login HTTP 200.
- Redis and PostgreSQL remain unexposed to the host.
- Backend/frontend are bound to loopback in the self-host Compose acceptance topology.

## Compatibility

The canonical ticket store remains `bugs`; Phase 2 introduces a QA-domain working surface rather than migrating data into a second ticket table.

Legacy UUIDs and external/legacy IDs remain supported alongside human IDs.
