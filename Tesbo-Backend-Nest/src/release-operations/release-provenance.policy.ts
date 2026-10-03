export type DeploymentProvenanceInput = {
  requestedGitSha: string;
  deployedGitSha?: string | null;
  expectedArtifactRef?: string | null;
  providerArtifactRef?: string | null;
  expectedConfigurationHash?: string | null;
  providerConfigurationHash?: string | null;
};

export type DeploymentProvenanceResult = {
  status: "matched" | "mismatch" | "unavailable";
  matched: boolean;
  reasons: Array<{ code: string; message: string; expected?: string | null; actual?: string | null }>;
};

function normalized(value?: string | null): string {
  return String(value || "").trim().toLowerCase();
}

export function evaluateDeploymentProvenance(input: DeploymentProvenanceInput): DeploymentProvenanceResult {
  const reasons: DeploymentProvenanceResult["reasons"] = [];
  const requestedSha = normalized(input.requestedGitSha);
  const deployedSha = normalized(input.deployedGitSha);

  if (!deployedSha) {
    reasons.push({
      code: "DEPLOYED_SHA_MISSING",
      message: "The deployment provider did not return the deployed Git SHA.",
      expected: requestedSha,
      actual: null,
    });
  } else if (deployedSha !== requestedSha) {
    reasons.push({
      code: "GIT_SHA_MISMATCH",
      message: "The deployed Git SHA does not match the approved/requested SHA.",
      expected: requestedSha,
      actual: deployedSha,
    });
  }

  const expectedArtifact = normalized(input.expectedArtifactRef);
  const providerArtifact = normalized(input.providerArtifactRef);
  if (expectedArtifact) {
    if (!providerArtifact) {
      reasons.push({
        code: "ARTIFACT_PROVENANCE_MISSING",
        message: "The build declares an expected artifact but the provider did not return one.",
        expected: expectedArtifact,
        actual: null,
      });
    } else if (providerArtifact !== expectedArtifact) {
      reasons.push({
        code: "ARTIFACT_MISMATCH",
        message: "The deployed artifact reference does not match the build's expected artifact.",
        expected: expectedArtifact,
        actual: providerArtifact,
      });
    }
  }

  const expectedConfig = normalized(input.expectedConfigurationHash);
  const providerConfig = normalized(input.providerConfigurationHash);
  if (expectedConfig) {
    if (!providerConfig) {
      reasons.push({
        code: "CONFIG_PROVENANCE_MISSING",
        message: "The build declares an expected configuration hash but the provider did not return one.",
        expected: expectedConfig,
        actual: null,
      });
    } else if (providerConfig !== expectedConfig) {
      reasons.push({
        code: "CONFIGURATION_MISMATCH",
        message: "The deployed configuration hash does not match the build's expected configuration hash.",
        expected: expectedConfig,
        actual: providerConfig,
      });
    }
  }

  if (!reasons.length) return { status: "matched", matched: true, reasons: [] };
  const unavailable = reasons.every((reason) => reason.code.endsWith("_MISSING"));
  return {
    status: unavailable ? "unavailable" : "mismatch",
    matched: false,
    reasons,
  };
}
