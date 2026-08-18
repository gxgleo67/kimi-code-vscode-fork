/**
 * Scenario: managed (subscription) usage data is shaped for the webview usage status bar.
 * Responsibilities: verify hour-window picking, ratio/percent math, token formatting, and reset countdowns.
 * Wiring: the pure helpers from shared/managed-usage are used directly; there are no stubs.
 * Run: pnpm --filter kimi-code exec vitest run --config vitest.config.ts test/managed-usage.test.ts
 */

import { describe, expect, it } from "vitest";

import {
  formatResetCountdown,
  formatTokenCount,
  formatUsagePercent,
  toManagedUsageView,
  usageRatio,
} from "../shared/managed-usage";

describe("toManagedUsageView (maps SDK usage rows into the bridge view)", () => {
  it("picks the hour-based window out of the limits rows", () => {
    const view = toManagedUsageView(
      { used: 120, limit: 1000, resetAt: "2026-08-17T00:00:00.000Z" },
      [
        { window: { duration: 1, unit: "day" }, used: 5, limit: 50 },
        { name: "5h", window: { duration: 5, unit: "hour" }, used: 30, limit: 100, resetAt: "2026-08-10T05:00:00.000Z" },
      ],
    );

    expect(view).toEqual({
      summary: { used: 120, limit: 1000, resetAt: "2026-08-17T00:00:00.000Z" },
      fiveHour: { used: 30, limit: 100, resetAt: "2026-08-10T05:00:00.000Z" },
    });
  });

  it("ignores minute-based rows that were not folded into whole hours", () => {
    const view = toManagedUsageView(null, [
      { window: { duration: 30, unit: "minute" }, used: 1, limit: 10 },
    ]);

    expect(view.summary).toBeUndefined();
    expect(view.fiveHour).toBeUndefined();
  });

  it("omits windows that are missing and drops the backend-only name field", () => {
    const view = toManagedUsageView(null, [
      { name: "custom", window: { duration: 5, unit: "hour" }, used: 3, limit: 10 },
    ]);

    expect(view.summary).toBeUndefined();
    expect(view.fiveHour).toEqual({ used: 3, limit: 10 });
  });
});

describe("usageRatio", () => {
  it("computes the used/limit ratio clamped to [0, 1]", () => {
    expect(usageRatio(25, 100)).toBe(0.25);
    expect(usageRatio(150, 100)).toBe(1);
    expect(usageRatio(-5, 100)).toBe(0);
  });

  it("reports 0 for a non-positive or non-finite limit", () => {
    expect(usageRatio(10, 0)).toBe(0);
    expect(usageRatio(10, -1)).toBe(0);
    expect(usageRatio(10, Number.NaN)).toBe(0);
  });
});

describe("formatUsagePercent", () => {
  it("rounds to one decimal like ChatStatus", () => {
    expect(formatUsagePercent(0.234)).toBe(23.4);
    expect(formatUsagePercent(0.8)).toBe(80);
    expect(formatUsagePercent(1)).toBe(100);
  });

  it("clamps and guards non-finite input", () => {
    expect(formatUsagePercent(1.5)).toBe(100);
    expect(formatUsagePercent(0)).toBe(0);
    expect(formatUsagePercent(Number.NaN)).toBe(0);
  });
});

describe("formatResetCountdown", () => {
  const now = Date.parse("2026-08-10T00:00:00.000Z");

  it("renders the two largest units", () => {
    expect(formatResetCountdown("2026-08-13T02:00:00.000Z", now)).toBe("resets in 3d 2h");
    expect(formatResetCountdown("2026-08-10T02:15:00.000Z", now)).toBe("resets in 2h 15m");
    expect(formatResetCountdown("2026-08-10T00:45:00.000Z", now)).toBe("resets in 45m");
    expect(formatResetCountdown("2026-08-10T00:00:30.000Z", now)).toBe("resets in <1m");
  });

  it("drops zero-valued minor units", () => {
    expect(formatResetCountdown("2026-08-15T00:00:00.000Z", now)).toBe("resets in 5d");
    expect(formatResetCountdown("2026-08-10T05:00:00.000Z", now)).toBe("resets in 5h");
  });

  it("hints at a refresh once the window has elapsed", () => {
    expect(formatResetCountdown("2026-08-09T23:59:59.000Z", now)).toBe("reset, refreshing...");
  });

  it("returns undefined for a missing or unparseable timestamp", () => {
    expect(formatResetCountdown(undefined, now)).toBeUndefined();
    expect(formatResetCountdown("not-a-date", now)).toBeUndefined();
  });
});

describe("formatTokenCount", () => {
  it("formats in 1024-based units", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(2048)).toBe("2k");
    expect(formatTokenCount(45_200)).toBe("44.1k");
    expect(formatTokenCount(200_000)).toBe("195k");
    expect(formatTokenCount(262_144)).toBe("256k");
    expect(formatTokenCount(1_572_864)).toBe("1.5M");
  });

  it("guards negative and non-finite input", () => {
    expect(formatTokenCount(-1)).toBe("0");
    expect(formatTokenCount(Number.NaN)).toBe("0");
  });
});
