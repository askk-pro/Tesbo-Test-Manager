"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  authMe,
  type EngineeringIntegrationProvider,
  type EngineeringProjectStatus,
  type EngineeringRemoteItem,
  type EngineeringSyncResult,
} from "@/lib/api";
import { Button, Card } from "@/components/ui";
import { Breadcrumbs, PageHeader, StandardPageLayout } from "@/components/workflows";
import { useProjectData } from "@/components/project/ProjectDataProvider";

export function EngineeringProjectIntegration({
  provider,
  label,
  remoteUnitLabel,
  fetchStatus,
  fetchItems,
  saveMapping,
  syncRequirements,
}: {
  provider: EngineeringIntegrationProvider;
  label: string;
  remoteUnitLabel: string;
  fetchStatus: (projectId: string) => Promise<EngineeringProjectStatus>;
  fetchItems: (projectId: string) => Promise<EngineeringRemoteItem[]>;
  saveMapping: (projectId: string, remoteId: string | null) => Promise<void>;
  syncRequirements: (projectId: string) => Promise<EngineeringSyncResult>;
}) {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const { project } = useProjectData();

  const [status, setStatus] = useState<EngineeringProjectStatus | null>(null);
  const [items, setItems] = useState<EngineeringRemoteItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const statusResult = await fetchStatus(projectId);
      setStatus(statusResult);
      if (statusResult.connected) {
        setItemsLoading(true);
        const remoteItems = await fetchItems(projectId);
        setItems(remoteItems);
        setSelectedId(
          statusResult.mappedItem?.id ||
            remoteItems.find((item) => item.connected)?.id ||
            ""
        );
        setItemsLoading(false);
      } else {
        setItems([]);
        setSelectedId("");
      }
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to load integration.",
      });
    } finally {
      setItemsLoading(false);
      setLoading(false);
    }
  }, [fetchItems, fetchStatus, projectId]);

  useEffect(() => {
    authMe().then((me) => {
      if (!me) {
        router.replace("/login");
        return;
      }
      void load();
    });
  }, [load, router]);

  async function linkSelected() {
    setSaving(true);
    setMessage(null);
    try {
      await saveMapping(projectId, selectedId || null);
      const selected = items.find((item) => item.id === selectedId);
      await load();
      setMessage({
        type: "success",
        text: selected
          ? selected.name + " linked to this Tesbo project."
          : remoteUnitLabel + " unlinked.",
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to save mapping.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function unlink() {
    setSaving(true);
    setMessage(null);
    try {
      await saveMapping(projectId, null);
      setSelectedId("");
      await load();
      setMessage({ type: "success", text: remoteUnitLabel + " unlinked. Existing synced requirements are preserved." });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to unlink mapping.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function sync() {
    setSyncing(true);
    setMessage(null);
    try {
      const result = await syncRequirements(projectId);
      await load();
      setMessage({
        type: "success",
        text:
          "Synced " +
          result.synced +
          " item(s): " +
          result.created +
          " requirement(s) created, " +
          result.updated +
          " updated.",
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Requirement sync failed.",
      });
    } finally {
      setSyncing(false);
    }
  }

  function sourceUrl(): string | null {
    if (!status?.mappedItem) return null;
    if (provider === "github" && status.mappedItem.context) {
      return "https://github.com/" + status.mappedItem.context + "/issues";
    }
    if (provider === "azure-devops" && status.siteUrl) {
      return status.siteUrl.replace(/\/$/, "") + "/" + encodeURIComponent(status.mappedItem.name);
    }
    return status.siteUrl || null;
  }

  const mappedSourceUrl = sourceUrl();

  return (
    <StandardPageLayout
      header={
        <PageHeader
          title={label + " Integration"}
          subtitle={"Map one " + remoteUnitLabel.toLowerCase() + " and sync its engineering requirements into Tesbo REQ-n traceability."}
          breadcrumb={
            <Breadcrumbs
              items={[
                { label: "Projects", href: "/projects" },
                { label: String(project.name || "Project"), href: "/projects/" + projectId + "/dashboard" },
                { label: "Settings", href: "/projects/" + projectId + "/settings?tab=integrations" },
                { label },
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
        <Card className="p-5 text-sm text-[var(--muted)]">Loading integration…</Card>
      ) : !status?.connected ? (
        <Card className="p-5">
          <h2 className="text-base font-semibold text-[var(--foreground)]">{label} is not connected for this workspace</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Connect it once in Workspace Settings, then return here to choose the {remoteUnitLabel.toLowerCase()} for this project.
          </p>
          <Link
            href={"/settings/integrations/" + provider + "?returnProjectId=" + projectId}
            className="mt-4 inline-flex h-9 items-center justify-center rounded-[10px] border border-transparent bg-[var(--brand-primary)] px-3.5 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-[var(--brand-hover)]"
          >
            Connect {label}
          </Link>
        </Card>
      ) : (
        <>
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-[var(--foreground)]">Workspace connection</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {status.externalId ? label + " account: " + status.externalId : label + " connected"}
                </p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full bg-[var(--success-soft)] px-3 py-1 text-xs font-semibold text-[var(--success-foreground)]">
                <span className="h-2 w-2 rounded-full bg-[var(--success)]" />
                Connected
              </span>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-base font-semibold text-[var(--foreground)]">Select a {remoteUnitLabel}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Exactly one {remoteUnitLabel.toLowerCase()} feeds this Tesbo project. Re-mapping preserves requirements already synchronized from the previous source.
            </p>

            {itemsLoading ? (
              <p className="mt-4 text-sm text-[var(--muted)]">Loading {remoteUnitLabel.toLowerCase()}s…</p>
            ) : items.length === 0 ? (
              <p className="mt-4 text-sm text-[var(--muted)]">No accessible {remoteUnitLabel.toLowerCase()}s were found.</p>
            ) : (
              <div className="mt-4 max-w-2xl">
                <select
                  value={selectedId}
                  onChange={(event) => setSelectedId(event.target.value)}
                  className="h-10 w-full rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--brand-primary)]"
                >
                  <option value="">Select {remoteUnitLabel.toLowerCase()}…</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id} disabled={item.archived === true}>
                      {item.name}
                      {item.context && item.context !== item.name ? " · " + item.context : ""}
                      {item.private ? " · private" : ""}
                      {item.archived ? " · archived" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={linkSelected} disabled={saving || !selectedId}>
                {saving ? "Saving…" : "Link " + remoteUnitLabel}
              </Button>
              {status.mappedItem ? (
                <Button variant="secondary" onClick={unlink} disabled={saving}>
                  Unlink
                </Button>
              ) : null}
            </div>
          </Card>

          {status.mappedItem ? (
            <Card className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-[var(--foreground)]">Requirement sync</h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Linked to <span className="font-medium text-[var(--foreground)]">{status.mappedItem.name}</span>.
                    Synced items become normal Tesbo REQ-n requirements with source traceability.
                  </p>
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    Last sync: {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : "Never"}
                    {" · "}Last synced: {status.lastSyncedCount}
                    {" · "}Remote items read: {status.lastTotalCount}
                  </p>
                </div>
                {mappedSourceUrl ? (
                  <a
                    href={mappedSourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-[var(--accent-light)] hover:underline"
                  >
                    Open source ↗
                  </a>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button onClick={sync} disabled={syncing}>
                  {syncing ? "Syncing…" : "Sync requirements now"}
                </Button>
                <Link href={"/projects/" + projectId + "/requirements"} className="text-sm text-[var(--accent-light)] hover:underline">
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
