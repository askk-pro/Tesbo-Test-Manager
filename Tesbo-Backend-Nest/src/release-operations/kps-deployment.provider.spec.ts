import type { AppConfigService } from "../config/app-config.service";
import { KpsDeploymentProvider } from "./kps-deployment.provider";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("KPS deployment provider", () => {
  const config = {
    kpsBaseUrl: "https://kps.example.test",
    kpsApiToken: "secret-token",
  } as AppConfigService;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("starts an exact-commit deployment through the KPS workload action API", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({
        deploymentUuid: "dep-123",
        workload: { status: "PROVISIONING" },
        deploymentStrategy: "stop-first",
        persistentVolumeCount: 1,
        sourceCommitSelector: "a".repeat(40),
      }),
    );
    const provider = new KpsDeploymentProvider(config);
    const result = await provider.start({
      projectRef: "project-1",
      workloadRef: "workload-1",
      requestedGitSha: "a".repeat(40),
    });

    expect(result.deploymentId).toBe("dep-123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://kps.example.test/api/projects/project-1/workloads/workload-1/actions",
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      action: "deploy",
      commitSha: "a".repeat(40),
    });
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret-token",
    );
  });

  it("maps successful KPS deployment detail to SHA, artifact and configuration provenance", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({
        deployment: {
          deploymentUuid: "dep-123",
          commit: "b".repeat(40),
          status: "finished",
          dockerRegistryImageTag: "image:build-123",
          configurationHash: "config-123",
        },
      }),
    );
    const provider = new KpsDeploymentProvider(config);
    const result = await provider.observe({
      projectRef: "project-1",
      workloadRef: "workload-1",
      deploymentId: "dep-123",
    });
    expect(result).toEqual(
      expect.objectContaining({
        state: "succeeded",
        deployedGitSha: "b".repeat(40),
        artifactRef: "image:build-123",
        configurationHash: "config-123",
      }),
    );
  });

  it("treats a transient KPS deployment-history 404 as pending", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({ error: "Deployment not found in this workload history." }, 404),
    );
    const provider = new KpsDeploymentProvider(config);
    const result = await provider.observe({
      projectRef: "project-1",
      workloadRef: "workload-1",
      deploymentId: "dep-later",
    });
    expect(result.state).toBe("pending");
    expect(result.providerStatus).toBe("not_yet_visible");
  });
});
