/**
 * Managed (subscription) usage view shared by the extension host and the webview.
 *
 * The host maps the SDK's usage rows into these plain shapes so no
 * package-internal types leak across the bridge; the webview formats them
 * for the usage status bar. All helpers are pure so they can be unit-tested
 * from either side.
 */

export interface ManagedUsageWindowView {
  readonly used: number;
  readonly limit: number;
  /** ISO timestamp at which the window resets. */
  readonly resetAt?: string;
}

export interface ManagedUsageView {
  /** Weekly window (the backend summary row). */
  readonly summary?: ManagedUsageWindowView;
  /** Hour-based window (typically 5h) picked out of the limits rows. */
  readonly fiveHour?: ManagedUsageWindowView;
}

export type ManagedUsageResult =
  | { readonly ok: true; readonly usage: ManagedUsageView }
  | { readonly ok: false; readonly error: string };

/**
 * Structural mirror of the SDK's usage row; keeps shared/ free of
 * package imports while staying assignable from the real type.
 */
export interface ManagedUsageRowInput {
  readonly name?: string;
  readonly window?: { readonly duration: number; readonly unit: string };
  readonly used: number;
  readonly limit: number;
  readonly resetAt?: string;
}

function toWindowView(row: ManagedUsageRowInput): ManagedUsageWindowView {
  return row.resetAt === undefined
    ? { used: row.used, limit: row.limit }
    : { used: row.used, limit: row.limit, resetAt: row.resetAt };
}

/** Maps the summary + limits rows into the bridge view, picking the hour-based window. */
export function toManagedUsageView(
  summary: ManagedUsageRowInput | null,
  limits: readonly ManagedUsageRowInput[],
): ManagedUsageView {
  const fiveHour = limits.find((row) => row.window?.unit === "hour");
  return {
    ...(summary !== null ? { summary: toWindowView(summary) } : {}),
    ...(fiveHour !== undefined ? { fiveHour: toWindowView(fiveHour) } : {}),
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
