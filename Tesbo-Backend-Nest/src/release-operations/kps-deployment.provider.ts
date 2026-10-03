import { Injectable } from "@nestjs/common";
import { AppConfigService } from "../config/app-config.service";

export type KpsDeploymentReference = {
  projectRef: string;
  workloadRef: string;
};

export type KpsDeploymentStart = {
  deploymentId: string;
  providerStatus: string | null;
  deploymentStrategy: string | null;
  persistentVolumeCount: number | null;
  metadata: Record<string, unknown>;
};

export type KpsDeploymentObservation = {
  state: "pending" | "succeeded" | "failed" | "cancelled" | "unknown";
  providerStatus: string | null;
  deployedGitSha: string | null;
  artifactRef: string | null;
  configurationHash: string | null;
  metadata: Record<string, unknown>;
};

class KpsProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "KpsProviderError";
  }
}

@Injectable()
export class KpsDeploymentProvider {
  constructor(private readonly config: AppConfigService) {}

  private baseUrl(): string {
    const raw = this.config.kpsBaseUrl.trim().replace(/\/+$/, "");
    if (!raw) throw new Error("KPS_BASE_URL is not configured.");
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("KPS_BASE_URL must use http:// or https://.");
    }
    return url.toString().replace(/\/+$/, "");
  }

  private token(): string {
    const token = this.config.kpsApiToken.trim();
    if (!token) throw new Error("KPS_API_TOKEN is not configured.");
    return token;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(this.baseUrl() + path, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer " + this.token(),
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let body: any = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text.slice(0, 1000) };
      }
    }
    if (!response.ok) {
      const message = String(body?.error || body?.message || ("KPS returned HTTP " + response.status));
      throw new KpsProviderError(message, response.status);
    }
    return body as T;
  }

  private workloadPath(ref: KpsDeploymentReference): string {
    return "/api/projects/" + encodeURIComponent(ref.projectRef) +
      "/workloads/" + encodeURIComponent(ref.workloadRef);
  }

  async start(
    ref: KpsDeploymentReference & { requestedGitSha: string },
  ): Promise<KpsDeploymentStart> {
    const payload = await this.request<any>(this.workloadPath(ref) + "/actions", {
      method: "POST",
      body: JSON.stringify({
        action: "deploy",
        commitSha: ref.requestedGitSha,
      }),
    });
    const deploymentId = String(payload?.deploymentUuid || "").trim();
    if (!deploymentId) {
      throw new Error("KPS accepted the deployment request but returned no deployment UUID.");
    }
    return {
      deploymentId,
      providerStatus: payload?.workload?.status ? String(payload.workload.status) : "queued",
      deploymentStrategy: payload?.deploymentStrategy ? String(payload.deploymentStrategy) : null,
      persistentVolumeCount: Number.isFinite(Number(payload?.persistentVolumeCount))
        ? Number(payload.persistentVolumeCount)
        : null,
      metadata: {
        message: payload?.message || null,
        sourceCommitSelector: payload?.sourceCommitSelector || null,
        releaseGovernanceEnforced: payload?.releaseGovernanceEnforced === true,
      },
    };
  }

  async observe(
    ref: KpsDeploymentReference & { deploymentId: string },
  ): Promise<KpsDeploymentObservation> {
    let payload: any;
    try {
      payload = await this.request<any>(
        this.workloadPath(ref) + "/deployments/" + encodeURIComponent(ref.deploymentId),
      );
    } catch (error) {
      if (
        error instanceof KpsProviderError &&
        error.status === 404 &&
        error.message.includes("Deployment not found")
      ) {
        return {
          state: "pending",
          providerStatus: "not_yet_visible",
          deployedGitSha: null,
          artifactRef: null,
          configurationHash: null,
          metadata: { transientNotFound: true },
        };
      }
      throw error;
    }

    const deployment = payload?.deployment || {};
    const rawStatus = String(deployment.status || "").trim();
    const value = rawStatus.toLowerCase();
    let state: KpsDeploymentObservation["state"] = "unknown";
    if (value.includes("finished") || value.includes("success")) state = "succeeded";
    else if (value.includes("cancel")) state = "cancelled";
    else if (value.includes("fail") || value.includes("error")) state = "failed";
    else if (
      value.includes("queue") ||
      value.includes("progress") ||
      value.includes("running") ||
      value.includes("provision") ||
      value.includes("pending")
    ) {
      state = "pending";
    }

    return {
      state,
      providerStatus: rawStatus || null,
      deployedGitSha: deployment.commit ? String(deployment.commit) : null,
      artifactRef: deployment.dockerRegistryImageTag
        ? String(deployment.dockerRegistryImageTag)
        : null,
      configurationHash: deployment.configurationHash
        ? String(deployment.configurationHash)
        : null,
      metadata: {
        commitMessage: deployment.commitMessage || null,
        createdAt: deployment.createdAt || null,
        updatedAt: deployment.updatedAt || null,
        rollback: deployment.rollback === true,
        forceRebuild: deployment.forceRebuild === true,
      },
    };
  }
}
