"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { IconRefresh } from "@tabler/icons-react";
import {
  getQaTicketFailureIntelligence,
  type QaFailureIntelligence,
} from "@/lib/api";
import { Button, Card } from "@/components/ui";

export default function QaFailureIntelligencePanel({
  projectId,
  ticketRef,
}: {
  projectId: string;
  ticketRef: string;
}) {
  const [data, setData] = useState<QaFailureIntelligence | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await getQaTicketFailureIntelligence(projectId, ticketRef));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load failure intelligence.");
    } finally {
      setBusy(false);
    }
  }, [projectId, ticketRef]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        {error ? (
          <Card className="border-[var(--error)]/30 p-4 text-sm text-[var(--status-fail-text)]">{error}</Card>
        ) : null}

        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[var(--foreground)]">Failure intelligence</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Latest failed/blocked executions with previous-run state, step outcomes and evidence counts.
              </p>
            </div>
            <Button variant="secondary" disabled={busy} onClick={() => void load()}>
              <IconRefresh size={16} />
              Refresh
            </Button>
          </div>

          {data?.attention?.length ? (
            <div className="mt-4 rounded-xl border border-[var(--warning)]/30 bg-[var(--warning-soft)] p-4">
              <div className="text-sm font-semibold text-[var(--foreground)]">Attention</div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
                {data.attention.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ) : null}

          <div className="mt-5 space-y-4">
            {data?.failures?.map((item) => {
              const executionHref =
                "/projects/" +
                projectId +
                "/cycles/" +
                String(data.current?.cycleId || "") +
                "/execute/" +
                item.current.executionId;
              return (
                <div key={item.testcaseId} className="rounded-xl border border-[var(--border-subtle)] p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="font-mono text-xs font-semibold text-[var(--accent-light)]">
                        {item.testcaseHumanId || item.testcaseExternalId || item.testcaseId}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-[var(--foreground)]">{item.title}</div>
                      <div className="mt-1 text-xs text-[var(--muted)]">
                        {(item.previous?.status || "No previous result") +
                          " → " +
                          item.current.status +
                          " · " +
                          item.change}
                      </div>
                    </div>
                    <Link href={executionHref} className="text-xs font-medium text-[var(--accent-light)] hover:underline">
                      Open execution
                    </Link>
                  </div>

                  {item.current.errorMessage ? (
                    <div className="mt-3 rounded-lg bg-[var(--error-soft)] p-3 text-sm text-[var(--status-fail-text)]">
                      {item.current.errorMessage}
                    </div>
                  ) : null}

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-[var(--surface-raised)] p-2 text-xs text-[var(--muted)]">
                      Evidence <span className="ml-1 font-semibold text-[var(--foreground)]">{item.current.evidenceCount || 0}</span>
                    </div>
                    <div className="rounded-lg bg-[var(--surface-raised)] p-2 text-xs text-[var(--muted)]">
                      Failed steps <span className="ml-1 font-semibold text-[var(--foreground)]">{item.current.stepFailed || 0}</span>
                    </div>
                    <div className="rounded-lg bg-[var(--surface-raised)] p-2 text-xs text-[var(--muted)]">
                      Blocked steps <span className="ml-1 font-semibold text-[var(--foreground)]">{item.current.stepBlocked || 0}</span>
                    </div>
                  </div>

                  {item.steps?.length ? (
                    <div className="mt-4 space-y-2">
                      {item.steps.map((step) => (
                        <div
                          key={String(step.stepNumber) + ":" + step.action}
                          className="rounded-lg border border-[var(--border-subtle)] p-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-[var(--foreground)]">
                              {step.stepNumber}. {step.action}
                            </div>
                            <span className="text-xs font-semibold text-[var(--muted)]">{step.status}</span>
                          </div>
                          {step.expectedResult ? (
                            <div className="mt-1 text-xs text-[var(--muted)]">Expected: {step.expectedResult}</div>
                          ) : null}
                          {step.actualResult ? (
                            <div className="mt-1 text-xs text-[var(--muted)]">Actual: {step.actualResult}</div>
                          ) : null}
                          {step.errorMessage ? (
                            <div className="mt-1 text-xs text-[var(--status-fail-text)]">{step.errorMessage}</div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}

            {data && data.failures.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border-subtle)] p-8 text-center text-sm text-[var(--muted)]">
                The latest governed retest has no Failed or Blocked executions.
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">ChatGPT analysis contract</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Failure intelligence is evidence-first. It exposes comparisons, step outcomes and evidence metadata without turning a hypothesis into a root-cause claim.
        </p>
        <div className="mt-4 rounded-lg bg-[var(--surface-raised)] p-3 font-mono text-xs text-[var(--foreground)]">
          get_ticket_failure_intelligence
        </div>
        {data?.analysisGuidance?.length ? (
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-[var(--muted)]">
            {data.analysisGuidance.map((item) => <li key={item}>{item}</li>)}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
