"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { IconBrain, IconRefresh, IconRepeat, IconSparkles } from "@tabler/icons-react";
import {
  analyzeQaTicketFailure,
  getQaTicketFailureTriage,
  type QaFailureAiSnapshot,
  type QaFailureClassification,
  type QaFailureTriage,
} from "@/lib/api";
import { Button, Card } from "@/components/ui";

function classificationLabel(value: QaFailureClassification): string {
  switch (value) {
    case "flaky":
      return "Flaky";
    case "deterministic":
      return "Deterministic";
    case "stable_pass":
      return "Stable pass";
    case "insufficient_history":
      return "Needs history";
    default:
      return "Unknown";
  }
}

function classificationClass(value: QaFailureClassification): string {
  if (value === "deterministic") return "border-[var(--error)]/30 bg-[var(--error-soft)] text-[var(--status-fail-text)]";
  if (value === "flaky") return "border-[var(--warning)]/30 bg-[var(--warning-soft)] text-[var(--warning-foreground)]";
  if (value === "stable_pass") return "border-[var(--success)]/30 bg-[var(--success-soft)] text-[var(--success)]";
  return "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--muted)]";
}

function AiAnalysis({ snapshot }: { snapshot: QaFailureAiSnapshot | null }) {
  if (!snapshot) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border-subtle)] p-5 text-sm text-[var(--muted)]">
        No AI hypothesis snapshot has been generated for this ticket yet. The deterministic triage above remains available without AI.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {snapshot.evidenceSnapshot?.summary ? (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4 text-sm leading-6 text-[var(--foreground)]">
          {snapshot.evidenceSnapshot.summary}
        </div>
      ) : null}
      {snapshot.hypotheses?.length ? (
        <div className="space-y-3">
          {snapshot.hypotheses.map((hypothesis, index) => (
            <div key={snapshot.id + ":" + index} className="rounded-xl border border-[var(--border-subtle)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-[var(--foreground)]">Hypothesis {index + 1}</span>
                <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {hypothesis.confidence} confidence
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--foreground)]">{hypothesis.hypothesis}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {hypothesis.evidenceRefs.map((ref) => (
                  <span key={ref} className="rounded-md bg-[var(--surface-raised)] px-2 py-1 font-mono text-[10px] text-[var(--muted)]">
                    {ref}
                  </span>
                ))}
              </div>
              {hypothesis.missingEvidence?.length ? (
                <div className="mt-3 text-xs text-[var(--muted)]">
                  Missing evidence: {hypothesis.missingEvidence.join(" · ")}
                </div>
              ) : null}
              {hypothesis.recommendedChecks?.length ? (
                <div className="mt-3 text-xs text-[var(--muted)]">
                  Checks: {hypothesis.recommendedChecks.join(" · ")}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-[var(--muted)]">The model returned no hypothesis that survived evidence-reference validation.</div>
      )}
      <div className="text-[11px] text-[var(--muted-soft)]">
        Generated with {snapshot.provider || "configured AI"}{snapshot.model ? " · " + snapshot.model : ""}. Hypotheses are not root-cause findings.
      </div>
    </div>
  );
}

export default function QaFailureIntelligencePanel({
  projectId,
  ticketRef,
}: {
  projectId: string;
  ticketRef: string;
}) {
  const [data, setData] = useState<QaFailureTriage | null>(null);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await getQaTicketFailureTriage(projectId, ticketRef));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load failure triage.");
    } finally {
      setBusy(false);
    }
  }, [projectId, ticketRef]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeAnalysis = useMemo(
    () => data?.generatedAnalysis || data?.latestAiAnalysis || null,
    [data]
  );

  const analyze = useCallback(async () => {
    setAnalyzing(true);
    setError(null);
    setAiNotice(null);
    try {
      const result = await analyzeQaTicketFailure(projectId, ticketRef);
      setData(result);
      if (result.ai && !result.ai.available) {
        setAiNotice(result.ai.reason || "No AI key is allocated to this project. Deterministic triage is still available.");
      } else {
        setAiNotice("A new evidence-grounded hypothesis snapshot was created.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not analyze this failure.");
    } finally {
      setAnalyzing(false);
    }
  }, [projectId, ticketRef]);

  return (
    <div className="space-y-5">
      {error ? (
        <Card className="border-[var(--error)]/30 p-4 text-sm text-[var(--status-fail-text)]">{error}</Card>
      ) : null}
      {aiNotice ? (
        <Card className="border-[var(--info)]/30 p-4 text-sm text-[var(--muted)]">{aiNotice}</Card>
      ) : null}

      <Card className="p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <IconBrain size={18} className="text-[var(--accent-light)]" />
              <h2 className="text-base font-semibold text-[var(--foreground)]">Failure triage</h2>
              <span className="rounded-full bg-[var(--surface-raised)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted)]">
                Phase 4
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              Failure signatures, execution history and flake classification are computed from stored evidence. AI hypotheses are kept separate below.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => void load()}>
              <IconRefresh size={16} />
              Refresh
            </Button>
            <Button variant="secondary" disabled={analyzing || !data?.triage?.length} onClick={() => void analyze()}>
              <IconSparkles size={16} />
              {analyzing ? "Analyzing…" : "Analyze with AI"}
            </Button>
          </div>
        </div>

        {data?.attention?.length ? (
          <div className="mt-4 rounded-xl border border-[var(--warning)]/30 bg-[var(--warning-soft)] p-4">
            <div className="text-sm font-semibold text-[var(--foreground)]">Evidence attention</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
              {data.attention.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        ) : null}

        <div className="mt-5 space-y-4">
          {data?.triage?.map((item) => {
            const executionHref = item.currentRunId && item.currentExecutionId
              ? "/projects/" + projectId + "/cycles/" + item.currentRunId + "/execute/" + item.currentExecutionId
              : null;
            return (
              <div key={item.testcaseId} className="rounded-xl border border-[var(--border-subtle)] p-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-semibold text-[var(--accent-light)]">
                      {item.testcaseHumanId || item.testcaseExternalId || item.testcaseId}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-[var(--foreground)]">{item.title}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={"rounded-full border px-2 py-0.5 text-[11px] font-semibold " + classificationClass(item.classification)}>
                        {classificationLabel(item.classification)}
                      </span>
                      <span className="text-xs text-[var(--muted)]">Flake score {item.flakeScore}/100</span>
                      <span className="text-xs text-[var(--muted)]">· {item.metrics.settledRuns} settled runs</span>
                      <span className="text-xs text-[var(--muted)]">· {item.metrics.flips} flips</span>
                    </div>
                  </div>
                  {executionHref ? (
                    <Link href={executionHref} className="shrink-0 text-xs font-medium text-[var(--accent-light)] hover:underline">
                      Open current execution
                    </Link>
                  ) : null}
                </div>

                <div className="mt-4 grid gap-2 md:grid-cols-3">
                  <div className="rounded-lg bg-[var(--surface-raised)] p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-soft)]">Failure signature</div>
                    <div className="mt-1 truncate font-mono text-xs text-[var(--foreground)]">{item.failureSignature.slice(0, 16)}…</div>
                    <div className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">{item.signatureLabel}</div>
                  </div>
                  <div className="rounded-lg bg-[var(--surface-raised)] p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-soft)]">Probable subsystem</div>
                    <div className="mt-1 text-sm font-medium text-[var(--foreground)]">{item.probableSubsystem.name}</div>
                    <div className="mt-1 text-xs text-[var(--muted)]">Derived from {item.probableSubsystem.source}</div>
                  </div>
                  <div className="rounded-lg bg-[var(--surface-raised)] p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-soft)]">Probable owner</div>
                    <div className="mt-1 text-sm font-medium text-[var(--foreground)]">{item.probableOwner.name || "Unassigned"}</div>
                    <div className="mt-1 text-xs text-[var(--muted)]">Derived from {item.probableOwner.source}</div>
                  </div>
                </div>

                <div className="mt-3 rounded-lg border border-[var(--border-subtle)] p-3">
                  <div className="flex items-start gap-2">
                    <IconRepeat size={16} className="mt-0.5 shrink-0 text-[var(--accent-light)]" />
                    <div>
                      <div className="text-xs font-semibold text-[var(--foreground)]">
                        Rerun recommendation · {item.rerunRecommendation.strategy}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-[var(--muted)]">{item.rerunRecommendation.reason}</div>
                      {item.rerunRecommendation.capture.length ? (
                        <div className="mt-1 text-[11px] text-[var(--muted-soft)]">
                          Capture: {item.rerunRecommendation.capture.join(", ")}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="mt-3 overflow-x-auto">
                  <div className="flex min-w-max gap-2">
                    {item.history.slice(-8).map((row, index) => (
                      <div key={(row.executionId || String(index)) + ":" + index} className="min-w-[130px] rounded-lg border border-[var(--border-subtle)] px-3 py-2">
                        <div className="font-mono text-[10px] text-[var(--muted-soft)]">{row.runHumanId || row.runName || "Run"}</div>
                        <div className="mt-1 text-xs font-semibold text-[var(--foreground)]">{row.status || "Unknown"}</div>
                        <div className="mt-1 text-[10px] text-[var(--muted)]">retry {row.retryCount || 0}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}

          {data && data.triage.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border-subtle)] p-8 text-center text-sm text-[var(--muted)]">
              The latest governed retest has no Failed or Blocked executions to triage.
            </div>
          ) : null}
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Evidence clusters</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">Repeated normalized signatures across recent testcase history.</p>
          <div className="mt-4 space-y-2">
            {data?.clusters?.map((cluster) => (
              <div key={cluster.signature} className="rounded-xl border border-[var(--border-subtle)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[var(--foreground)]">{cluster.label}</div>
                    <div className="mt-1 font-mono text-[10px] text-[var(--muted-soft)]">{cluster.signature.slice(0, 18)}…</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-bold text-[var(--foreground)]">{cluster.occurrenceCount}</div>
                    <div className="text-[10px] text-[var(--muted)]">{cluster.testcaseCount} testcase{cluster.testcaseCount === 1 ? "" : "s"}</div>
                  </div>
                </div>
              </div>
            ))}
            {data && data.clusters.length === 0 ? <div className="text-sm text-[var(--muted)]">No repeated failure clusters yet.</div> : null}
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Governance</h3>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-5 text-[var(--muted)]">
            <li>Flake classification requires at least {data?.triageRules.flakeMinimumSettledRuns || 3} settled runs.</li>
            <li>Subsystem and owner are derived from stored suite/assignment data, not guessed by AI.</li>
            <li>AI hypotheses must cite exact execution, step, run or evidence references.</li>
            <li>AI never approves a release; human release approval is a separate governed action.</li>
          </ul>
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex items-center gap-2">
          <IconSparkles size={17} className="text-[var(--ai-primary)]" />
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Source-grounded AI hypotheses</h3>
        </div>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          This is a hypothesis layer over deterministic observations. Unsupported model citations are discarded before storage.
        </p>
        <div className="mt-4">
          <AiAnalysis snapshot={activeAnalysis} />
        </div>
      </Card>
    </div>
  );
}
