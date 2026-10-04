"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  connectKpsDevOpsProject,
  getKpsDevOpsStatus,
  listKpsDevOpsProjects,
  syncKpsDevOpsRequirements,
  type KpsDevOpsProject,
  type KpsDevOpsStatus,
} from "@/lib/api";
import { Button, Card, Select } from "@/components/ui";
import { Breadcrumbs, PageHeader, StandardPageLayout } from "@/components/workflows";
import { useAppData } from "@/components/app/AppDataProvider";
import { useProjectData } from "@/components/project/ProjectDataProvider";

export default function KpsDevOpsIntegrationPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const { currentUser } = useAppData();
  const { project } = useProjectData();
  const [status, setStatus] = useState<KpsDevOpsStatus | null>(null);
  const [projects, setProjects] = useState<KpsDevOpsProject[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const statusResult = await getKpsDevOpsStatus(projectId);
      setStatus(statusResult);
      if (statusResult.connected) {
        const projectRows = await listKpsDevOpsProjects(projectId);
        setProjects(projectRows);
        setSelectedId(statusResult.mappedProject?.id || projectRows.find((item) => item.connected)?.id || "");
      }
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to load KPS DevOps integration." });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!currentUser) {
      router.replace("/login");
      return;
    }
    void load();
  }, [currentUser, load, router]);

  async function saveMapping() {
    setSaving(true);
    setMessage(null);
    try {
      await connectKpsDevOpsProject(projectId, selectedId || null);
      await load();
      const selected = projects.find((item) => item.id === selectedId);
      setMessage({
        type: "success",
        text: selected ? `${selected.name} linked to this Tesbo project.` : "KPS DevOps project unlinked.",
      });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to save KPS DevOps mapping." });
    } finally {
      setSaving(false);
    }
  }

  async function syncRequirements() {
    setSyncing(true);
    setMessage(null);
    try {
      const result = await syncKpsDevOpsRequirements(projectId);
      await load();
      setMessage({
        type: "success",
        text: `Synced ${result.eligibleRequirements} requirement work item(s): ${result.created} created, ${result.updated} updated.`,
      });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "KPS DevOps sync failed." });
    } finally {
      setSyncing(false);
    }
  }

  const mappedId = status?.mappedProject?.id || "";
  const mappedBoardsUrl =
    status?.siteUrl && mappedId
      ? `${status.siteUrl.replace(/\/$/, "")}/devops/boards?projectId=${encodeURIComponent(mappedId)}`
      : null;

  return (
    <StandardPageLayout
      header={
        <PageHeader
          title="Azure DevOps (KPS)"
          subtitle="Link a KPS DevOps Boards project and mirror requirement-level work items into Tesbo."
          breadcrumb={
            <Breadcrumbs
              items={[
                { label: "Projects", href: "/projects" },
                { label: String(project.name || "Project"), href: `/projects/${projectId}/dashboard` },
                { label: "Settings", href: `/projects/${projectId}/settings?tab=integrations` },
                { label: "Azure DevOps (KPS)" },
              ]}
            />
          }
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
        <Card className="p-6 text-sm text-[var(--muted)]">Loading KPS DevOps integration…</Card>
      ) : !status?.connected ? (
        <Card className="p-5">
          <h2 className="text-base font-semibold text-[var(--foreground)]">KPS runtime is not configured</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Configure KPS_BASE_URL and KPS_API_TOKEN on the QA backend before using this integration.
          </p>
        </Card>
      ) : (
        <>
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-[var(--foreground)]">KPS connection</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Server-to-server authentication is already active. No Azure DevOps PAT is required for KPS Boards.
                </p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full bg-[var(--success-soft)] px-3 py-1 text-xs font-semibold text-[var(--success-foreground)]">
                <span className="h-2 w-2 rounded-full bg-[var(--success)]" />
                Connected
              </span>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-base font-semibold text-[var(--foreground)]">Map a KPS DevOps project</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Select the KPS project whose Boards requirement-level work items should feed this Tesbo project.
            </p>
            <div className="mt-4 max-w-2xl">
              <Select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                <option value="">Select a KPS project…</option>
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}{item.organizationName ? ` · ${item.organizationName}` : ""} ({item.slug || item.key})
                  </option>
                ))}
              </Select>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={saveMapping} disabled={saving || !selectedId}>
                {saving ? "Saving…" : "Link KPS project"}
              </Button>
              {mappedId ? (
                <Button
                  variant="secondary"
                  onClick={async () => {
                    setSelectedId("");
                    setSaving(true);
                    setMessage(null);
                    try {
                      await connectKpsDevOpsProject(projectId, null);
                      await load();
                      setMessage({ type: "success", text: "KPS DevOps project unlinked." });
                    } catch (error) {
                      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to unlink KPS DevOps project." });
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={saving}
                >
                  Unlink
                </Button>
              ) : null}
            </div>
          </Card>

          {status.mappedProject ? (
            <Card className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-[var(--foreground)]">Requirement sync</h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Linked to <span className="font-medium text-[var(--foreground)]">{status.mappedProject.name}</span>.
                    Only KPS work-item types configured at the <strong>requirement</strong> backlog level are mirrored.
                  </p>
                  <div className="mt-3 text-xs text-[var(--muted)]">
                    Last sync: {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : "Never"}
                    {" · "}Last synced requirements: {status.lastSyncedCount}
                  </div>
                </div>
                {mappedBoardsUrl ? (
                  <Link
                    href={mappedBoardsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-[var(--accent-light)] hover:underline"
                  >
                    Open KPS Boards ↗
                  </Link>
                ) : null}
              </div>
              <div className="mt-4 flex items-center gap-3">
                <Button onClick={syncRequirements} disabled={syncing}>
                  {syncing ? "Syncing…" : "Sync requirements now"}
                </Button>
                <Link href={`/projects/${projectId}/requirements`} className="text-sm text-[var(--accent-light)] hover:underline">
                  View Requirements →
                </Link>
              </div>
            </Card>
          ) : null}
        </>
      )}
    </StandardPageLayout>
  );
}
