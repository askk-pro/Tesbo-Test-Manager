import {
  deriveAutomationRunStatus,
  durationAwareShards,
  nextScheduleAt,
  normalizeDailyTime,
  retryDelayMs,
  shouldNotify,
  validateTimezone,
} from "./qa-automation-intelligence";

describe("Phase 6 automation intelligence", () => {
  it("calculates one-time schedules only while still in the future", () => {
    const now = new Date("2026-10-02T10:00:00Z");
    expect(nextScheduleAt({ scheduleType: "one_time", runAt: "2026-10-02T11:00:00Z" }, now)?.toISOString())
      .toBe("2026-10-02T11:00:00.000Z");
    expect(nextScheduleAt({ scheduleType: "one_time", runAt: "2026-10-02T09:00:00Z" }, now)).toBeNull();
  });

  it("calculates a timezone-safe daily next run", () => {
    const before = nextScheduleAt(
      { scheduleType: "daily", timezone: "Asia/Kolkata", dailyTime: "23:30" },
      new Date("2026-10-02T12:00:00Z"),
    );
    expect(before?.toISOString()).toBe("2026-10-02T18:00:00.000Z");

    const after = nextScheduleAt(
      { scheduleType: "daily", timezone: "Asia/Kolkata", dailyTime: "23:30" },
      new Date("2026-10-02T19:00:00Z"),
    );
    expect(after?.toISOString()).toBe("2026-10-03T18:00:00.000Z");
  });

  it("validates timezone and HH:MM inputs", () => {
    expect(validateTimezone("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(() => validateTimezone("Mars/Olympus")).toThrow();
    expect(normalizeDailyTime("09:05")).toBe("09:05");
    expect(() => normalizeDailyTime("9:5")).toThrow();
  });

  it("advances interval schedules past now", () => {
    const next = nextScheduleAt({
      scheduleType: "interval",
      intervalMinutes: 30,
      lastRunAt: "2026-10-02T08:00:00Z",
    }, new Date("2026-10-02T10:10:00Z"));
    expect(next?.toISOString()).toBe("2026-10-02T10:30:00.000Z");
  });

  it("balances long tests across shards using longest-processing-time first", () => {
    const shards = durationAwareShards([
      { testcaseId: "a", estimatedDurationMs: 90_000 },
      { testcaseId: "b", estimatedDurationMs: 70_000 },
      { testcaseId: "c", estimatedDurationMs: 50_000 },
      { testcaseId: "d", estimatedDurationMs: 30_000 },
    ], 2);
    expect(shards).toHaveLength(2);
    const durations = shards.map((item) => item.estimatedDurationMs).sort((a, b) => a - b);
    expect(durations[1] - durations[0]).toBeLessThanOrEqual(20_000);
    expect(shards.flatMap((item) => item.testcaseIds).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("uses a bounded exponential retry backoff", () => {
    expect(retryDelayMs(1, 30)).toBe(30_000);
    expect(retryDelayMs(2, 30)).toBe(60_000);
    expect(retryDelayMs(20, 3600)).toBe(3_600_000);
  });

  it("derives the aggregate operational run state without hiding failures", () => {
    expect(deriveAutomationRunStatus(["passed", "passed"])).toBe("passed");
    expect(deriveAutomationRunStatus(["passed", "failed"])).toBe("partial");
    expect(deriveAutomationRunStatus(["failed", "failed"])).toBe("failed");
    expect(deriveAutomationRunStatus(["passed", "blocked"])).toBe("blocked");
    expect(deriveAutomationRunStatus(["running", "passed"])).toBe("running");
    expect(deriveAutomationRunStatus(["stuck", "passed"])).toBe("stuck");
  });

  it("honors explicit notification event preferences", () => {
    expect(shouldNotify(["failed", "stuck"], "failed")).toBe(true);
    expect(shouldNotify(["failed", "stuck"], "passed")).toBe(false);
  });
});
