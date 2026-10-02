"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  acknowledgeQaAutomationAlert,
  createQaAutomationSchedule,
  deleteQaAutomationSchedule,
  getQaAutomationDashboard,
  listQaAutomationAlerts,
  listQaAutomationRuns,
  listQaAutomationSchedules,
  listQaBuilds,
  triggerQaAutomation,
  updateQaAutomationSchedule,
  type QaAutomationAlert,
  type QaAutomationDashboard,
  type QaAutomationRunSummary,
  type QaAutomationSchedule,
  type QaBuildRecord,
} from "@/lib/api";
import { useAppData } from "@/components/app/AppDataProvider";
import { useProjectData } from "@/components/project/ProjectDataProvider";
import { Button, Card, PageLoader } from "@/components/ui";
import { PageHeader, StandardPageLayout } from "@/components/workflows";

type Tab = "overview" | "schedules" | "runs" | "alerts" | "workers";

const inputClass =
  "mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-[13px] text-[var(--foreground)] outline-none";
const labelClass = "text-[12px] font-medium text-[var(--muted)]";

function tone(status?: string | null) {
  const value = String(status || "").toLowerCase();
  if (["passed", "healthy", "certified", "current", "acknowledged"].includes(value)) return "text-[var(--success)]";
  if (["failed", "blocked", "stuck", "critical", "high", "partial"].includes(value)) return "text-[var(--status-fail-text)]";
  if (["queued", "planning", "waiting_workers", "running", "warning", "delayed"].includes(value)) return "text-[var(--warning-foreground)]";
  return "text-[var(--muted)]";
}

function Metric({ title, value, note }: { title: string; value: React.ReactNode; note?: string }) {
  return (
    <Card className="p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-soft)]">{title}</div>
      <div className="mt-1 text-[22px] font-semibold text-[var(--foreground)]">{value}</div>
      {note ? <div className="mt-1 text-[11px] text-[var(--muted)]">{note}</div> : null}
    </Card>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function scheduleLabel(s: QaAutomationSchedule) {
  if (s.scheduleType === "event") return "On " + String(s.eventType || "event").replaceAll("_", " ");
  if (s.scheduleType === "daily") return "Daily " + (s.dailyTime || "") + " " + s.timezone;
  if (s.scheduleType === "recurring") return "Every " + String(s.intervalMinutes || 0) + "m";
  return "One-time " + formatDate(s.runAt);
}

export default function QaOperationsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = String(params.id);
  const { currentUser } = useAppData();
  const { project, projectMembers } = useProjectData();
  const role = projectMembers.find((m) => m.userId === currentUser?.userId)?.role || "";
  const canManage = role === "owner" || role === "manager";

  const initialTab = (searchParams.get("tab") || "overview") as Tab;
  const [tab, setTab] = useState<Tab>(["overview", "schedules", "runs", "alerts", "workers"].includes(initialTab) ? initialTab : "overview");
  const [dashboard, setDashboard] = useState<QaAutomationDashboard | null>(null);
  const [schedules, setSchedules] = useState<QaAutomationSchedule[]>([]);
  const [runs, setRuns] = useState<QaAutomationRunSummary[]>([]);
  const [alerts, setAlerts] = useState<QaAutomationAlert[]>([]);
  const [builds, setBuilds] = useState<QaBuildRecord[]>([]);
  const [buildId, setBuildId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [form, setForm] = useState({
    name: "Nightly regression",
    scheduleType: "daily" as "one_time" | "recurring" | "daily" | "event",
    repository: "",
    branchFilter: "main",
    eventType: "build_deployed" as "build_registered" | "build_deployed" | "pr_updated",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    dailyTime: "23:00",
    intervalMinutes: 1440,
    runAt: "",
    environment: "staging",
    desiredShards: 4,
    maxParallelism: 4,
    retryLimit: 1,
    retryBackoffSeconds: 30,
    stuckAfterMinutes: 30,
  });

  const refresh = useCallback(async () => {
    const [d, s, r, a, b] = await Promise.all([
      getQaAutomationDashboard(projectId),
      listQaAutomationSchedules(projectId),
      listQaAutomationRuns(projectId, 100),
      listQaAutomationAlerts(projectId, "open"),
      listQaBuilds(projectId, 100),
    ]);
    setDashboard(d);
    setSchedules(s);
    setRuns(r);
    setAlerts(a);
    setBuilds(b);
    setBuildId((current) => current || b[0]?.id || "");
  }, [projectId]);

  useEffect(() => {
    let active = true;
    refresh()
      .catch((e) => active && setError(e instanceof Error ? e.message : "Could not load QA Operations."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [refresh]);

  async function action(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setError("");
    setNotice("");
    try { await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : "Action failed."); }
    finally { setBusy(""); }
  }

  async function createSchedule(e: React.FormEvent) {
    e.preventDefault();
    await action("create-schedule", async () => {
      await createQaAutomationSchedule(projectId, {
        name: form.name.trim(),
        scheduleType: form.scheduleType,
        repository: form.repository.trim() || undefined,
        branchFilter: form.branchFilter.trim() || undefined,
        eventType: form.scheduleType === "event" ? form.eventType : undefined,
        timezone: form.timezone,
        dailyTime: form.scheduleType === "daily" ? form.dailyTime : undefined,
        intervalMinutes: form.scheduleType === "recurring" ? form.intervalMinutes : undefined,
        runAt: form.scheduleType === "one_time" && form.runAt ? new Date(form.runAt).toISOString() : undefined,
        environment: form.environment.trim(),
        desiredShards: form.desiredShards,
        maxParallelism: form.maxParallelism,
        retryLimit: form.retryLimit,
        retryBackoffSeconds: form.retryBackoffSeconds,
        stuckAfterMinutes: form.stuckAfterMinutes,
        autoPrepareCertification: true,
        enabled: true,
      });
      setNotice("Continuous QA schedule created.");
      await refresh();
    });
  }

  async function triggerNow() {
    if (!buildId) return;
    await action("trigger", async () => {
      const run = await triggerQaAutomation(projectId, { buildId });
      setNotice("Automation run queued: " + run.id.slice(0, 8));
      await refresh();
      setTab("runs");
    });
  }

  const selectedBuild = useMemo(() => builds.find((b) => b.id === buildId) || null, [builds, buildId]);

  if (loading) return <PageLoader variant="screen" label="Loading QA Operations…" />;

  return (
    <StandardPageLayout
      header={
        <PageHeader
          title="QA Operations"
          subtitle="Continuous regression scheduling, worker queues, parallel shards, recovery, alerts and certification monitoring."
          breadcrumb={<><Link href={"/projects/" + projectId}>{String(project.name || "Project")}</Link> / QA Operations</>}
          actions={<div className="flex gap-2"><Button variant="secondary" disabled={Boolean(busy)} onClick={() => void refresh()}>Refresh</Button><Link href={"/projects/" + projectId + "/release-qa"} className="inline-flex items-center rounded-md border border-[var(--border)] px-3 py-2 text-[12px] font-medium">Release QA</Link></div>}
        />
      }
    >
      {error ? <Card className="border-[var(--error)]/30 bg-[var(--error-soft)] p-4 text-[13px] text-[var(--status-fail-text)]">{error}</Card> : null}
      {notice ? <Card className="border-[var(--success)]/30 bg-[var(--success-soft)] p-4 text-[13px] text-[var(--success)]">{notice}</Card> : null}

      <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-1">
        {(["overview", "schedules", "runs", "alerts", "workers"] as Tab[]).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={"rounded-md px-3 py-2 text-[12px] font-medium " + (tab === t ? "bg-[var(--surface-raised)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted)]")}>
            {t === "overview" ? "Operations overview" : t === "schedules" ? "Schedules & triggers" : t === "runs" ? "Automation runs" : t === "alerts" ? "Alerts" : "Workers & queue"}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metric title="Active runs" value={dashboard?.counts.active ?? 0} />
            <Metric title="Passed" value={dashboard?.counts.passed ?? 0} note="all retained runs" />
            <Metric title="Unhealthy" value={dashboard?.counts.unhealthy ?? 0} note="failed / blocked / stuck" />
            <Metric title="Open alerts" value={dashboard?.alerts.open ?? 0} note={(dashboard?.alerts.critical ?? 0) + " critical"} />
            <Metric title="Next schedule" value={dashboard?.schedules.nextRunAt ? new Date(dashboard.schedules.nextRunAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"} />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
            <Card className="p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div><h2 className="font-semibold">Run a build now</h2><p className="mt-1 text-[12px] text-[var(--muted)]">Uses Phase-5 impact analysis, generates a new regression plan version, duration-balances shards, then waits for workers.</p></div>
                <Button disabled={!buildId || busy === "trigger"} onClick={() => void triggerNow()}>{busy === "trigger" ? "Queueing…" : "Start continuous QA"}</Button>
              </div>
              <select className={inputClass} value={buildId} onChange={(e) => setBuildId(e.target.value)}>
                {builds.length ? builds.map((b) => <option key={b.id} value={b.id}>{b.releaseName || b.buildVersion || b.gitSha.slice(0, 12)} · {b.environment || "no env"}</option>) : <option value="">No builds registered</option>}
              </select>
              {selectedBuild ? <div className="mt-3 text-[11px] text-[var(--muted)]"><div>{selectedBuild.repository}</div><div className="font-mono">{selectedBuild.gitSha}</div></div> : null}
            </Card>

            <Card className="p-5">
              <h2 className="font-semibold">Queue health</h2>
              <div className="mt-4 grid grid-cols-2 gap-3 text-[12px]">
                <div><span className="text-[var(--muted)]">Waiting</span><div className="mt-1 text-xl font-semibold">{dashboard?.queue.waiting ?? 0}</div></div>
                <div><span className="text-[var(--muted)]">Active</span><div className="mt-1 text-xl font-semibold">{dashboard?.queue.active ?? 0}</div></div>
                <div><span className="text-[var(--muted)]">Delayed</span><div className="mt-1 text-xl font-semibold">{dashboard?.queue.delayed ?? 0}</div></div>
                <div><span className="text-[var(--muted)]">Failed jobs</span><div className="mt-1 text-xl font-semibold">{dashboard?.queue.failed ?? 0}</div></div>
              </div>
            </Card>
          </div>

          <Card className="p-5">
            <h2 className="font-semibold">30-day regression trend</h2>
            <div className="mt-4 space-y-2">
              {(dashboard?.trend || []).length === 0 ? <div className="text-[12px] text-[var(--muted)]">No continuous QA runs yet.</div> : (dashboard?.trend || []).slice(-14).map((item) => {
                const pass = item.total ? Math.round((item.passed / item.total) * 100) : 0;
                return <div key={item.day} className="grid grid-cols-[110px_1fr_70px] items-center gap-3 text-[11px]"><span>{new Date(item.day).toLocaleDateString()}</span><div className="h-2 rounded-full bg-[var(--surface-secondary)]"><div className="h-2 rounded-full bg-[var(--success)]" style={{ width: pass + "%" }} /></div><span className="text-right">{item.passed}/{item.total}</span></div>;
              })}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-[var(--border-subtle)] px-5 py-4 font-semibold">Recent continuous QA runs</div>
            <RunTable runs={(dashboard?.recent || []).slice(0, 8)} />
          </Card>
        </div>
      ) : null}

      {tab === "schedules" ? (
        <div className="space-y-5">
          {canManage ? (
            <Card className="p-5">
              <h2 className="font-semibold">New schedule / trigger</h2>
              <form onSubmit={createSchedule} className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <label className={labelClass}>Name<input className={inputClass} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
                <label className={labelClass}>Trigger<select className={inputClass} value={form.scheduleType} onChange={(e) => setForm({ ...form, scheduleType: e.target.value as typeof form.scheduleType })}><option value="event">Build event</option><option value="daily">Daily</option><option value="recurring">Interval</option><option value="one_time">One-time</option></select></label>
                <label className={labelClass}>Repository filter<input className={inputClass} value={form.repository} onChange={(e) => setForm({ ...form, repository: e.target.value })} placeholder="optional" /></label>
                <label className={labelClass}>Branch filter<input className={inputClass} value={form.branchFilter} onChange={(e) => setForm({ ...form, branchFilter: e.target.value })} placeholder="main" /></label>
                <label className={labelClass}>Environment<input className={inputClass} value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })} /></label>
                {form.scheduleType === "event" ? <label className={labelClass}>Event<select className={inputClass} value={form.eventType} onChange={(e) => setForm({ ...form, eventType: e.target.value as typeof form.eventType })}><option value="build_deployed">Build deployed</option><option value="build_registered">Build registered</option><option value="pr_updated">PR updated</option></select></label> : null}
                {form.scheduleType === "daily" ? <><label className={labelClass}>Daily time<input type="time" className={inputClass} value={form.dailyTime} onChange={(e) => setForm({ ...form, dailyTime: e.target.value })} /></label><label className={labelClass}>Timezone<input className={inputClass} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></label></> : null}
                {form.scheduleType === "recurring" ? <label className={labelClass}>Interval minutes<input type="number" min={5} max={10080} className={inputClass} value={form.intervalMinutes} onChange={(e) => setForm({ ...form, intervalMinutes: Number(e.target.value) })} /></label> : null}
                {form.scheduleType === "one_time" ? <label className={labelClass}>Run at<input type="datetime-local" className={inputClass} value={form.runAt} onChange={(e) => setForm({ ...form, runAt: e.target.value })} /></label> : null}
                <label className={labelClass}>Desired shards<input type="number" min={1} max={32} className={inputClass} value={form.desiredShards} onChange={(e) => setForm({ ...form, desiredShards: Number(e.target.value) })} /></label>
                <label className={labelClass}>Max parallel workers<input type="number" min={1} max={32} className={inputClass} value={form.maxParallelism} onChange={(e) => setForm({ ...form, maxParallelism: Number(e.target.value) })} /></label>
                <label className={labelClass}>Retry limit<input type="number" min={0} max={5} className={inputClass} value={form.retryLimit} onChange={(e) => setForm({ ...form, retryLimit: Number(e.target.value) })} /></label>
                <label className={labelClass}>Stuck after minutes<input type="number" min={5} max={1440} className={inputClass} value={form.stuckAfterMinutes} onChange={(e) => setForm({ ...form, stuckAfterMinutes: Number(e.target.value) })} /></label>
                <div className="md:col-span-2 xl:col-span-4 flex justify-end"><Button type="submit" disabled={busy === "create-schedule"}>{busy === "create-schedule" ? "Creating…" : "Create schedule"}</Button></div>
              </form>
            </Card>
          ) : null}

          <Card className="overflow-hidden">
            <div className="border-b border-[var(--border-subtle)] px-5 py-4 font-semibold">Configured schedules</div>
            <div className="divide-y divide-[var(--border-subtle)]">
              {schedules.length === 0 ? <div className="p-6 text-[12px] text-[var(--muted)]">No schedules configured.</div> : schedules.map((s) => (
                <div key={s.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                  <div><div className="font-medium">{s.name}</div><div className="mt-1 text-[11px] text-[var(--muted)]">{scheduleLabel(s)} · {s.environment || "any environment"} · {s.desiredShards} shard target · {s.maxParallelism} max parallel</div><div className="mt-1 text-[11px] text-[var(--muted-soft)]">Next: {formatDate(s.nextRunAt)} · Last: {formatDate(s.lastRunAt)} <span className={tone(s.lastStatus)}>· {s.lastStatus || "never run"}</span></div></div>
                  {canManage ? <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => void action("toggle-" + s.id, async () => { await updateQaAutomationSchedule(s.id, { enabled: !s.enabled }); await refresh(); })}>{s.enabled ? "Disable" : "Enable"}</Button><Button size="sm" variant="destructive" onClick={() => void action("delete-" + s.id, async () => { await deleteQaAutomationSchedule(s.id); await refresh(); })}>Delete</Button></div> : null}
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "runs" ? <Card className="overflow-hidden"><div className="border-b border-[var(--border-subtle)] px-5 py-4 font-semibold">Automation runs</div><RunTable runs={runs} /></Card> : null}

      {tab === "alerts" ? (
        <Card className="overflow-hidden">
          <div className="border-b border-[var(--border-subtle)] px-5 py-4 font-semibold">Open alerts & escalations</div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {alerts.length === 0 ? <div className="p-6 text-[12px] text-[var(--muted)]">No open QA automation alerts.</div> : alerts.map((a) => (
              <div key={a.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
                <div><div className={"text-[11px] font-semibold uppercase " + tone(a.severity)}>{a.severity} · {a.alertType.replaceAll("_", " ")}</div><div className="mt-1 font-medium">{a.title}</div><div className="mt-1 text-[12px] text-[var(--muted)]">{a.body || "—"}</div><div className="mt-1 text-[10px] text-[var(--muted-soft)]">{formatDate(a.createdAt)}</div></div>
                <Button size="sm" variant="secondary" disabled={busy === "ack-" + a.id} onClick={() => void action("ack-" + a.id, async () => { await acknowledgeQaAutomationAlert(projectId, a.id); await refresh(); })}>Acknowledge</Button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {tab === "workers" ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="p-5">
            <h2 className="font-semibold">Worker contract</h2>
            <p className="mt-2 text-[12px] leading-5 text-[var(--muted)]">Playwright/API workers use a project-scoped API token. They claim one duration-balanced shard, heartbeat while executing, report testcase results/evidence through the existing Automation Ingest API, close the normal RUN-n cycle, then complete the shard with its claim token.</p>
            <div className="mt-4 rounded-lg bg-[var(--surface-secondary)] p-3 font-mono text-[11px] leading-5 text-[var(--muted)]">
              POST /qa-automation/workers/claim<br />
              POST /qa-automation/shards/:id/heartbeat<br />
              POST /automation/runs/:RUN/results<br />
              POST /automation/runs/:RUN/results/:case/evidence<br />
              PATCH /automation/runs/:RUN/close<br />
              POST /qa-automation/shards/:id/complete
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="font-semibold">Recovery policy</h2>
            <div className="mt-4 space-y-2 text-[12px] text-[var(--muted)]">
              <div>• Longest-processing-time sharding uses recent execution durations.</div>
              <div>• Each run enforces configured max parallelism.</div>
              <div>• Failed/blocked shards retry with bounded exponential backoff.</div>
              <div>• Missing heartbeat requeues a shard until retry budget is exhausted.</div>
              <div>• Exhausted shards become stuck and raise a critical alert.</div>
              <div>• Certified releases are rechecked every watchdog cycle and can become stale/revoked automatically.</div>
            </div>
          </Card>
        </div>
      ) : null}
    </StandardPageLayout>
  );
}

function RunTable({ runs }: { runs: QaAutomationRunSummary[] }) {
  if (!runs.length) return <div className="p-6 text-[12px] text-[var(--muted)]">No continuous QA runs yet.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="tesbo-table">
        <thead><tr><th className="px-4 py-3">Build</th><th className="px-4 py-3">Trigger</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Shards</th><th className="px-4 py-3">Risk</th><th className="px-4 py-3">Started</th></tr></thead>
        <tbody>{runs.map((r) => <tr key={r.id}><td className="px-4 py-3"><div>{r.releaseName || r.buildVersion || "Build"}</div><div className="font-mono text-[10px] text-[var(--muted)]">{r.gitSha?.slice(0, 12) || r.buildId?.slice(0, 8) || "—"}</div></td><td className="px-4 py-3">{r.triggerSource}</td><td className={"px-4 py-3 font-semibold " + tone(r.status)}>{r.status.replaceAll("_", " ")}</td><td className="px-4 py-3 text-[11px]">{r.shardsPassed || 0} pass · {r.shardsRunning || 0} run · {r.shardsQueued || 0} wait · {(r.shardsFailed || 0) + (r.shardsBlocked || 0) + (r.shardsStuck || 0)} issue</td><td className="px-4 py-3">{r.riskBand || "—"}{r.riskScore != null ? " " + r.riskScore : ""}</td><td className="px-4 py-3 text-[11px]">{formatDate(r.startedAt || r.createdAt)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
