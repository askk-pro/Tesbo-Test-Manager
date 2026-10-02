export interface ChangeFile {
  path: string;
  status?: string | null;
  additions?: number | null;
  deletions?: number | null;
}

export interface ImpactRuleInput {
  id: string;
  pathPattern: string;
  component?: string | null;
  suiteId?: string | null;
  requirementId?: string | null;
  testcaseId?: string | null;
  riskWeight?: number | null;
  mandatory?: boolean | null;
}

export interface RegressionCandidateInput {
  id: string;
  humanId?: string | null;
  externalId?: string | null;
  title: string;
  type?: string | null;
  priority?: string | null;
  severity?: string | null;
  component?: string | null;
  suiteId?: string | null;
  automationStatus?: string | null;
  automationPath?: string | null;
  automationTags?: string | null;
  customTags?: string[] | null;
  requirementIds?: string[] | null;
  openDefectCount?: number | null;
  historicalDefectCount?: number | null;
  recentFailureCount?: number | null;
  flakeClassification?: string | null;
  flakeScore?: number | null;
}

export interface RegressionSelectionItem {
  testcaseId: string;
  humanId?: string | null;
  title: string;
  sources: string[];
  reasons: string[];
  riskWeight: number;
  mandatory: boolean;
  selected: boolean;
}

export interface RiskFactor {
  code: string;
  points: number;
  explanation: string;
}

export interface RiskAssessment {
  score: number;
  band: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  factors: RiskFactor[];
}

export interface RegressionMatrixTarget {
  environment: string;
  browser: string;
  targetType: "browser" | "api" | "manual" | "production-safe";
  required: boolean;
}

const DEPENDENCY_FILE_RE =
  /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements[^/]*\.txt|poetry\.lock|pyproject\.toml|go\.(mod|sum)|cargo\.lock|composer\.lock|pom\.xml|build\.gradle(?:\.kts)?|dockerfile|docker-compose[^/]*\.ya?ml)$/i;

function normalizedPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/").trim();
}

export function isDependencyFile(path: string): boolean {
  return DEPENDENCY_FILE_RE.test(normalizedPath(path));
}

export function globToRegExp(pattern: string): RegExp {
  const normalized = normalizedPath(pattern);
  let out = "^";
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === "*" && next === "*") {
      const after = normalized[i + 2];
      if (after === "/") {
        out += "(?:.*/)?";
        i += 2;
      } else {
        out += ".*";
        i += 1;
      }
      continue;
    }
    if (char === "*") {
      out += "[^/]*";
      continue;
    }
    if (char === "?") {
      out += "[^/]";
      continue;
    }
    if ("\\.^$+{}()|[]".includes(char)) out += "\\" + char;
    else out += char;
  }
  out += "$";
  return new RegExp(out, "i");
}

export function matchesGlob(path: string, pattern: string): boolean {
  return globToRegExp(pattern).test(normalizedPath(path));
}

export function matchImpactRules(changedFiles: ChangeFile[], rules: ImpactRuleInput[]) {
  const files = changedFiles.map((file) => ({ ...file, path: normalizedPath(file.path) })).filter((file) => file.path);
  const matchedRules = rules
    .map((rule) => ({
      ...rule,
      matchedFiles: files.filter((file) => matchesGlob(file.path, rule.pathPattern)).map((file) => file.path),
    }))
    .filter((rule) => rule.matchedFiles.length > 0);

  return {
    matchedRules,
    components: [...new Set(matchedRules.map((rule) => String(rule.component || "").trim()).filter(Boolean))],
    suiteIds: [...new Set(matchedRules.map((rule) => String(rule.suiteId || "")).filter(Boolean))],
    requirementIds: [...new Set(matchedRules.map((rule) => String(rule.requirementId || "")).filter(Boolean))],
    testcaseIds: [...new Set(matchedRules.map((rule) => String(rule.testcaseId || "")).filter(Boolean))],
    dependencyFiles: files.filter((file) => isDependencyFile(file.path)).map((file) => file.path),
  };
}

function textTags(candidate: RegressionCandidateInput): string[] {
  const free = String(candidate.automationTags || "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  const custom = (candidate.customTags || []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean);
  return [...new Set([...free, ...custom])];
}

function addSignal(
  signals: Map<string, { sources: Set<string>; reasons: Set<string>; riskWeight: number; mandatory: boolean }>,
  candidate: RegressionCandidateInput,
  source: string,
  reason: string,
  weight: number,
  mandatory = false,
) {
  const current = signals.get(candidate.id) || {
    sources: new Set<string>(),
    reasons: new Set<string>(),
    riskWeight: 0,
    mandatory: false,
  };
  current.sources.add(source);
  current.reasons.add(reason);
  current.riskWeight = Math.min(100, current.riskWeight + Math.max(0, weight));
  current.mandatory = current.mandatory || mandatory;
  signals.set(candidate.id, current);
}

export function selectRegressionTests(input: {
  changedFiles: ChangeFile[];
  rules: ImpactRuleInput[];
  candidates: RegressionCandidateInput[];
  explicitDependencyChanges?: unknown[];
}) {
  const impact = matchImpactRules(input.changedFiles, input.rules);
  const matchedRuleMap = new Map<string, ImpactRuleInput[]>();
  for (const rule of impact.matchedRules) {
    for (const candidate of input.candidates) {
      const requirementIds = new Set(candidate.requirementIds || []);
      const matchesTarget =
        (rule.testcaseId && candidate.id === rule.testcaseId) ||
        (rule.suiteId && candidate.suiteId === rule.suiteId) ||
        (rule.component && String(candidate.component || "").toLowerCase() === String(rule.component).toLowerCase()) ||
        (rule.requirementId && requirementIds.has(rule.requirementId));
      if (!matchesTarget) continue;
      const list = matchedRuleMap.get(candidate.id) || [];
      list.push(rule);
      matchedRuleMap.set(candidate.id, list);
    }
  }

  const hasDependencyChange = impact.dependencyFiles.length > 0 || (input.explicitDependencyChanges || []).length > 0;
  const signals = new Map<string, { sources: Set<string>; reasons: Set<string>; riskWeight: number; mandatory: boolean }>();

  for (const candidate of input.candidates) {
    const tags = textTags(candidate);
    const type = String(candidate.type || "").toLowerCase();
    const priority = String(candidate.priority || "").toUpperCase();
    const severity = String(candidate.severity || "").toLowerCase();

    if (type === "smoke" || tags.includes("smoke")) {
      addSignal(signals, candidate, "smoke", "Mandatory smoke coverage", 15, true);
    }

    const rules = matchedRuleMap.get(candidate.id) || [];
    for (const rule of rules) {
      addSignal(
        signals,
        candidate,
        "impacted",
        `Changed path matched impact rule "${rule.pathPattern}"`,
        Number(rule.riskWeight || 5),
        Boolean(rule.mandatory),
      );
    }

    const automationPath = normalizedPath(String(candidate.automationPath || ""));
    if (automationPath && input.changedFiles.some((file) => normalizedPath(file.path) === automationPath)) {
      addSignal(signals, candidate, "changed-test", "The automated testcase implementation changed in this build", 10);
    }

    if (Number(candidate.recentFailureCount || 0) > 0) {
      addSignal(
        signals,
        candidate,
        "historical-failure",
        `Recent execution history contains ${Number(candidate.recentFailureCount || 0)} failure/blocked result(s)`,
        Math.min(15, Number(candidate.recentFailureCount || 0) * 3),
      );
    }

    if (candidate.flakeClassification === "flaky") {
      addSignal(
        signals,
        candidate,
        "flaky",
        `Recent history is classified flaky (score ${Number(candidate.flakeScore || 0)}/100)`,
        6,
      );
    }

    if (Number(candidate.historicalDefectCount || 0) > 0) {
      addSignal(
        signals,
        candidate,
        "prior-defect",
        `Linked to ${Number(candidate.historicalDefectCount || 0)} historical QA defect(s)`,
        Math.min(12, Number(candidate.historicalDefectCount || 0) * 2),
      );
    }

    if (hasDependencyChange && (type === "integration" || type === "regression" || type === "smoke" || tags.includes("integration") || tags.includes("regression"))) {
      addSignal(signals, candidate, "dependency", "Dependency manifest/lockfile changed; integration/regression coverage selected", 10);
    }

    const alreadyImpacted = signals.get(candidate.id)?.sources.has("impacted");
    if (alreadyImpacted && (priority === "P0" || priority === "P1" || severity === "critical" || severity === "high")) {
      addSignal(signals, candidate, "high-risk", "Impacted testcase has high business/test severity", 12, priority === "P0");
    }
  }

  const selected = input.candidates
    .filter((candidate) => signals.has(candidate.id))
    .map<RegressionSelectionItem>((candidate) => {
      const signal = signals.get(candidate.id)!;
      return {
        testcaseId: candidate.id,
        humanId: candidate.humanId || candidate.externalId || null,
        title: candidate.title,
        sources: [...signal.sources],
        reasons: [...signal.reasons],
        riskWeight: signal.riskWeight,
        mandatory: signal.mandatory,
        selected: true,
      };
    })
    .sort((a, b) => Number(b.mandatory) - Number(a.mandatory) || b.riskWeight - a.riskWeight || a.title.localeCompare(b.title));

  return {
    impact,
    selected,
    summary: {
      totalCandidates: input.candidates.length,
      selected: selected.length,
      smoke: selected.filter((item) => item.sources.includes("smoke")).length,
      impacted: selected.filter((item) => item.sources.includes("impacted")).length,
      historicalFailure: selected.filter((item) => item.sources.includes("historical-failure")).length,
      flaky: selected.filter((item) => item.sources.includes("flaky")).length,
      priorDefect: selected.filter((item) => item.sources.includes("prior-defect")).length,
      dependency: selected.filter((item) => item.sources.includes("dependency")).length,
      manual: selected.filter((item) => {
        const candidate = input.candidates.find((candidate) => candidate.id === item.testcaseId);
        return String(candidate?.automationStatus || "").toLowerCase() !== "automated";
      }).length,
    },
  };
}

export function assessBuildRisk(input: {
  changedFiles: ChangeFile[];
  dependencyChangeCount: number;
  impactedHighRiskTests: number;
  openHighDefects: number;
  recentFailures: number;
  impactedRequirementCount: number;
  coveredRequirementCount: number;
  repeatedChangeFiles: number;
}): RiskAssessment {
  const factors: RiskFactor[] = [];

  const lineDelta = input.changedFiles.reduce(
    (sum, file) => sum + Math.max(0, Number(file.additions || 0)) + Math.max(0, Number(file.deletions || 0)),
    0,
  );
  const sizePoints = Math.min(25, Math.max(
    Math.min(15, input.changedFiles.length),
    lineDelta > 1000 ? 25 : lineDelta > 500 ? 20 : lineDelta > 200 ? 15 : lineDelta > 50 ? 10 : lineDelta > 0 ? 5 : 0,
  ));
  if (sizePoints) {
    factors.push({
      code: "CHANGE_SIZE",
      points: sizePoints,
      explanation: `${input.changedFiles.length} changed file(s)${lineDelta ? `, ${lineDelta} changed line(s)` : ""}`,
    });
  }

  if (input.dependencyChangeCount > 0) {
    factors.push({
      code: "DEPENDENCY_CHANGE",
      points: Math.min(15, 8 + input.dependencyChangeCount * 2),
      explanation: `${input.dependencyChangeCount} dependency manifest/change item(s)`,
    });
  }

  if (input.impactedHighRiskTests > 0) {
    factors.push({
      code: "HIGH_RISK_TESTS",
      points: Math.min(20, input.impactedHighRiskTests * 4),
      explanation: `${input.impactedHighRiskTests} impacted Critical/High or P0/P1 testcase(s)`,
    });
  }

  if (input.openHighDefects > 0) {
    factors.push({
      code: "OPEN_BLOCKERS",
      points: Math.min(20, input.openHighDefects * 5),
      explanation: `${input.openHighDefects} open/reopened Critical/High or P0/P1 QA defect(s) affect selected tests`,
    });
  }

  if (input.recentFailures > 0) {
    factors.push({
      code: "RECENT_FAILURES",
      points: Math.min(15, input.recentFailures * 2),
      explanation: `${input.recentFailures} recent failed/blocked execution(s) across selected tests`,
    });
  }

  if (input.impactedRequirementCount > 0) {
    const uncovered = Math.max(0, input.impactedRequirementCount - input.coveredRequirementCount);
    if (uncovered > 0) {
      factors.push({
        code: "COVERAGE_GAP",
        points: Math.min(15, Math.ceil((uncovered / input.impactedRequirementCount) * 15)),
        explanation: `${uncovered} of ${input.impactedRequirementCount} impacted requirement(s) have no selected testcase coverage`,
      });
    }
  }

  if (input.repeatedChangeFiles > 0) {
    factors.push({
      code: "CHANGE_FREQUENCY",
      points: Math.min(10, input.repeatedChangeFiles * 2),
      explanation: `${input.repeatedChangeFiles} changed file(s) also changed in recent registered builds`,
    });
  }

  const score = Math.min(100, factors.reduce((sum, factor) => sum + factor.points, 0));
  const band = score >= 75 ? "CRITICAL" : score >= 50 ? "HIGH" : score >= 25 ? "MEDIUM" : "LOW";
  return { score, band, factors };
}

export function normalizeRegressionMatrix(
  input: unknown,
  defaultEnvironment = "staging",
): RegressionMatrixTarget[] {
  const source = Array.isArray(input) ? input : [];
  const output: RegressionMatrixTarget[] = [];
  const validTargetTypes = new Set(["browser", "api", "manual", "production-safe"]);

  for (const raw of source) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const targetType = String(item.targetType || "").trim() as RegressionMatrixTarget["targetType"];
    if (!validTargetTypes.has(targetType)) continue;
    const environment = String(item.environment || defaultEnvironment).trim().slice(0, 128);
    const browser = String(item.browser || "").trim().slice(0, 64);
    const key = [environment, browser, targetType].join("|").toLowerCase();
    if (output.some((existing) => [existing.environment, existing.browser, existing.targetType].join("|").toLowerCase() === key)) continue;
    output.push({ environment, browser, targetType, required: item.required !== false });
  }

  if (!output.length) {
    return [
      { environment: defaultEnvironment || "staging", browser: "chrome", targetType: "browser", required: true },
      { environment: defaultEnvironment || "staging", browser: "edge", targetType: "browser", required: true },
      { environment: defaultEnvironment || "staging", browser: "firefox", targetType: "browser", required: true },
      { environment: defaultEnvironment || "staging", browser: "", targetType: "api", required: true },
      { environment: defaultEnvironment || "staging", browser: "", targetType: "manual", required: true },
    ];
  }
  return output.slice(0, 24);
}
