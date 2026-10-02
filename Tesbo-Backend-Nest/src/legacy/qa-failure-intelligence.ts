import { createHash } from "crypto";

export type ExecutionHistoryStatus = "Passed" | "Failed" | "Blocked" | "Skipped" | "Untested" | "Retest" | string;

export interface FailureStepInput {
  stepNumber?: number | null;
  action?: string | null;
  status?: string | null;
  actualResult?: string | null;
  errorMessage?: string | null;
}

export interface FailureExecutionInput {
  executionId?: string | null;
  runId?: string | null;
  runHumanId?: string | null;
  runName?: string | null;
  status?: ExecutionHistoryStatus | null;
  errorMessage?: string | null;
  errorStack?: string | null;
  actualResult?: string | null;
  retryCount?: number | null;
  executedAt?: string | null;
  steps?: FailureStepInput[] | null;
}

export interface FailureSignature {
  signature: string;
  label: string;
  normalized: string;
  signalCount: number;
}

export interface FlakeClassification {
  classification: "flaky" | "deterministic" | "stable_pass" | "insufficient_history" | "unknown";
  flakeScore: number;
  settledRuns: number;
  passedRuns: number;
  failedRuns: number;
  blockedRuns: number;
  flips: number;
  flipRate: number;
  retryPassObserved: boolean;
  currentSignatureOccurrences: number;
  failureSignatureCount: number;
  rerunRecommendation: {
    shouldRerun: boolean;
    count: number;
    strategy: "same-build-isolated" | "after-change-targeted" | "single-targeted" | "none";
    reason: string;
    capture: string[];
  };
}

export interface FailureCluster {
  signature: string;
  label: string;
  occurrenceCount: number;
  testcaseCount: number;
  firstSeen: string | null;
  lastSeen: string | null;
  executionIds: string[];
  runIds: string[];
}

export interface ReleaseGateEvidence {
  matchedRuns: number;
  completedRuns: number;
  incompleteRuns: number;
  totalExecutions: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  pending: number;
  openCriticalHighTickets: number;
  openP0P1Tickets: number;
  highConfidenceFlaky: number;
  deterministicFailures: number;
}

export interface ReleaseGateEvaluation {
  readiness: "blocked" | "ready_for_approval";
  blockers: Array<{ code: string; message: string; count?: number }>;
  warnings: Array<{ code: string; message: string; count?: number }>;
}

const FAILURE_STATUSES = new Set(["Failed", "Blocked"]);
const SETTLED_FOR_FLAKE = new Set(["Passed", "Failed", "Blocked"]);

function encodeHttpStatus(code: string): string {
  const alphabet = ["z", "o", "t", "h", "f", "v", "s", "e", "i", "n"];
  return code
    .split("")
    .map((digit) => alphabet[Number(digit)] || "x")
    .join("");
}

export function normalizeFailureText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b[0-9a-f]{12,64}\b/gi, "<hex>")
    .replace(/\b\d{4}-\d{2}-\d{2}[t ][0-9:.+-z]+\b/gi, "<timestamp>")
    // Preserve semantically meaningful HTTP/status-code differences while still normalizing
    // volatile request/order IDs, durations, line numbers and other ordinary numeric values.
    .replace(/\b(http|status(?:\s+code)?|got|expected)\s*[:=]?\s*([1-5]\d{2})\b/g, (_m, prefix, code) => {
      return prefix + " <http-" + encodeHttpStatus(code) + ">";
    })
    .replace(/\b\d+\b/g, "<n>")
    .replace(/(?:[a-z]:)?(?:[\\/][^\s:()]+){2,}/gi, "<path>")
    .replace(/\s+/g, " ")
    .trim();
}

function compactStack(value: unknown): string {
  const lines = String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/node_modules|internal\/|node:internal/i.test(line))
    .slice(0, 6);
  return normalizeFailureText(lines.join(" | "));
}

export function failureSignatureFor(input: FailureExecutionInput): FailureSignature {
  const steps = (input.steps || [])
    .filter((step) => FAILURE_STATUSES.has(String(step.status || "")))
    .slice(0, 12);

  const signals = [
    normalizeFailureText(input.errorMessage),
    compactStack(input.errorStack),
    ...steps.flatMap((step) => [
      normalizeFailureText(step.action),
      normalizeFailureText(step.errorMessage),
      normalizeFailureText(step.actualResult),
    ]),
  ].filter(Boolean);

  const normalized = signals.length
    ? signals.join(" | ")
    : `status:${normalizeFailureText(input.status || "unknown")}|no-diagnostics`;
  const signature = createHash("sha256").update(normalized).digest("hex");
  const firstDiagnostic =
    normalizeFailureText(input.errorMessage) ||
    steps.map((step) => normalizeFailureText(step.errorMessage)).find(Boolean) ||
    steps.map((step) => normalizeFailureText(step.action)).find(Boolean) ||
    String(input.status || "Failure");

  return {
    signature,
    label: String(firstDiagnostic || "Failure").slice(0, 180),
    normalized,
    signalCount: signals.length,
  };
}

function rerunFor(classification: FlakeClassification["classification"]): FlakeClassification["rerunRecommendation"] {
  switch (classification) {
    case "flaky":
      return {
        shouldRerun: true,
        count: 3,
        strategy: "same-build-isolated",
        reason: "Result history alternates between pass and failure. Re-run the same case in isolation on the same build before changing the product.",
        capture: ["trace", "video", "log"],
      };
    case "deterministic":
      return {
        shouldRerun: false,
        count: 1,
        strategy: "after-change-targeted",
        reason: "The same failure signature repeats without a passing observation. Re-running an unchanged build adds little evidence; re-run after a code/configuration change.",
        capture: ["trace", "log"],
      };
    case "insufficient_history":
      return {
        shouldRerun: true,
        count: 1,
        strategy: "single-targeted",
        reason: "There is not enough settled execution history to distinguish intermittent from repeatable behavior.",
        capture: ["trace", "video", "log"],
      };
    case "unknown":
      return {
        shouldRerun: true,
        count: 1,
        strategy: "single-targeted",
        reason: "The available observations do not form a stable failure pattern. Capture one more targeted execution with complete diagnostics.",
        capture: ["trace", "video", "log"],
      };
    default:
      return {
        shouldRerun: false,
        count: 0,
        strategy: "none",
        reason: "Recent settled executions are passing; no failure-confirmation rerun is indicated.",
        capture: [],
      };
  }
}

export function classifyExecutionHistory(history: FailureExecutionInput[]): FlakeClassification {
  const settled = history.filter((row) => SETTLED_FOR_FLAKE.has(String(row.status || "")));
  const passed = settled.filter((row) => row.status === "Passed");
  const failed = settled.filter((row) => row.status === "Failed");
  const blocked = settled.filter((row) => row.status === "Blocked");
  const retryPassObserved = passed.some((row) => Number(row.retryCount || 0) > 0);

  let flips = 0;
  for (let i = 1; i < settled.length; i += 1) {
    const before = settled[i - 1].status === "Passed" ? "pass" : "fail";
    const after = settled[i].status === "Passed" ? "pass" : "fail";
    if (before !== after) flips += 1;
  }
  const flipRate = settled.length > 1 ? flips / (settled.length - 1) : 0;

  const failures = settled.filter((row) => FAILURE_STATUSES.has(String(row.status || "")));
  const signatures = failures.map((row) => failureSignatureFor(row).signature);
  const signatureCounts = new Map<string, number>();
  for (const signature of signatures) signatureCounts.set(signature, (signatureCounts.get(signature) || 0) + 1);
  const current = [...settled].reverse().find((row) => FAILURE_STATUSES.has(String(row.status || "")));
  const currentSignature = current ? failureSignatureFor(current).signature : null;
  const currentSignatureOccurrences = currentSignature ? signatureCounts.get(currentSignature) || 0 : 0;

  let classification: FlakeClassification["classification"];
  if (settled.length < 3) classification = "insufficient_history";
  else if (failures.length === 0) classification = "stable_pass";
  else if (passed.length > 0 && failures.length > 0) classification = "flaky";
  else if (failures.length >= 2 && currentSignatureOccurrences >= 2) classification = "deterministic";
  else classification = "unknown";

  let flakeScore = 0;
  if (classification === "flaky") {
    flakeScore = Math.min(100, Math.round(35 + flipRate * 45 + (retryPassObserved ? 20 : 0)));
  } else if (classification === "unknown") {
    flakeScore = Math.min(35, Math.round(flipRate * 35));
  } else if (classification === "insufficient_history" && retryPassObserved) {
    flakeScore = 30;
  }

  return {
    classification,
    flakeScore,
    settledRuns: settled.length,
    passedRuns: passed.length,
    failedRuns: failed.length,
    blockedRuns: blocked.length,
    flips,
    flipRate: Number(flipRate.toFixed(3)),
    retryPassObserved,
    currentSignatureOccurrences,
    failureSignatureCount: signatureCounts.size,
    rerunRecommendation: rerunFor(classification),
  };
}

export function clusterFailures(
  rows: Array<FailureExecutionInput & { testcaseId?: string | null }>,
): FailureCluster[] {
  const clusters = new Map<string, FailureCluster>();
  for (const row of rows) {
    if (!FAILURE_STATUSES.has(String(row.status || ""))) continue;
    const sig = failureSignatureFor(row);
    const existing = clusters.get(sig.signature) || {
      signature: sig.signature,
      label: sig.label,
      occurrenceCount: 0,
      testcaseCount: 0,
      firstSeen: null,
      lastSeen: null,
      executionIds: [],
      runIds: [],
    };
    existing.occurrenceCount += 1;
    if (row.executionId) existing.executionIds.push(String(row.executionId));
    if (row.runId) existing.runIds.push(String(row.runId));
    const stamp = row.executedAt ? new Date(row.executedAt).toISOString() : null;
    if (stamp && (!existing.firstSeen || stamp < existing.firstSeen)) existing.firstSeen = stamp;
    if (stamp && (!existing.lastSeen || stamp > existing.lastSeen)) existing.lastSeen = stamp;
    clusters.set(sig.signature, existing);
  }

  for (const cluster of clusters.values()) {
    const testcaseIds = new Set(
      rows
        .filter((row) => FAILURE_STATUSES.has(String(row.status || "")) && failureSignatureFor(row).signature === cluster.signature)
        .map((row) => String(row.testcaseId || ""))
        .filter(Boolean),
    );
    cluster.testcaseCount = testcaseIds.size;
    cluster.executionIds = [...new Set(cluster.executionIds)].slice(0, 50);
    cluster.runIds = [...new Set(cluster.runIds)].slice(0, 50);
  }

  return [...clusters.values()].sort((a, b) => b.occurrenceCount - a.occurrenceCount || String(b.lastSeen).localeCompare(String(a.lastSeen)));
}

export function evaluateReleaseGate(evidence: ReleaseGateEvidence): ReleaseGateEvaluation {
  const blockers: ReleaseGateEvaluation["blockers"] = [];
  const warnings: ReleaseGateEvaluation["warnings"] = [];

  if (evidence.matchedRuns === 0) blockers.push({ code: "NO_MATCHING_RUN", message: "No test run matches this release/build/environment." });
  if (evidence.completedRuns === 0 && evidence.matchedRuns > 0) blockers.push({ code: "NO_COMPLETED_RUN", message: "No matching test run is completed." });
  if (evidence.incompleteRuns > 0) blockers.push({ code: "INCOMPLETE_RUNS", message: "Matching test runs are still incomplete.", count: evidence.incompleteRuns });
  if (evidence.pending > 0) blockers.push({ code: "PENDING_EXECUTIONS", message: "Untested or retest executions remain.", count: evidence.pending });
  if (evidence.failed > 0) blockers.push({ code: "FAILED_EXECUTIONS", message: "Failed executions remain in the release evidence.", count: evidence.failed });
  if (evidence.blocked > 0) blockers.push({ code: "BLOCKED_EXECUTIONS", message: "Blocked executions remain in the release evidence.", count: evidence.blocked });
  if (evidence.openCriticalHighTickets > 0) blockers.push({ code: "OPEN_CRITICAL_HIGH_TICKETS", message: "Open/reopened Critical or High QA tickets are linked to this release evidence.", count: evidence.openCriticalHighTickets });
  if (evidence.openP0P1Tickets > 0) blockers.push({ code: "OPEN_P0_P1_TICKETS", message: "Open/reopened P0 or P1 QA tickets are linked to this release evidence.", count: evidence.openP0P1Tickets });

  if (evidence.skipped > 0) warnings.push({ code: "SKIPPED_EXECUTIONS", message: "Some release executions were skipped.", count: evidence.skipped });
  if (evidence.highConfidenceFlaky > 0) warnings.push({ code: "FLAKY_TESTS", message: "High-confidence flaky tests were observed in recent history. They do not automatically block release approval.", count: evidence.highConfidenceFlaky });
  if (evidence.deterministicFailures > 0 && evidence.failed === 0) warnings.push({ code: "HISTORICAL_DETERMINISTIC_FAILURES", message: "Deterministic failure patterns exist in recent history even though this release currently has no failed execution.", count: evidence.deterministicFailures });

  return { readiness: blockers.length ? "blocked" : "ready_for_approval", blockers, warnings };
}

export function evidenceDigest(value: unknown): string {
  const canonical = JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.keys(item)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = (item as Record<string, unknown>)[key];
          return acc;
        }, {});
    }
    return item;
  });
  return createHash("sha256").update(canonical).digest("hex");
}
