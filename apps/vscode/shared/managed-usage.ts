/**
 * Managed (subscription) usage view shared by the extension host and the webview.
 *
 * The host maps the SDK's quota usages into these plain shapes so no
 * package-internal types leak across the bridge; the webview formats them
 * for the usage status bar. All helpers are pure so they can be unit-tested
 * from either side.
 */

export interface ManagedUsageWindowView {
  /** Used fraction of the window quota as reported by the platform (0..1). */
  readonly usedRatio: number;
  /** ISO timestamp at which the window resets. */
  readonly resetAt?: string;
}

export interface ManagedUsageView {
  /** 5-hour window (platform limit_5h). */
  readonly fiveHour?: ManagedUsageWindowView;
  /** 7-day window (platform limit_7d). */
  readonly weekly?: ManagedUsageWindowView;
  /** Monthly total window (platform limit_month_total). */
  readonly monthTotal?: ManagedUsageWindowView;
  /** Monthly code window (platform limit_month_code). */
  readonly monthCode?: ManagedUsageWindowView;
}

export type ManagedUsageResult =
  | { readonly ok: true; readonly usage: ManagedUsageView }
  | { readonly ok: false; readonly error: string };

/**
 * Structural mirror of the SDK's quota usages map; keeps shared/ free of
 * package imports while staying assignable from the real type.
 */
export interface ManagedQuotaUsagesInput {
  readonly limit5h?: ManagedUsageWindowView;
  readonly limit7d?: ManagedUsageWindowView;
  readonly monthTotal?: ManagedUsageWindowView;
  readonly monthCode?: ManagedUsageWindowView;
}

/** Maps the SDK quota usages map into the bridge view. */
export function toManagedUsageView(usages: ManagedQuotaUsagesInput): ManagedUsageView {
  return {
    ...(usages.limit5h !== undefined ? { fiveHour: usages.limit5h } : {}),
    ...(usages.limit7d !== undefined ? { weekly: usages.limit7d } : {}),
    ...(usages.monthTotal !== undefined ? { monthTotal: usages.monthTotal } : {}),
    ...(usages.monthCode !== undefined ? { monthCode: usages.monthCode } : {}),
  };
}

/** Usage as a [0, 1] ratio; a non-positive or non-finite limit reports 0. */
export function usageRatio(used: number, limit: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return 0;
  return Math.max(0, Math.min(used / limit, 1));
}

/** Ratio as a one-decimal percentage (0.234 -> 23.4), matching ChatStatus rounding. */
export function formatUsagePercent(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return Math.round(Math.min(ratio, 1) * 1000) / 10;
}

/**
 * "resets in 3d 2h" style countdown to an ISO reset timestamp; the two
 * largest units only. Returns undefined for a missing/unparseable
 * timestamp, and a refresh hint once the window has elapsed.
 */
export function formatResetCountdown(resetAt: string | undefined, now: number = Date.now()): string | undefined {
  if (resetAt === undefined) return undefined;
  const parsed = Date.parse(resetAt);
  if (!Number.isFinite(parsed)) return undefined;
  const diffSec = Math.floor((parsed - now) / 1000);
  if (diffSec <= 0) return "reset, refreshing...";
  return `resets in ${formatCountdownDuration(diffSec)}`;
}

function formatCountdownDuration(totalSeconds: number): string {
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 1) return "<1m";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/**
 * Format a token count in 1024-based units ("45k", "1.5M"); context sizes
 * are powers of two, so 262144 reads as "256k". k values at or above 100
 * are rounded to whole numbers ("977k").
 */
export function formatTokenCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return "0";
  if (count >= 1024 * 1024) return `${trimDecimal(count / (1024 * 1024))}M`;
  if (count >= 1024) {
    const k = count / 1024;
    return `${k >= 100 ? Math.round(k) : trimDecimal(k)}k`;
  }
  return String(count);
}

/** One decimal place, dropping a redundant ".0" ("2.0" -> "2", "1.5" stays). */
function trimDecimal(value: number): string {
  const s = value.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}
