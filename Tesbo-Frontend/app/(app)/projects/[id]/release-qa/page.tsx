"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  certifyRelease,
  createChangeImpactRule,
  createSelectiveRegressionRerun,
  deleteChangeImpactRule,
  generateRegressionPlan,
  getPhase5ReleaseDashboard,
  getQaBuildImpact,
  getRegressionPlan,
  listChangeImpactRules,
  listQaBuilds,
  listRegressionPlans,
  markQaBuildDeployed,
  overrideRegressionPlanTest,
  prepareReleaseCertification,
  registerQaBuild,
  startRegressionPlan,
  type ChangeImpactRule,
  type Phase5ReleaseDashboard,
  type QaBuildImpact,
  type QaBuildRecord,
  type RegressionPlan,
} from "@/lib/api";
import { useAppData } from "@/components/app/AppDataProvider";
import { useProjectData } from "@/components/project/ProjectDataProvider";
import { Button, Card, PageLoader } from "@/components/ui";
import { PageHeader, StandardPageLayout } from "@/components/workflows";

type Tab = "dashboard" | "plan" | "rules" | "register";

const inputClass =
  "mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-[13px] text-[var(--foreground)] outline-none";
const labelClass = "text-[12px] font-medium text-[var(--muted)]";

function nice(value?: string | null) {
  return String(value || "not evaluated").replaceAll("_", " ");
}

function badgeClass(value?: string | null) {
  const v = String(value || "").toLowerCase();
  if (["approved", "certified", "ready", "ready_for_approval", "current"].includes(v)) {
    return "border-[var(--success)]/30 bg-[var(--success-soft)] text-[var(--success)]";
  }
  if (["blocked", "failed", "rejected", "revoked"].includes(v)) {
    return "border-[var(--error)]/30 bg-[var(--error-soft)] text-[var(--status-fail-text)]";
  }
  if (["testing", "stale", "superseded", "expired", "needs_re_evaluation"].includes(v)) {
    return "border-[var(--warning)]/30 bg-[var(--warning-soft)] text-[var(--warning-foreground)]";
  }
  return "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--muted)]";
}

function Badge({ value, children }: { value?: string | null; children: React.ReactNode }) {
  return <span className={"inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize " + badgeClass(value)}>{children}</span>;
}

function Metric({ title, value, note }: { title: string; value: React.ReactNode; note?: string }) {
  return (
    <Card className="p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-soft)]">{title}</div>
      <div className="mt-1 text-[21px] font-semibold text-[var(--foreground)]">{value}</div>
      {note ? <div className="mt-1 text-[11px] text-[var(--muted)]">{note}</div> : null}
    </Card>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border-subtle)] px-5 py-8 text-center text-[13px] text-[var(--muted)]">
      {children}
    </div>
  );
}

export default function ReleaseQaPage() {
  const params = useParams();
  const projectId = String(params.id);
  const { currentUser } = useAppData();
  const { project, projectMembers } = useProjectData();
  const role = projectMembers.find((m) => m.userId === currentUser?.userId)?.role || "";
  const canManage = role === "owner" || role === "manager";

  const [tab, setTab] = useState<Tab>("dashboard");
  const [builds, setBuilds] = useState<QaBuildRecord[]>([]);
  const [buildId, setBuildId] = useState("");
  const [impact, setImpact] = useState<QaBuildImpact | null>(null);
  const [dashboard, setDashboard] = useState<Phase5ReleaseDashboard | null>(null);
  const [plan, setPlan] = useState<RegressionPlan | null>(null);
  const [rules, setRules] = useState<ChangeImpactRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const [buildForm, setBuildForm] = useState({
    repository: "", gitSha: "", baseSha: "", branchName: "main",
    releaseName: "", buildVersion: "", environment: "staging", changedFiles: "",
  });
  const [ruleForm, setRuleForm] = useState({
    name: "", pathPattern: "", component: "", requirementRef: "", testcaseRef: "", riskWeight: "5", mandatory: false,
  });

  const selectedBuild = useMemo(() => builds.find((b) => b.id === buildId) || null, [builds, buildId]);

  async function loadRules() {
    setRules(await listChangeImpactRules(projectId));
  }

  async function loadBuilds(preferred?: string) {
    const rows = await listQaBuilds(projectId, 100);
    setBuilds(rows);
    const next = preferred && rows.some((b) => b.id === preferred) ? preferred : buildId && rows.some((b) => b.id === buildId) ? buildId : rows[0]?.id || "";
    setBuildId(next);
  }

  async function loadDetail(id: string) {
    if (!id) {
      setImpact(null); setDashboard(null); setPlan(null);
      return;
    }
    const [i, d, p] = await Promise.all([
      getQaBuildImpact(projectId, id),
      getPhase5ReleaseDashboard(projectId, id),
      listRegressionPlans(projectId, id),
    ]);
    setImpact(i);
    setDashboard(d);
    setPlan(p[0]?.id ? await getRegressionPlan(projectId, p[0].id) : null);
  }

  async function refresh(id = buildId) {
    setError("");
    try {
      await Promise.all([loadBuilds(id), listChangeImpactRules(projectId).then(setRules)]);
      if (id) await loadDetail(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not refresh Release QA.");
    }
  }

  async function action(name: string, fn: () => Promise<void>) {
    setBusy(name); setError(""); setNotice("");
    try { await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : "Action failed."); }
    finally { setBusy(""); }
  }

  useEffect(() => {
    let active = true;
    Promise.all([listQaBuilds(projectId, 100), listChangeImpactRules(projectId)])
      .then(([b, r]) => {
        if (!active) return;
        setBuilds(b); setRules(r); setBuildId(b[0]?.id || ""); setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Could not load Release QA.");
        setLoading(false);
      });
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    if (!buildId) return;
    void loadDetail(buildId).catch((e) => setError(e instanceof Error ? e.message : "Could not load build details."));
    // loadDetail is intentionally tied to the selected build id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildId, projectId]);

  if (loading) return <PageLoader variant="screen" label="Loading Release QA…" />;

  const cert = dashboard?.certification?.certification || null;
  const exec = dashboard?.execution;

  return (
    <StandardPageLayout
      header={
        <PageHeader
          title="Release QA"
          subtitle="Change-aware regression, smart test selection and evidence-bound certification."
          breadcrumb={<><Link href={"/projects/" + projectId}>{String(project.name || "Project")}</Link> / Release QA</>}
          actions={<Button variant="secondary" disabled={Boolean(busy)} onClick={() => void refresh()}>Refresh</Button>}
        />
      }
    >
      {error ? <Card className="border-[var(--error)]/30 bg-[var(--error-soft)] p-4 text-[13px] text-[var(--status-fail-text)]">{error}</Card> : null}
      {notice ? <Card className="border-[var(--success)]/30 bg-[var(--success-soft)] p-4 text-[13px] text-[var(--success)]">{notice}</Card> : null}

      <Card className="p-4">
        <label className={labelClass}>Build / commit
          <select className={inputClass} value={buildId} onChange={(e) => setBuildId(e.target.value)}>
            {builds.length === 0 ? <option value="">No builds registered</option> : null}
            {builds.map((b) => <option key={b.id} value={b.id}>{b.releaseName || b.buildVersion || b.gitSha.slice(0, 12)} · {b.environment || "no env"}</option>)}
          </select>
        </label>
      </Card>

      <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-1">
        {(["dashboard","plan","rules","register"] as Tab[]).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={"rounded-md px-3 py-2 text-[12px] font-medium " + (tab === t ? "bg-[var(--surface-raised)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted)]")}>
            {t === "dashboard" ? "Release dashboard" : t === "plan" ? "Regression plan" : t === "rules" ? "Impact rules" : "Register build"}
          </button>
        ))}
      </div>

      {tab === "dashboard" ? (
        !selectedBuild ? <Card className="p-8 text-center text-[var(--muted)]">Register a build first.</Card> : (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric title="Build" value={selectedBuild.buildVersion || selectedBuild.releaseName || "—"} />
              <Metric title="Commit" value={<span className="font-mono text-[16px]">{selectedBuild.gitSha.slice(0,12)}</span>} />
              <Metric title="Risk" value={dashboard?.risk?.band || impact?.risk.band || "—"} note={(dashboard?.risk?.score ?? impact?.risk.score ?? 0) + "/100 deterministic"} />
              <Metric title="Certification" value={cert?.state || "Not issued"} note={cert ? "Validity: " + cert.validityStatus : undefined} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <Metric title="Selected" value={dashboard?.plan?.selected ?? 0} />
              <Metric title="Passed" value={exec?.passed ?? 0} />
              <Metric title="Failed" value={exec?.failed ?? 0} />
              <Metric title="Flaky" value={dashboard?.flaky ?? 0} />
              <Metric title="Blocked" value={exec?.blocked ?? 0} />
              <Metric title="Coverage" value={(dashboard?.plan?.coveragePct ?? 0) + "%"} />
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <Card className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div><h2 className="font-semibold">Smart regression</h2><p className="mt-1 text-[12px] text-[var(--muted)]">Scope is selected from changed paths, smoke tests, history, defects and dependencies.</p></div>
                  {!plan ? <Button disabled={!impact?.recommendation.recommendedCount || busy === "generate"} onClick={() => void action("generate", async () => {
                    const p = await generateRegressionPlan(projectId, selectedBuild.id); setPlan(await getRegressionPlan(projectId, p.id)); setNotice("Regression plan generated."); setTab("plan"); await loadDetail(selectedBuild.id);
                  })}>Generate plan</Button> : <Button variant="secondary" onClick={() => setTab("plan")}>Open plan</Button>}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Metric title="Smoke" value={impact?.recommendation.smoke ?? 0} />
                  <Metric title="Impacted" value={impact?.recommendation.impacted ?? 0} />
                  <Metric title="History" value={impact?.recommendation.historicalFailure ?? 0} />
                  <Metric title="Prior defects" value={impact?.recommendation.priorDefect ?? 0} />
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="font-semibold">QA gate & certification</h2>
                <div className="mt-4 space-y-3 text-[12px]">
                  <div className="flex justify-between"><span>Phase-4 gate</span><Badge value={dashboard?.qaGate?.effectiveState}>{nice(dashboard?.qaGate?.effectiveState)}</Badge></div>
                  <div className="flex justify-between"><span>Certification</span><Badge value={cert?.state}>{cert?.state || "not prepared"}</Badge></div>
                  {cert ? <div className="flex justify-between"><span>Validity</span><Badge value={cert.validityStatus}>{cert.validityStatus}</Badge></div> : null}
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button variant="secondary" disabled={!plan || busy === "prepare"} onClick={() => void action("prepare", async () => {
                    const r = await prepareReleaseCertification(projectId, selectedBuild.id, { planId: plan?.id }); setNotice("Certification evidence: " + nice(r.status)); await loadDetail(selectedBuild.id);
                  })}>Prepare / refresh</Button>
                  {canManage ? <Button disabled={busy === "certify" || cert?.state !== "APPROVED" || cert?.validityStatus !== "current"} onClick={() => void action("certify", async () => {
                    await certifyRelease(projectId, selectedBuild.id, { planId: plan?.id }); setNotice("Release certificate issued."); await loadDetail(selectedBuild.id);
                  })}>Certify release</Button> : null}
                </div>
                <p className="mt-3 text-[11px] text-[var(--muted-soft)]">Final certification remains human-only. MCP can prepare and inspect evidence but cannot issue it.</p>
              </Card>
            </div>

            <Card className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[11px] text-[var(--muted)]"><div>{selectedBuild.repository}</div><div className="font-mono">{selectedBuild.gitSha}</div></div>
                {!selectedBuild.deploymentTimestamp ? <Button variant="secondary" disabled={busy === "deploy"} onClick={() => void action("deploy", async () => {
                  await markQaBuildDeployed(projectId, selectedBuild.id); setNotice("Build marked deployed. Older current certificates may be superseded."); await refresh(selectedBuild.id);
                })}>Mark deployed</Button> : <Badge value="current">Deployed</Badge>}
              </div>
            </Card>
          </div>
        )
      ) : null}

      {tab === "plan" ? (
        !plan ? <Card className="p-8 text-center text-[var(--muted)]">Generate a regression plan from the dashboard.</Card> : (
          <div className="space-y-5">
            <Card className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><div className="flex items-center gap-2"><h2 className="font-semibold">{plan.name}</h2><Badge value={plan.status}>{plan.status}</Badge></div><p className="mt-1 text-[11px] text-[var(--muted)]">{plan.selectedTestCount} selected · {plan.coveragePct}% scope · {plan.riskBand} {plan.riskScore}/100</p></div>
                <div className="flex gap-2">
                  {plan.status === "DRAFT" ? <Button disabled={busy === "start"} onClick={() => void action("start", async () => {
                    const r = await startRegressionPlan(projectId, plan.id); setNotice("Created " + r.created.length + " RUN-n regression run(s)."); setPlan(await getRegressionPlan(projectId, plan.id)); await loadDetail(buildId);
                  })}>Start regression</Button> : null}
                  {plan.runs?.some((r) => Number(r.failed) + Number(r.blocked) > 0) ? <Button variant="secondary" disabled={busy === "rerun"} onClick={() => void action("rerun", async () => {
                    const r = await createSelectiveRegressionRerun(projectId, plan.id, { mode: "failed" }); setNotice("Created " + r.created.length + " selective rerun(s)."); setPlan(await getRegressionPlan(projectId, plan.id)); await loadDetail(buildId);
                  })}>Rerun failures</Button> : null}
                </div>
              </div>
            </Card>

            {plan.status === "DRAFT" ? <Card className="p-4"><label className={labelClass}>Override reason<input className={inputClass} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Required for include/exclude" /></label></Card> : null}

            <Card className="overflow-hidden">
              <div className="border-b border-[var(--border-subtle)] px-5 py-4 font-semibold">Regression scope</div>
              <div className="divide-y divide-[var(--border-subtle)]">
                {(plan.items || []).map((item) => <div key={item.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0"><div className="font-medium">{item.humanId || item.externalId || item.testcaseId} · {item.title}</div><div className="mt-1 text-[11px] text-[var(--muted)]">{item.selectionSources.join(", ")} · Risk {item.riskWeight}{item.mandatory ? " · MANDATORY" : ""}</div><div className="mt-1 text-[11px] text-[var(--muted)]">{item.reasons.join(" · ")}</div></div>
                  {plan.status === "DRAFT" ? <Button size="sm" variant={item.selected ? "secondary" : "primary"} disabled={!overrideReason.trim() || (item.selected && item.mandatory) || busy === "scope"} onClick={() => void action("scope", async () => {
                    const ref = item.humanId || item.externalId || item.testcaseId; setPlan(await overrideRegressionPlanTest(projectId, plan.id, ref, { selected: !item.selected, reason: overrideReason.trim() })); setOverrideReason(""); await loadDetail(buildId);
                  })}>{item.selected ? "Exclude" : "Include"}</Button> : <Badge value={item.selected ? "current" : "stale"}>{item.selected ? "Selected" : "Excluded"}</Badge>}
                </div>)}
              </div>
            </Card>

            <Card className="overflow-hidden">
              <div className="border-b border-[var(--border-subtle)] px-5 py-4 font-semibold">Generated runs</div>
              {(plan.runs || []).length ? (plan.runs || []).map((run) => <div key={run.id} className="flex flex-wrap justify-between gap-3 border-t border-[var(--border-subtle)] px-5 py-4 first:border-t-0">
                <Link href={"/projects/" + projectId + "/cycles/" + run.cycleId} className="font-medium hover:underline">{run.runHumanId || run.runName || run.cycleId}</Link>
                <span className="text-[11px] text-[var(--muted)]">{run.passed} passed · {run.failed} failed · {run.blocked} blocked · {run.pending} pending</span>
              </div>) : <Empty>No RUN-n cycles generated yet.</Empty>}
            </Card>
          </div>
        )
      ) : null}

      {tab === "rules" ? (
        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <Card className="p-5">
            <h2 className="font-semibold">New impact rule</h2>
            <div className="mt-4 space-y-3">
              <label className={labelClass}>Name<input disabled={!canManage} className={inputClass} value={ruleForm.name} onChange={(e) => setRuleForm(v => ({...v,name:e.target.value}))} /></label>
              <label className={labelClass}>Path glob<input disabled={!canManage} className={inputClass} value={ruleForm.pathPattern} onChange={(e) => setRuleForm(v => ({...v,pathPattern:e.target.value}))} placeholder="src/auth/**" /></label>
              <label className={labelClass}>Component<input disabled={!canManage} className={inputClass} value={ruleForm.component} onChange={(e) => setRuleForm(v => ({...v,component:e.target.value}))} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className={labelClass}>REQ<input disabled={!canManage} className={inputClass} value={ruleForm.requirementRef} onChange={(e) => setRuleForm(v => ({...v,requirementRef:e.target.value}))} /></label>
                <label className={labelClass}>TC<input disabled={!canManage} className={inputClass} value={ruleForm.testcaseRef} onChange={(e) => setRuleForm(v => ({...v,testcaseRef:e.target.value}))} /></label>
              </div>
              <label className={labelClass}>Risk weight<input disabled={!canManage} type="number" min={0} max={30} className={inputClass} value={ruleForm.riskWeight} onChange={(e) => setRuleForm(v => ({...v,riskWeight:e.target.value}))} /></label>
              <label className="flex items-center gap-2 text-[12px] text-[var(--muted)]"><input disabled={!canManage} type="checkbox" checked={ruleForm.mandatory} onChange={(e) => setRuleForm(v => ({...v,mandatory:e.target.checked}))} /> Mandatory</label>
              <Button fullWidth disabled={!canManage || !ruleForm.name.trim() || !ruleForm.pathPattern.trim() || busy === "rule"} onClick={() => void action("rule", async () => {
                await createChangeImpactRule(projectId, { name: ruleForm.name.trim(), pathPattern: ruleForm.pathPattern.trim(), ...(ruleForm.component.trim()?{component:ruleForm.component.trim()}:{}), ...(ruleForm.requirementRef.trim()?{requirementRef:ruleForm.requirementRef.trim()}:{}), ...(ruleForm.testcaseRef.trim()?{testcaseRef:ruleForm.testcaseRef.trim()}:{}), riskWeight:Number(ruleForm.riskWeight||5), mandatory:ruleForm.mandatory });
                setRuleForm({name:"",pathPattern:"",component:"",requirementRef:"",testcaseRef:"",riskWeight:"5",mandatory:false}); await loadRules(); if (buildId) await loadDetail(buildId);
              })}>Create rule</Button>
            </div>
          </Card>
          <Card className="overflow-hidden">
            <div className="border-b border-[var(--border-subtle)] px-5 py-4 font-semibold">Path → QA rules</div>
            {rules.length ? rules.map((r) => <div key={r.id} className="flex items-start justify-between gap-3 border-t border-[var(--border-subtle)] px-5 py-4 first:border-t-0"><div><div className="font-medium">{r.name}{r.mandatory ? " · MANDATORY" : ""}</div><div className="mt-1 font-mono text-[11px] text-[var(--accent-light)]">{r.pathPattern}</div><div className="mt-1 text-[11px] text-[var(--muted)]">{r.component || r.requirementHumanId || r.testcaseHumanId || r.testcaseExternalId || "mapped target"} · Risk +{r.riskWeight}</div></div>{canManage ? <Button size="icon" variant="ghost" onClick={() => void action("delete-rule", async () => { await deleteChangeImpactRule(projectId,r.id); await loadRules(); if(buildId) await loadDetail(buildId); })}>×</Button> : null}</div>) : <Empty>No impact rules yet.</Empty>}
          </Card>
        </div>
      ) : null}

      {tab === "register" ? (
        <Card className="p-5">
          <h2 className="font-semibold">Register build / commit</h2>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <label className={labelClass}>Repository *<input className={inputClass} value={buildForm.repository} onChange={(e) => setBuildForm(v => ({...v,repository:e.target.value}))} /></label>
            <label className={labelClass}>Git SHA *<input className={inputClass} value={buildForm.gitSha} onChange={(e) => setBuildForm(v => ({...v,gitSha:e.target.value}))} /></label>
            <label className={labelClass}>Base SHA<input className={inputClass} value={buildForm.baseSha} onChange={(e) => setBuildForm(v => ({...v,baseSha:e.target.value}))} /></label>
            <label className={labelClass}>Branch<input className={inputClass} value={buildForm.branchName} onChange={(e) => setBuildForm(v => ({...v,branchName:e.target.value}))} /></label>
            <label className={labelClass}>Release<input className={inputClass} value={buildForm.releaseName} onChange={(e) => setBuildForm(v => ({...v,releaseName:e.target.value}))} /></label>
            <label className={labelClass}>Build version<input className={inputClass} value={buildForm.buildVersion} onChange={(e) => setBuildForm(v => ({...v,buildVersion:e.target.value}))} /></label>
            <label className={labelClass}>Environment<input className={inputClass} value={buildForm.environment} onChange={(e) => setBuildForm(v => ({...v,environment:e.target.value}))} /></label>
          </div>
          <label className={"mt-3 block " + labelClass}>Changed files<textarea className={inputClass + " min-h-[130px] font-mono"} value={buildForm.changedFiles} onChange={(e) => setBuildForm(v => ({...v,changedFiles:e.target.value}))} placeholder={"src/auth/session.ts|modified|18|4\npackage-lock.json|modified|3|3"} /></label>
          <div className="mt-4 flex justify-end"><Button disabled={!buildForm.repository.trim() || !buildForm.gitSha.trim() || busy === "register"} onClick={() => void action("register", async () => {
            const changedFiles = buildForm.changedFiles.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(line=>{const [path,status,a,d]=line.split("|"); return {path:path.trim(), ...(status?{status:status.trim()}:{}), ...(a?{additions:Number(a)}:{}), ...(d?{deletions:Number(d)}:{})};});
            const b = await registerQaBuild(projectId, { repository:buildForm.repository.trim(), gitSha:buildForm.gitSha.trim(), ...(buildForm.baseSha.trim()?{baseSha:buildForm.baseSha.trim()}:{}), ...(buildForm.branchName.trim()?{branchName:buildForm.branchName.trim()}:{}), ...(buildForm.releaseName.trim()?{releaseName:buildForm.releaseName.trim()}:{}), ...(buildForm.buildVersion.trim()?{buildVersion:buildForm.buildVersion.trim()}:{}), environment:buildForm.environment.trim(), changedFiles });
            await loadBuilds(b.id); setBuildId(b.id); setTab("dashboard"); setNotice("Build registered.");
          })}>Register build</Button></div>
        </Card>
      ) : null}
    </StandardPageLayout>
  );
}
