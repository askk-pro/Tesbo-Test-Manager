"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconSearch,
  IconTicket,
  IconArrowRight,
  IconRefresh,
} from "@tabler/icons-react";
import {
  listQaTickets,
  searchQaReferences,
  type BugItem,
  type QaReferenceMatch,
} from "@/lib/api";
import { Button, Card, Input, PageLoader, PriorityBadge, SeverityBadge, StatusChip } from "@/components/ui";
import { Breadcrumbs, PageHeader, StandardPageLayout } from "@/components/workflows";

const STATUS_TONE: Record<string, "error" | "success" | "info" | "warning" | "neutral"> = {
  Open: "error",
  Closed: "success",
  "In Progress": "info",
  Reopened: "warning",
};

function ticketRef(ticket: BugItem) {
  return ticket.humanId || ticket.externalId || ticket.id;
}

export default function QaTicketsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = String(params.id);
  const [tickets, setTickets] = useState<BugItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<QaReferenceMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTickets(await listQaTickets(projectId, status ? { status } : undefined));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load QA tickets.");
    } finally {
      setLoading(false);
    }
  }, [projectId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setMatches([]);
      setSearching(false);
      return;
    }
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const result = await searchQaReferences(projectId, q);
        setMatches(result.matches);
      } catch {
        setMatches([]);
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [projectId, query]);

  const summary = useMemo(() => ({
    open: tickets.filter((t) => t.status === "Open" || t.status === "Reopened").length,
    progress: tickets.filter((t) => t.status === "In Progress").length,
    closed: tickets.filter((t) => t.status === "Closed").length,
    critical: tickets.filter((t) => t.severity === "Critical").length,
  }), [tickets]);

  if (loading && tickets.length === 0) return <PageLoader label="Loading QA tickets…" />;

  return (
    <StandardPageLayout
      header={
        <PageHeader
          breadcrumb={<Breadcrumbs items={[{ label: "Project", href: `/projects/${projectId}` }, { label: "QA Tickets" }]} />}
          title={
            <>
              <IconTicket size={28} />
              QA Tickets
            </>
          }
          subtitle="The working queue for defects and QA issues, with human IDs, traceability, evidence and governed retests."
          actions={
            <Button variant="secondary" onClick={() => void load()}>
              <IconRefresh size={16} />
              Refresh
            </Button>
          }
        />
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Open / reopened", summary.open],
          ["In progress", summary.progress],
          ["Closed", summary.closed],
          ["Critical", summary.critical],
        ].map(([label, value]) => (
          <Card key={String(label)} className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted-soft)]">{label}</div>
            <div className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{value}</div>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-soft)]" size={17} />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search QA-184, TC-291, REQ-93, RUN-42 or a title…"
              className="pl-9"
            />
            {(query.trim() || searching) && (
              <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] shadow-xl">
                {searching ? (
                  <div className="px-4 py-3 text-sm text-[var(--muted)]">Searching…</div>
                ) : matches.length ? (
                  matches.map((match) => (
                    <button
                      key={`${match.kind}:${match.id}`}
                      type="button"
                      onClick={() => router.push(match.href)}
                      className="flex w-full items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3 text-left last:border-b-0 hover:bg-[var(--surface-raised)]"
                    >
                      <span className="rounded bg-[var(--brand-soft)] px-2 py-1 font-mono text-xs font-semibold text-[var(--accent-light)]">
                        {match.humanId}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-[var(--foreground)]">{match.title}</span>
                      <span className="text-xs uppercase text-[var(--muted-soft)]">{match.kind}</span>
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-3 text-sm text-[var(--muted)]">No matching QA references.</div>
                )}
              </div>
            )}
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 text-sm text-[var(--foreground)]"
          >
            <option value="">All statuses</option>
            <option>Open</option>
            <option>In Progress</option>
            <option>Reopened</option>
            <option>Closed</option>
          </select>
        </div>
      </Card>

      {error ? (
        <Card className="border-[var(--error)]/30 p-5 text-sm text-[var(--status-fail-text)]">{error}</Card>
      ) : null}

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_120px_110px_90px_36px] gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-soft)]">
          <span>Ticket</span>
          <span>Status</span>
          <span>Severity</span>
          <span>Priority</span>
          <span />
        </div>
        {tickets.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-[var(--muted)]">No QA tickets match this view.</div>
        ) : (
          tickets.map((ticket) => {
            const ref = ticketRef(ticket);
            return (
              <Link
                key={ticket.id}
                href={`/projects/${projectId}/qa-tickets/${encodeURIComponent(ref)}`}
                className="grid grid-cols-[minmax(0,1fr)_120px_110px_90px_36px] gap-3 border-b border-[var(--border-subtle)] px-4 py-4 last:border-b-0 hover:bg-[var(--surface-raised)]"
              >
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-[var(--accent-light)]">{ref}</span>
                    {ticket.integrationIssueKey ? (
                      <span className="text-[11px] text-[var(--muted-soft)]">{ticket.integrationIssueKey}</span>
                    ) : null}
                  </div>
                  <div className="truncate text-sm font-medium text-[var(--foreground)]">{ticket.title}</div>
                  {ticket.description ? (
                    <div className="mt-1 line-clamp-1 text-xs text-[var(--muted)]">{ticket.description}</div>
                  ) : null}
                </div>
                <div><StatusChip tone={STATUS_TONE[ticket.status] || "neutral"}>{ticket.status}</StatusChip></div>
                <div><SeverityBadge severity={ticket.severity} /></div>
                <div>{ticket.priority ? <PriorityBadge priority={ticket.priority} /> : <span className="text-xs text-[var(--muted-soft)]">—</span>}</div>
                <IconArrowRight size={18} className="mt-1 text-[var(--muted-soft)]" />
              </Link>
            );
          })
        )}
      </Card>
    </StandardPageLayout>
  );
}
