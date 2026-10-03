import { evaluateDeploymentProvenance } from "./release-provenance.policy";

describe("Phase 7 deployment provenance", () => {
  it("matches an exact deployed SHA and records optional provider artifact metadata", () => {
    expect(evaluateDeploymentProvenance({
      requestedGitSha: "a".repeat(40),
      deployedGitSha: "A".repeat(40),
      providerArtifactRef: "image:a",
      providerConfigurationHash: "config-a",
    })).toEqual({ status: "matched", matched: true, reasons: [] });
  });

  it("fails closed when deployed SHA is absent", () => {
    const result = evaluateDeploymentProvenance({
      requestedGitSha: "a".repeat(40),
      deployedGitSha: null,
    });
    expect(result.status).toBe("unavailable");
    expect(result.reasons.map((item) => item.code)).toContain("DEPLOYED_SHA_MISSING");
  });

  it("blocks a SHA mismatch", () => {
    const result = evaluateDeploymentProvenance({
      requestedGitSha: "a".repeat(40),
      deployedGitSha: "b".repeat(40),
    });
    expect(result.status).toBe("mismatch");
    expect(result.reasons.map((item) => item.code)).toContain("GIT_SHA_MISMATCH");
  });

  it("enforces artifact/config identity when the QA build declares expected values", () => {
    const result = evaluateDeploymentProvenance({
      requestedGitSha: "a".repeat(40),
      deployedGitSha: "a".repeat(40),
      expectedArtifactRef: "image:approved",
      providerArtifactRef: "image:other",
      expectedConfigurationHash: "cfg-approved",
      providerConfigurationHash: "cfg-other",
    });
    expect(result.status).toBe("mismatch");
    expect(result.reasons.map((item) => item.code)).toEqual(
      expect.arrayContaining(["ARTIFACT_MISMATCH", "CONFIGURATION_MISMATCH"]),
    );
  });
});
