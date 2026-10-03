export type ReleaseEnvironmentPolicy = {
  protected: boolean;
  requiredCertificationState: "NONE" | "READY" | "APPROVED" | "CERTIFIED";
  requiredApprovals: number;
  requireNoP0P1: boolean;
  minRegressionCoverage: number;
  requireSmoke: boolean;
  observationMinutes: number;
};

export type ReleaseCertificationEvidence = {
  state?: string | null;
  validityStatus?: string | null;
  evidenceDigest?: string | null;
  evidenceSnapshot?: Record<string, any> | null;
};

export type ReleasePolicyBlocker = {
  code: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
};

export type ReleasePolicyEvaluation = {
  passed: boolean;
  blockers: ReleasePolicyBlocker[];
  certificationState: string | null;
  certificationValidity: string | null;
  regressionCoverage: number | null;
  smokeSelected: number | null;
  openP0P1Tickets: number | null;
};

const CERTIFICATION_RANK: Record<string, number> = {
  NONE: 0,
  READY: 1,
  APPROVED: 2,
  CERTIFIED: 3,
};

function numeric(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function evaluateReleasePolicy(
  policy: ReleaseEnvironmentPolicy,
  certification: ReleaseCertificationEvidence | null | undefined,
): ReleasePolicyEvaluation {
  const blockers: ReleasePolicyBlocker[] = [];
  const state = certification?.state ? String(certification.state).toUpperCase() : null;
  const validity = certification?.validityStatus ? String(certification.validityStatus).toLowerCase() : null;
  const snapshot = certification?.evidenceSnapshot && typeof certification.evidenceSnapshot === "object"
    ? certification.evidenceSnapshot
    : {};

  const plan = snapshot.plan && typeof snapshot.plan === "object" ? snapshot.plan : {};
  const releaseGate = snapshot.releaseGate && typeof snapshot.releaseGate === "object" ? snapshot.releaseGate : {};
  const currentMetrics =
    releaseGate.currentMetrics && typeof releaseGate.currentMetrics === "object" ? releaseGate.currentMetrics : {};
  const selection =
    plan.selectionSummary && typeof plan.selectionSummary === "object" ? plan.selectionSummary : {};

  const coverage = numeric(plan.coveragePct);
  const smoke = numeric(selection.smoke);
  const openP0P1 = numeric(currentMetrics.openP0P1Tickets);

  if (policy.requiredCertificationState !== "NONE") {
    if (!certification) {
      blockers.push({
        code: "CERTIFICATION_MISSING",
        message: `A ${policy.requiredCertificationState} release certification is required.`,
        expected: policy.requiredCertificationState,
        actual: null,
      });
    } else if (validity !== "current") {
      blockers.push({
        code: "CERTIFICATION_NOT_CURRENT",
        message: "Release certification evidence is not current.",
        expected: "current",
        actual: validity,
      });
    } else if ((CERTIFICATION_RANK[state || ""] ?? -1) < CERTIFICATION_RANK[policy.requiredCertificationState]) {
      blockers.push({
        code: "CERTIFICATION_STATE",
        message: `Certification must reach ${policy.requiredCertificationState} before promotion.`,
        expected: policy.requiredCertificationState,
        actual: state,
      });
    }
  }

  if (coverage === null || coverage < policy.minRegressionCoverage) {
    blockers.push({
      code: "REGRESSION_COVERAGE",
      message: `Regression coverage must be at least ${policy.minRegressionCoverage}%.`,
      expected: policy.minRegressionCoverage,
      actual: coverage,
    });
  }

  if (policy.requireSmoke && (smoke === null || smoke < 1)) {
    blockers.push({
      code: "SMOKE_REQUIRED",
      message: "At least one mandatory smoke test must be present in certification evidence.",
      expected: 1,
      actual: smoke,
    });
  }

  if (policy.requireNoP0P1) {
    if (openP0P1 === null) {
      blockers.push({
        code: "P0_P1_EVIDENCE_MISSING",
        message: "P0/P1 defect evidence is missing from the certification snapshot.",
        expected: 0,
        actual: null,
      });
    } else if (openP0P1 > 0) {
      blockers.push({
        code: "OPEN_P0_P1",
        message: "Open P0/P1 defects block promotion to this environment.",
        expected: 0,
        actual: openP0P1,
      });
    }
  }

  return {
    passed: blockers.length === 0,
    blockers,
    certificationState: state,
    certificationValidity: validity,
    regressionCoverage: coverage,
    smokeSelected: smoke,
    openP0P1Tickets: openP0P1,
  };
}
