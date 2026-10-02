"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconActivity,
  IconBrain,
  IconDownload,
  IconFile,
  IconLink,
  IconMessage,
  IconRefresh,
  IconRoute,
  IconTestPipe,
  IconUpload,
} from "@tabler/icons-react";
import {
  addQaTicketComment,
  getQaTicketAnalysisContext,
  getQaTicketEvidenceDownloadUrl,
  getQaTicketWorkspace,
  linkQaTicketRequirement,
  linkQaTicketTestcase,
  requestQaTicketRetest,
  unlinkQaTicketRequirement,
  unlinkQaTicketTestcase,
  uploadQaTicketEvidence,
  type QaTicketAnalysisContext,
  type QaTicketWorkspace,
  type QaTraceNode,
} from "@/lib/api";
import {
  Button,
  Card,
  Input,
  PageLoader,
  PriorityBadge,
  SeverityBadge,
  StatusChip,
  Textarea,
} from "@/components/ui";
import { Breadcrumbs, PageHeader, StandardPageLayout } from "@/components/workflows";

type Tab = "overview" | "traceability" | "evidence" | "comments" | "activity" | "analysis";

const TABS: Array<{ id: Tab; label: string; icon: typeof IconRoute }> = [
  { id: "overview", label: "Overview", icon: IconFile },
  { id: "traceability", label: "Traceability", icon: IconRoute },
  { id: "evidence", label: "Evidence", icon: IconUpload },
  { id: "comments", label: "Comments", icon: IconMessage },
  { id: "activity", label: "Activity", icon: IconActivity },
  { id: "analysis", label: "AI context", icon: IconBrain },
];

function fmt(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function bytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function NodeCard({ node }: { node: QaTraceNode }) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-soft)]">{node.kind}</span>
        {node.status ? <span className="text-[11px] text-[var(--muted)]">{node.status}</span> : null}
      </div>
      <div className="mt-1 font-mono text-xs font-semibold text-[var(--accent-light)]">{node.humanId || node.entityId.slice(0, 8)}</div>
      <div className="mt-1 text-sm font-medium text-[var(--foreground)]">{node.title || "Untitled"}</div>
    </div>
  );
}

export default function QaTicketWorkspacePage() {
  const params = useParams<{ id: string; ticketRef: string }>();
  const projectId = String(params.id);
  const ticketRef = decodeURIComponent(String(params.ticketRef));
  const [workspace, setWorkspace] = useState<QaTicketWorkspace | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [requirementRef, setRequirementRef] = useState("");
  const [testcaseRef, setTestcaseRef] = useState("");
  const [runRef, setRunRef] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [evidenceKind, setEvidenceKind] = useState<"screenshot" | "video" | "trace" | "log" | "">("");
  const [analysis, setAnalysis] = useState<QaTicketAnalysisContext | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setWorkspace(await getQaTicketWorkspace(projectId, ticketRef));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load QA ticket workspace.");
    } finally {
      setLoading(false);
    }
  }, [projectId, ticketRef]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The action failed.");
    } finally {
      setBusy(null);
    }
  };

  const groups = useMemo(() => {
    const result: Record<string, QaTraceNode[]> = {
      requirement: [],
      testcase: [],
      run: [],
      execution: [],
      evidence: [],
    };
    for (const node of workspace?.graph.nodes || []) {
      if (node.kind !== "ticket") result[node.kind]?.push(node);
    }
    return result;
  }, [workspace]);

  if (loading && !workspace) return <PageLoader label="Loading QA ticket workspace…" />;
  if (!workspace) {
    return (
      <StandardPageLayout>
        <Card className="p-6 text-sm text-[var(--status-fail-text)]">{error || "Ticket not found."}</Card>
      </StandardPageLayout>
    );
  }

  const ticket = workspace.ticket;
  const humanId = ticket.humanId || ticket.externalId || ticketRef;

  return (
    <StandardPageLayout
      header={
        <PageHeader
          breadcrumb={
            <Breadcrumbs
              items={[
                { label: "QA Tickets", href: `/projects/${projectId}/qa-tickets` },
                { label: humanId },
              ]}
            />
          }
          title={
            <div className="min-w-0">
              <div className="font-mono text-sm font-semibold text-[var(--accent-light)]">{humanId}</div>
              <div className="truncate">{ticket.title}</div>
            </div>
          }
          subtitle={ticket.description || "QA ticket workspace"}
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={busy === "retest"}
                onClick={() =>
                  void runAction("retest", () =>
                    requestQaTicketRetest(projectId, humanId, {
                      name: `Retest ${humanId}`,
                    })
                  )
                }
              >
                <IconTestPipe size={16} />
                Request retest
              </Button>
              <Button variant="secondary" onClick={() => void load()}>
                <IconRefresh size={16} />
                Refresh
              </Button>
            </div>
          }
        />
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip>{ticket.status}</StatusChip>
        <SeverityBadge severity={ticket.severity} />
        {ticket.priority ? <PriorityBadge priority={ticket.priority} /> : null}
        {ticket.integrationIssueKey ? (
          <span className="rounded-md bg-[var(--surface-raised)] px-2 py-1 text-xs text-[var(--muted)]">
            {ticket.integrationProvider}: {ticket.integrationIssueKey}
          </span>
        ) : null}
      </div>

      {error ? <Card className="border-[var(--error)]/30 p-4 text-sm text-[var(--status-fail-text)]">{error}</Card> : null}

      <div className="overflow-x-auto border-b border-[var(--border-subtle)]">
        <div className="flex min-w-max gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  active
                    ? "border-[var(--brand-primary)] text-[var(--foreground)]"
                    : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === "overview" ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <Card className="p-5">
              <h2 className="text-base font-semibold text-[var(--foreground)]">Requirements</h2>
              <div className="mt-4 space-y-3">
                {workspace.requirements.map((req) => (
                  <div key={req.id} className="flex items-start gap-3 rounded-xl border border-[var(--border-subtle)] p-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-xs font-semibold text-[var(--accent-light)]">{req.humanId}</div>
                      <div className="mt-1 text-sm font-medium text-[var(--foreground)]">{req.title}</div>
                      <div className="mt-1 text-xs text-[var(--muted)]">{req.status}{req.priority ? ` · ${req.priority}` : ""}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === `unlink-req-${req.id}`}
                      onClick={() =>
                        void runAction(`unlink-req-${req.id}`, () =>
                          unlinkQaTicketRequirement(projectId, humanId, req.humanId)
                        )
                      }
                    >
                      Unlink
                    </Button>
                  </div>
                ))}
                {workspace.requirements.length === 0 ? (
                  <div className="text-sm text-[var(--muted)]">No requirement is linked yet.</div>
                ) : null}
              </div>
              <div className="mt-4 flex gap-2">
                <Input value={requirementRef} onChange={(e) => setRequirementRef(e.target.value)} placeholder="REQ-93 or source key" />
                <Button
                  disabled={!requirementRef.trim() || busy === "link-req"}
                  onClick={() =>
                    void runAction("link-req", async () => {
                      await linkQaTicketRequirement(projectId, humanId, requirementRef.trim());
                      setRequirementRef("");
                    })
                  }
                >
                  <IconLink size={16} />
                  Link
                </Button>
              </div>
            </Card>

            <Card className="p-5">
              <h2 className="text-base font-semibold text-[var(--foreground)]">Test cases and runs</h2>
              <div className="mt-4 space-y-3">
                {workspace.testcaseLinks.map((link) => (
                  <div key={link.linkId} className="rounded-xl border border-[var(--border-subtle)] p-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-xs font-semibold text-[var(--accent-light)]">
                          {link.testcaseHumanId || link.testcaseExternalId || "Test case"}
                        </div>
                        <div className="mt-1 text-sm font-medium text-[var(--foreground)]">{link.testcaseTitle || "Untitled"}</div>
                        <div className="mt-1 text-xs text-[var(--muted)]">
                          {link.runHumanId ? `${link.runHumanId} · ${link.runName || "Run"}` : "No run linked"}
                          {link.executionStatus ? ` · result ${link.executionStatus}` : ""}
                        </div>
                      </div>
                      {link.testcaseHumanId ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy === `unlink-tc-${link.linkId}`}
                          onClick={() =>
                            void runAction(`unlink-tc-${link.linkId}`, () =>
                              unlinkQaTicketTestcase(projectId, humanId, String(link.testcaseHumanId))
                            )
                          }
                        >
                          Unlink
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
                {workspace.testcaseLinks.length === 0 ? (
                  <div className="text-sm text-[var(--muted)]">No test case is linked yet.</div>
                ) : null}
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input value={testcaseRef} onChange={(e) => setTestcaseRef(e.target.value)} placeholder="TC-291" />
                <Input value={runRef} onChange={(e) => setRunRef(e.target.value)} placeholder="RUN-42 (optional)" />
                <Button
                  disabled={!testcaseRef.trim() || busy === "link-tc"}
                  onClick={() =>
                    void runAction("link-tc", async () => {
                      await linkQaTicketTestcase(projectId, humanId, testcaseRef.trim(), runRef.trim() || undefined);
                      setTestcaseRef("");
                      setRunRef("");
                    })
                  }
                >
                  Link test
                </Button>
              </div>
            </Card>
          </div>

          <div className="space-y-5">
            <Card className="p-5">
              <h2 className="text-base font-semibold text-[var(--foreground)]">Traceability health</h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {[
                  ["Requirements", workspace.requirements.length],
                  ["Test links", workspace.testcaseLinks.length],
                  ["Runs", new Set(workspace.testcaseLinks.map((x) => x.runId).filter(Boolean)).size],
                  ["Evidence", workspace.evidence.length],
                  ["Comments", workspace.comments.length],
                  ["Activity", workspace.activity.length],
                ].map(([label, count]) => (
                  <div key={String(label)} className="rounded-xl bg-[var(--surface-raised)] p-3">
                    <div className="text-[11px] text-[var(--muted)]">{label}</div>
                    <div className="mt-1 text-xl font-semibold text-[var(--foreground)]">{count}</div>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="p-5">
              <h2 className="text-base font-semibold text-[var(--foreground)]">References</h2>
              <div className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                <div>Canonical: <span className="font-mono text-[var(--foreground)]">{humanId}</span></div>
                <div>Legacy: <span className="font-mono text-[var(--foreground)]">{ticket.externalId}</span></div>
                {ticket.integrationIssueKey ? <div>External: <span className="font-mono text-[var(--foreground)]">{ticket.integrationIssueKey}</span></div> : null}
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {activeTab === "traceability" ? (
        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="text-base font-semibold text-[var(--foreground)]">Traceability graph</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Ticket → requirement → test case → run → execution → evidence. Direct ticket-to-test links are also retained.
            </p>
            <div className="mt-5 grid gap-5 xl:grid-cols-5">
              {(["requirement", "testcase", "run", "execution", "evidence"] as const).map((kind) => (
                <div key={kind}>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-soft)]">{kind}</div>
                  <div className="space-y-2">
                    {groups[kind].map((node) => <NodeCard key={node.id} node={node} />)}
                    {groups[kind].length === 0 ? <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-3 text-xs text-[var(--muted-soft)]">None</div> : null}
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Relationships</h3>
            <div className="mt-3 grid gap-2 lg:grid-cols-2">
              {workspace.graph.edges.map((edge, i) => (
                <div key={`${edge.from}:${edge.to}:${i}`} className="rounded-lg bg-[var(--surface-raised)] px-3 py-2 font-mono text-xs text-[var(--muted)]">
                  {edge.from} <span className="text-[var(--accent-light)]">—{edge.relation}→</span> {edge.to}
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}

      {activeTab === "evidence" ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="overflow-hidden">
            <div className="border-b border-[var(--border-subtle)] px-5 py-4">
              <h2 className="text-base font-semibold text-[var(--foreground)]">Evidence</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">Direct ticket evidence and evidence inherited from linked executions.</p>
            </div>
            <div>
              {workspace.evidence.map((item) => (
                <div key={item.id} className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-5 py-4 last:border-b-0">
                  <IconFile size={18} className="text-[var(--muted)]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[var(--foreground)]">{item.fileName}</div>
                    <div className="mt-1 text-xs text-[var(--muted)]">
                      {item.evidenceKind || item.contentType} · {bytes(item.fileSize)} · {item.sourceType}
                      {item.runHumanId ? ` · ${item.runHumanId}` : ""}
                      {item.testcaseHumanId ? ` · ${item.testcaseHumanId}` : ""}
                    </div>
                  </div>
                  <a
                    href={getQaTicketEvidenceDownloadUrl(projectId, humanId, item.id)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--surface-raised)]"
                    title="Download evidence"
                  >
                    <IconDownload size={16} />
                  </a>
                </div>
              ))}
              {workspace.evidence.length === 0 ? <div className="p-8 text-center text-sm text-[var(--muted)]">No evidence yet.</div> : null}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-base font-semibold text-[var(--foreground)]">Upload evidence</h2>
            <div className="mt-4 space-y-3">
              <select
                value={evidenceKind}
                onChange={(e) => setEvidenceKind(e.target.value as typeof evidenceKind)}
                className="h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 text-sm"
              >
                <option value="">General attachment</option>
                <option value="screenshot">Screenshot</option>
                <option value="video">Video</option>
                <option value="trace">Trace</option>
                <option value="log">Log</option>
              </select>
              <input
                type="file"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
                className="block w-full text-sm text-[var(--muted)]"
              />
              <Button
                className="w-full"
                disabled={!files.length || busy === "upload"}
                onClick={() =>
                  void runAction("upload", async () => {
                    await uploadQaTicketEvidence(projectId, humanId, files, evidenceKind || undefined);
                    setFiles([]);
                  })
                }
              >
                <IconUpload size={16} />
                Upload {files.length ? `(${files.length})` : ""}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {activeTab === "comments" ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="p-5">
            <h2 className="text-base font-semibold text-[var(--foreground)]">Discussion</h2>
            <div className="mt-4 space-y-4">
              {workspace.comments.map((item) => (
                <div key={item.id} className="rounded-xl border border-[var(--border-subtle)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-medium text-[var(--foreground)]">{item.authorName || item.authorEmail || item.source}</div>
                    <div className="text-[11px] text-[var(--muted-soft)]">{fmt(item.createdAt)}</div>
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">{item.body}</div>
                </div>
              ))}
              {workspace.comments.length === 0 ? <div className="text-sm text-[var(--muted)]">No comments yet.</div> : null}
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="text-base font-semibold text-[var(--foreground)]">Add comment</h2>
            <Textarea className="mt-4 min-h-32" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add QA context, reproduction notes or retest observations…" />
            <Button
              className="mt-3 w-full"
              disabled={!comment.trim() || busy === "comment"}
              onClick={() =>
                void runAction("comment", async () => {
                  await addQaTicketComment(projectId, humanId, comment.trim());
                  setComment("");
                })
              }
            >
              <IconMessage size={16} />
              Add comment
            </Button>
          </Card>
        </div>
      ) : null}

      {activeTab === "activity" ? (
        <Card className="overflow-hidden">
          {workspace.activity.map((item) => (
            <div key={item.id} className="border-b border-[var(--border-subtle)] px-5 py-4 last:border-b-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium text-[var(--foreground)]">{item.action.replaceAll("_", " ")}</div>
                <div className="text-xs text-[var(--muted-soft)]">{fmt(item.createdAt)}</div>
              </div>
              <div className="mt-1 text-xs text-[var(--muted)]">
                {item.actorName || item.actorEmail || item.actorType || "System"}
              </div>
              {item.diff ? (
                <pre className="mt-3 overflow-x-auto rounded-lg bg-[var(--surface-raised)] p-3 text-[11px] text-[var(--muted)]">{JSON.stringify(item.diff, null, 2)}</pre>
              ) : null}
            </div>
          ))}
          {workspace.activity.length === 0 ? <div className="p-8 text-center text-sm text-[var(--muted)]">No activity yet.</div> : null}
        </Card>
      ) : null}

      {activeTab === "analysis" ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--foreground)]">ChatGPT-ready analysis context</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Factual context only. Root cause remains unknown unless evidence supports it.
                </p>
              </div>
              <Button
                variant="secondary"
                disabled={busy === "analysis"}
                onClick={async () => {
                  setBusy("analysis");
                  setError(null);
                  try {
                    setAnalysis(await getQaTicketAnalysisContext(projectId, humanId));
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not prepare analysis context.");
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                <IconBrain size={16} />
                Prepare context
              </Button>
            </div>
            {analysis ? (
              <div className="mt-5 space-y-4">
                {analysis.attention.length ? (
                  <div className="rounded-xl border border-[var(--warning)]/30 bg-[var(--warning-soft)] p-4">
                    <div className="text-sm font-semibold text-[var(--foreground)]">Attention</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
                      {analysis.attention.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                ) : (
                  <div className="rounded-xl border border-[var(--success)]/30 bg-[var(--success-soft)] p-4 text-sm text-[var(--muted)]">
                    No structural traceability warnings were detected.
                  </div>
                )}
                <pre className="max-h-[520px] overflow-auto rounded-xl bg-[var(--surface-raised)] p-4 text-xs text-[var(--muted)]">{JSON.stringify(analysis, null, 2)}</pre>
              </div>
            ) : (
              <div className="mt-8 text-sm text-[var(--muted)]">
                Use this context from ChatGPT through MCP with <span className="font-mono text-[var(--foreground)]">get_ticket_analysis_context</span>.
              </div>
            )}
          </Card>
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">MCP workflow</h3>
            <div className="mt-3 space-y-3 text-sm leading-6 text-[var(--muted)]">
              <p><span className="font-mono text-[var(--foreground)]">get_ticket_workspace</span> reads the complete ticket workspace.</p>
              <p><span className="font-mono text-[var(--foreground)]">get_ticket_traceability</span> returns the governed QA graph.</p>
              <p><span className="font-mono text-[var(--foreground)]">attach_ticket_evidence</span> accepts small evidence files through MCP.</p>
              <p><span className="font-mono text-[var(--foreground)]">get_ticket_analysis_context</span> prepares fact-grounded analysis input without mutating the ticket.</p>
            </div>
          </Card>
        </div>
      ) : null}

      <div className="text-xs text-[var(--muted-soft)]">
        Need the legacy defect board? <Link className="text-[var(--accent-light)] hover:underline" href={`/projects/${projectId}/bugs`}>Open Bugs</Link>
      </div>
    </StandardPageLayout>
  );
}
