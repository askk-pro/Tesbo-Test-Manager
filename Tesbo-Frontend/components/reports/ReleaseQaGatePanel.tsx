"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconChecks, IconRefresh, IconShieldCheck, IconShieldX } from "@tabler/icons-react";
import {
  decideReleaseQaGate,
  evaluateReleaseQaGate,
  getLatestReleaseQaGate,
  listReleaseQaGateCandidates,
  type ReleaseQaGateCandidate,
} from "@/lib/api";
import { Button } from "@/components/ui";

type GateState = Awaited<ReturnType<typeof getLatestReleaseQaGate>>;

function stateLabel(value: GateState["effectiveState"]): string {
  return value.replaceAll("_", " ");
}

export function ReleaseQaGatePanel({ projectId, canApprove }: { projectId: string; canApprove: boolean }) {
  const [candidates, setCandidates] = useState<ReleaseQaGateCandidate[]>([]);
  const [selection, setSelection] = useState("");
  const [environment, setEnvironment] = useState("");
  const [state, setState] = useState<GateState | null>(null);
  const [busy, setBusy] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => {
    const index = Number(selection);
    return Number.isInteger(index) && index >= 0 ? candidates[index] || null : null;
  }, [candidates, selection]);

  const loadLatest = useCallback(async (candidate: ReleaseQaGateCandidate | null, env: string) => {
    if (!candidate) {
      setState(null);
      return;
    }
    setError(null);
    try {
      setState(await getLatestReleaseQaGate(projectId, candidate.releaseName, candidate.buildVersion, env));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the release QA gate.");
    }
  }, [projectId]);

  const loadCandidates = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const list = await listReleaseQaGateCandidates(projectId);
      setCandidates(list);
      if (list.length) {
        setSelection("0");
        setEnvironment("");
        await loadLatest(list[0], "");
      } else {
        setSelection("");
        setState(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load release/build candidates.");
    } finally {
      setBusy(false);
    }
  }, [loadLatest, projectId]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  const evaluate = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await evaluateReleaseQaGate(projectId, {
        releaseName: selected.releaseName,
        buildVersion: selected.buildVersion,
        ...(environment ? { environment } : {}),
      });
      await loadLatest(selected, environment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not evaluate the release QA gate.");
    } finally {
      setBusy(false);
    }
  }, [environment, loadLatest, projectId, selected]);

  const decide = useCallback(async (decision: "approved" | "rejected") => {
    if (!state?.gate) return;
    setDecisionBusy(true);
    setError(null);
    try {
      await decideReleaseQaGate(projectId, state.gate.id, { decision, ...(note.trim() ? { note: note.trim() } : {}) });
      if (selected) await loadLatest(selected, environment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the human release decision.");
    } finally {
      setDecisionBusy(false);
    }
  }, [environment, loadLatest, note, projectId, selected, state?.gate]);

  const gate = state?.gate || null;
  const metrics = gate?.evidenceSnapshot?.metrics;
  const approvalDisabled = !canApprove || !gate || state?.stale || gate.readiness !== "ready_for_approval" || decisionBusy;

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <IconShieldCheck size={16} className="text-[var(--accent-light)]" />
              <span className="text-[13px] font-semibold text-[var(--foreground)]">Release QA gate</span>
              <span className="rounded-full bg-[var(--ai-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ai-primary)]">Phase 4</span>
            </div>
            <p className="mt-1 max-w-3xl text-[11px] leading-5 text-[var(--muted-soft)]">
              Readiness is computed from test-run and QA-ticket facts. AI does not approve releases. Approval or rejection is a separate human action bound to the exact evidence digest.
            </p>
          </div>
          <Button variant="secondary" disabled={busy} onClick={() => void loadCandidates()}>
            <IconRefresh size={15} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {error ? (
          <div className="rounded-lg border border-[var(--error)]/30 bg-[var(--error-soft)] p-3 text-xs text-[var(--status-fail-text)]">{error}</div>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto]">
          <label className="text-xs text-[var(--muted)]">
            Release / build
            <select
              value={selection}
              onChange={(event) => {
                const value = event.target.value;
                const candidate = candidates[Number(value)] || null;
                setSelection(value);
                setEnvironment("");
                void loadLatest(candidate, "");
              }}
              className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--foreground)] outline-none"
            >
              {candidates.length === 0 ? <option value="">No release/build runs yet</option> : null}
              {candidates.map((candidate, index) => (
                <option key={candidate.releaseName + ":" + candidate.buildVersion} value={String(index)}>
                  {candidate.releaseName} · {candidate.buildVersion} · {candidate.completedRunCount}/{candidate.runCount} completed
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-[var(--muted)]">
            Environment
            <select
              value={environment}
              disabled={!selected}
              onChange={(event) => {
                const value = event.target.value;
                setEnvironment(value);
                void loadLatest(selected, value);
              }}
              className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--foreground)] outline-none"
            >
              <option value="">All environments</option>
              {(selected?.environments || []).filter(Boolean).map((env) => <option key={env} value={env}>{env}</option>)}
            </select>
          </label>

          <div className="flex items-end">
            <Button disabled={!selected || busy} onClick={() => void evaluate()}>
              <IconChecks size={15} />
              {busy ? "Evaluating…" : "Evaluate gate"}
            </Button>
          </div>
        </div>

        {gate ? (
          <>
            <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
              {[
                ["Runs", metrics?.matchedRuns ?? 0],
                ["Passed", metrics?.passed ?? 0],
                ["Failed", metrics?.failed ?? 0],
                ["Blocked", metrics?.blocked ?? 0],
                ["Pending", metrics?.pending ?? 0],
                ["Flaky", metrics?.highConfidenceFlaky ?? 0],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg bg-[var(--surface-raised)] p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-soft)]">{label}</div>
                  <div className="mt-1 text-lg font-bold text-[var(--foreground)]">{value}</div>
                </div>
              ))}
            </div>

            <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
              <div className="rounded-xl border border-[var(--border-subtle)] p-4">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-soft)]">Effective state</div>
                <div className="mt-2 text-base font-semibold capitalize text-[var(--foreground)]">{stateLabel(state?.effectiveState || gate.readiness)}</div>
                <div className="mt-2 font-mono text-[10px] text-[var(--muted-soft)]">{gate.evidenceDigest.slice(0, 18)}…</div>
                {state?.stale ? (
                  <div className="mt-3 rounded-lg bg-[var(--warning-soft)] p-2 text-xs text-[var(--warning-foreground)]">
                    Evidence changed after evaluation. Re-evaluate before any decision.
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-[var(--border-subtle)] p-4">
                  <div className="text-xs font-semibold text-[var(--foreground)]">Release blockers</div>
                  {gate.blockers.length ? (
                    <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs text-[var(--status-fail-text)]">
                      {gate.blockers.map((item) => <li key={item.code}>{item.message}{item.count != null ? " (" + item.count + ")" : ""}</li>)}
                    </ul>
                  ) : (
                    <div className="mt-2 text-xs text-[var(--success)]">No hard QA blockers in this evaluation.</div>
                  )}
                </div>
                <div className="rounded-xl border border-[var(--border-subtle)] p-4">
                  <div className="text-xs font-semibold text-[var(--foreground)]">Warnings</div>
                  {gate.warnings.length ? (
                    <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs text-[var(--warning-foreground)]">
                      {gate.warnings.map((item) => <li key={item.code}>{item.message}{item.count != null ? " (" + item.count + ")" : ""}</li>)}
                    </ul>
                  ) : (
                    <div className="mt-2 text-xs text-[var(--muted)]">No release QA warnings.</div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-xs font-semibold text-[var(--foreground)]">Human release decision</div>
                  <div className="mt-1 text-xs leading-5 text-[var(--muted)]">
                    Owner/manager approval is allowed only when readiness is ready for approval and the evidence digest is still current.
                  </div>
                </div>
                {gate.decision ? (
                  <div className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold capitalize text-[var(--foreground)]">
                    {gate.decision}
                  </div>
                ) : null}
              </div>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Decision note (optional)"
                className="mt-3 min-h-20 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--foreground)] outline-none"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button disabled={approvalDisabled} onClick={() => void decide("approved")}>
                  <IconShieldCheck size={15} />
                  Approve release
                </Button>
                <Button variant="secondary" disabled={!canApprove || !gate || state?.stale || decisionBusy} onClick={() => void decide("rejected")}>
                  <IconShieldX size={15} />
                  Reject release
                </Button>
              </div>
              {!canApprove ? <div className="mt-2 text-[11px] text-[var(--muted-soft)]">Only a project owner or manager can record the human release decision.</div> : null}
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--border-subtle)] p-7 text-center text-sm text-[var(--muted)]">
            Select a release/build and evaluate it to create the first evidence-bound QA gate.
          </div>
        )}
      </div>
    </div>
  );
}
