import { McpService } from "./mcp.service";
import { DatabaseService } from "../database/database.service";
import { LegacyService } from "../legacy/legacy.service";
import type { ApiTokenContext } from "../common/request.types";
import { MCP_PROTOCOL_VERSION, MCP_SERVER_INSTRUCTIONS, MCP_SERVER_NAME, RpcCode } from "./mcp.types";

/** Minimal LegacyService test double — only the methods the MCP tools call. */
function makeLegacy(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    getProject: jest.fn().mockResolvedValue({ id: "proj-1", name: "Demo" }),
    listTestCases: jest.fn().mockResolvedValue({ rows: [{ id: "tc-1" }], total: 1 }),
    createTestCase: jest.fn().mockResolvedValue({ id: "tc-new" }),
    updateTestCase: jest.fn().mockResolvedValue(undefined),
    getTestCase: jest.fn().mockResolvedValue({ id: "tc-1", title: "Updated", suiteId: "suite-current", ownerId: "user-current" }),
    duplicateTestCase: jest.fn().mockResolvedValue({ id: "tc-copy", title: "Original (copy)", suiteId: "suite-1" }),
    bulkUpdateTestCases: jest.fn().mockResolvedValue(undefined),
    executionReport: jest.fn().mockResolvedValue({ filterBy: "overall", filterValue: null, rows: [] }),
    listSuites: jest
      .fn()
      .mockResolvedValue([{ id: "suite-1", parentId: "suite-root", name: "Suite 1", position: 0, testCaseCount: 2, recursiveTestCaseCount: 2 }]),
    createSuite: jest.fn().mockResolvedValue({ id: "suite-new" }),
    updateSuite: jest.fn().mockResolvedValue(undefined),
    listCycles: jest
      .fn()
      .mockResolvedValue([{ id: "cycle-1", name: "Cycle 1", planId: "plan-1", passed: 1, failed: 0, blocked: 0, skipped: 0, untested: 1 }]),
    createCycle: jest.fn().mockResolvedValue({ id: "cycle-new" }),
    addCycleTestCases: jest.fn().mockResolvedValue({ requested: 1, added: 1, skipped: 0 }),
    getPlan: jest.fn().mockResolvedValue({ id: "plan-1", name: "Plan 1" }),
    executions: jest
      .fn()
      .mockResolvedValue([{ id: "ex-1", status: "Untested", title: "Case 1", suiteId: "suite-1" }]),
    updateExecution: jest.fn().mockResolvedValue(undefined),
    testcaseExecutions: jest
      .fn()
      .mockResolvedValue([{ id: "ex-1", status: "Untested", cycleId: "cycle-1", cycleName: "Cycle 1" }]),
    listBugs: jest.fn().mockResolvedValue([{ id: "bug-1", title: "Bug 1" }]),
    getBug: jest.fn().mockResolvedValue({ id: "bug-1", title: "Bug 1", links: [], attachments: [] }),
    createBug: jest.fn().mockResolvedValue({ id: "bug-new" }),
    updateBug: jest.fn().mockResolvedValue({ id: "bug-1", title: "Updated bug", links: [], attachments: [] }),
    addBugLink: jest.fn().mockResolvedValue({ id: "bug-1", title: "Bug 1", links: [{ id: "link-1", testcaseId: "tc-1", cycleId: null }] }),
    removeBugLink: jest.fn().mockResolvedValue({ id: "bug-1", title: "Bug 1", links: [] }),
    getTicketByRefForUser: jest.fn().mockResolvedValue({ id: "bug-1", humanId: "QA-1", title: "Bug 1" }),
    getTicketWorkspace: jest.fn().mockResolvedValue({
      ticket: { id: "bug-1", humanId: "QA-1", title: "Bug 1" },
      requirements: [],
      testcaseLinks: [],
      evidence: [],
      graph: { nodes: [], edges: [] },
      comments: [],
      activity: []
    }),
    getTicketTraceabilityForUser: jest.fn().mockResolvedValue({
      ticket: { id: "bug-1", humanId: "QA-1", title: "Bug 1" },
      requirements: [],
      testcaseLinks: [],
      evidence: [],
      graph: { nodes: [], edges: [] }
    }),
    listTicketEvidenceForUser: jest.fn().mockResolvedValue({ list: [] }),
    attachTicketEvidenceBase64: jest.fn().mockResolvedValue({ list: [{ id: "att-1", fileName: "shot.png" }], total: 1 }),
    getTicketAnalysisContext: jest.fn().mockResolvedValue({
      ticket: { id: "bug-1", humanId: "QA-1", title: "Bug 1" },
      facts: { linkedRequirements: 0, linkedTestcases: 0, linkedRuns: 0, failedExecutions: 0, blockedExecutions: 0, evidenceItems: 0, comments: 0 },
      attention: [],
      traceability: { nodes: [], edges: [] },
      latestComments: [],
      evidence: [],
      analysisGuidance: []
    }),
    listTicketRetests: jest.fn().mockResolvedValue([
      { id: "rt-1", cycleId: "cycle-1", runHumanId: "RUN-1", decision: "pending", total: 1, passed: 0, failed: 1, blocked: 0, skipped: 0, pending: 0 }
    ]),
    getTicketRetestComparison: jest.fn().mockResolvedValue({
      ticket: { id: "bug-1", humanId: "QA-1", title: "Bug 1" },
      current: { cycleId: "cycle-1", runHumanId: "RUN-1" },
      previous: null,
      items: []
    }),
    getTicketFailureIntelligence: jest.fn().mockResolvedValue({
      ticket: { id: "bug-1", humanId: "QA-1", title: "Bug 1" },
      current: { cycleId: "cycle-1", runHumanId: "RUN-1" },
      previous: null,
      items: [],
      failures: [],
      attention: [],
      analysisGuidance: []
    }),
    getTicketFailureTriage: jest.fn().mockResolvedValue({
      ticket: { id: "bug-1", humanId: "QA-1", title: "Bug 1" },
      current: { cycleId: "cycle-1", runHumanId: "RUN-1" },
      failures: [],
      triage: [{ testcaseId: "tc-1", classification: "flaky", flakeScore: 75 }],
      clusters: [],
      latestAiAnalysis: null
    }),
    analyzeTicketFailureWithAi: jest.fn().mockResolvedValue({
      ticket: { id: "bug-1", humanId: "QA-1", title: "Bug 1" },
      triage: [{ testcaseId: "tc-1", classification: "flaky", flakeScore: 75 }],
      ai: { available: true, provider: "openai", model: "gpt-4o-mini" },
      generatedAnalysis: { id: "triage-1", hypotheses: [] }
    }),
    listReleaseGateCandidates: jest.fn().mockResolvedValue([
      { releaseName: "v1.2", buildVersion: "101", runCount: 2, completedRunCount: 2, environments: ["staging"] }
    ]),
    evaluateReleaseQaGate: jest.fn().mockResolvedValue({
      gate: { id: "gate-1", readiness: "ready_for_approval", evidenceDigest: "abc" },
      evidence: { releaseName: "v1.2", buildVersion: "101" }
    }),
    getLatestReleaseQaGate: jest.fn().mockResolvedValue({
      gate: { id: "gate-1", readiness: "ready_for_approval", evidenceDigest: "abc" },
      stale: false,
      effectiveState: "ready_for_approval"
    }),
    listReleaseQaGateHistory: jest.fn().mockResolvedValue([
      { id: "gate-1", releaseName: "v1.2", buildVersion: "101", readiness: "ready_for_approval" }
    ]),
    listQaBuilds: jest.fn().mockResolvedValue([
      { id: "build-1", repository: "askk-pro/app", gitSha: "abcdef1234567", buildVersion: "101", environment: "staging" }
    ]),
    registerQaBuild: jest.fn().mockResolvedValue({
      id: "build-1", repository: "askk-pro/app", gitSha: "abcdef1234567", changedFiles: []
    }),
    markQaBuildDeployed: jest.fn().mockResolvedValue({ id: "build-1", deploymentTimestamp: "2026-10-02T10:00:00Z" }),
    getQaBuildImpact: jest.fn().mockResolvedValue({
      build: { id: "build-1", gitSha: "abcdef1234567" },
      risk: { score: 42, band: "MEDIUM", factors: [] },
      recommendation: { recommendedCount: 3, tests: [] }
    }),
    listChangeImpactRules: jest.fn().mockResolvedValue([]),
    createChangeImpactRule: jest.fn().mockResolvedValue({ id: "rule-1", pathPattern: "src/auth/**" }),
    updateChangeImpactRule: jest.fn().mockResolvedValue({ id: "rule-1", pathPattern: "src/auth/**" }),
    deleteChangeImpactRule: jest.fn().mockResolvedValue({ ok: true, id: "rule-1" }),
    generateRegressionPlan: jest.fn().mockResolvedValue({ id: "reg-plan-1", status: "DRAFT", selectedTestCount: 3 }),
    listRegressionPlans: jest.fn().mockResolvedValue([{ id: "reg-plan-1", status: "DRAFT" }]),
    getRegressionPlan: jest.fn().mockResolvedValue({ id: "reg-plan-1", status: "DRAFT", items: [], runs: [] }),
    overrideRegressionPlanTest: jest.fn().mockResolvedValue({ id: "reg-plan-1", status: "DRAFT", items: [] }),
    startRegressionPlan: jest.fn().mockResolvedValue({ plan: { id: "reg-plan-1", status: "TESTING" }, created: [] }),
    createSelectiveRegressionRerun: jest.fn().mockResolvedValue({ created: [], plan: { id: "reg-plan-1" } }),
    prepareReleaseCertification: jest.fn().mockResolvedValue({
      certification: { id: "cert-1", state: "READY", validityStatus: "current" },
      status: "ready"
    }),
    getReleaseCertification: jest.fn().mockResolvedValue({
      certification: { id: "cert-1", state: "READY", validityStatus: "current" },
      events: [],
      status: "ready"
    }),
    listReleaseCertifications: jest.fn().mockResolvedValue([]),
    getPhase5ReleaseDashboard: jest.fn().mockResolvedValue({
      build: { id: "build-1" },
      risk: { score: 42, band: "MEDIUM" },
      plan: { id: "reg-plan-1", selected: 3, coveragePct: 100 },
      execution: null,
      qaGate: null,
      certification: { certification: { id: "cert-1", state: "READY" } }
    }),
    listExecutionStepResults: jest.fn().mockResolvedValue([
      { stepNumber: 1, action: "Open login", status: "Failed", reportedBy: "human" }
    ]),
    saveExecutionStepResults: jest.fn().mockResolvedValue({
      executionId: "ex-1",
      status: "Failed",
      steps: [{ stepNumber: 1, action: "Open login", status: "Failed" }]
    }),
    decideTicketRetest: jest.fn().mockResolvedValue({
      ticket: { id: "bug-1", humanId: "QA-1", status: "Reopened" },
      runId: "cycle-1",
      decision: "failed",
      ticketStatus: "Reopened"
    }),
    linkTicketToRequirement: jest.fn().mockResolvedValue({ ticket: { id: "bug-1", humanId: "QA-1" }, requirements: [] }),
    unlinkTicketFromRequirement: jest.fn().mockResolvedValue({ ticket: { id: "bug-1", humanId: "QA-1" }, requirements: [], wasLinked: true }),
    searchQaReferences: jest.fn().mockResolvedValue({ matches: [{ kind: "ticket", id: "bug-1", humanId: "QA-1", title: "Bug 1" }] }),
    requirementMatrix: jest.fn().mockResolvedValue({ rows: [] }),
    searchKnowledgeBase: jest.fn().mockResolvedValue({ list: [], total: 0 }),
    listKnowledgeDocuments: jest.fn().mockResolvedValue({ list: [{ id: "kb-doc-1", title: "Doc 1" }], total: 1 }),
    getKnowledgeDocument: jest.fn().mockResolvedValue({ id: "kb-doc-1", title: "Doc 1", breadcrumb: [] }),
    createKnowledgeDocument: jest.fn().mockResolvedValue({ id: "kb-doc-new" }),
    updateKnowledgeDocument: jest.fn().mockResolvedValue({ id: "kb-doc-1" }),
    moveKnowledgeDocument: jest.fn().mockResolvedValue({ id: "kb-doc-1" }),
    deleteKnowledgeDocument: jest.fn().mockResolvedValue({ success: true }),
    restoreKnowledgeDocument: jest.fn().mockResolvedValue({ id: "kb-doc-1", title: "Doc 1", isDeleted: false }),
    getKnowledgeFolderTree: jest.fn().mockResolvedValue({ id: "folder-root", name: "Root", isRoot: true, children: [] }),
    getKnowledgeFolder: jest.fn().mockResolvedValue({ id: "kb-folder-1", name: "Folder 1", breadcrumb: [] }),
    createKnowledgeFolder: jest.fn().mockResolvedValue({ id: "kb-folder-new" }),
    updateKnowledgeFolder: jest.fn().mockResolvedValue({ id: "kb-folder-1" }),
    moveKnowledgeFolder: jest.fn().mockResolvedValue({ id: "kb-folder-1" }),
    ...overrides
  } as unknown as LegacyService;
}

/**
 * DB double. Routes the queries the engine and the tool handlers make:
 *  - MCP agent actor lookup -> configurable actor id
 *  - execution -> cycle/project lookup (requireExecutionOwner) -> configurable owning cycle+project (or none)
 *  - testcase/suite/bug/cycle -> project lookup (requireProjectOwnedRow) -> configurable owning project (or none)
 */
function makeDb(
  opts: {
    mcpActorId?: string | null;
    executionProject?: string | null | undefined;
    executionCycleId?: string;
    testcaseProject?: string | null | undefined;
    suiteProject?: string | null | undefined;
    bugProject?: string | null | undefined;
    cycleProject?: string | null | undefined;
    planProject?: string | null | undefined;
    /** ids partitionOwnedIds should treat as belonging to the token's project. */
    ownedTestcaseIds?: string[];
  } = {}
) {
  const query = jest.fn((sql: string) => {
    if (sql.includes("FROM actors a JOIN agents g")) {
      return Promise.resolve({ rows: opts.mcpActorId ? [{ id: opts.mcpActorId }] : [] });
    }
    if (sql.includes("FROM executions e")) {
      return Promise.resolve({
        rows:
          opts.executionProject === undefined
            ? []
            : [{ project_id: opts.executionProject, cycle_id: opts.executionCycleId ?? "cycle-1" }]
      });
    }
    // partitionOwnedIds's query (`id = ANY($1::uuid[])`) is checked before the single-id
    // requireProjectOwnedRow query below — both match "FROM testcases WHERE id", but only this
    // one returns `{id}` rows instead of `{project_id}` rows.
    if (sql.includes("FROM testcases WHERE id = ANY")) {
      return Promise.resolve({ rows: (opts.ownedTestcaseIds || []).map((id) => ({ id })) });
    }
    if (sql.includes("FROM testcases WHERE id")) {
      return Promise.resolve({
        rows: opts.testcaseProject === undefined ? [] : [{ project_id: opts.testcaseProject }]
      });
    }
    if (sql.includes("FROM suites WHERE id")) {
      return Promise.resolve({
        rows: opts.suiteProject === undefined ? [] : [{ project_id: opts.suiteProject }]
      });
    }
    if (sql.includes("FROM bugs WHERE id")) {
      return Promise.resolve({
        rows: opts.bugProject === undefined ? [] : [{ project_id: opts.bugProject }]
      });
    }
    if (sql.includes("FROM cycles WHERE id")) {
      return Promise.resolve({
        rows: opts.cycleProject === undefined ? [] : [{ project_id: opts.cycleProject }]
      });
    }
    if (sql.includes("FROM plans WHERE id")) {
      return Promise.resolve({
        rows: opts.planProject === undefined ? [] : [{ project_id: opts.planProject }]
      });
    }
    return Promise.resolve({ rows: [] });
  });
  return { db: { query } as unknown as DatabaseService, query };
}

function principal(over: Partial<ApiTokenContext> = {}): ApiTokenContext {
  return { tokenId: "tok-1", userId: "user-1", projectId: "proj-1", scopes: ["read", "write"], ...over };
}

const rpc = (method: string, params?: Record<string, unknown>, id: number | string = 1) => ({
  jsonrpc: "2.0" as const,
  id,
  method,
  params
});

describe("McpService", () => {
  describe("protocol handshake & discovery", () => {
    it("initialize advertises protocol version, capabilities and server info", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(rpc("initialize"), principal(), "proj-1");
      expect(res.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
      expect(res.result.serverInfo.name).toBe(MCP_SERVER_NAME);
      expect(res.result.capabilities).toHaveProperty("tools");
      expect(res.result.instructions).toBe(MCP_SERVER_INSTRUCTIONS);
      expect(res.id).toBe(1);
    });

    it("initialize echoes a supported client protocol version and falls back to the default otherwise", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const version = async (protocolVersion?: string) =>
        ((await svc.handleRequest(rpc("initialize", protocolVersion ? { protocolVersion } : {}), principal(), "proj-1")) as any).result.protocolVersion;
      expect(await version("2025-06-18")).toBe("2025-06-18");
      expect(await version("2024-11-05")).toBe("2024-11-05");
      // Requires JSON-RPC batch support, which this server does not have — answered as before.
      expect(await version("2025-03-26")).toBe(MCP_PROTOCOL_VERSION);
      expect(await version("1999-01-01")).toBe(MCP_PROTOCOL_VERSION);
      expect(await version()).toBe(MCP_PROTOCOL_VERSION);
    });

    it("serverInfo.version carries the deploy and a fingerprint of the tool set", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(rpc("initialize"), principal(), "proj-1");
      expect(res.result.serverInfo.version).toBe(svc.serverVersion);
      expect(svc.serverVersion).toMatch(/^0\.1\.0\+[^.]+\.[0-9a-f]{16}$/);
    });

    it("a session id is current only for the tool set it was issued against", () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const id = svc.newSessionId();
      expect(svc.isCurrentSession(id)).toBe(true);
      // Each initialize gets its own id.
      expect(svc.newSessionId()).not.toBe(id);
      // Another process built from the same code (the other blue/green color, a replica) must
      // accept it — the fingerprint is derived from the tools, not from the process.
      expect(new McpService(makeLegacy(), db).isCurrentSession(id)).toBe(true);
      // Issued by a build whose tools differed: stale, so the client is told to re-initialize.
      expect(svc.isCurrentSession(`0000000000000000.${id.split(".")[1]}`)).toBe(false);
      expect(svc.isCurrentSession("not-a-tesbo-session")).toBe(false);
      expect(svc.isCurrentSession("")).toBe(false);
    });

    it("recognises JSON-RPC notifications, which get no response", () => {
      expect(McpService.isNotification({ jsonrpc: "2.0", method: "notifications/initialized" })).toBe(true);
      expect(McpService.isNotification({ jsonrpc: "2.0", id: 1, method: "notifications/initialized" })).toBe(false);
      expect(McpService.isNotification({ jsonrpc: "2.0", method: "tools/list" })).toBe(false);
      expect(McpService.isNotification(null)).toBe(false);
      expect(McpService.isNotification("notifications/initialized")).toBe(false);
    });

    it("ping returns an empty result", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(rpc("ping"), principal(), "proj-1");
      expect(res.result).toEqual({});
    });

    it("tools/list returns every registered tool with a name, description and inputSchema", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(rpc("tools/list"), principal(), "proj-1");
      const names = res.result.tools.map((t: any) => t.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "list_projects",
          "list_testcases",
          "get_testcase",
          "create_testcase",
          "update_testcase",
          "archive_testcase",
          "restore_testcase",
          "duplicate_testcase",
          "bulk_create_testcases",
          "bulk_update_testcases",
          "bulk_archive_testcases",
          "get_testcase_bugs",
          "get_testcase_executions",
          "link_requirement_to_testcase",
          "unlink_requirement_from_testcase",
          "list_suites",
          "get_suite",
          "create_suite",
          "update_suite",
          "clone_test_suite",
          "list_test_cycles",
          "get_test_cycle",
          "create_cycle_from_plan",
          "create_cycle_from_testcases",
          "record_execution_result",
          "list_executions",
          "get_execution",
          "get_execution_steps",
          "record_execution_steps",
          "update_execution_result",
          "bulk_record_execution_results",
          "get_test_execution_summary",
          "list_bugs",
          "get_bug",
          "create_bug",
          "update_bug",
          "get_ticket_workspace",
          "get_ticket_traceability",
          "list_ticket_evidence",
          "attach_ticket_evidence",
          "get_ticket_analysis_context",
          "list_ticket_retests",
          "get_ticket_retest_comparison",
          "get_ticket_failure_intelligence",
          "get_ticket_failure_triage",
          "analyze_ticket_failure",
          "list_release_qa_gate_candidates",
          "evaluate_release_qa_gate",
          "get_release_qa_gate",
          "list_release_qa_gate_history",
          "list_qa_builds",
          "register_qa_build",
          "mark_qa_build_deployed",
          "get_qa_build_impact",
          "list_change_impact_rules",
          "create_change_impact_rule",
          "update_change_impact_rule",
          "delete_change_impact_rule",
          "generate_regression_plan",
          "list_regression_plans",
          "get_regression_plan",
          "override_regression_plan_test",
          "start_regression_plan",
          "create_selective_regression_rerun",
          "prepare_release_certification",
          "get_release_certification",
          "list_release_certifications",
          "get_release_dashboard",
          "decide_ticket_retest",
          "link_ticket_to_requirement",
          "unlink_ticket_from_requirement",
          "search_qa_references",
          "link_testcase_to_bug",
          "unlink_testcase_from_bug",
          "get_requirement_matrix",
          "search_knowledge_base",
          "list_knowledge_documents",
          "get_knowledge_document",
          "create_knowledge_document",
          "update_knowledge_document",
          "move_knowledge_document",
          "archive_knowledge_document",
          "restore_knowledge_document",
          "list_knowledge_folders",
          "get_knowledge_folder",
          "create_knowledge_folder",
          "update_knowledge_folder",
          "move_knowledge_folder"
        ])
      );
      for (const t of res.result.tools) {
        expect(typeof t.description).toBe("string");
        expect(t.inputSchema).toBeDefined();
      }
    });
  });

  describe("request validation", () => {
    it("rejects a non-2.0 payload with InvalidRequest", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest({ method: "ping" }, principal(), "proj-1");
      expect(res.error.code).toBe(RpcCode.InvalidRequest);
    });

    it("returns MethodNotFound for an unknown method", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(rpc("resources/list"), principal(), "proj-1");
      expect(res.error.code).toBe(RpcCode.MethodNotFound);
    });

    it("echoes back the request id on errors", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(rpc("nope", {}, 99), principal(), "proj-1");
      expect(res.id).toBe(99);
    });
  });

  describe("project scope enforcement", () => {
    it("denies when the token's project differs from the URL project", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(rpc("tools/list"), principal({ projectId: "proj-1" }), "proj-2");
      expect(res.error.code).toBe(RpcCode.ProjectScopeDenied);
    });

    it("denies when the token carries no project scope", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(rpc("tools/list"), principal({ projectId: null }), "proj-1");
      expect(res.error.code).toBe(RpcCode.ProjectScopeDenied);
    });
  });

  describe("tool scope enforcement", () => {
    it("blocks a write tool when the token only has read scope", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "create_suite", arguments: { name: "S" } }),
        principal({ scopes: ["read"] }),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ScopeDenied);
      expect((legacy as any).createSuite).not.toHaveBeenCalled();
    });

    it("allows a read tool for a read-only token", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "list_testcases", arguments: {} }),
        principal({ scopes: ["read"] }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
    });
  });

  describe("tools/call dispatch & result shape", () => {
    it("returns MethodNotFound for an unknown tool name", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(rpc("tools/call", { name: "delete_everything" }), principal(), "proj-1");
      expect(res.error.code).toBe(RpcCode.MethodNotFound);
    });

    it("wraps a read result as an MCP text content part", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(rpc("tools/call", { name: "list_projects" }), principal(), "proj-1");
      expect((legacy as any).getProject).toHaveBeenCalledWith("proj-1");
      expect(res.result.isError).toBe(false);
      expect(res.result.content[0].type).toBe("text");
      expect(JSON.parse(res.result.content[0].text)).toEqual({ projects: [{ id: "proj-1", name: "Demo" }] });
    });

    it("passes the token's project (not a client-supplied one) into list_testcases", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      await svc.handleRequest(
        rpc("tools/call", { name: "list_testcases", arguments: { status: "Active" } }),
        principal(),
        "proj-1"
      );
      expect((legacy as any).listTestCases).toHaveBeenCalledWith("proj-1", { status: "Active" });
    });

    it("passes the token's project and user into search_knowledge_base", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      await svc.handleRequest(
        rpc("tools/call", { name: "search_knowledge_base", arguments: { q: "login" } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect((legacy as any).searchKnowledgeBase).toHaveBeenCalledWith("proj-1", "user-7", { q: "login" });
    });
  });

  describe("Knowledge Base write tools", () => {
    it("attributes create_knowledge_document to the token's user, not the agent actor", async () => {
      // The engine resolves an MCP actor for every write-scope tool regardless of whether the
      // handler uses it (mcp.service.ts callTool) — the assertion that matters here is which id
      // Knowledge Base's created_by/updated_by columns actually receive: the human user, per the
      // module doc comment, since those columns reference users(id) rather than actors(id).
      const { db } = makeDb({ mcpActorId: "mcp-actor-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      await svc.handleRequest(
        rpc("tools/call", { name: "create_knowledge_document", arguments: { title: "Runbook", folderId: "folder-1" } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect((legacy as any).createKnowledgeDocument).toHaveBeenCalledWith("proj-1", "user-7", {
        title: "Runbook",
        folderId: "folder-1"
      });
    });

    it("rejects create_knowledge_document without folderId", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "create_knowledge_document", arguments: { title: "Runbook" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/"folderId"/i);
    });

    it("passes documentId and args through to update_knowledge_document", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      await svc.handleRequest(
        rpc("tools/call", { name: "update_knowledge_document", arguments: { documentId: "doc-1", title: "New title" } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect((legacy as any).updateKnowledgeDocument).toHaveBeenCalledWith("proj-1", "user-7", "doc-1", {
        documentId: "doc-1",
        title: "New title"
      });
    });

    it("rejects update_knowledge_document without documentId", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "update_knowledge_document", arguments: { title: "New title" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/"documentId"/i);
    });

    it("surfaces the read-only-mirror rejection from updateKnowledgeDocument as a ToolExecutionError", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy({
        updateKnowledgeDocument: jest.fn().mockRejectedValue({
          getResponse: () => ({ error: "synced from Jira and its body can't be edited" })
        })
      });
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "update_knowledge_document", arguments: { documentId: "doc-1", title: "x" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/synced from Jira/i);
    });

    it("passes documentId and folderId through to move_knowledge_document", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      await svc.handleRequest(
        rpc("tools/call", { name: "move_knowledge_document", arguments: { documentId: "doc-1", folderId: "folder-2" } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect((legacy as any).moveKnowledgeDocument).toHaveBeenCalledWith("proj-1", "user-7", "doc-1", {
        documentId: "doc-1",
        folderId: "folder-2"
      });
    });

    it("rejects move_knowledge_document without folderId", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "move_knowledge_document", arguments: { documentId: "doc-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/"folderId"/i);
    });

    it("passes the token's user through to create_knowledge_folder", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      await svc.handleRequest(
        rpc("tools/call", { name: "create_knowledge_folder", arguments: { name: "Release Notes 2" } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect((legacy as any).createKnowledgeFolder).toHaveBeenCalledWith("proj-1", "user-7", {
        name: "Release Notes 2"
      });
    });

    it("rejects create_knowledge_folder without name", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "create_knowledge_folder", arguments: {} }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/"name"/i);
    });

    it("passes folderId and args through to update_knowledge_folder", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      await svc.handleRequest(
        rpc("tools/call", { name: "update_knowledge_folder", arguments: { folderId: "folder-1", name: "Renamed" } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect((legacy as any).updateKnowledgeFolder).toHaveBeenCalledWith("proj-1", "user-7", "folder-1", {
        folderId: "folder-1",
        name: "Renamed"
      });
    });

    it("rejects update_knowledge_folder without folderId", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "update_knowledge_folder", arguments: { name: "Renamed" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/"folderId"/i);
    });

    it("passes folderId and parentFolderId through to move_knowledge_folder", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      await svc.handleRequest(
        rpc("tools/call", { name: "move_knowledge_folder", arguments: { folderId: "folder-1", parentFolderId: "folder-2" } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect((legacy as any).moveKnowledgeFolder).toHaveBeenCalledWith("proj-1", "user-7", "folder-1", {
        folderId: "folder-1",
        parentFolderId: "folder-2"
      });
    });

    it("rejects move_knowledge_folder without parentFolderId", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "move_knowledge_folder", arguments: { folderId: "folder-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/"parentFolderId"/i);
    });

    it("surfaces a role/ownership rejection (Forbidden) from a KB mutate method as a ToolExecutionError", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy({
        moveKnowledgeFolder: jest.fn().mockRejectedValue({
          getResponse: () => ({ error: "You can only modify items you created" })
        })
      });
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "move_knowledge_folder", arguments: { folderId: "folder-1", parentFolderId: "folder-2" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/only modify items you created/i);
    });
  });

  describe("Knowledge Base read/archive/restore tools", () => {
    it("lists and gets a Knowledge Base document, passing the token's project and user through", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);

      const listRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "list_knowledge_documents", arguments: { documentType: "general" } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(listRes.result.isError).toBe(false);
      expect((legacy as any).listKnowledgeDocuments).toHaveBeenCalledWith("proj-1", "user-7", { documentType: "general" });

      const getRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_knowledge_document", arguments: { documentId: "kb-doc-1" } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(getRes.result.isError).toBe(false);
      expect((legacy as any).getKnowledgeDocument).toHaveBeenCalledWith("proj-1", "user-7", "kb-doc-1");
    });

    it("rejects get_knowledge_document without documentId", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_knowledge_document", arguments: {} }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/"documentId"/i);
    });

    it("surfaces a not-found rejection from getKnowledgeDocument as a ToolExecutionError", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy({
        getKnowledgeDocument: jest.fn().mockRejectedValue({ getResponse: () => ({ error: "Document not found" }) })
      });
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_knowledge_document", arguments: { documentId: "ghost" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/document not found/i);
    });

    it("surfaces a cross-project rejection from getKnowledgeDocument/getKnowledgeFolder (kbDocument/kbFolder are project-scoped internally)", async () => {
      // Unlike testcases/suites/bugs/cycles, the KB legacy methods already filter by project_id
      // inside kbDocument()/kbFolder() themselves (WHERE id = $1 AND project_id = $2), so these
      // MCP tools need no extra ownership pre-check of their own — a foreign-project id simply
      // 404s from inside the legacy call, exactly like the REST GET routes that share it.
      const { db } = makeDb();
      const legacy = makeLegacy({
        getKnowledgeDocument: jest.fn().mockRejectedValue({ getResponse: () => ({ error: "Document not found" }) }),
        getKnowledgeFolder: jest.fn().mockRejectedValue({ getResponse: () => ({ error: "Folder not found" }) })
      });
      const svc = new McpService(legacy, db);
      const docRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_knowledge_document", arguments: { documentId: "foreign-doc" } }),
        principal(),
        "proj-1"
      );
      expect(docRes.error.code).toBe(RpcCode.ToolExecutionError);
      expect(docRes.error.message).toMatch(/document not found/i);

      const folderRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_knowledge_folder", arguments: { folderId: "foreign-folder" } }),
        principal(),
        "proj-1"
      );
      expect(folderRes.error.code).toBe(RpcCode.ToolExecutionError);
      expect(folderRes.error.message).toMatch(/folder not found/i);
    });

    it("lists the folder tree and gets one folder, passing the token's project and user through", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);

      const treeRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "list_knowledge_folders", arguments: {} }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(treeRes.result.isError).toBe(false);
      expect((legacy as any).getKnowledgeFolderTree).toHaveBeenCalledWith("proj-1", "user-7");
      expect(JSON.parse(treeRes.result.content[0].text).isRoot).toBe(true);

      const folderRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_knowledge_folder", arguments: { folderId: "kb-folder-1" } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(folderRes.result.isError).toBe(false);
      expect((legacy as any).getKnowledgeFolder).toHaveBeenCalledWith("proj-1", "user-7", "kb-folder-1");
    });

    it("rejects get_knowledge_folder without folderId", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_knowledge_folder", arguments: {} }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/"folderId"/i);
    });

    it("archives a Knowledge Base document, passing the token's project and user through", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "archive_knowledge_document", arguments: { documentId: "kb-doc-1" } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).deleteKnowledgeDocument).toHaveBeenCalledWith("proj-1", "user-7", "kb-doc-1");
    });

    it("rejects archive_knowledge_document without documentId", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "archive_knowledge_document", arguments: {} }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/"documentId"/i);
    });

    it("surfaces an already-archived (not found) rejection from deleteKnowledgeDocument as a ToolExecutionError", async () => {
      // deleteKnowledgeDocument's own kbDocument() lookup excludes already-deleted rows, so
      // archiving twice is NOT a silent no-op — it 404s the same as a nonexistent id. This test
      // documents that real (asymmetric-with-restore) behavior rather than inventing a softer one.
      const { db } = makeDb();
      const legacy = makeLegacy({
        deleteKnowledgeDocument: jest.fn().mockRejectedValue({ getResponse: () => ({ error: "Document not found" }) })
      });
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "archive_knowledge_document", arguments: { documentId: "kb-doc-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/document not found/i);
    });

    it("surfaces the Zyra AI Memory guard from deleteKnowledgeDocument as a ToolExecutionError", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy({
        deleteKnowledgeDocument: jest.fn().mockRejectedValue({
          getResponse: () => ({ error: '"Zyra AI Memory" is managed by Zyra and can\'t be deleted' })
        })
      });
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "archive_knowledge_document", arguments: { documentId: "kb-doc-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/managed by Zyra/i);
    });

    it("restores a Knowledge Base document, passing the token's project and user through", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "restore_knowledge_document", arguments: { documentId: "kb-doc-1" } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).restoreKnowledgeDocument).toHaveBeenCalledWith("proj-1", "user-7", "kb-doc-1");
    });

    it("rejects restore_knowledge_document without documentId", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "restore_knowledge_document", arguments: {} }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/"documentId"/i);
    });

    it("restoring a document that is not currently archived succeeds as a no-op (matching restoreKnowledgeDocument's own idempotent contract)", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy({
        restoreKnowledgeDocument: jest.fn().mockResolvedValue({ id: "kb-doc-1", title: "Doc 1", isDeleted: false, deletedAt: null })
      });
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "restore_knowledge_document", arguments: { documentId: "kb-doc-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect(JSON.parse(res.result.content[0].text).isDeleted).toBe(false);
    });

    it("surfaces the owner/manager-only rejection from restoreKnowledgeDocument as a ToolExecutionError", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy({
        restoreKnowledgeDocument: jest.fn().mockRejectedValue({
          getResponse: () => ({ error: "Only owners and managers can perform this action" })
        })
      });
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "restore_knowledge_document", arguments: { documentId: "kb-doc-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/only owners and managers/i);
    });

    it("blocks archive_knowledge_document/restore_knowledge_document for a read-scoped token", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const archiveRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "archive_knowledge_document", arguments: { documentId: "kb-doc-1" } }),
        principal({ scopes: ["read"] }),
        "proj-1"
      );
      expect(archiveRes.error.code).toBe(RpcCode.ScopeDenied);
      expect((legacy as any).deleteKnowledgeDocument).not.toHaveBeenCalled();

      const restoreRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "restore_knowledge_document", arguments: { documentId: "kb-doc-1" } }),
        principal({ scopes: ["read"] }),
        "proj-1"
      );
      expect(restoreRes.error.code).toBe(RpcCode.ScopeDenied);
      expect((legacy as any).restoreKnowledgeDocument).not.toHaveBeenCalled();
    });
  });

  describe("actor attribution", () => {
    it("attributes create_testcase writes to the resolved MCP agent actor", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      await svc.handleRequest(
        rpc("tools/call", { name: "create_testcase", arguments: { title: "Login works" } }),
        principal(),
        "proj-1"
      );
      expect((legacy as any).createTestCase).toHaveBeenCalledWith("proj-1", "mcp-actor-1", { title: "Login works" });
    });

    it("does not resolve an actor for read tools", async () => {
      const { db, query } = makeDb({ mcpActorId: "mcp-actor-1" });
      const svc = new McpService(makeLegacy(), db);
      await svc.handleRequest(rpc("tools/call", { name: "get_requirement_matrix" }), principal(), "proj-1");
      const actorLookups = query.mock.calls.filter((c) => String(c[0]).includes("FROM actors a JOIN agents g"));
      expect(actorLookups).toHaveLength(0);
    });

    it("caches the MCP actor lookup across calls", async () => {
      const { db, query } = makeDb({ mcpActorId: "mcp-actor-1" });
      const svc = new McpService(makeLegacy(), db);
      await svc.handleRequest(rpc("tools/call", { name: "create_suite", arguments: { name: "A" } }), principal(), "proj-1");
      await svc.handleRequest(rpc("tools/call", { name: "create_suite", arguments: { name: "B" } }), principal(), "proj-1");
      const actorLookups = query.mock.calls.filter((c) => String(c[0]).includes("FROM actors a JOIN agents g"));
      expect(actorLookups).toHaveLength(1);
    });

    it("reports bugs under the token user while attributing the mutation to the MCP actor", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      await svc.handleRequest(
        rpc("tools/call", { name: "create_bug", arguments: { title: "Broken" } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect((legacy as any).createBug).toHaveBeenCalledWith("proj-1", "user-7", { title: "Broken" }, "mcp-actor-1");
    });
  });

  describe("record_execution_result project scoping", () => {
    it("records a result when the execution belongs to the token's project", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", executionProject: "proj-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "record_execution_result", arguments: { executionId: "ex-1", status: "Passed" } }),
        principal(),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      // Attributed to the token's user (ctx.userId), NOT the mcp-actor-1 agent actor resolved by
      // makeDb's mcpActorId — updateExecution stores this as executions.executed_by, which
      // references users(id), and the agent actor has no organization_members row to satisfy
      // requireProjectAccess. See mcp.tools.ts's record_execution_result handler comment.
      expect((legacy as any).updateExecution).toHaveBeenCalledWith("ex-1", "user-1", {
        executionId: "ex-1",
        status: "Passed"
      });
    });

    it("denies recording a result for an execution in another project", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", executionProject: "proj-OTHER" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "record_execution_result", arguments: { executionId: "ex-1", status: "Passed" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ProjectScopeDenied);
      expect((legacy as any).updateExecution).not.toHaveBeenCalled();
    });

    it("returns a tool error when the execution does not exist", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", executionProject: undefined });
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "record_execution_result", arguments: { executionId: "ghost", status: "Passed" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/not found/i);
    });
  });

  describe("get_testcase project scoping", () => {
    it("returns a test case when it belongs to the token's project", async () => {
      const { db } = makeDb({ testcaseProject: "proj-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_testcase", arguments: { testcaseId: "tc-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).getTestCase).toHaveBeenCalledWith("tc-1");
    });

    it("denies reading a test case that belongs to another project", async () => {
      const { db } = makeDb({ testcaseProject: "proj-OTHER" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_testcase", arguments: { testcaseId: "tc-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ProjectScopeDenied);
      expect((legacy as any).getTestCase).not.toHaveBeenCalled();
    });

    it("returns a tool error when the test case does not exist", async () => {
      const { db } = makeDb({ testcaseProject: undefined });
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_testcase", arguments: { testcaseId: "ghost" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/not found/i);
    });

    it("rejects get_testcase without testcaseId", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(rpc("tools/call", { name: "get_testcase", arguments: {} }), principal(), "proj-1");
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/"testcaseId"/i);
    });
  });

  describe("update_testcase project scoping", () => {
    it("updates a test case when it belongs to the token's project, attributed to the agent actor", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", testcaseProject: "proj-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "update_testcase", arguments: { testcaseId: "tc-1", title: "New title" } }),
        principal({ userId: "user-1" }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      // Attributed to the resolved MCP agent actor, same as create_testcase, since
      // testcases.updated_by references actors(id) — see mcp.tools.ts's handler comment.
      // suiteId/ownerId are re-supplied from the current row (preserveOmittedSuiteAndOwner):
      // updateTestCaseWithClient writes both verbatim (no COALESCE), so omitting them here must
      // not silently clear them.
      expect((legacy as any).updateTestCase).toHaveBeenCalledWith("tc-1", "mcp-actor-1", {
        title: "New title",
        suiteId: "suite-current",
        ownerId: "user-current"
      });
      expect((legacy as any).getTestCase).toHaveBeenCalledWith("tc-1");
    });

    it("denies updating a test case that belongs to another project", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", testcaseProject: "proj-OTHER" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "update_testcase", arguments: { testcaseId: "tc-1", title: "New title" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ProjectScopeDenied);
      expect((legacy as any).updateTestCase).not.toHaveBeenCalled();
    });

    it("returns a tool error when updating a test case that does not exist", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", testcaseProject: undefined });
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "update_testcase", arguments: { testcaseId: "ghost", title: "x" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/not found/i);
    });

    it("rejects update_testcase without testcaseId", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "update_testcase", arguments: { title: "x" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/"testcaseId"/i);
    });

  });

  describe("archive_testcase / restore_testcase project scoping", () => {
    it("archives a test case by setting status to Archived, attributed to the agent actor", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", testcaseProject: "proj-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "archive_testcase", arguments: { testcaseId: "tc-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      // Regression: archive_testcase only means to touch status — it must re-supply the test
      // case's current suiteId/ownerId (fetched via getTestCase), or updateTestCaseWithClient's
      // no-COALESCE columns silently unassign the suite/owner on every archive.
      expect((legacy as any).updateTestCase).toHaveBeenCalledWith("tc-1", "mcp-actor-1", {
        status: "Archived",
        suiteId: "suite-current",
        ownerId: "user-current"
      });
      expect((legacy as any).getTestCase).toHaveBeenCalledWith("tc-1");
    });

    it("restores a test case by setting status to Draft, attributed to the agent actor", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", testcaseProject: "proj-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "restore_testcase", arguments: { testcaseId: "tc-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).updateTestCase).toHaveBeenCalledWith("tc-1", "mcp-actor-1", {
        status: "Draft",
        suiteId: "suite-current",
        ownerId: "user-current"
      });
    });

    it("does not fetch or override suiteId/ownerId when the caller already supplied both", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", testcaseProject: "proj-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      await svc.handleRequest(
        rpc("tools/call", {
          name: "update_testcase",
          arguments: { testcaseId: "tc-1", suiteId: "suite-explicit", ownerId: "user-explicit", title: "New title" }
        }),
        principal(),
        "proj-1"
      );
      expect((legacy as any).updateTestCase).toHaveBeenCalledWith("tc-1", "mcp-actor-1", {
        title: "New title",
        suiteId: "suite-explicit",
        ownerId: "user-explicit"
      });
      // getTestCase is still called once for the return value, but not a second time to look up
      // current suiteId/ownerId, since both were already supplied.
      expect((legacy as any).getTestCase).toHaveBeenCalledTimes(1);
    });

    it("respects an explicit null suiteId (unassign from suite) instead of preserving the current one", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", testcaseProject: "proj-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      await svc.handleRequest(
        rpc("tools/call", { name: "update_testcase", arguments: { testcaseId: "tc-1", suiteId: null, ownerId: null } }),
        principal(),
        "proj-1"
      );
      expect((legacy as any).updateTestCase).toHaveBeenCalledWith("tc-1", "mcp-actor-1", { suiteId: null, ownerId: null });
    });

    it("denies archiving and restoring a test case that belongs to another project", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", testcaseProject: "proj-OTHER" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);

      const archiveRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "archive_testcase", arguments: { testcaseId: "tc-1" } }),
        principal(),
        "proj-1"
      );
      expect(archiveRes.error.code).toBe(RpcCode.ProjectScopeDenied);

      const restoreRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "restore_testcase", arguments: { testcaseId: "tc-1" } }),
        principal(),
        "proj-1"
      );
      expect(restoreRes.error.code).toBe(RpcCode.ProjectScopeDenied);
      expect((legacy as any).updateTestCase).not.toHaveBeenCalled();
    });

    it("returns a tool error for archive_testcase/restore_testcase on a test case that does not exist", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", testcaseProject: undefined });
      const svc = new McpService(makeLegacy(), db);
      const archiveRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "archive_testcase", arguments: { testcaseId: "ghost" } }),
        principal(),
        "proj-1"
      );
      expect(archiveRes.error.code).toBe(RpcCode.ToolExecutionError);
      expect(archiveRes.error.message).toMatch(/not found/i);

      const restoreRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "restore_testcase", arguments: { testcaseId: "ghost" } }),
        principal(),
        "proj-1"
      );
      expect(restoreRes.error.code).toBe(RpcCode.ToolExecutionError);
      expect(restoreRes.error.message).toMatch(/not found/i);
    });

    it("rejects archive_testcase and restore_testcase without testcaseId", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      expect(
        (await svc.handleRequest(rpc("tools/call", { name: "archive_testcase", arguments: {} }), principal(), "proj-1") as any).error
          .message
      ).toMatch(/"testcaseId"/i);
      expect(
        (await svc.handleRequest(rpc("tools/call", { name: "restore_testcase", arguments: {} }), principal(), "proj-1") as any).error
          .message
      ).toMatch(/"testcaseId"/i);
    });
  });

  describe("duplicate_testcase project scoping", () => {
    it("duplicates a test case, attributed to the agent actor, without altering the original", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", testcaseProject: "proj-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "duplicate_testcase", arguments: { testcaseId: "tc-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).duplicateTestCase).toHaveBeenCalledWith("tc-1", "mcp-actor-1");
      // updateTestCase (or any other write on the source id) must never be invoked by a duplicate.
      expect((legacy as any).updateTestCase).not.toHaveBeenCalled();
      const body = JSON.parse(res.result.content[0].text);
      expect(body.id).toBe("tc-copy");
    });

    it("denies duplicate_testcase for a test case belonging to another project", async () => {
      const { db } = makeDb({ testcaseProject: "proj-OTHER" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "duplicate_testcase", arguments: { testcaseId: "tc-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ProjectScopeDenied);
      expect((legacy as any).duplicateTestCase).not.toHaveBeenCalled();
    });

    it("returns a tool error when duplicating a test case that does not exist, and rejects a missing testcaseId", async () => {
      const { db } = makeDb({ testcaseProject: undefined });
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "duplicate_testcase", arguments: { testcaseId: "ghost" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/not found/i);

      const missing: any = await svc.handleRequest(rpc("tools/call", { name: "duplicate_testcase", arguments: {} }), principal(), "proj-1");
      expect(missing.error.message).toMatch(/"testcaseId"/i);
    });
  });

  describe("bulk_create_testcases", () => {
    it("creates every valid item and reports a per-item failure without stopping the batch", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1" });
      const legacy = makeLegacy({
        createTestCase: jest
          .fn()
          .mockResolvedValueOnce({ id: "tc-a" })
          .mockRejectedValueOnce({ getResponse: () => ({ error: "Title must be 512 characters or fewer" }) })
          .mockResolvedValueOnce({ id: "tc-c" })
      });
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", {
          name: "bulk_create_testcases",
          arguments: { testcases: [{ title: "A" }, { title: "B-too-long" }, { title: "C" }] }
        }),
        principal(),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      const body = JSON.parse(res.result.content[0].text);
      expect(body.total).toBe(3);
      expect(body.succeeded).toBe(2);
      expect(body.failed).toBe(1);
      expect(body.results[0]).toEqual({ index: 0, ok: true, testcase: { id: "tc-a" } });
      expect(body.results[1].ok).toBe(false);
      expect(body.results[1].error).toMatch(/512 characters/i);
      expect(body.results[2]).toEqual({ index: 2, ok: true, testcase: { id: "tc-c" } });
      expect((legacy as any).createTestCase).toHaveBeenCalledTimes(3);
      // Every item attributed to the agent actor, exactly like create_testcase.
      expect((legacy as any).createTestCase).toHaveBeenNthCalledWith(1, "proj-1", "mcp-actor-1", { title: "A" });
    });

    it("reports a per-item failure for a missing title without needing the legacy call to reject", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "bulk_create_testcases", arguments: { testcases: [{ title: "Fine" }, {}] } }),
        principal(),
        "proj-1"
      );
      const body = JSON.parse(res.result.content[0].text);
      expect(body.succeeded).toBe(1);
      expect(body.failed).toBe(1);
      expect(body.results[1].error).toMatch(/"title"/i);
      // The invalid item never reached the legacy layer at all.
      expect((legacy as any).createTestCase).toHaveBeenCalledTimes(1);
    });

    it("rejects an empty or over-limit testcases array", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const empty: any = await svc.handleRequest(
        rpc("tools/call", { name: "bulk_create_testcases", arguments: { testcases: [] } }),
        principal(),
        "proj-1"
      );
      expect(empty.error.message).toMatch(/non-empty array/i);

      const overLimit = Array.from({ length: 501 }, (_, i) => ({ title: `T${i}` }));
      const tooMany: any = await svc.handleRequest(
        rpc("tools/call", { name: "bulk_create_testcases", arguments: { testcases: overLimit } }),
        principal(),
        "proj-1"
      );
      expect(tooMany.error.message).toMatch(/limited to 500/i);
    });

    it("accepts a large batch at the limit, creating every item", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1" });
      const legacy = makeLegacy({ createTestCase: jest.fn().mockResolvedValue({ id: "tc-x" }) });
      const svc = new McpService(legacy, db);
      const atLimit = Array.from({ length: 500 }, (_, i) => ({ title: `T${i}` }));
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "bulk_create_testcases", arguments: { testcases: atLimit } }),
        principal(),
        "proj-1"
      );
      const body = JSON.parse(res.result.content[0].text);
      expect(body.total).toBe(500);
      expect(body.succeeded).toBe(500);
      expect((legacy as any).createTestCase).toHaveBeenCalledTimes(500);
    });

    it("rejects bulk_create_testcases for a read-scoped token", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "bulk_create_testcases", arguments: { testcases: [{ title: "X" }] } }),
        principal({ scopes: ["read"] }),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ScopeDenied);
      expect((legacy as any).createTestCase).not.toHaveBeenCalled();
    });
  });

  describe("bulk_update_testcases / bulk_archive_testcases", () => {
    it("applies one update to every valid id and reports invalid ids as per-item failures", async () => {
      const { db } = makeDb({ ownedTestcaseIds: ["tc-1", "tc-2"] });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", {
          name: "bulk_update_testcases",
          arguments: { testcaseIds: ["tc-1", "tc-2", "tc-ghost"], priority: "High" }
        }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      // bulkUpdateTestCases requires a real user, not the agent actor (same as update_suite).
      expect((legacy as any).bulkUpdateTestCases).toHaveBeenCalledWith("proj-1", "user-7", {
        testcaseIds: ["tc-1", "tc-2"],
        priority: "High",
        suiteId: undefined,
        status: undefined,
        ownerId: undefined,
        automationStatus: undefined
      });
      const body = JSON.parse(res.result.content[0].text);
      expect(body.total).toBe(3);
      expect(body.succeeded).toBe(2);
      expect(body.failed).toBe(1);
      expect(body.results.find((r: any) => r.id === "tc-ghost")).toEqual({
        id: "tc-ghost",
        ok: false,
        error: "Test case not found in this project"
      });
    });

    it("deduplicates repeated ids in the input before applying and reporting", async () => {
      const { db } = makeDb({ ownedTestcaseIds: ["tc-1"] });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "bulk_update_testcases", arguments: { testcaseIds: ["tc-1", "tc-1", "tc-1"], priority: "Low" } }),
        principal(),
        "proj-1"
      );
      const body = JSON.parse(res.result.content[0].text);
      expect(body.total).toBe(1);
      expect(body.results).toHaveLength(1);
      expect((legacy as any).bulkUpdateTestCases).toHaveBeenCalledTimes(1);
    });

    it("never calls bulkUpdateTestCases at all when every id is invalid (no unintended update)", async () => {
      const { db } = makeDb({ ownedTestcaseIds: [] });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "bulk_update_testcases", arguments: { testcaseIds: ["tc-ghost-1", "tc-ghost-2"], priority: "High" } }),
        principal(),
        "proj-1"
      );
      const body = JSON.parse(res.result.content[0].text);
      expect(body.succeeded).toBe(0);
      expect(body.failed).toBe(2);
      expect((legacy as any).bulkUpdateTestCases).not.toHaveBeenCalled();
    });

    it("bulk-archives valid ids by setting status to Archived, leaving invalid ids untouched", async () => {
      const { db } = makeDb({ ownedTestcaseIds: ["tc-1", "tc-2"] });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "bulk_archive_testcases", arguments: { testcaseIds: ["tc-1", "tc-2", "tc-ghost"] } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).bulkUpdateTestCases).toHaveBeenCalledWith("proj-1", "user-7", {
        testcaseIds: ["tc-1", "tc-2"],
        status: "Archived"
      });
      const body = JSON.parse(res.result.content[0].text);
      expect(body.succeeded).toBe(2);
      expect(body.failed).toBe(1);
    });

    it("rejects an empty or over-limit testcaseIds array for both tools", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      for (const name of ["bulk_update_testcases", "bulk_archive_testcases"]) {
        const empty: any = await svc.handleRequest(rpc("tools/call", { name, arguments: { testcaseIds: [] } }), principal(), "proj-1");
        expect(empty.error.message).toMatch(/non-empty array/i);

        const tooMany: any = await svc.handleRequest(
          rpc("tools/call", { name, arguments: { testcaseIds: Array.from({ length: 501 }, (_, i) => `id-${i}`) } }),
          principal(),
          "proj-1"
        );
        expect(tooMany.error.message).toMatch(/limited to 500/i);
      }
    });

    it("rejects bulk_update_testcases and bulk_archive_testcases for a read-scoped token", async () => {
      const { db } = makeDb({ ownedTestcaseIds: ["tc-1"] });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const updateRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "bulk_update_testcases", arguments: { testcaseIds: ["tc-1"], priority: "High" } }),
        principal({ scopes: ["read"] }),
        "proj-1"
      );
      expect(updateRes.error.code).toBe(RpcCode.ScopeDenied);
      const archiveRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "bulk_archive_testcases", arguments: { testcaseIds: ["tc-1"] } }),
        principal({ scopes: ["read"] }),
        "proj-1"
      );
      expect(archiveRes.error.code).toBe(RpcCode.ScopeDenied);
      expect((legacy as any).bulkUpdateTestCases).not.toHaveBeenCalled();
    });
  });

  describe("get_testcase_bugs / get_testcase_executions project scoping", () => {
    it("lists bugs and executions for a test case that belongs to the token's project", async () => {
      const { db } = makeDb({ testcaseProject: "proj-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);

      const bugsRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_testcase_bugs", arguments: { testcaseId: "tc-1" } }),
        principal(),
        "proj-1"
      );
      expect(bugsRes.result.isError).toBe(false);
      expect((legacy as any).listBugs).toHaveBeenCalledWith("proj-1", { testcaseId: "tc-1" });
      expect(JSON.parse(bugsRes.result.content[0].text).bugs).toHaveLength(1);

      const executionsRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_testcase_executions", arguments: { testcaseId: "tc-1" } }),
        principal(),
        "proj-1"
      );
      expect(executionsRes.result.isError).toBe(false);
      expect((legacy as any).testcaseExecutions).toHaveBeenCalledWith("proj-1", "tc-1");
      expect(JSON.parse(executionsRes.result.content[0].text).executions).toHaveLength(1);
    });

    it("denies get_testcase_bugs/get_testcase_executions for a test case belonging to another project", async () => {
      const { db } = makeDb({ testcaseProject: "proj-OTHER" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);

      const bugsRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_testcase_bugs", arguments: { testcaseId: "tc-1" } }),
        principal(),
        "proj-1"
      );
      expect(bugsRes.error.code).toBe(RpcCode.ProjectScopeDenied);
      expect((legacy as any).listBugs).not.toHaveBeenCalled();

      const executionsRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_testcase_executions", arguments: { testcaseId: "tc-1" } }),
        principal(),
        "proj-1"
      );
      expect(executionsRes.error.code).toBe(RpcCode.ProjectScopeDenied);
      expect((legacy as any).testcaseExecutions).not.toHaveBeenCalled();
    });

    it("returns a tool error for get_testcase_bugs/get_testcase_executions when the test case does not exist", async () => {
      const { db } = makeDb({ testcaseProject: undefined });
      const svc = new McpService(makeLegacy(), db);
      const bugsRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_testcase_bugs", arguments: { testcaseId: "ghost" } }),
        principal(),
        "proj-1"
      );
      expect(bugsRes.error.code).toBe(RpcCode.ToolExecutionError);
      expect(bugsRes.error.message).toMatch(/not found/i);
    });

    it("rejects get_testcase_bugs and get_testcase_executions without testcaseId", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      expect(
        (await svc.handleRequest(rpc("tools/call", { name: "get_testcase_bugs", arguments: {} }), principal(), "proj-1") as any).error
          .message
      ).toMatch(/"testcaseId"/i);
      expect(
        (
          await svc.handleRequest(rpc("tools/call", { name: "get_testcase_executions", arguments: {} }), principal(), "proj-1") as any
        ).error.message
      ).toMatch(/"testcaseId"/i);
    });
  });

  describe("link_requirement_to_testcase / unlink_requirement_from_testcase project scoping", () => {
    it("links a test case to a Jira requirement, attributed to the agent actor", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", testcaseProject: "proj-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "link_requirement_to_testcase", arguments: { testcaseId: "tc-1", jiraIssueKey: "PROJ-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      // Regression: link/unlink_requirement_to_testcase only mean to touch the Jira/Linear
      // fields — same preserveOmittedSuiteAndOwner fix as update_testcase/archive_testcase.
      expect((legacy as any).updateTestCase).toHaveBeenCalledWith("tc-1", "mcp-actor-1", {
        jiraIssueKey: "PROJ-1",
        jiraUrl: undefined,
        suiteId: "suite-current",
        ownerId: "user-current"
      });
    });

    it("unlinks a test case's Jira requirement by clearing jiraIssueKey/jiraUrl", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", testcaseProject: "proj-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "unlink_requirement_from_testcase", arguments: { testcaseId: "tc-1", provider: "jira" } }),
        principal(),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).updateTestCase).toHaveBeenCalledWith("tc-1", "mcp-actor-1", {
        jiraIssueKey: null,
        jiraUrl: null,
        suiteId: "suite-current",
        ownerId: "user-current"
      });
    });

    it("rejects link_requirement_to_testcase with neither or both of jiraIssueKey/linearIssueKey", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const neither: any = await svc.handleRequest(
        rpc("tools/call", { name: "link_requirement_to_testcase", arguments: { testcaseId: "tc-1" } }),
        principal(),
        "proj-1"
      );
      expect(neither.error.message).toMatch(/jiraIssueKey.*linearIssueKey|linearIssueKey.*jiraIssueKey/i);

      const both: any = await svc.handleRequest(
        rpc("tools/call", {
          name: "link_requirement_to_testcase",
          arguments: { testcaseId: "tc-1", jiraIssueKey: "PROJ-1", linearIssueKey: "ENG-1" }
        }),
        principal(),
        "proj-1"
      );
      expect(both.error.message).toMatch(/only one of/i);
    });

    it("rejects unlink_requirement_from_testcase with an invalid provider", async () => {
      const { db } = makeDb({ testcaseProject: "proj-1" });
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "unlink_requirement_from_testcase", arguments: { testcaseId: "tc-1", provider: "github" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/"provider" must be "jira" or "linear"/i);
    });

    it("denies link/unlink_requirement for a test case belonging to another project", async () => {
      const { db } = makeDb({ testcaseProject: "proj-OTHER" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const linkRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "link_requirement_to_testcase", arguments: { testcaseId: "tc-1", jiraIssueKey: "PROJ-1" } }),
        principal(),
        "proj-1"
      );
      expect(linkRes.error.code).toBe(RpcCode.ProjectScopeDenied);
      const unlinkRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "unlink_requirement_from_testcase", arguments: { testcaseId: "tc-1", provider: "jira" } }),
        principal(),
        "proj-1"
      );
      expect(unlinkRes.error.code).toBe(RpcCode.ProjectScopeDenied);
      expect((legacy as any).updateTestCase).not.toHaveBeenCalled();
    });
  });

  describe("list_suites / get_suite / update_suite project scoping", () => {
    it("lists suites scoped to the token's project", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(rpc("tools/call", { name: "list_suites", arguments: {} }), principal(), "proj-1");
      expect(res.result.isError).toBe(false);
      expect((legacy as any).listSuites).toHaveBeenCalledWith("proj-1");
      expect(JSON.parse(res.result.content[0].text).suites).toHaveLength(1);
    });

    it("returns a suite by id when it belongs to the token's project", async () => {
      const { db } = makeDb({ suiteProject: "proj-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_suite", arguments: { suiteId: "suite-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect(JSON.parse(res.result.content[0].text).id).toBe("suite-1");
    });

    it("denies get_suite/update_suite for a suite belonging to another project", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", suiteProject: "proj-OTHER" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);

      const getRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_suite", arguments: { suiteId: "suite-1" } }),
        principal(),
        "proj-1"
      );
      expect(getRes.error.code).toBe(RpcCode.ProjectScopeDenied);

      const updateRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "update_suite", arguments: { suiteId: "suite-1", name: "Renamed" } }),
        principal(),
        "proj-1"
      );
      expect(updateRes.error.code).toBe(RpcCode.ProjectScopeDenied);
      expect((legacy as any).updateSuite).not.toHaveBeenCalled();
    });

    it("returns a tool error for get_suite/update_suite when the suite does not exist", async () => {
      const { db } = makeDb({ suiteProject: undefined });
      const svc = new McpService(makeLegacy(), db);
      const getRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_suite", arguments: { suiteId: "ghost" } }),
        principal(),
        "proj-1"
      );
      expect(getRes.error.code).toBe(RpcCode.ToolExecutionError);
      expect(getRes.error.message).toMatch(/not found/i);
    });

    it("rejects get_suite and update_suite without suiteId", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      expect(
        (await svc.handleRequest(rpc("tools/call", { name: "get_suite", arguments: {} }), principal(), "proj-1") as any).error.message
      ).toMatch(/"suiteId"/i);
      expect(
        (await svc.handleRequest(rpc("tools/call", { name: "update_suite", arguments: {} }), principal(), "proj-1") as any).error
          .message
      ).toMatch(/"suiteId"/i);
    });

    it("renames a suite while defaulting parentId to its current parent, attributed to the token's user", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", suiteProject: "proj-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "update_suite", arguments: { suiteId: "suite-1", name: "Renamed" } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      // updateSuite() has no COALESCE on parent_id — the tool must supply the suite's own current
      // parentId ("suite-root", from makeLegacy's listSuites mock) when the caller didn't send one,
      // or a rename-only call would silently move the suite to the project root. Attributed to
      // ctx.userId (not the agent actor) since updateSuite requires a real user for its internal
      // requireProjectAccess check.
      expect((legacy as any).updateSuite).toHaveBeenCalledWith("user-7", "suite-1", {
        name: "Renamed",
        parentId: "suite-root",
        position: undefined
      });
    });

    it("reparents a suite to the root when parentId is explicitly null", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", suiteProject: "proj-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      await svc.handleRequest(
        rpc("tools/call", { name: "update_suite", arguments: { suiteId: "suite-1", parentId: null } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect((legacy as any).updateSuite).toHaveBeenCalledWith("user-7", "suite-1", {
        name: undefined,
        parentId: null,
        position: undefined
      });
    });
  });

  describe("clone_test_suite", () => {
    // A 2-node subtree: suite-1 (source, parent "suite-root") with one child suite-2, one test
    // case directly in each. Exercises the parent-before-child clone order and per-suite
    // test-case relocation in one pass.
    function makeCloneLegacy(overrides: Partial<Record<string, jest.Mock>> = {}) {
      return makeLegacy({
        listSuites: jest.fn().mockResolvedValue([
          { id: "suite-1", parentId: "suite-root", name: "Suite 1", position: 0, testCaseCount: 1, recursiveTestCaseCount: 2 },
          { id: "suite-2", parentId: "suite-1", name: "Suite 2", position: 0, testCaseCount: 1, recursiveTestCaseCount: 1 }
        ]),
        listTestCases: jest
          .fn()
          .mockResolvedValueOnce({ rows: [], total: 1 }) // pre-count for suite-1
          .mockResolvedValueOnce({ rows: [], total: 1 }) // pre-count for suite-2
          .mockResolvedValueOnce({ rows: [{ id: "tc-in-suite-1" }], total: 1 }) // full fetch, suite-1
          .mockResolvedValueOnce({ rows: [{ id: "tc-in-suite-2" }], total: 1 }), // full fetch, suite-2
        createSuite: jest
          .fn()
          .mockResolvedValueOnce({ id: "suite-1-clone", name: "Suite 1 (copy)" })
          .mockResolvedValueOnce({ id: "suite-2-clone", name: "Suite 2" }),
        duplicateTestCase: jest
          .fn()
          .mockResolvedValueOnce({ id: "tc-in-suite-1-clone", ownerId: "owner-copied-1" })
          .mockResolvedValueOnce({ id: "tc-in-suite-2-clone", ownerId: "owner-copied-2" }),
        ...overrides
      });
    }

    it("clones a suite and its subtree's test cases, leaving the originals untouched", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", suiteProject: "proj-1" });
      const legacy = makeCloneLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "clone_test_suite", arguments: { suiteId: "suite-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      const body = JSON.parse(res.result.content[0].text);
      expect(body.suiteCount).toBe(2);
      expect(body.testcaseCount).toBe(2);
      expect(body.clonedSuiteId).toBe("suite-1-clone");

      // Parent cloned before child: suite-1's clone must exist before suite-2 is created under it.
      expect((legacy as any).createSuite).toHaveBeenNthCalledWith(1, "proj-1", { name: "Suite 1 (copy)", parentId: "suite-root", position: 0 });
      expect((legacy as any).createSuite).toHaveBeenNthCalledWith(2, "proj-1", { name: "Suite 2", parentId: "suite-1-clone", position: 0 });

      // Each source test case duplicated (attributed to the agent actor) then relocated into its
      // new suite — the source suite/test case ids are never passed to any write except
      // duplicateTestCase's read-only source-id argument.
      expect((legacy as any).duplicateTestCase).toHaveBeenCalledWith("tc-in-suite-1", "mcp-actor-1");
      // The relocation call must re-supply the ownerId duplicateTestCase already copied from the
      // source (updateTestCase writes owner_id verbatim, no COALESCE) — otherwise moving the copy
      // into its new suite silently drops its owner.
      expect((legacy as any).updateTestCase).toHaveBeenCalledWith("tc-in-suite-1-clone", "mcp-actor-1", {
        suiteId: "suite-1-clone",
        ownerId: "owner-copied-1"
      });
      expect((legacy as any).duplicateTestCase).toHaveBeenCalledWith("tc-in-suite-2", "mcp-actor-1");
      expect((legacy as any).updateTestCase).toHaveBeenCalledWith("tc-in-suite-2-clone", "mcp-actor-1", {
        suiteId: "suite-2-clone",
        ownerId: "owner-copied-2"
      });
      // Never a write keyed on the original suite ids.
      expect((legacy as any).updateSuite).not.toHaveBeenCalled();
    });

    it("denies clone_test_suite for a suite belonging to another project", async () => {
      const { db } = makeDb({ suiteProject: "proj-OTHER" });
      const legacy = makeCloneLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "clone_test_suite", arguments: { suiteId: "suite-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ProjectScopeDenied);
      expect((legacy as any).createSuite).not.toHaveBeenCalled();
    });

    it("refuses a subtree over the suite-count limit before creating anything", async () => {
      const { db } = makeDb({ suiteProject: "proj-1" });
      const bigTree = Array.from({ length: 101 }, (_, i) => ({
        id: i === 0 ? "suite-1" : `suite-child-${i}`,
        parentId: i === 0 ? null : "suite-1",
        name: `Suite ${i}`,
        position: i
      }));
      const legacy = makeLegacy({ listSuites: jest.fn().mockResolvedValue(bigTree) });
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "clone_test_suite", arguments: { suiteId: "suite-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/over the 100-suite clone limit/i);
      expect((legacy as any).createSuite).not.toHaveBeenCalled();
    });

    it("returns a tool error when the source suite does not exist, and rejects a missing suiteId", async () => {
      const { db } = makeDb({ suiteProject: undefined });
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "clone_test_suite", arguments: { suiteId: "ghost" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/not found/i);

      const missing: any = await svc.handleRequest(rpc("tools/call", { name: "clone_test_suite", arguments: {} }), principal(), "proj-1");
      expect(missing.error.message).toMatch(/"suiteId"/i);
    });

    it("rejects clone_test_suite for a read-scoped token", async () => {
      const { db } = makeDb({ suiteProject: "proj-1" });
      const legacy = makeCloneLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "clone_test_suite", arguments: { suiteId: "suite-1" } }),
        principal({ scopes: ["read"] }),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ScopeDenied);
      expect((legacy as any).createSuite).not.toHaveBeenCalled();
    });
  });

  describe("list_bugs / get_bug / update_bug project scoping", () => {
    it("lists bugs scoped to the token's project with filters forwarded", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "list_bugs", arguments: { status: "Open" } }),
        principal(),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).listBugs).toHaveBeenCalledWith("proj-1", { status: "Open" });
      expect(JSON.parse(res.result.content[0].text).bugs).toHaveLength(1);
    });

    it("returns a bug by id when it belongs to the token's project", async () => {
      const { db } = makeDb({ bugProject: "proj-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(rpc("tools/call", { name: "get_bug", arguments: { bugId: "bug-1" } }), principal(), "proj-1");
      expect(res.result.isError).toBe(false);
      expect((legacy as any).getBug).toHaveBeenCalledWith("bug-1");
    });

    it("denies get_bug/update_bug for a bug belonging to another project", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", bugProject: "proj-OTHER" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);

      const getRes: any = await svc.handleRequest(rpc("tools/call", { name: "get_bug", arguments: { bugId: "bug-1" } }), principal(), "proj-1");
      expect(getRes.error.code).toBe(RpcCode.ProjectScopeDenied);

      const updateRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "update_bug", arguments: { bugId: "bug-1", status: "Closed" } }),
        principal(),
        "proj-1"
      );
      expect(updateRes.error.code).toBe(RpcCode.ProjectScopeDenied);
      expect((legacy as any).updateBug).not.toHaveBeenCalled();
    });

    it("returns a tool error for get_bug/update_bug when the bug does not exist", async () => {
      const { db } = makeDb({ bugProject: undefined });
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(rpc("tools/call", { name: "get_bug", arguments: { bugId: "ghost" } }), principal(), "proj-1");
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/not found/i);
    });

    it("rejects get_bug and update_bug without bugId", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      expect(
        (await svc.handleRequest(rpc("tools/call", { name: "get_bug", arguments: {} }), principal(), "proj-1") as any).error.message
      ).toMatch(/"bugId"/i);
      expect(
        (await svc.handleRequest(rpc("tools/call", { name: "update_bug", arguments: {} }), principal(), "proj-1") as any).error.message
      ).toMatch(/"bugId"/i);
    });

    it("updates a bug with the token user for authorization and the MCP actor for audit attribution", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", bugProject: "proj-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "update_bug", arguments: { bugId: "bug-1", status: "Closed", severity: "High" } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).updateBug).toHaveBeenCalledWith("user-7", "bug-1", { status: "Closed", severity: "High" }, "mcp-actor-1");
    });
  });

  describe("link_testcase_to_bug / unlink_testcase_from_bug project scoping", () => {
    it("links a test case to a bug, attributed to the token's user", async () => {
      const { db } = makeDb({ bugProject: "proj-1", testcaseProject: "proj-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "link_testcase_to_bug", arguments: { bugId: "bug-1", testcaseId: "tc-1" } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).addBugLink).toHaveBeenCalledWith("user-7", "bug-1", {
        testcaseId: "tc-1",
        cycleId: undefined,
        executionId: undefined
      }, null);
    });

    it("is idempotent: linking the same test case to the same bug twice does not error", async () => {
      const { db } = makeDb({ bugProject: "proj-1", testcaseProject: "proj-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const call = () =>
        svc.handleRequest(
          rpc("tools/call", { name: "link_testcase_to_bug", arguments: { bugId: "bug-1", testcaseId: "tc-1" } }),
          principal(),
          "proj-1"
        );
      const first: any = await call();
      const second: any = await call();
      expect(first.result.isError).toBe(false);
      expect(second.result.isError).toBe(false);
      expect((legacy as any).addBugLink).toHaveBeenCalledTimes(2);
    });

    it("unlinks a linked test case from a bug", async () => {
      const { db } = makeDb({ bugProject: "proj-1", testcaseProject: "proj-1" });
      const legacy = makeLegacy({
        getBug: jest.fn().mockResolvedValue({ id: "bug-1", links: [{ id: "link-1", testcaseId: "tc-1", cycleId: null }] })
      });
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "unlink_testcase_from_bug", arguments: { bugId: "bug-1", testcaseId: "tc-1" } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).removeBugLink).toHaveBeenCalledWith("user-7", "bug-1", "link-1", null);
      expect(JSON.parse(res.result.content[0].text)).toEqual({ ok: true, bugId: "bug-1", testcaseId: "tc-1", wasLinked: true });
    });

    it("unlinking a test case that isn't linked to the bug is a graceful no-op, not an error", async () => {
      const { db } = makeDb({ bugProject: "proj-1", testcaseProject: "proj-1" });
      const legacy = makeLegacy({ getBug: jest.fn().mockResolvedValue({ id: "bug-1", links: [] }) });
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "unlink_testcase_from_bug", arguments: { bugId: "bug-1", testcaseId: "tc-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).removeBugLink).not.toHaveBeenCalled();
      expect(JSON.parse(res.result.content[0].text)).toEqual({ ok: true, bugId: "bug-1", testcaseId: "tc-1", wasLinked: false });
    });

    it("denies link_testcase_to_bug/unlink_testcase_from_bug when the test case belongs to another project", async () => {
      const { db } = makeDb({ bugProject: "proj-1", testcaseProject: "proj-OTHER" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const linkRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "link_testcase_to_bug", arguments: { bugId: "bug-1", testcaseId: "tc-1" } }),
        principal(),
        "proj-1"
      );
      expect(linkRes.error.code).toBe(RpcCode.ProjectScopeDenied);
      expect((legacy as any).addBugLink).not.toHaveBeenCalled();

      const unlinkRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "unlink_testcase_from_bug", arguments: { bugId: "bug-1", testcaseId: "tc-1" } }),
        principal(),
        "proj-1"
      );
      expect(unlinkRes.error.code).toBe(RpcCode.ProjectScopeDenied);
    });

    it("denies link_testcase_to_bug/unlink_testcase_from_bug when the bug belongs to another project", async () => {
      const { db } = makeDb({ bugProject: "proj-OTHER", testcaseProject: "proj-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const linkRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "link_testcase_to_bug", arguments: { bugId: "bug-1", testcaseId: "tc-1" } }),
        principal(),
        "proj-1"
      );
      expect(linkRes.error.code).toBe(RpcCode.ProjectScopeDenied);
      expect((legacy as any).addBugLink).not.toHaveBeenCalled();
    });

    it("rejects link_testcase_to_bug/unlink_testcase_from_bug on ids that do not exist, and without required arguments", async () => {
      const { db } = makeDb({ bugProject: undefined, testcaseProject: undefined });
      const svc = new McpService(makeLegacy(), db);
      const notFound: any = await svc.handleRequest(
        rpc("tools/call", { name: "link_testcase_to_bug", arguments: { bugId: "ghost", testcaseId: "tc-1" } }),
        principal(),
        "proj-1"
      );
      expect(notFound.error.code).toBe(RpcCode.ToolExecutionError);

      expect(
        (await svc.handleRequest(rpc("tools/call", { name: "link_testcase_to_bug", arguments: { testcaseId: "tc-1" } }), principal(), "proj-1") as any)
          .error.message
      ).toMatch(/"bugId"/i);
      expect(
        (await svc.handleRequest(rpc("tools/call", { name: "link_testcase_to_bug", arguments: { bugId: "bug-1" } }), principal(), "proj-1") as any)
          .error.message
      ).toMatch(/"testcaseId"/i);
      expect(
        (
          await svc.handleRequest(
            rpc("tools/call", { name: "unlink_testcase_from_bug", arguments: { testcaseId: "tc-1" } }),
            principal(),
            "proj-1"
          ) as any
        ).error.message
      ).toMatch(/"bugId"/i);
    });
  });

  describe("list_test_cycles / get_test_cycle project scoping", () => {
    it("lists cycles scoped to the token's project", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(rpc("tools/call", { name: "list_test_cycles", arguments: {} }), principal(), "proj-1");
      expect(res.result.isError).toBe(false);
      expect((legacy as any).listCycles).toHaveBeenCalledWith("proj-1");
      expect(JSON.parse(res.result.content[0].text).cycles).toHaveLength(1);
    });

    it("returns a cycle by id with its linked plan attached", async () => {
      const { db } = makeDb({ cycleProject: "proj-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_test_cycle", arguments: { cycleId: "cycle-1" } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      const body = JSON.parse(res.result.content[0].text);
      expect(body.id).toBe("cycle-1");
      expect((legacy as any).getPlan).toHaveBeenCalledWith("user-7", "plan-1");
      expect(body.plan).toEqual({ id: "plan-1", name: "Plan 1" });
    });

    it("omits plan rather than failing get_test_cycle when getPlan rejects", async () => {
      const { db } = makeDb({ cycleProject: "proj-1" });
      const legacy = makeLegacy({ getPlan: jest.fn().mockRejectedValue(new Error("Plan not found")) });
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_test_cycle", arguments: { cycleId: "cycle-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect(JSON.parse(res.result.content[0].text).plan).toBeNull();
    });

    it("denies get_test_cycle for a cycle belonging to another project", async () => {
      const { db } = makeDb({ cycleProject: "proj-OTHER" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_test_cycle", arguments: { cycleId: "cycle-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ProjectScopeDenied);
    });

    it("returns a tool error for get_test_cycle when the cycle does not exist", async () => {
      const { db } = makeDb({ cycleProject: undefined });
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_test_cycle", arguments: { cycleId: "ghost" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/not found/i);
    });

    it("rejects get_test_cycle without cycleId", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(rpc("tools/call", { name: "get_test_cycle", arguments: {} }), principal(), "proj-1");
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/"cycleId"/i);
    });
  });

  describe("create_cycle_from_testcases", () => {
    it("creates a cycle and adds only the valid test cases, reporting invalid ids separately", async () => {
      const { db } = makeDb({ ownedTestcaseIds: ["tc-1", "tc-2"] });
      const legacy = makeLegacy({
        createCycle: jest.fn().mockResolvedValue({ id: "cycle-new", name: "Sprint 12 Run" }),
        addCycleTestCases: jest.fn().mockResolvedValue({ requested: 2, added: 2, skipped: 0 })
      });
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", {
          name: "create_cycle_from_testcases",
          arguments: { name: "Sprint 12 Run", testcaseIds: ["tc-1", "tc-2", "tc-ghost"] }
        }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).createCycle).toHaveBeenCalledWith(
        "proj-1",
        expect.objectContaining({ name: "Sprint 12 Run" })
      );
      // addCycleTestCases requires a real user (requireCycleAccess), not the agent actor.
      expect((legacy as any).addCycleTestCases).toHaveBeenCalledWith("cycle-new", "user-7", { testcaseIds: ["tc-1", "tc-2"] });
      const body = JSON.parse(res.result.content[0].text);
      expect(body.cycle.id).toBe("cycle-new");
      expect(body.testcasesRequested).toBe(3);
      expect(body.testcasesAdded).toBe(2);
      expect(body.invalidTestcaseIds).toEqual(["tc-ghost"]);
    });

    it("deduplicates repeated testcaseIds before adding", async () => {
      const { db } = makeDb({ ownedTestcaseIds: ["tc-1"] });
      const legacy = makeLegacy({ addCycleTestCases: jest.fn().mockResolvedValue({ requested: 1, added: 1, skipped: 0 }) });
      const svc = new McpService(legacy, db);
      await svc.handleRequest(
        rpc("tools/call", { name: "create_cycle_from_testcases", arguments: { name: "Run", testcaseIds: ["tc-1", "tc-1"] } }),
        principal(),
        "proj-1"
      );
      expect((legacy as any).addCycleTestCases).toHaveBeenCalledWith("cycle-new", "user-1", { testcaseIds: ["tc-1"] });
    });

    it("creates the cycle but skips addCycleTestCases entirely when every id is invalid", async () => {
      const { db } = makeDb({ ownedTestcaseIds: [] });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "create_cycle_from_testcases", arguments: { name: "Run", testcaseIds: ["tc-ghost"] } }),
        principal(),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).addCycleTestCases).not.toHaveBeenCalled();
      const body = JSON.parse(res.result.content[0].text);
      expect(body.testcasesAdded).toBe(0);
      expect(body.invalidTestcaseIds).toEqual(["tc-ghost"]);
    });

    it("denies create_cycle_from_testcases when planId belongs to another project", async () => {
      const { db } = makeDb({ planProject: "proj-OTHER", ownedTestcaseIds: ["tc-1"] });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "create_cycle_from_testcases", arguments: { name: "Run", testcaseIds: ["tc-1"], planId: "plan-x" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ProjectScopeDenied);
      expect((legacy as any).createCycle).not.toHaveBeenCalled();
    });

    it("rejects create_cycle_from_testcases missing name or testcaseIds, and for a read-scoped token", async () => {
      const { db } = makeDb({ ownedTestcaseIds: ["tc-1"] });
      const svc = new McpService(makeLegacy(), db);
      const missingName: any = await svc.handleRequest(
        rpc("tools/call", { name: "create_cycle_from_testcases", arguments: { testcaseIds: ["tc-1"] } }),
        principal(),
        "proj-1"
      );
      expect(missingName.error.message).toMatch(/"name"/i);

      const missingIds: any = await svc.handleRequest(
        rpc("tools/call", { name: "create_cycle_from_testcases", arguments: { name: "Run" } }),
        principal(),
        "proj-1"
      );
      expect(missingIds.error.message).toMatch(/non-empty array/i);

      const scopeRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "create_cycle_from_testcases", arguments: { name: "Run", testcaseIds: ["tc-1"] } }),
        principal({ scopes: ["read"] }),
        "proj-1"
      );
      expect(scopeRes.error.code).toBe(RpcCode.ScopeDenied);
    });
  });

  describe("list_executions / get_execution / update_execution_result project scoping", () => {
    it("lists executions for a cycle that belongs to the token's project", async () => {
      const { db } = makeDb({ cycleProject: "proj-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "list_executions", arguments: { cycleId: "cycle-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).executions).toHaveBeenCalledWith("cycle-1");
      expect(JSON.parse(res.result.content[0].text).executions).toHaveLength(1);
    });

    it("denies list_executions for a cycle belonging to another project", async () => {
      const { db } = makeDb({ cycleProject: "proj-OTHER" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "list_executions", arguments: { cycleId: "cycle-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ProjectScopeDenied);
      expect((legacy as any).executions).not.toHaveBeenCalled();
    });

    it("rejects list_executions without cycleId", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(rpc("tools/call", { name: "list_executions", arguments: {} }), principal(), "proj-1");
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/"cycleId"/i);
    });

    it("returns an execution by id when it belongs to the token's project", async () => {
      const { db } = makeDb({ executionProject: "proj-1", executionCycleId: "cycle-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_execution", arguments: { executionId: "ex-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).executions).toHaveBeenCalledWith("cycle-1");
      expect(JSON.parse(res.result.content[0].text).id).toBe("ex-1");
    });

    it("denies get_execution/update_execution_result for an execution belonging to another project", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", executionProject: "proj-OTHER" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);

      const getRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_execution", arguments: { executionId: "ex-1" } }),
        principal(),
        "proj-1"
      );
      expect(getRes.error.code).toBe(RpcCode.ProjectScopeDenied);

      const updateRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "update_execution_result", arguments: { executionId: "ex-1", status: "Passed" } }),
        principal(),
        "proj-1"
      );
      expect(updateRes.error.code).toBe(RpcCode.ProjectScopeDenied);
      expect((legacy as any).updateExecution).not.toHaveBeenCalled();
    });

    it("returns a tool error for get_execution/update_execution_result when the execution does not exist", async () => {
      const { db } = makeDb({ executionProject: undefined });
      const svc = new McpService(makeLegacy(), db);
      const getRes: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_execution", arguments: { executionId: "ghost" } }),
        principal(),
        "proj-1"
      );
      expect(getRes.error.code).toBe(RpcCode.ToolExecutionError);
      expect(getRes.error.message).toMatch(/not found/i);
    });

    it("rejects get_execution and update_execution_result without executionId", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      expect(
        (await svc.handleRequest(rpc("tools/call", { name: "get_execution", arguments: {} }), principal(), "proj-1") as any).error.message
      ).toMatch(/"executionId"/i);
      expect(
        (await svc.handleRequest(rpc("tools/call", { name: "update_execution_result", arguments: {} }), principal(), "proj-1") as any)
          .error.message
      ).toMatch(/"executionId"/i);
    });

    it("updates an execution's result, attributed to the token's user (not the agent actor)", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1", executionProject: "proj-1", executionCycleId: "cycle-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "update_execution_result", arguments: { executionId: "ex-1", status: "Passed", assigneeId: null } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).updateExecution).toHaveBeenCalledWith("ex-1", "user-7", { status: "Passed", assigneeId: null });
      expect((legacy as any).executions).toHaveBeenCalledWith("cycle-1");
    });

    it("rejects update_execution_result for a read-scoped token", async () => {
      const { db } = makeDb({ executionProject: "proj-1", executionCycleId: "cycle-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "update_execution_result", arguments: { executionId: "ex-1", status: "Passed" } }),
        principal({ scopes: ["read"] }),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ScopeDenied);
      expect((legacy as any).updateExecution).not.toHaveBeenCalled();
    });
  });

  describe("bulk_record_execution_results", () => {
    it("records every valid item and reports a per-item failure without stopping the batch", async () => {
      const { db, query } = makeDb({ executionProject: "proj-1", executionCycleId: "cycle-1" });
      // Route ex-1/ex-2 as owned, ex-ghost as not found, without disturbing the default
      // makeDb("FROM executions e") single-shape mock — override the query fn directly since
      // requireExecutionOwner is called per item with different ids.
      query.mockImplementation((sql: string, params?: unknown[]) => {
        if (sql.includes("FROM actors a JOIN agents g")) return Promise.resolve({ rows: [] });
        if (sql.includes("FROM executions e")) {
          const id = (params as string[])?.[0];
          if (id === "ex-ghost") return Promise.resolve({ rows: [] });
          return Promise.resolve({ rows: [{ project_id: "proj-1", cycle_id: "cycle-1" }] });
        }
        return Promise.resolve({ rows: [] });
      });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", {
          name: "bulk_record_execution_results",
          arguments: {
            results: [
              { executionId: "ex-1", status: "Passed" },
              { executionId: "ex-ghost", status: "Failed" },
              { executionId: "ex-2", status: "Blocked", assigneeId: null }
            ]
          }
        }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      const body = JSON.parse(res.result.content[0].text);
      expect(body.total).toBe(3);
      expect(body.succeeded).toBe(2);
      expect(body.failed).toBe(1);
      expect(body.results[1]).toEqual({ index: 1, executionId: "ex-ghost", ok: false, error: "Execution not found" });
      expect((legacy as any).updateExecution).toHaveBeenCalledTimes(2);
      // Attributed to the token's user, exactly like update_execution_result/record_execution_result.
      expect((legacy as any).updateExecution).toHaveBeenNthCalledWith(1, "ex-1", "user-7", { status: "Passed" });
      expect((legacy as any).updateExecution).toHaveBeenNthCalledWith(2, "ex-2", "user-7", { status: "Blocked", assigneeId: null });
    });

    it("reports a per-item failure for an execution in another project without touching it", async () => {
      const { db, query } = makeDb();
      query.mockImplementation((sql: string, params?: unknown[]) => {
        if (sql.includes("FROM actors a JOIN agents g")) return Promise.resolve({ rows: [] });
        if (sql.includes("FROM executions e")) {
          const id = (params as string[])?.[0];
          return Promise.resolve({ rows: [{ project_id: id === "ex-foreign" ? "proj-OTHER" : "proj-1", cycle_id: "cycle-1" }] });
        }
        return Promise.resolve({ rows: [] });
      });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", {
          name: "bulk_record_execution_results",
          arguments: { results: [{ executionId: "ex-foreign", status: "Passed" }, { executionId: "ex-1", status: "Passed" }] }
        }),
        principal(),
        "proj-1"
      );
      const body = JSON.parse(res.result.content[0].text);
      expect(body.results[0]).toEqual({
        index: 0,
        executionId: "ex-foreign",
        ok: false,
        error: "Execution belongs to a different project than this token"
      });
      expect(body.results[1].ok).toBe(true);
      expect((legacy as any).updateExecution).toHaveBeenCalledTimes(1);
      expect((legacy as any).updateExecution).toHaveBeenCalledWith("ex-1", "user-1", { status: "Passed" });
    });

    it("rejects an empty results array, an over-limit batch, and items missing executionId", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const empty: any = await svc.handleRequest(
        rpc("tools/call", { name: "bulk_record_execution_results", arguments: { results: [] } }),
        principal(),
        "proj-1"
      );
      expect(empty.error.message).toMatch(/non-empty array/i);

      const tooMany: any = await svc.handleRequest(
        rpc("tools/call", {
          name: "bulk_record_execution_results",
          arguments: { results: Array.from({ length: 201 }, (_, i) => ({ executionId: `ex-${i}`, status: "Passed" })) }
        }),
        principal(),
        "proj-1"
      );
      expect(tooMany.error.message).toMatch(/limited to 200/i);

      const missingId: any = await svc.handleRequest(
        rpc("tools/call", { name: "bulk_record_execution_results", arguments: { results: [{ status: "Passed" }] } }),
        principal(),
        "proj-1"
      );
      const missingBody = JSON.parse(missingId.result.content[0].text);
      expect(missingBody.results[0].ok).toBe(false);
      expect(missingBody.results[0].error).toMatch(/"executionId"/i);
    });

    it("rejects bulk_record_execution_results for a read-scoped token", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "bulk_record_execution_results", arguments: { results: [{ executionId: "ex-1", status: "Passed" }] } }),
        principal({ scopes: ["read"] }),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ScopeDenied);
      expect((legacy as any).updateExecution).not.toHaveBeenCalled();
    });
  });

  describe("get_test_execution_summary", () => {
    it("summarizes a single cycle by reusing executionReport with a run filter", async () => {
      const { db } = makeDb({ cycleProject: "proj-1" });
      const legacy = makeLegacy({
        executionReport: jest.fn().mockResolvedValue({
          filterBy: "run",
          filterValue: "cycle-1",
          rows: [{ groupId: "cycle-1", groupName: "Cycle 1", Passed: 3, Failed: 1, Blocked: 0, Skipped: 0, Untested: 2, Retest: 0, total: 6 }]
        })
      });
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_test_execution_summary", arguments: { cycleId: "cycle-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).executionReport).toHaveBeenCalledWith("proj-1", { filterBy: "run", filterValue: "cycle-1" });
      const body = JSON.parse(res.result.content[0].text);
      expect(body.scope).toBe("cycle");
      expect(body).toMatchObject({ Passed: 3, Failed: 1, Blocked: 0, Skipped: 0, Untested: 2, Retest: 0, total: 6 });
    });

    it("returns all zeros for a cycle with no executions yet, rather than erroring", async () => {
      const { db } = makeDb({ cycleProject: "proj-1" });
      const legacy = makeLegacy({ executionReport: jest.fn().mockResolvedValue({ filterBy: "run", filterValue: "cycle-1", rows: [] }) });
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_test_execution_summary", arguments: { cycleId: "cycle-1" } }),
        principal(),
        "proj-1"
      );
      const body = JSON.parse(res.result.content[0].text);
      expect(body).toMatchObject({ Passed: 0, Failed: 0, Blocked: 0, Skipped: 0, Untested: 0, Retest: 0, total: 0 });
    });

    it("aggregates across every cycle in the project when cycleId is omitted", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy({
        executionReport: jest.fn().mockResolvedValue({
          filterBy: "overall",
          filterValue: null,
          rows: [
            { groupId: "cycle-1", groupName: "Cycle 1", Passed: 3, Failed: 1, Blocked: 0, Skipped: 0, Untested: 2, Retest: 0, total: 6 },
            { groupId: "cycle-2", groupName: "Cycle 2", Passed: 1, Failed: 0, Blocked: 1, Skipped: 0, Untested: 0, Retest: 0, total: 2 }
          ]
        })
      });
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(rpc("tools/call", { name: "get_test_execution_summary", arguments: {} }), principal(), "proj-1");
      expect((legacy as any).executionReport).toHaveBeenCalledWith("proj-1", { filterBy: "overall" });
      const body = JSON.parse(res.result.content[0].text);
      expect(body.scope).toBe("project");
      expect(body.cycleCount).toBe(2);
      expect(body).toMatchObject({ Passed: 4, Failed: 1, Blocked: 1, Skipped: 0, Untested: 2, Retest: 0, total: 8 });
    });

    it("denies get_test_execution_summary for a cycle belonging to another project, and rejects one that does not exist", async () => {
      const { db } = makeDb({ cycleProject: "proj-OTHER" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_test_execution_summary", arguments: { cycleId: "cycle-1" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ProjectScopeDenied);
      expect((legacy as any).executionReport).not.toHaveBeenCalled();
    });
  });

  describe("Phase 2 QA ticket workspace MCP tools", () => {
    it("returns a ticket workspace scoped by token user and project", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_ticket_workspace", arguments: { ticketRef: "QA-1" } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).getTicketWorkspace).toHaveBeenCalledWith("user-7", "proj-1", "QA-1");
      expect(JSON.parse(res.result.content[0].text).ticket.humanId).toBe("QA-1");
    });

    it("allows traceability and analysis-context reads with a read-only token", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const readOnly = principal({ userId: "user-7", scopes: ["read"] });

      const trace: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_ticket_traceability", arguments: { ticketRef: "QA-1" } }),
        readOnly,
        "proj-1"
      );
      const analysis: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_ticket_analysis_context", arguments: { ticketRef: "QA-1" } }),
        readOnly,
        "proj-1"
      );

      expect(trace.result.isError).toBe(false);
      expect(analysis.result.isError).toBe(false);
      expect((legacy as any).getTicketTraceabilityForUser).toHaveBeenCalledWith("user-7", "proj-1", "QA-1");
      expect((legacy as any).getTicketAnalysisContext).toHaveBeenCalledWith("user-7", "proj-1", "QA-1");
    });

    it("attributes MCP evidence upload to the agent while authorizing as the token user", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const args = {
        ticketRef: "QA-1",
        fileName: "failure.png",
        contentBase64: "aGVsbG8=",
        contentType: "image/png",
        evidenceKind: "screenshot"
      };
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "attach_ticket_evidence", arguments: args }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).attachTicketEvidenceBase64).toHaveBeenCalledWith(
        "proj-1",
        "QA-1",
        "user-7",
        "mcp-actor-1",
        args
      );
    });

    it("authorizes ticket access before linking a requirement and records the MCP actor", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", {
          name: "link_ticket_to_requirement",
          arguments: { ticketRef: "QA-1", requirementRef: "REQ-1" }
        }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).getTicketByRefForUser).toHaveBeenCalledWith("user-7", "proj-1", "QA-1");
      expect((legacy as any).linkTicketToRequirement).toHaveBeenCalledWith("proj-1", "QA-1", "REQ-1", "mcp-actor-1");
    });

    it("blocks Phase 2 write tools for a read-only token", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", {
          name: "link_ticket_to_requirement",
          arguments: { ticketRef: "QA-1", requirementRef: "REQ-1" }
        }),
        principal({ scopes: ["read"] }),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ScopeDenied);
      expect((legacy as any).linkTicketToRequirement).not.toHaveBeenCalled();
    });

    it("searches QA human references only inside the token project", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "search_qa_references", arguments: { q: "QA-1" } }),
        principal({ userId: "user-7", scopes: ["read"] }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).searchQaReferences).toHaveBeenCalledWith("user-7", "proj-1", "QA-1");
      expect(JSON.parse(res.result.content[0].text).matches[0].humanId).toBe("QA-1");
    });
  });

  describe("Phase 3 execution, retest and failure-intelligence MCP tools", () => {
    it("allows retest comparison and failure intelligence with a read-only token", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const readOnly = principal({ userId: "user-7", scopes: ["read"] });

      const compare: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_ticket_retest_comparison", arguments: { ticketRef: "QA-1", runRef: "RUN-1" } }),
        readOnly,
        "proj-1"
      );
      const intelligence: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_ticket_failure_intelligence", arguments: { ticketRef: "QA-1" } }),
        readOnly,
        "proj-1"
      );

      expect(compare.result.isError).toBe(false);
      expect(intelligence.result.isError).toBe(false);
      expect((legacy as any).getTicketRetestComparison).toHaveBeenCalledWith("user-7", "proj-1", "QA-1", "RUN-1");
      expect((legacy as any).getTicketFailureIntelligence).toHaveBeenCalledWith("user-7", "proj-1", "QA-1", undefined);
    });

    it("reads execution steps only after project-scope validation", async () => {
      const { db } = makeDb({ executionProject: "proj-1", executionCycleId: "cycle-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_execution_steps", arguments: { executionId: "ex-1" } }),
        principal({ userId: "user-7", scopes: ["read"] }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).listExecutionStepResults).toHaveBeenCalledWith("cycle-1", "ex-1", "user-7");
    });

    it("records execution steps as the MCP actor while authorizing as the token user", async () => {
      const { db } = makeDb({
        mcpActorId: "mcp-actor-1",
        executionProject: "proj-1",
        executionCycleId: "cycle-1"
      });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const steps = [{ stepNumber: 1, action: "Open login", status: "Failed" }];
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "record_execution_steps", arguments: { executionId: "ex-1", steps } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).saveExecutionStepResults).toHaveBeenCalledWith(
        "cycle-1",
        "ex-1",
        "user-7",
        { steps },
        "mcp-actor-1"
      );
    });

    it("uses the MCP actor for the controlled retest decision", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", {
          name: "decide_ticket_retest",
          arguments: { ticketRef: "QA-1", runRef: "RUN-1", note: "Verified regression" }
        }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).decideTicketRetest).toHaveBeenCalledWith(
        "user-7",
        "proj-1",
        "QA-1",
        "RUN-1",
        { decision: "auto", note: "Verified regression" },
        "mcp-actor-1"
      );
    });

    it("blocks Phase 3 result mutations for a read-only token", async () => {
      const { db } = makeDb({
        mcpActorId: "mcp-actor-1",
        executionProject: "proj-1",
        executionCycleId: "cycle-1"
      });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const stepWrite: any = await svc.handleRequest(
        rpc("tools/call", {
          name: "record_execution_steps",
          arguments: { executionId: "ex-1", steps: [{ stepNumber: 1, action: "Open", status: "Passed" }] }
        }),
        principal({ userId: "user-7", scopes: ["read"] }),
        "proj-1"
      );
      const decision: any = await svc.handleRequest(
        rpc("tools/call", { name: "decide_ticket_retest", arguments: { ticketRef: "QA-1", runRef: "RUN-1" } }),
        principal({ userId: "user-7", scopes: ["read"] }),
        "proj-1"
      );
      expect(stepWrite.error.code).toBe(RpcCode.ScopeDenied);
      expect(decision.error.code).toBe(RpcCode.ScopeDenied);
      expect((legacy as any).saveExecutionStepResults).not.toHaveBeenCalled();
      expect((legacy as any).decideTicketRetest).not.toHaveBeenCalled();
    });
  });

  describe("Phase 4 AI triage, flake detection and release-gate MCP tools", () => {
    it("exposes deterministic failure triage to read-only clients", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_ticket_failure_triage", arguments: { ticketRef: "QA-1", runRef: "RUN-1" } }),
        principal({ userId: "user-7", scopes: ["read"] }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).getTicketFailureTriage).toHaveBeenCalledWith("user-7", "proj-1", "QA-1", "RUN-1");
    });

    it("requires write scope for persisted AI failure analysis", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const denied: any = await svc.handleRequest(
        rpc("tools/call", { name: "analyze_ticket_failure", arguments: { ticketRef: "QA-1" } }),
        principal({ userId: "user-7", scopes: ["read"] }),
        "proj-1"
      );
      expect(denied.error.code).toBe(RpcCode.ScopeDenied);
      expect((legacy as any).analyzeTicketFailureWithAi).not.toHaveBeenCalled();
    });

    it("attributes persisted AI analysis activity to the MCP actor while authorizing as the token user", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "analyze_ticket_failure", arguments: { ticketRef: "QA-1", runRef: "RUN-1" } }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).analyzeTicketFailureWithAi).toHaveBeenCalledWith(
        "user-7",
        "proj-1",
        "QA-1",
        "RUN-1",
        "mcp-actor-1"
      );
    });

    it("evaluates a release gate as the token user and attributes audit activity to the MCP actor", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", {
          name: "evaluate_release_qa_gate",
          arguments: { releaseName: "v1.2", buildVersion: "101", environment: "staging" }
        }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).evaluateReleaseQaGate).toHaveBeenCalledWith(
        "user-7",
        "proj-1",
        { releaseName: "v1.2", buildVersion: "101", environment: "staging" },
        "mcp-actor-1"
      );
    });

    it("lets read-only clients inspect release candidates, current gate and history", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const ro = principal({ userId: "user-7", scopes: ["read"] });
      const candidates: any = await svc.handleRequest(
        rpc("tools/call", { name: "list_release_qa_gate_candidates", arguments: {} }),
        ro,
        "proj-1"
      );
      const current: any = await svc.handleRequest(
        rpc("tools/call", {
          name: "get_release_qa_gate",
          arguments: { releaseName: "v1.2", buildVersion: "101", environment: "staging" }
        }),
        ro,
        "proj-1"
      );
      const history: any = await svc.handleRequest(
        rpc("tools/call", {
          name: "list_release_qa_gate_history",
          arguments: { releaseName: "v1.2", buildVersion: "101" }
        }),
        ro,
        "proj-1"
      );
      expect(candidates.result.isError).toBe(false);
      expect(current.result.isError).toBe(false);
      expect(history.result.isError).toBe(false);
      expect((legacy as any).listReleaseGateCandidates).toHaveBeenCalledWith("user-7", "proj-1");
      expect((legacy as any).getLatestReleaseQaGate).toHaveBeenCalledWith("user-7", "proj-1", "v1.2", "101", "staging");
      expect((legacy as any).listReleaseQaGateHistory).toHaveBeenCalledWith("user-7", "proj-1", "v1.2", "101");
    });

    it("does not expose a release-approval MCP tool; approval stays human-only", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const listed: any = await svc.handleRequest(rpc("tools/list"), principal(), "proj-1");
      const names = listed.result.tools.map((tool: any) => tool.name);
      expect(names).not.toContain("decide_release_qa_gate");
      expect(names).not.toContain("approve_release_qa_gate");

      const attempted: any = await svc.handleRequest(
        rpc("tools/call", { name: "decide_release_qa_gate", arguments: { gateId: "gate-1", decision: "approved" } }),
        principal(),
        "proj-1"
      );
      expect(attempted.error.code).toBe(RpcCode.MethodNotFound);
    });
  });

  describe("Phase 5 change-aware regression and certification MCP tools", () => {
    it("registers a build as the token user and attributes mutation to the MCP actor", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const args = {
        repository: "askk-pro/app",
        gitSha: "abcdef1234567",
        baseSha: "1234567abcdef",
        branchName: "main",
        buildVersion: "101",
        releaseName: "v1.2",
        environment: "staging",
        changedFiles: [{ path: "src/auth/session.ts", additions: 5, deletions: 1 }]
      };
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "register_qa_build", arguments: args }),
        principal({ userId: "user-7" }),
        "proj-1"
      );
      expect(res.result.isError).toBe(false);
      expect((legacy as any).registerQaBuild).toHaveBeenCalledWith(
        "user-7",
        "proj-1",
        expect.objectContaining({ ...args, sourceProvider: "mcp" }),
        "mcp-actor-1"
      );
    });

    it("allows read-only clients to inspect deterministic build impact and the release dashboard", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const ro = principal({ userId: "user-7", scopes: ["read"] });
      const impact: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_qa_build_impact", arguments: { buildId: "build-1" } }),
        ro,
        "proj-1"
      );
      const dashboard: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_release_dashboard", arguments: { buildId: "build-1" } }),
        ro,
        "proj-1"
      );
      expect(impact.result.isError).toBe(false);
      expect(dashboard.result.isError).toBe(false);
      expect((legacy as any).getQaBuildImpact).toHaveBeenCalledWith("user-7", "proj-1", "build-1");
      expect((legacy as any).getPhase5ReleaseDashboard).toHaveBeenCalledWith("user-7", "proj-1", "build-1");
    });

    it("requires write scope to generate/start regression work", async () => {
      const { db } = makeDb();
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const ro = principal({ userId: "user-7", scopes: ["read"] });
      const generated: any = await svc.handleRequest(
        rpc("tools/call", { name: "generate_regression_plan", arguments: { buildId: "build-1" } }),
        ro,
        "proj-1"
      );
      const started: any = await svc.handleRequest(
        rpc("tools/call", { name: "start_regression_plan", arguments: { planId: "reg-plan-1" } }),
        ro,
        "proj-1"
      );
      expect(generated.error.code).toBe(RpcCode.ScopeDenied);
      expect(started.error.code).toBe(RpcCode.ScopeDenied);
      expect((legacy as any).generateRegressionPlan).not.toHaveBeenCalled();
      expect((legacy as any).startRegressionPlan).not.toHaveBeenCalled();
    });

    it("attributes regression-plan generation and certification preparation to the MCP actor", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1" });
      const legacy = makeLegacy();
      const svc = new McpService(legacy, db);
      const principalWithWrite = principal({ userId: "user-7" });
      const plan: any = await svc.handleRequest(
        rpc("tools/call", { name: "generate_regression_plan", arguments: { buildId: "build-1" } }),
        principalWithWrite,
        "proj-1"
      );
      const cert: any = await svc.handleRequest(
        rpc("tools/call", { name: "prepare_release_certification", arguments: { buildId: "build-1", planId: "reg-plan-1" } }),
        principalWithWrite,
        "proj-1"
      );
      expect(plan.result.isError).toBe(false);
      expect(cert.result.isError).toBe(false);
      expect((legacy as any).generateRegressionPlan).toHaveBeenCalledWith(
        "user-7", "proj-1", "build-1",
        { name: undefined, matrix: undefined },
        "mcp-actor-1"
      );
      expect((legacy as any).prepareReleaseCertification).toHaveBeenCalledWith(
        "user-7", "proj-1", "build-1",
        { planId: "reg-plan-1" },
        "mcp-actor-1"
      );
    });

    it("does not expose final release certification or certification revocation through MCP", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const listed: any = await svc.handleRequest(rpc("tools/list"), principal(), "proj-1");
      const names = listed.result.tools.map((tool: any) => tool.name);
      expect(names).not.toContain("certify_release");
      expect(names).not.toContain("revoke_release_certification");

      const certify: any = await svc.handleRequest(
        rpc("tools/call", { name: "certify_release", arguments: { buildId: "build-1" } }),
        principal(),
        "proj-1"
      );
      expect(certify.error.code).toBe(RpcCode.MethodNotFound);
    });
  });


  describe("Phase 6 continuous QA automation MCP tools", () => {
    function makeQaAutomation() {
      return {
        listSchedules: jest.fn().mockResolvedValue([{ id: "schedule-1", name: "Nightly", scheduleType: "daily" }]),
        createSchedule: jest.fn().mockResolvedValue({ id: "schedule-1", name: "Nightly" }),
        updateSchedule: jest.fn().mockResolvedValue({ id: "schedule-1", enabled: false }),
        deleteSchedule: jest.fn().mockResolvedValue({ ok: true, id: "schedule-1" }),
        triggerManual: jest.fn().mockResolvedValue({ id: "auto-run-1", status: "queued" }),
        listRuns: jest.fn().mockResolvedValue([{ id: "auto-run-1", status: "running" }]),
        getRun: jest.fn().mockResolvedValue({ id: "auto-run-1", status: "running", shards: [] }),
        listAlerts: jest.fn().mockResolvedValue([{ id: "alert-1", severity: "high" }]),
        acknowledgeAlert: jest.fn().mockResolvedValue({ id: "alert-1", status: "acknowledged" }),
        dashboard: jest.fn().mockResolvedValue({ counts: { active: 1 }, queue: { waiting: 0 } })
      };
    }

    it("exposes continuous-QA operations but not worker claim/heartbeat/complete controls", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db, makeQaAutomation() as any);
      const listed: any = await svc.handleRequest(rpc("tools/list"), principal(), "proj-1");
      const names = listed.result.tools.map((tool: any) => tool.name);
      expect(names).toEqual(expect.arrayContaining([
        "list_qa_automation_schedules",
        "create_qa_automation_schedule",
        "trigger_continuous_qa",
        "list_qa_automation_runs",
        "list_qa_automation_alerts",
        "get_qa_operations_dashboard"
      ]));
      expect(names).not.toContain("claim_qa_automation_shard");
      expect(names).not.toContain("heartbeat_qa_automation_shard");
      expect(names).not.toContain("complete_qa_automation_shard");
      expect(names).not.toContain("certify_release");
    });

    it("allows read-only QA Operations inspection and blocks schedule creation without write scope", async () => {
      const { db } = makeDb();
      const qa = makeQaAutomation();
      const svc = new McpService(makeLegacy(), db, qa as any);
      const ro = principal({ userId: "user-7", scopes: ["read"] });
      const dashboard: any = await svc.handleRequest(
        rpc("tools/call", { name: "get_qa_operations_dashboard", arguments: {} }),
        ro,
        "proj-1"
      );
      const denied: any = await svc.handleRequest(
        rpc("tools/call", { name: "create_qa_automation_schedule", arguments: { name: "Nightly", scheduleType: "daily" } }),
        ro,
        "proj-1"
      );
      expect(dashboard.result.isError).toBe(false);
      expect(qa.dashboard).toHaveBeenCalledWith("user-7", "proj-1");
      expect(denied.error.code).toBe(RpcCode.ScopeDenied);
      expect(qa.createSchedule).not.toHaveBeenCalled();
    });

    it("creates schedules and triggers continuous QA as the token user", async () => {
      const { db } = makeDb();
      const qa = makeQaAutomation();
      const svc = new McpService(makeLegacy(), db, qa as any);
      const rw = principal({ userId: "user-7" });
      const created: any = await svc.handleRequest(
        rpc("tools/call", {
          name: "create_qa_automation_schedule",
          arguments: { name: "On deploy", scheduleType: "event", eventType: "build_deployed", desiredShards: 4 }
        }),
        rw,
        "proj-1"
      );
      const triggered: any = await svc.handleRequest(
        rpc("tools/call", { name: "trigger_continuous_qa", arguments: { buildId: "build-1" } }),
        rw,
        "proj-1"
      );
      expect(created.result.isError).toBe(false);
      expect(triggered.result.isError).toBe(false);
      expect(qa.createSchedule).toHaveBeenCalledWith(
        "user-7",
        "proj-1",
        expect.objectContaining({ name: "On deploy", scheduleType: "event", eventType: "build_deployed", desiredShards: 4 })
      );
      expect(qa.triggerManual).toHaveBeenCalledWith(
        "user-7",
        "proj-1",
        expect.objectContaining({ buildId: "build-1", triggerSource: "mcp" })
      );
    });

    it("reads and acknowledges automation alerts through the scoped Phase-6 service", async () => {
      const { db } = makeDb();
      const qa = makeQaAutomation();
      const svc = new McpService(makeLegacy(), db, qa as any);
      const rw = principal({ userId: "user-7" });
      const list: any = await svc.handleRequest(
        rpc("tools/call", { name: "list_qa_automation_alerts", arguments: {} }),
        rw,
        "proj-1"
      );
      const ack: any = await svc.handleRequest(
        rpc("tools/call", { name: "acknowledge_qa_automation_alert", arguments: { alertId: "alert-1" } }),
        rw,
        "proj-1"
      );
      expect(list.result.isError).toBe(false);
      expect(ack.result.isError).toBe(false);
      expect(qa.listAlerts).toHaveBeenCalledWith("user-7", "proj-1", "open");
      expect(qa.acknowledgeAlert).toHaveBeenCalledWith("user-7", "proj-1", "alert-1");
    });
  });

  describe("argument validation & error mapping", () => {
    it("rejects create_testcase without a title", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1" });
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "create_testcase", arguments: {} }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/title/i);
    });

    it("rejects search_knowledge_base without q", async () => {
      const { db } = makeDb();
      const svc = new McpService(makeLegacy(), db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "search_knowledge_base", arguments: {} }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toMatch(/"q"/i);
    });

    it("maps an underlying service exception onto a ToolExecutionError", async () => {
      const { db } = makeDb({ mcpActorId: "mcp-actor-1" });
      const legacy = makeLegacy({
        createSuite: jest.fn().mockRejectedValue({
          getResponse: () => ({ error: "name is required" })
        })
      });
      const svc = new McpService(legacy, db);
      const res: any = await svc.handleRequest(
        rpc("tools/call", { name: "create_suite", arguments: { name: "x" } }),
        principal(),
        "proj-1"
      );
      expect(res.error.code).toBe(RpcCode.ToolExecutionError);
      expect(res.error.message).toBe("name is required");
    });
  });
});
