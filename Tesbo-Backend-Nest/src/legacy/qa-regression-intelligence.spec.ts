import {
  assessBuildRisk,
  globToRegExp,
  isDependencyFile,
  matchImpactRules,
  matchesGlob,
  normalizeRegressionMatrix,
  selectRegressionTests,
} from "./qa-regression-intelligence";

describe("Phase 5 regression intelligence", () => {
  it("supports * and ** path impact rules", () => {
    expect(matchesGlob("src/auth/session/middleware.ts", "src/auth/**")).toBe(true);
    expect(matchesGlob("src/auth.ts", "src/*.ts")).toBe(true);
    expect(matchesGlob("src/auth/session/middleware.ts", "src/*.ts")).toBe(false);
    expect(globToRegExp("packages/*/src/**").test("packages/web/src/auth/login.ts")).toBe(true);
  });

  it("recognizes common dependency manifests", () => {
    expect(isDependencyFile("package-lock.json")).toBe(true);
    expect(isDependencyFile("apps/api/requirements-prod.txt")).toBe(true);
    expect(isDependencyFile("src/auth/service.ts")).toBe(false);
  });

  it("maps changed files through explicit impact rules", () => {
    const impact = matchImpactRules(
      [{ path: "src/auth/session.ts" }, { path: "package.json" }],
      [
        { id: "r1", pathPattern: "src/auth/**", component: "Auth", riskWeight: 12 },
        { id: "r2", pathPattern: "src/billing/**", component: "Billing" },
      ],
    );
    expect(impact.matchedRules).toHaveLength(1);
    expect(impact.components).toEqual(["Auth"]);
    expect(impact.dependencyFiles).toEqual(["package.json"]);
  });

  it("selects smoke, directly impacted, historical, defect and dependency regression tests with reasons", () => {
    const result = selectRegressionTests({
      changedFiles: [{ path: "src/auth/session.ts" }, { path: "package-lock.json" }],
      explicitDependencyChanges: [{ name: "next", from: "15", to: "16" }],
      rules: [{ id: "r1", pathPattern: "src/auth/**", component: "Auth", riskWeight: 12 }],
      candidates: [
        {
          id: "tc-smoke",
          title: "Login smoke",
          type: "Smoke",
          component: "Auth",
          automationStatus: "Automated",
          requirementIds: [],
        },
        {
          id: "tc-auth",
          title: "Session expiry",
          type: "Functional",
          component: "Auth",
          priority: "P1",
          automationStatus: "Automated",
          requirementIds: [],
          recentFailureCount: 2,
        },
        {
          id: "tc-integration",
          title: "OAuth integration",
          type: "Integration",
          component: "Identity",
          automationStatus: "Automated",
          historicalDefectCount: 1,
          requirementIds: [],
        },
      ],
    });
    expect(result.selected.map((item) => item.testcaseId)).toEqual(
      expect.arrayContaining(["tc-smoke", "tc-auth", "tc-integration"]),
    );
    expect(result.selected.find((item) => item.testcaseId === "tc-smoke")?.mandatory).toBe(true);
    expect(result.selected.find((item) => item.testcaseId === "tc-auth")?.sources).toEqual(
      expect.arrayContaining(["impacted", "historical-failure", "high-risk"]),
    );
    expect(result.selected.find((item) => item.testcaseId === "tc-integration")?.sources).toEqual(
      expect.arrayContaining(["dependency", "prior-defect"]),
    );
  });

  it("produces transparent bounded build-risk factors", () => {
    const risk = assessBuildRisk({
      changedFiles: Array.from({ length: 12 }, (_, i) => ({ path: `src/f${i}.ts`, additions: 30, deletions: 10 })),
      dependencyChangeCount: 1,
      impactedHighRiskTests: 3,
      openHighDefects: 2,
      recentFailures: 3,
      impactedRequirementCount: 4,
      coveredRequirementCount: 3,
      repeatedChangeFiles: 2,
    });
    expect(risk.score).toBeGreaterThanOrEqual(50);
    expect(["HIGH", "CRITICAL"]).toContain(risk.band);
    expect(risk.factors.map((item) => item.code)).toEqual(
      expect.arrayContaining(["CHANGE_SIZE", "DEPENDENCY_CHANGE", "OPEN_BLOCKERS", "COVERAGE_GAP"]),
    );
  });

  it("normalizes a default Chrome/Edge/Firefox/API/manual matrix", () => {
    const matrix = normalizeRegressionMatrix([], "staging");
    expect(matrix.map((item) => item.browser)).toEqual(expect.arrayContaining(["chrome", "edge", "firefox"]));
    expect(matrix.map((item) => item.targetType)).toEqual(expect.arrayContaining(["browser", "api", "manual"]));
  });

  it("deduplicates and bounds custom matrix targets", () => {
    const matrix = normalizeRegressionMatrix([
      { environment: "staging", browser: "chrome", targetType: "browser" },
      { environment: "staging", browser: "chrome", targetType: "browser" },
      { environment: "production", targetType: "production-safe", required: false },
    ]);
    expect(matrix).toHaveLength(2);
    expect(matrix[1]).toMatchObject({ environment: "production", targetType: "production-safe", required: false });
  });
});
