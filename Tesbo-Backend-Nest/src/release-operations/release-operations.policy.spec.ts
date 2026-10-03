import { evaluateReleasePolicy, type ReleaseEnvironmentPolicy } from "./release-operations.policy";

const protectedPolicy: ReleaseEnvironmentPolicy = {
  protected: true,
  requiredCertificationState: "READY",
  requiredApprovals: 1,
  requireNoP0P1: true,
  minRegressionCoverage: 100,
  requireSmoke: true,
  observationMinutes: 15,
};

function certification(overrides: Record<string, unknown> = {}) {
  return {
    state: "READY",
    validityStatus: "current",
    evidenceDigest: "a".repeat(64),
    evidenceSnapshot: {
      plan: { coveragePct: 100, selectionSummary: { smoke: 2 } },
      releaseGate: { currentMetrics: { openP0P1Tickets: 0 } },
    },
    ...overrides,
  };
}

describe("Phase 7 release promotion policy", () => {
  it("passes a current READY certification with complete smoke/regression evidence", () => {
    expect(evaluateReleasePolicy(protectedPolicy, certification())).toEqual(
      expect.objectContaining({ passed: true, blockers: [] }),
    );
  });

  it("blocks missing or stale certification evidence", () => {
    expect(evaluateReleasePolicy(protectedPolicy, null).blockers.map((b) => b.code)).toContain("CERTIFICATION_MISSING");
    expect(
      evaluateReleasePolicy(protectedPolicy, certification({ validityStatus: "stale" })).blockers.map((b) => b.code),
    ).toContain("CERTIFICATION_NOT_CURRENT");
  });

  it("enforces coverage, smoke and P0/P1 policy from the evidence-bound snapshot", () => {
    const result = evaluateReleasePolicy(
      protectedPolicy,
      certification({
        evidenceSnapshot: {
          plan: { coveragePct: 82.5, selectionSummary: { smoke: 0 } },
          releaseGate: { currentMetrics: { openP0P1Tickets: 2 } },
        },
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.blockers.map((b) => b.code)).toEqual(
      expect.arrayContaining(["REGRESSION_COVERAGE", "SMOKE_REQUIRED", "OPEN_P0_P1"]),
    );
  });

  it("fails closed when a protected policy lacks P0/P1 evidence", () => {
    const result = evaluateReleasePolicy(
      protectedPolicy,
      certification({
        evidenceSnapshot: {
          plan: { coveragePct: 100, selectionSummary: { smoke: 1 } },
          releaseGate: {},
        },
      }),
    );
    expect(result.blockers.map((b) => b.code)).toContain("P0_P1_EVIDENCE_MISSING");
  });

  it("can require a fully CERTIFIED release for stricter environments", () => {
    const result = evaluateReleasePolicy(
      { ...protectedPolicy, requiredCertificationState: "CERTIFIED" },
      certification({ state: "APPROVED" }),
    );
    expect(result.blockers.map((b) => b.code)).toContain("CERTIFICATION_STATE");
  });
});
