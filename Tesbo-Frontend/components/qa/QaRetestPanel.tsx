"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { IconCircleCheck, IconRefresh } from "@tabler/icons-react";
import {
  decideQaTicketRetest,
  getQaTicketRetestComparison,
  listQaTicketRetests,
  type QaRetestComparison,
  type QaTicketRetest,
} from "@/lib/api";
import { Button, Card, StatusChip, Textarea } from "@/components/ui";

function fmt(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

export default function QaRetestPanel({
  projectId,
  ticketRef,
  onChanged,
}: {
  projectId: string;
  ticketRef: string;
  onChanged?: () => Promise<void> | void;
}) {
  const [retests, setRetests] = useState<QaTicketRetest[]>([]);
  const [comparison, setComparison] = useState<QaRetestComparison | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const list = await listQaTicketRetests(projectId, ticketRef);
    setRetests(list);
    if (list.length) {
      const ref = list[0].runHumanId || list[0].cycleId;
      setComparison(await getQaTicketRetestComparison(projectId, ticketRef, ref));
    } else {
      setComparison(null);
    }
  }, [projectId, ticketRef]);

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load retest history.")
    );
  }, [load]);

  async function evaluate(retest: QaTicketRetest) {
    setBusy(true);
    setError(null);
    try {
      await decideQaTicketRetest(
        projectId,
        ticketRef,
        retest.runHumanId || retest.cycleId,
        { decision: "auto", note: decisionNote.trim() || undefined }
      );
      setDecisionNote("");
      await load();
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not evaluate retest.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {error ? (
        <Card className="border-[var(--error)]/30 p-4 text-sm text-[var(--status-fail-text)]">
          {error}
        </Card>
      ) : null}

      <Card className="p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">Retest lifecycle</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Every retest is a normal governed test run. The final ticket decision is computed from stored execution results.
            </p>
          </div>
          <Button variant="secondary" disabled={busy} onClick={() => void load()}>
            <IconRefresh size={16} />
            Refresh retests
          </Button>
        </div>

        <div className="mt-5 space-y-3">
          {retests.map((retest, index) => {
            const complete = retest.total > 0 && retest.pending === 0;
            const latest = index === 0;
            const runHref = "/projects/" + projectId + "/cycles/" + retest.cycleId;
            return (
              <div key={retest.id} className="rounded-xl border border-[var(--border-subtle)] p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={runHref}
                        className="font-mono text-xs font-semibold text-[var(--accent-light)] hover:underline"
                      >
                        {retest.runHumanId || retest.cycleId}
                      </Link>
                      {latest ? (
                        <span className="rounded bg-[var(--brand-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--accent-light)]">
                          Latest
                        </span>
                      ) : null}
                      <StatusChip>
                        {retest.decision === "pending" ? retest.runStatus || "Pending" : retest.decision}
                      </StatusChip>
                      <span className="text-xs text-[var(--muted-soft)]">{retest.source || "manual"}</span>
                    </div>
                    <div className="mt-1 text-sm font-medium text-[var(--foreground)]">
                      {retest.runName || "Retest run"}
                    </div>
                    <div className="mt-1 text-xs text-[var(--muted)]">
                      {retest.environment || "Environment not set"}
                      {retest.buildVersion ? " · build " + retest.buildVersion : ""}
                      {retest.createdAt ? " · " + fmt(retest.createdAt) : ""}
                    </div>
                  </div>

                  <div className="grid grid-cols-5 gap-2 text-center">
                    {[
                      ["Total", retest.total],
                      ["Pass", retest.passed],
                      ["Fail", retest.failed],
                      ["Blocked", retest.blocked],
                      ["Pending", retest.pending],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-lg bg-[var(--surface-raised)] px-2 py-2">
                        <div className="text-[10px] uppercase text-[var(--muted-soft)]">{label}</div>
                        <div className="mt-0.5 text-sm font-semibold text-[var(--foreground)]">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {latest && retest.decision === "pending" ? (
                  <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
                    <Textarea
                      value={decisionNote}
                      onChange={(e) => setDecisionNote(e.target.value)}
                      rows={2}
                      placeholder="Optional retest decision note…"
                    />
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-[var(--muted)]">
                        {complete
                          ? "Results are complete. Evaluation computes Passed / Failed / Blocked and updates the ticket."
                          : "Evaluation stays locked until every execution has a final result."}
                      </p>
                      <Button disabled={!complete || busy} onClick={() => void evaluate(retest)}>
                        <IconCircleCheck size={16} />
                        Evaluate retest
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}

          {retests.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border-subtle)] p-8 text-center text-sm text-[var(--muted)]">
              No governed retest has been created for this ticket yet.
            </div>
          ) : null}
        </div>
      </Card>

      {comparison?.current ? (
        <Card className="overflow-hidden">
          <div className="border-b border-[var(--border-subtle)] px-5 py-4">
            <h2 className="text-base font-semibold text-[var(--foreground)]">Previous vs current run</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {(comparison.previous?.runHumanId || "No previous governed retest") +
                " → " +
                (comparison.current.runHumanId || "Current run")}
            </p>
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {comparison.items.map((item) => (
              <div
                key={item.testcaseId}
                className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_130px_130px_110px] lg:items-center"
              >
                <div className="min-w-0">
                  <div className="font-mono text-xs font-semibold text-[var(--accent-light)]">
                    {item.testcaseHumanId || item.testcaseExternalId || item.testcaseId}
                  </div>
                  <div className="mt-1 truncate text-sm font-medium text-[var(--foreground)]">{item.title}</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    {(item.current.stepTotal || 0) + " steps · " + (item.current.evidenceCount || 0) + " evidence"}
                  </div>
                </div>
                <div className="text-sm text-[var(--muted)]">
                  <span className="text-[11px] uppercase text-[var(--muted-soft)]">Previous</span>
                  <div className="mt-1 font-medium text-[var(--foreground)]">{item.previous?.status || "—"}</div>
                </div>
                <div className="text-sm text-[var(--muted)]">
                  <span className="text-[11px] uppercase text-[var(--muted-soft)]">Current</span>
                  <div className="mt-1 font-medium text-[var(--foreground)]">{item.current.status}</div>
                </div>
                <div>
                  <span className="rounded-full border border-[var(--border-subtle)] px-2.5 py-1 text-xs font-medium capitalize text-[var(--foreground)]">
                    {item.change}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
