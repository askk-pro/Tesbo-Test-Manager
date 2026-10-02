import {
  classifyExecutionHistory,
  clusterFailures,
  evaluateReleaseGate,
  evidenceDigest,
  failureSignatureFor,
  normalizeFailureText,
} from "./qa-failure-intelligence";

describe("Phase 4 failure intelligence", () => {
  it("normalizes volatile ids, ordinary numbers, urls and paths before signing a failure", () => {
    const a = normalizeFailureText("HTTP 504 at https://example.test/a/123 request 123e4567-e89b-12d3-a456-426614174000 order 91823 /srv/app/a.ts:42");
    const b = normalizeFailureText("HTTP 504 at https://other.test/b/999 request 123e4567-e89b-12d3-a456-426614174111 order 22119 /srv/app/b.ts:87");
    expect(a).toContain("<url>");
    expect(a).toContain("<uuid>");
    expect(a).toContain("<n>");
    expect(a).toContain("<path>");
    expect(a).toContain("<http-");
    expect(a).toBe(b);
  });

  it("gives the same signature to the same logical failure with volatile identifiers", () => {
    const one = failureSignatureFor({ status: "Failed", errorMessage: "Expected 200 but got 500 for order 91823" });
    const two = failureSignatureFor({ status: "Failed", errorMessage: "Expected 200 but got 500 for order 22119" });
    expect(one.signature).toBe(two.signature);
  });

  it("keeps distinct HTTP failure codes in distinct signatures", () => {
    const serverError = failureSignatureFor({ status: "Failed", errorMessage: "Expected 200 but got 500 for order 91823" });
    const unavailable = failureSignatureFor({ status: "Failed", errorMessage: "Expected 200 but got 503 for order 22119" });
    expect(serverError.signature).not.toBe(unavailable.signature);
  });

  it("classifies alternating pass/fail history as flaky and recommends isolated reruns", () => {
    const result = classifyExecutionHistory([
      { status: "Passed", retryCount: 0 },
      { status: "Failed", errorMessage: "Timeout while saving" },
      { status: "Passed", retryCount: 1 },
      { status: "Failed", errorMessage: "Timeout while saving" },
    ]);
    expect(result.classification).toBe("flaky");
    expect(result.flakeScore).toBeGreaterThanOrEqual(50);
    expect(result.rerunRecommendation).toMatchObject({ shouldRerun: true, count: 3, strategy: "same-build-isolated" });
  });

  it("classifies repeated identical failures with no passes as deterministic", () => {
    const result = classifyExecutionHistory([
      { status: "Failed", errorMessage: "Unique constraint users_email_key" },
      { status: "Failed", errorMessage: "Unique constraint users_email_key" },
      { status: "Failed", errorMessage: "Unique constraint users_email_key" },
    ]);
    expect(result.classification).toBe("deterministic");
    expect(result.currentSignatureOccurrences).toBe(3);
    expect(result.rerunRecommendation.strategy).toBe("after-change-targeted");
    expect(result.rerunRecommendation.shouldRerun).toBe(false);
  });

  it("does not overclaim flakiness from two observations", () => {
    const result = classifyExecutionHistory([{ status: "Passed" }, { status: "Failed", errorMessage: "boom" }]);
    expect(result.classification).toBe("insufficient_history");
  });

  it("clusters repeated evidence by normalized failure signature", () => {
    const clusters = clusterFailures([
      { testcaseId: "tc-1", executionId: "e1", runId: "r1", status: "Failed", errorMessage: "Timeout after 30 seconds" },
      { testcaseId: "tc-2", executionId: "e2", runId: "r2", status: "Failed", errorMessage: "Timeout after 45 seconds" },
      { testcaseId: "tc-3", executionId: "e3", runId: "r3", status: "Failed", errorMessage: "Permission denied" },
    ]);
    expect(clusters[0]).toMatchObject({ occurrenceCount: 2, testcaseCount: 2 });
    expect(clusters).toHaveLength(2);
  });

  it("blocks a release on hard QA facts but treats flakiness as a warning", () => {
    const result = evaluateReleaseGate({
      matchedRuns: 2,
      completedRuns: 1,
      incompleteRuns: 1,
      totalExecutions: 10,
      passed: 8,
      failed: 1,
      blocked: 0,
      skipped: 0,
      pending: 1,
      openCriticalHighTickets: 1,
      openP0P1Tickets: 0,
      highConfidenceFlaky: 2,
      deterministicFailures: 1,
    });
    expect(result.readiness).toBe("blocked");
    expect(result.blockers.map((b) => b.code)).toEqual(expect.arrayContaining(["INCOMPLETE_RUNS", "PENDING_EXECUTIONS", "FAILED_EXECUTIONS", "OPEN_CRITICAL_HIGH_TICKETS"]));
    expect(result.warnings.map((w) => w.code)).toContain("FLAKY_TESTS");
  });

  it("requires human approval only after a clean evidence evaluation", () => {
    const result = evaluateReleaseGate({
      matchedRuns: 1,
      completedRuns: 1,
      incompleteRuns: 0,
      totalExecutions: 5,
      passed: 5,
      failed: 0,
      blocked: 0,
      skipped: 0,
      pending: 0,
      openCriticalHighTickets: 0,
      openP0P1Tickets: 0,
      highConfidenceFlaky: 1,
      deterministicFailures: 0,
    });
    expect(result.readiness).toBe("ready_for_approval");
    expect(result.blockers).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });

  it("makes evidence digests insensitive to object key ordering", () => {
    expect(evidenceDigest({ b: 2, a: 1 })).toBe(evidenceDigest({ a: 1, b: 2 }));
  });
});
