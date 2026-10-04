"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import {
  authMe,
  connectEngineeringIntegration,
  disconnectEngineeringIntegration,
  getEngineeringIntegrationStatus,
  type EngineeringIntegrationProvider,
  type EngineeringIntegrationStatus,
} from "@/lib/api";
import { useAppData } from "@/components/app/AppDataProvider";
import { Breadcrumbs, PageHeader, StandardPageLayout } from "@/components/workflows";
import { Button, Card, Input } from "@/components/ui";

function validProjectId(value: string | null): value is string {
  return !!value && /^[a-zA-Z0-9-]+$/.test(value);
}

function EngineeringWorkspaceIntegrationInner({
  provider,
  label,
  accountLabel,
}: {
  provider: EngineeringIntegrationProvider;
  label: string;
  accountLabel: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { workspace } = useAppData();
  const returnProjectIdParam = searchParams.get("returnProjectId");
  const returnProjectId = validProjectId(returnProjectIdParam) ? returnProjectIdParam : null;

  const [status, setStatus] = useState<EngineeringIntegrationStatus | null>(null);
  const [organization, setOrganization] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const canManage = (workspace?.role || "member").toLowerCase() === "owner";
  const workspaceName = String(workspace?.name || "");

  const load = useCallback(async () => {
    try {
      const result = await getEngineeringIntegrationStatus(provider);
      setStatus(result);
      if (result.externalId) setOrganization(result.externalId);
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to load integration.",
      });
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    authMe().then((me) => {
      if (!me) {
        router.replace("/login");
        return;
      }
      void load();
    });
  }, [load, router]);

  async function connect() {
    if (!organization.trim() || !token.trim()) {
      setMessage({ type: "error", text: accountLabel + " and access token are required." });
      return;
    }
    setConnecting(true);
    setMessage(null);
    try {
      await connectEngineeringIntegration(provider, organization.trim(), token.trim());
      setToken("");
      await load();
      setMessage({ type: "success", text: label + " connected." });
      if (returnProjectId) {
        router.replace("/projects/" + returnProjectId + "/settings/integrations/" + provider);
      }
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Connection failed.",
      });
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    setMessage(null);
    try {
      await disconnectEngineeringIntegration(provider);
      await load();
      setMessage({ type: "success", text: label + " disconnected. Existing synced requirements are preserved." });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Disconnect failed.",
      });
    } finally {
      setDisconnecting(false);
    }
  }

  const breadcrumb = (
    <Breadcrumbs
      items={[
        { label: workspaceName || "Workspace", href: "/dashboard" },
        { label: "Workspace settings", href: "/settings?tab=integrations" },
        { label },
      ]}
    />
  );

  return (
    <StandardPageLayout
      header={
        <PageHeader
          title={label + " Integration"}
          subtitle={
            status?.connected
              ? "Connected once for this workspace. Map projects or repositories from each Tesbo project's Settings → Integrations page."
              : "Connect this engineering system once for the workspace, then map it to individual Tesbo projects."
          }
          breadcrumb={breadcrumb}
        />
      }
    >
      {message ? (
        <div
          className={
            message.type === "success"
              ? "rounded-lg border border-[var(--success)]/30 bg-[var(--success-soft)] px-4 py-3 text-sm text-[var(--success-foreground)]"
              : "rounded-lg border border-[var(--error)]/30 bg-[var(--error-soft)] px-4 py-3 text-sm text-[var(--error-foreground)]"
          }
        >
          {message.text}
        </div>
      ) : null}

      {loading ? (
        <Card className="p-5 text-sm text-[var(--muted)]">Loading integration…</Card>
      ) : status?.connected ? (
        <>
          <Card className="p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-[var(--foreground)]">{label} connected</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {status.siteUrl ? (
                    <>
                      Connected to{" "}
                      <a
                        href={status.siteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--accent-light)] hover:underline"
                      >
                        {status.siteUrl}
                      </a>
                    </>
                  ) : (
                    accountLabel
                  )}
                </p>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  {status.connectedProjects?.length
                    ? "Mapped to " + status.connectedProjects.length + " Tesbo project(s)."
                    : "No Tesbo project is mapped yet."}
                </p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full bg-[var(--success-soft)] px-3 py-1 text-xs font-semibold text-[var(--success-foreground)]">
                <span className="h-2 w-2 rounded-full bg-[var(--success)]" />
                Connected
              </span>
            </div>

            {status.connectedProjects?.length ? (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-secondary)] p-3">
                <div className="text-xs font-medium text-[var(--muted)]">Mapped Tesbo projects</div>
                <div className="mt-2 space-y-1 text-sm">
                  {status.connectedProjects.map((project) => (
                    <div key={project.projectId} className="flex items-center gap-2">
                      <span className="font-mono text-xs text-[var(--muted)]">{project.projectKey}</span>
                      <span className="text-[var(--foreground)]">{project.projectName}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {canManage ? (
              <Button
                type="button"
                variant="secondary"
                onClick={disconnect}
                disabled={disconnecting}
                className="border-[var(--error)]/50 text-[var(--error-foreground)] hover:bg-[color-mix(in_oklab,var(--error)_8%,white)]"
              >
                {disconnecting ? "Disconnecting…" : "Disconnect " + label}
              </Button>
            ) : null}
          </Card>

          {returnProjectId ? (
            <Card className="p-4">
              <Link
                href={"/projects/" + returnProjectId + "/settings/integrations/" + provider}
                className="text-sm font-medium text-[var(--accent-light)] hover:underline"
              >
                Continue project mapping →
              </Link>
            </Card>
          ) : null}
        </>
      ) : (
        <Card className="p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">Connect {label}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {canManage
                ? "The token is encrypted by the Tesbo backend and is never shown again after this form is submitted."
                : "Only the workspace owner can connect this integration."}
            </p>
          </div>

          {canManage ? (
            <>
              <div className="grid gap-4 max-w-2xl">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">{accountLabel}</label>
                  <Input
                    value={organization}
                    onChange={(event) => setOrganization(event.target.value)}
                    placeholder={
                      provider === "azure-devops"
                        ? "my-organization or https://dev.azure.com/my-organization"
                        : "my-github-organization or https://github.com/my-github-organization"
                    }
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Access token</label>
                  <Input
                    type="password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder={provider === "azure-devops" ? "Azure DevOps PAT" : "GitHub fine-grained token"}
                    autoComplete="new-password"
                  />
                  <p className="mt-1.5 text-xs text-[var(--muted)]">
                    {provider === "azure-devops"
                      ? "Use a token that can read Projects and Work Items. Microsoft Entra ID is the preferred production hardening path after this self-hosted connection is accepted."
                      : "Use an organization-authorized fine-grained token that can list repositories and read Issues. GitHub App installation auth can replace this token flow later without changing project mappings."}
                  </p>
                </div>
              </div>

              <Button type="button" onClick={connect} disabled={connecting || !organization.trim() || !token.trim()}>
                {connecting ? "Connecting…" : "Connect " + label}
              </Button>
            </>
          ) : null}
        </Card>
      )}
    </StandardPageLayout>
  );
}

export function EngineeringWorkspaceIntegration(props: {
  provider: EngineeringIntegrationProvider;
  label: string;
  accountLabel: string;
}) {
  return (
    <Suspense
      fallback={
        <StandardPageLayout header={<PageHeader title={props.label + " Integration"} />}>
          <div className="flex min-h-[200px] items-center justify-center text-sm text-[var(--muted)]">
            Loading…
          </div>
        </StandardPageLayout>
      }
    >
      <EngineeringWorkspaceIntegrationInner {...props} />
    </Suspense>
  );
}
