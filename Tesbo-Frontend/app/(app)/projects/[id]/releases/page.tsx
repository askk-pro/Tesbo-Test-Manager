"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createReleaseEnvironment,
  createReleasePromotion,
  decideReleasePromotion,
  listQaBuilds,
  listReleaseEnvironments,
  listReleasePromotions,
  refreshReleaseDeployment,
  refreshReleasePromotion,
  refreshReleaseVerification,
  startReleaseDeployment,
  startReleaseVerification,
  type QaBuildRecord,
  type ReleaseEnvironment,
  type ReleasePromotion,
} from "@/lib/api";
import { useAppData } from "@/components/app/AppDataProvider";
import { useProjectData } from "@/components/project/ProjectDataProvider";
import { Button, Card, PageLoader } from "@/components/ui";
import { PageHeader, StandardPageLayout } from "@/components/workflows";

type Tab = "promotions" | "environments";

const inputClass =
  "mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-[13px] text-[var(--foreground)] outline-none";
const labelClass = "text-[12px] font-medium text-[var(--muted)]";

function tone(value?: string | null) {
  const v = String(value || "").toLowerCase();
  if (["approved", "successful", "known_good", "certified", "ready_for_approval"].includes(v)) {
    return "border-[var(--success)]/30 bg-[var(--success-soft)] text-[var(--success)]";
  }
  if (["blocked", "rejected", "deployment_failed", "verification_failed", "rolled_back"].includes(v)) {
    return "border-[var(--error)]/30 bg-[var(--error-soft)] text-[var(--status-fail-text)]";
  }
  if (["awaiting_qa", "deploying", "verifying", "observation"].includes(v)) {
    return "border-[var(--warning)]/30 bg-[var(--warning-soft)] text-[var(--warning-foreground)]";
  }
  return "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--muted)]";
}

function Badge({ value }: { value?: string | null }) {
  return (
    <span className={"inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize " + tone(value)}>
      {String(value || "unknown").replaceAll("_", " ")}
    </span>
  );
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

export default function ReleasesPage() {
  const params = useParams();
  const projectId = String(params.id);
  const { currentUser } = useAppData();
  const { projectMembers } = useProjectData();
  const role = projectMembers.find((member) => member.userId === currentUser?.userId)?.role || "";
  const canManage = role === "owner" || role === "manager";

  const [tab, setTab] = useState<Tab>("promotions");
  const [environments, setEnvironments] = useState<ReleaseEnvironment[]>([]);
  const [promotions, setPromotions] = useState<ReleasePromotion[]>([]);
  const [builds, setBuilds] = useState<QaBuildRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [environmentForm, setEnvironmentForm] = useState({
    name: "Production",
    environmentType: "production",
    url: "",
    provider: "kps",
    providerProjectRef: "",
    providerWorkloadRef: "",
    protected: true,
    requiredCertificationState: "READY",
    requiredApprovals: "1",
    minRegressionCoverage: "100",
    requireNoP0P1: true,
    requireSmoke: true,
    observationMinutes: "15",
  });

  const [promotionForm, setPromotionForm] = useState({
    buildId: "",
    sourceEnvironmentId: "",
    targetEnvironmentId: "",
  });

  const refresh = useCallback(async () => {
    setError("");
    const [envRows, promotionRows, buildRows] = await Promise.all([
      listReleaseEnvironments(projectId),
      listReleasePromotions(projectId, 100),
      listQaBuilds(projectId, 100),
    ]);
    setEnvironments(envRows);
    setPromotions(promotionRows);
    setBuilds(buildRows);
    setPromotionForm((prev) => ({
      buildId: prev.buildId || buildRows[0]?.id || "",
      sourceEnvironmentId: prev.sourceEnvironmentId,
      targetEnvironmentId: prev.targetEnvironmentId || envRows[0]?.id || "",
    }));
  }, [projectId]);

  useEffect(() => {
    let active = true;
    void refresh()
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [projectId, refresh]);

  useEffect(() => {
    if (!promotions.some((promotion) => ["deploying", "verifying"].includes(promotion.status))) return;
    const timer = window.setInterval(() => {
      void refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [promotions, refresh]);

  const protectedCount = environments.filter((env) => env.protected).length;
  const activePromotionCount = promotions.filter((promotion) =>
    ["draft", "awaiting_qa", "ready_for_approval", "approved", "deploying", "verifying", "observation"].includes(
      promotion.status,
    ),
  ).length;
  const knownGoodCount = environments.filter((env) => env.knownGoodGitSha || env.knownGoodBuildId).length;
  const targetEnvironment = useMemo(
    () => environments.find((env) => env.id === promotionForm.targetEnvironmentId) || null,
    [environments, promotionForm.targetEnvironmentId],
  );

  async function submitEnvironment(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage) return;
    setBusy("environment");
    setError("");
    setNotice("");
    try {
      await createReleaseEnvironment(projectId, {
        name: environmentForm.name.trim(),
        environmentType: environmentForm.environmentType as ReleaseEnvironment["environmentType"],
        url: environmentForm.url.trim() || null,
        provider: environmentForm.provider.trim() || "kps",
        providerProjectRef: environmentForm.providerProjectRef.trim() || null,
        providerWorkloadRef: environmentForm.providerWorkloadRef.trim() || null,
        protected: environmentForm.protected,
        requiredCertificationState:
          environmentForm.requiredCertificationState as ReleaseEnvironment["requiredCertificationState"],
        requiredApprovals: Number(environmentForm.requiredApprovals),
        minRegressionCoverage: Number(environmentForm.minRegressionCoverage),
        requireNoP0P1: environmentForm.requireNoP0P1,
        requireSmoke: environmentForm.requireSmoke,
        observationMinutes: Number(environmentForm.observationMinutes),
      });
      setNotice("Release environment created.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function submitPromotion(event: React.FormEvent) {
    event.preventDefault();
    if (!promotionForm.buildId || !promotionForm.targetEnvironmentId) return;
    setBusy("promotion");
    setError("");
    setNotice("");
    try {
      const created = await createReleasePromotion(projectId, {
        buildId: promotionForm.buildId,
        targetEnvironmentId: promotionForm.targetEnvironmentId,
        ...(promotionForm.sourceEnvironmentId ? { sourceEnvironmentId: promotionForm.sourceEnvironmentId } : {}),
      });
      setNotice(
        created.status === "awaiting_qa"
          ? "Promotion requested. QA/certification policy must be satisfied before approval."
          : "Promotion requested and ready for human approval.",
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function refreshPolicy(promotionId: string) {
    setBusy("refresh-" + promotionId);
    setError("");
    try {
      await refreshReleasePromotion(projectId, promotionId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function deployPromotion(promotionId: string) {
    setBusy("deploy-" + promotionId);
    setError("");
    setNotice("");
    try {
      const deployed = await startReleaseDeployment(projectId, promotionId);
      setNotice(
        deployed.providerDeploymentId
          ? "Deployment queued in KPS. Provenance monitoring is running automatically."
          : "Deployment started. Provenance monitoring is running automatically.",
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function checkDeployment(promotionId: string) {
    setBusy("deployment-" + promotionId);
    setError("");
    try {
      await refreshReleaseDeployment(projectId, promotionId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function startVerification(promotionId: string) {
    setBusy("verify-" + promotionId);
    setError("");
    setNotice("");
    try {
      const result = await startReleaseVerification(projectId, promotionId);
      setNotice(
        result.verificationAutomationRunId
          ? "Post-deployment verification is running through the Phase-6 worker queue."
          : "Post-deployment verification was queued.",
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function checkVerification(promotionId: string) {
    setBusy("verification-" + promotionId);
    setError("");
    try {
      await refreshReleaseVerification(projectId, promotionId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function decide(promotionId: string, decision: "approve" | "reject") {
    const comment =
      decision === "reject"
        ? window.prompt("Reason for rejecting this promotion:")
        : window.prompt("Approval comment (optional):") || "";
    if (decision === "reject" && !comment?.trim()) return;
    setBusy(decision + "-" + promotionId);
    setError("");
    try {
      await decideReleasePromotion(projectId, promotionId, { decision, comment: comment?.trim() || undefined });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  if (loading) return <PageLoader />;

  return (
    <StandardPageLayout>
      <PageHeader
        title="Releases"
        subtitle="Govern build promotion from certified QA evidence through approval, deployment verification and Known Good."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={Boolean(busy)} onClick={() => void refresh()}>
              Refresh
            </Button>
            <Link
              href={"/projects/" + projectId + "/release-qa"}
              className="inline-flex items-center rounded-md border border-[var(--border)] px-3 py-2 text-[12px] font-medium"
            >
              Release QA
            </Link>
            <Link
              href={"/projects/" + projectId + "/qa-operations"}
              className="inline-flex items-center rounded-md border border-[var(--border)] px-3 py-2 text-[12px] font-medium"
            >
              QA Operations
            </Link>
          </div>
        }
      />

      {error ? <div className="mb-4 rounded-lg border border-[var(--error)]/30 bg-[var(--error-soft)] p-3 text-sm text-[var(--status-fail-text)]">{error}</div> : null}
      {notice ? <div className="mb-4 rounded-lg border border-[var(--success)]/30 bg-[var(--success-soft)] p-3 text-sm text-[var(--success)]">{notice}</div> : null}

      <div className="grid gap-3 md:grid-cols-4">
        <Metric title="Environments" value={environments.length} note="Durable release targets" />
        <Metric title="Protected" value={protectedCount} note="Policy-gated targets" />
        <Metric title="Active promotions" value={activePromotionCount} note="Awaiting QA/approval/deployment" />
        <Metric title="Known Good" value={knownGoodCount} note="Established after verification + observation" />
      </div>

      <div className="mt-5 flex gap-2 border-b border-[var(--border)]">
        {(["promotions", "environments"] as Tab[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={
              "border-b-2 px-3 py-2 text-[12px] font-semibold capitalize " +
              (tab === item ? "border-[var(--foreground)] text-[var(--foreground)]" : "border-transparent text-[var(--muted)]")
            }
          >
            {item}
          </button>
        ))}
      </div>

      {tab === "promotions" ? (
        <div className="mt-5 space-y-5">
          <Card className="p-5">
            <h2 className="font-semibold">Request promotion</h2>
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              A request is evaluated against the target environment policy and the build&apos;s latest Phase-6 certification.
            </p>
            <form onSubmit={submitPromotion} className="mt-4 grid gap-3 md:grid-cols-4">
              <label className={labelClass}>
                Build
                <select className={inputClass} value={promotionForm.buildId} onChange={(e) => setPromotionForm({ ...promotionForm, buildId: e.target.value })}>
                  <option value="">Select build</option>
                  {builds.map((build) => (
                    <option key={build.id} value={build.id}>
                      {build.releaseName || build.buildVersion || build.gitSha.slice(0, 12)} · {build.gitSha.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                From
                <select className={inputClass} value={promotionForm.sourceEnvironmentId} onChange={(e) => setPromotionForm({ ...promotionForm, sourceEnvironmentId: e.target.value })}>
                  <option value="">Build / unassigned</option>
                  {environments.map((env) => <option key={env.id} value={env.id}>{env.name}</option>)}
                </select>
              </label>
              <label className={labelClass}>
                Target
                <select className={inputClass} value={promotionForm.targetEnvironmentId} onChange={(e) => setPromotionForm({ ...promotionForm, targetEnvironmentId: e.target.value })}>
                  <option value="">Select target</option>
                  {environments.map((env) => <option key={env.id} value={env.id}>{env.name}{env.protected ? " · protected" : ""}</option>)}
                </select>
              </label>
              <div className="flex items-end">
                <Button type="submit" disabled={busy === "promotion" || !promotionForm.buildId || !promotionForm.targetEnvironmentId}>
                  Request promotion
                </Button>
              </div>
            </form>
            {targetEnvironment ? (
              <div className="mt-3 text-[11px] text-[var(--muted)]">
                Target policy: certification {targetEnvironment.requiredCertificationState} · {targetEnvironment.requiredApprovals} approval(s) · {Number(targetEnvironment.minRegressionCoverage)}% regression · smoke {targetEnvironment.requireSmoke ? "required" : "optional"} · observation {targetEnvironment.observationMinutes} min
              </div>
            ) : null}
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-[var(--border)] px-5 py-4">
              <h2 className="font-semibold">Promotion queue</h2>
              <p className="mt-1 text-[11px] text-[var(--muted)]">Approved releases deploy through KPS at the exact requested Git SHA; provider provenance is monitored server-side.</p>
            </div>
            {promotions.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--muted)]">No release promotions yet.</div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {promotions.map((promotion) => {
                  const blockers = promotion.policySnapshot?.evaluation?.blockers || [];
                  const requiredApprovals = Number((promotion.policySnapshot?.rules as { requiredApprovals?: number } | undefined)?.requiredApprovals || 0);
                  return (
                    <div key={promotion.id} className="p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{promotion.releaseName || promotion.buildVersion || promotion.gitSha?.slice(0, 12) || "Build"} → {promotion.targetEnvironmentName}</div>
                          <div className="mt-1 font-mono text-[10px] text-[var(--muted)]">{promotion.gitSha || promotion.buildId}</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Badge value={promotion.status} />
                            {promotion.certificationState ? <Badge value={promotion.certificationState} /> : null}
                            <span className="text-[11px] text-[var(--muted)]">{promotion.approvalCount || 0}/{Math.max(1, requiredApprovals)} approvals</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="secondary" disabled={Boolean(busy)} onClick={() => void refreshPolicy(promotion.id)}>Refresh policy</Button>
                          {canManage && ["ready_for_approval"].includes(promotion.status) ? (
                            <Button disabled={Boolean(busy)} onClick={() => void decide(promotion.id, "approve")}>Approve</Button>
                          ) : null}
                          {canManage && promotion.status === "approved" ? (
                            <Button disabled={Boolean(busy)} onClick={() => void deployPromotion(promotion.id)}>Deploy exact SHA</Button>
                          ) : null}
                          {canManage && promotion.status === "deploying" ? (
                            <Button variant="secondary" disabled={Boolean(busy)} onClick={() => void checkDeployment(promotion.id)}>Check deployment</Button>
                          ) : null}
                          {canManage && promotion.status === "verifying" && !promotion.verificationAutomationRunId ? (
                            <Button disabled={Boolean(busy)} onClick={() => void startVerification(promotion.id)}>Start verification</Button>
                          ) : null}
                          {canManage && promotion.status === "verifying" && promotion.verificationAutomationRunId ? (
                            <Button variant="secondary" disabled={Boolean(busy)} onClick={() => void checkVerification(promotion.id)}>Check verification</Button>
                          ) : null}
                          {canManage && ["awaiting_qa", "ready_for_approval"].includes(promotion.status) ? (
                            <Button variant="secondary" disabled={Boolean(busy)} onClick={() => void decide(promotion.id, "reject")}>Reject</Button>
                          ) : null}
                        </div>
                      </div>
                      {(promotion.providerDeploymentId || promotion.requestedGitSha || promotion.deployedGitSha) ? (
                        <div className="mt-3 grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-[11px] md:grid-cols-2">
                          <div><span className="text-[var(--muted-soft)]">KPS deployment</span><div className="font-mono">{promotion.providerDeploymentId || "requesting"}</div></div>
                          <div><span className="text-[var(--muted-soft)]">Provider status</span><div>{promotion.providerDeploymentStatus || "pending"}</div></div>
                          <div><span className="text-[var(--muted-soft)]">Requested SHA</span><div className="font-mono break-all">{promotion.requestedGitSha || "—"}</div></div>
                          <div><span className="text-[var(--muted-soft)]">Deployed SHA</span><div className="font-mono break-all">{promotion.deployedGitSha || "not observed yet"}</div></div>
                          <div><span className="text-[var(--muted-soft)]">Provenance</span><div><Badge value={promotion.provenanceStatus || "pending"} /></div></div>
                          <div><span className="text-[var(--muted-soft)]">Artifact</span><div className="font-mono break-all">{promotion.providerArtifactRef || "not reported yet"}</div></div>
                          {promotion.providerConfigurationHash ? <div className="md:col-span-2"><span className="text-[var(--muted-soft)]">Provider configuration hash</span><div className="font-mono break-all">{promotion.providerConfigurationHash}</div></div> : null}
                          {promotion.failureReason ? <div className="md:col-span-2 text-[var(--status-fail-text)]">{promotion.failureReason}</div> : null}
                        </div>
                      ) : null}
                      {promotion.verificationAutomationRunId || promotion.verificationStatus ? (
                        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-[11px] text-[var(--muted)]">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-[var(--foreground)]">Post-deployment verification</span>
                            <Badge value={promotion.verificationStatus || "queued"} />
                            {promotion.rollbackEligible ? <Badge value="rollback eligible" /> : null}
                          </div>
                          <div className="mt-1 font-mono">
                            Run: {promotion.verificationAutomationRunId || "pending"} · checked {promotion.verificationCheckedAt ? new Date(promotion.verificationCheckedAt).toLocaleString() : "not yet"}
                          </div>
                        </div>
                      ) : null}
                      {blockers.length ? (
                        <div className="mt-3 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-soft)] p-3">
                          <div className="text-[11px] font-semibold text-[var(--warning-foreground)]">Policy blockers</div>
                          <ul className="mt-1 space-y-1 text-[11px] text-[var(--muted)]">
                            {blockers.map((blocker) => <li key={blocker.code}>• {blocker.message}</li>)}
                          </ul>
                        </div>
                      ) : (
                        <div className="mt-3 text-[11px] text-[var(--success)]">Policy evidence is clean for this target.</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {canManage ? (
            <Card className="p-5">
              <h2 className="font-semibold">Add release environment</h2>
              <form onSubmit={submitEnvironment} className="mt-4 grid gap-3 md:grid-cols-4">
                <label className={labelClass}>Name<input className={inputClass} value={environmentForm.name} onChange={(e) => setEnvironmentForm({ ...environmentForm, name: e.target.value })} /></label>
                <label className={labelClass}>
                  Type
                  <select className={inputClass} value={environmentForm.environmentType} onChange={(e) => setEnvironmentForm({ ...environmentForm, environmentType: e.target.value })}>
                    {["development", "qa", "staging", "uat", "production", "custom"].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <label className={labelClass}>URL<input className={inputClass} placeholder="https://app.example.com" value={environmentForm.url} onChange={(e) => setEnvironmentForm({ ...environmentForm, url: e.target.value })} /></label>
                <label className={labelClass}>
                  Provider
                  <select className={inputClass} value={environmentForm.provider} onChange={(e) => setEnvironmentForm({ ...environmentForm, provider: e.target.value })}>
                    <option value="kps">KPS / Coolify</option>
                    <option value="manual">Manual</option>
                  </select>
                </label>
                <label className={labelClass}>KPS project ID<input className={inputClass} placeholder="cmu..." value={environmentForm.providerProjectRef} onChange={(e) => setEnvironmentForm({ ...environmentForm, providerProjectRef: e.target.value })} /></label>
                <label className={labelClass}>KPS workload ID<input className={inputClass} placeholder="cmu..." value={environmentForm.providerWorkloadRef} onChange={(e) => setEnvironmentForm({ ...environmentForm, providerWorkloadRef: e.target.value })} /></label>
                <label className={labelClass}>
                  Certification
                  <select className={inputClass} value={environmentForm.requiredCertificationState} onChange={(e) => setEnvironmentForm({ ...environmentForm, requiredCertificationState: e.target.value })}>
                    {["NONE", "READY", "APPROVED", "CERTIFIED"].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <label className={labelClass}>Approvals<input className={inputClass} type="number" min={1} max={20} value={environmentForm.requiredApprovals} onChange={(e) => setEnvironmentForm({ ...environmentForm, requiredApprovals: e.target.value })} /></label>
                <label className={labelClass}>Min regression %<input className={inputClass} type="number" min={0} max={100} value={environmentForm.minRegressionCoverage} onChange={(e) => setEnvironmentForm({ ...environmentForm, minRegressionCoverage: e.target.value })} /></label>
                <label className={labelClass}>Observation minutes<input className={inputClass} type="number" min={0} max={10080} value={environmentForm.observationMinutes} onChange={(e) => setEnvironmentForm({ ...environmentForm, observationMinutes: e.target.value })} /></label>
                <label className="flex items-center gap-2 text-[12px] text-[var(--muted)]"><input type="checkbox" checked={environmentForm.protected} onChange={(e) => setEnvironmentForm({ ...environmentForm, protected: e.target.checked })} />Protected environment</label>
                <label className="flex items-center gap-2 text-[12px] text-[var(--muted)]"><input type="checkbox" checked={environmentForm.requireNoP0P1} onChange={(e) => setEnvironmentForm({ ...environmentForm, requireNoP0P1: e.target.checked })} />Block open P0/P1</label>
                <label className="flex items-center gap-2 text-[12px] text-[var(--muted)]"><input type="checkbox" checked={environmentForm.requireSmoke} onChange={(e) => setEnvironmentForm({ ...environmentForm, requireSmoke: e.target.checked })} />Require smoke coverage</label>
                <div><Button type="submit" disabled={busy === "environment" || !environmentForm.name.trim()}>Add environment</Button></div>
              </form>
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            {environments.map((env) => (
              <Card key={env.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{env.name}</div>
                    <div className="mt-1 text-[11px] capitalize text-[var(--muted)]">{env.environmentType} · {env.provider}</div>
                  </div>
                  <Badge value={env.protected ? "protected" : "standard"} />
                </div>
                {env.url ? <div className="mt-3 break-all text-[11px] text-[var(--muted)]">{env.url}</div> : null}
                {env.provider === "kps" ? (
                  <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-[10px] text-[var(--muted)]">
                    KPS project: <span className="font-mono">{env.providerProjectRef || "not configured"}</span><br />
                    Workload: <span className="font-mono">{env.providerWorkloadRef || "not configured"}</span>
                  </div>
                ) : null}
                <div className="mt-4 grid grid-cols-2 gap-3 text-[11px]">
                  <div><span className="text-[var(--muted-soft)]">Certification</span><div className="font-medium">{env.requiredCertificationState}</div></div>
                  <div><span className="text-[var(--muted-soft)]">Approvals</span><div className="font-medium">{env.requiredApprovals}</div></div>
                  <div><span className="text-[var(--muted-soft)]">Regression</span><div className="font-medium">{Number(env.minRegressionCoverage)}%</div></div>
                  <div><span className="text-[var(--muted-soft)]">Observation</span><div className="font-medium">{env.observationMinutes} min</div></div>
                </div>
                <div className="mt-4 border-t border-[var(--border)] pt-3 text-[11px] text-[var(--muted)]">
                  Current: <span className="font-mono">{env.currentGitSha?.slice(0, 12) || "not recorded"}</span><br />
                  Known Good: <span className="font-mono">{env.knownGoodGitSha?.slice(0, 12) || "not established"}</span>
                </div>
              </Card>
            ))}
          </div>
          {environments.length === 0 ? <Card className="p-8 text-center text-sm text-[var(--muted)]">No release environments configured yet.</Card> : null}
        </div>
      )}
    </StandardPageLayout>
  );
}
