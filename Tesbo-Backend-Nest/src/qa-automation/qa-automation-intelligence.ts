export type QaScheduleType = "one_time" | "daily" | "interval" | "event";

export interface ScheduleTimingInput {
  scheduleType: QaScheduleType;
  timezone?: string | null;
  dailyTime?: string | null;
  intervalMinutes?: number | null;
  runAt?: string | Date | null;
  lastRunAt?: string | Date | null;
  currentNextRunAt?: string | Date | null;
}

export interface DurationCase {
  testcaseId: string;
  estimatedDurationMs?: number | null;
}

export interface DurationShard {
  shardIndex: number;
  estimatedDurationMs: number;
  testcaseIds: string[];
}

function asDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

export function normalizeDailyTime(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new Error("dailyTime must use HH:MM in 24-hour time");
  return text;
}

export function validateTimezone(timezone: unknown): string {
  const tz = String(timezone || "UTC").trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
  } catch {
    throw new Error("timezone must be a valid IANA timezone");
  }
  return tz;
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
    second: pick("second"),
  };
}

function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  // Iteratively solve local wall-clock -> UTC. Two iterations are enough for ordinary IANA zones,
  // including DST transitions where the first offset estimate may be from the adjacent offset.
  const desiredWallClockMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = new Date(desiredWallClockMs);
  for (let i = 0; i < 3; i += 1) {
    const parts = zonedParts(guess, timeZone);
    const representedWallClockMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      0,
    );
    const delta = desiredWallClockMs - representedWallClockMs;
    if (Math.abs(delta) < 1000) break;
    guess = new Date(guess.getTime() + delta);
  }
  return guess;
}

function addLocalDays(parts: { year: number; month: number; day: number }, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function nextScheduleAt(input: ScheduleTimingInput, now = new Date()): Date | null {
  const type = input.scheduleType;
  if (type === "event") return null;

  if (type === "one_time") {
    const runAt = asDate(input.runAt);
    if (!runAt) throw new Error("runAt is required for one_time schedules");
    return runAt > now ? runAt : null;
  }

  if (type === "interval") {
    const interval = Number(input.intervalMinutes);
    if (!Number.isInteger(interval) || interval < 5 || interval > 10080) {
      throw new Error("intervalMinutes must be an integer from 5 to 10080");
    }
    const step = interval * 60_000;
    const anchor = asDate(input.lastRunAt) || asDate(input.currentNextRunAt) || now;
    let candidate = new Date(anchor.getTime() + (anchor === now ? step : step));
    while (candidate <= now) candidate = new Date(candidate.getTime() + step);
    return candidate;
  }

  if (type === "daily") {
    const timeZone = validateTimezone(input.timezone);
    const [hour, minute] = normalizeDailyTime(input.dailyTime).split(":").map(Number);
    const localNow = zonedParts(now, timeZone);
    let localDate = { year: localNow.year, month: localNow.month, day: localNow.day };
    let candidate = zonedLocalToUtc(localDate.year, localDate.month, localDate.day, hour, minute, timeZone);
    if (candidate <= now) {
      localDate = addLocalDays(localDate, 1);
      candidate = zonedLocalToUtc(localDate.year, localDate.month, localDate.day, hour, minute, timeZone);
    }
    return candidate;
  }

  throw new Error("Unsupported scheduleType");
}

export function durationAwareShards(cases: DurationCase[], desiredShards: number): DurationShard[] {
  const count = Math.max(1, Math.min(32, Math.floor(Number(desiredShards) || 1), Math.max(1, cases.length)));
  const shards: DurationShard[] = Array.from({ length: count }, (_, shardIndex) => ({
    shardIndex,
    estimatedDurationMs: 0,
    testcaseIds: [],
  }));

  const ordered = cases
    .map((item) => ({
      testcaseId: String(item.testcaseId),
      estimatedDurationMs: Math.max(1_000, Math.min(3_600_000, Number(item.estimatedDurationMs) || 30_000)),
    }))
    .filter((item) => item.testcaseId)
    .sort((a, b) => b.estimatedDurationMs - a.estimatedDurationMs || a.testcaseId.localeCompare(b.testcaseId));

  for (const item of ordered) {
    shards.sort((a, b) => a.estimatedDurationMs - b.estimatedDurationMs || a.shardIndex - b.shardIndex);
    const target = shards[0];
    target.testcaseIds.push(item.testcaseId);
    target.estimatedDurationMs += item.estimatedDurationMs;
  }

  return shards
    .sort((a, b) => a.shardIndex - b.shardIndex)
    .filter((shard) => shard.testcaseIds.length > 0);
}

export function retryDelayMs(attempt: number, retryBackoffSeconds: number): number {
  const safeAttempt = Math.max(1, Math.floor(Number(attempt) || 1));
  const base = Math.max(1, Math.min(3600, Math.floor(Number(retryBackoffSeconds) || 30))) * 1000;
  return Math.min(3_600_000, base * 2 ** Math.max(0, safeAttempt - 1));
}

export type QaShardStatus = "queued" | "claimed" | "running" | "passed" | "failed" | "blocked" | "cancelled" | "stuck";
export type QaRunStatus = "queued" | "planning" | "waiting_workers" | "running" | "passed" | "failed" | "blocked" | "partial" | "stuck" | "cancelled";

export function deriveAutomationRunStatus(statuses: QaShardStatus[]): QaRunStatus {
  if (!statuses.length) return "waiting_workers";
  if (statuses.some((status) => status === "running" || status === "claimed")) return "running";
  if (statuses.some((status) => status === "queued")) return "waiting_workers";
  if (statuses.every((status) => status === "cancelled")) return "cancelled";
  if (statuses.some((status) => status === "stuck")) return "stuck";
  if (statuses.some((status) => status === "blocked")) return "blocked";
  if (statuses.some((status) => status === "failed")) {
    return statuses.some((status) => status === "passed") ? "partial" : "failed";
  }
  if (statuses.every((status) => status === "passed" || status === "cancelled")) {
    return statuses.some((status) => status === "passed") ? "passed" : "cancelled";
  }
  return "partial";
}

export function shouldNotify(notifyOn: unknown, event: string): boolean {
  if (!Array.isArray(notifyOn)) return false;
  return notifyOn.map((item) => String(item).toLowerCase()).includes(String(event).toLowerCase());
}
