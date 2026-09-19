/**
 * Scenario: managed (subscription) usage data is shaped for the webview usage status bar.
 * Responsibilities: verify quota window mapping, ratio/percent math, token formatting, and reset countdowns.
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

describe("toManagedUsageView (maps the SDK quota usages into the bridge view)", () => {
  it("maps the platform entries onto the named windows", () => {
    const view = toManagedUsageView({
      limit5h: { usedRatio: 0.3, resetAt: "2026-09-11T18:00:00Z" },
      limit7d: { usedRatio: 0.2, resetAt: "2026-09-17T00:00:00Z" },
      monthTotal: { usedRatio: 0.4, resetAt: "2026-10-01T00:00:00Z" },
      monthCode: { usedRatio: 0.25, resetAt: "2026-10-01T00:00:00Z" },
    });

    expect(view).toEqual({
      fiveHour: { usedRatio: 0.3, resetAt: "2026-09-11T18:00:00Z" },
      weekly: { usedRatio: 0.2, resetAt: "2026-09-17T00:00:00Z" },
      monthTotal: { usedRatio: 0.4, resetAt: "2026-10-01T00:00:00Z" },
      monthCode: { usedRatio: 0.25, resetAt: "2026-10-01T00:00:00Z" },
    });
  });

  it("omits windows the platform did not report", () => {
    const view = toManagedUsageView({});

    expect(view.fiveHour).toBeUndefined();
    expect(view.weekly).toBeUndefined();
    expect(view.monthTotal).toBeUndefined();
    expect(view.monthCode).toBeUndefined();
  });

  it("passes entries without a reset time through", () => {
    const view = toManagedUsageView({ limit7d: { usedRatio: 0.5 } });

    expect(view.weekly).toEqual({ usedRatio: 0.5 });
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
