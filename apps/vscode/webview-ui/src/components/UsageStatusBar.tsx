import { useEffect, useState } from "react";

import { bridge } from "@/services";
import { getModelById, MANAGED_KIMI_CODE_PROVIDER, useChatStore, useSettingsStore } from "@/stores";
import { useT } from "@/i18n";
import {
  formatTokenCount,
  formatUsagePercent,
  usageRatio,
  type ManagedUsageView,
  type ManagedUsageWindowView,
} from "shared/managed-usage";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const USAGE_POLL_INTERVAL_MS = 60_000;
const COUNTDOWN_TICK_MS = 60_000;

/** Context ring stays a fixed Kimi blue instead of ramping with fill level. */
const CONTEXT_RING_COLOR = "#3B82F6";

/** 5h quota ring: below 70% stays muted, from 70% (yellow) ramps to red at 100%. */
function quotaRingColor(ratio: number): string | undefined {
  if (ratio < 0.7) return undefined;
  const t = Math.min(1, (ratio - 0.7) / 0.3);
  const hue = Math.round(45 * (1 - t));
  return `hsl(${hue} 95% 50%)`;
}

/** Weekly quota ring: blue (#3B82F6 ≈ hsl 217) at 0% ramping to red (hsl 0) at 100%. */
function weeklyRingColor(ratio: number): string {
  const hue = Math.round(217 * (1 - Math.min(1, ratio)));
  return `hsl(${hue} 90% 55%)`;
}

interface RingCirclesProps {
  readonly center: number;
  readonly radius: number;
  readonly strokeWidth: number;
  /** null renders only the grey track (loading / fetch failed). */
  readonly ratio: number | null;
}

function RingCircles({ center, radius, strokeWidth, ratio }: RingCirclesProps) {
  const circumference = 2 * Math.PI * radius;
  const filled = (ratio ?? 0) * circumference;

  return (
    <>
      <circle cx={center} cy={center} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="opacity-20" />
      {ratio !== null && (
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
        />
      )}
    </>
  );
}

interface ContextRingProps {
  readonly ratio: number;
  readonly label: string;
  readonly detail?: string;
}

function ContextRing({ ratio, label, detail }: ContextRingProps) {
  const t = useT();
  const size = 14;
  const strokeWidth = 2;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center" style={{ color: CONTEXT_RING_COLOR }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block -rotate-90" aria-hidden="true">
            <RingCircles center={size / 2} radius={(size - strokeWidth) / 2} strokeWidth={strokeWidth} ratio={ratio} />
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex flex-col gap-0.5">
          <span>{label}</span>
          {detail !== undefined && <span>{detail}</span>}
          <span>{t("usage.percentUsed", { percent: formatUsagePercent(ratio) })}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

interface QuotaWindowState {
  /** null renders the grey placeholder state (loading / fetch failed). */
  readonly ratio: number | null;
  readonly resetAt?: string;
  readonly error?: string;
}

function quotaWindowState(
  window: ManagedUsageWindowView | undefined,
  usageError: string | null,
): QuotaWindowState | null {
  if (usageError !== null) return { ratio: null, error: usageError };
  if (window === undefined) return null;
  return {
    ratio: usageRatio(window.used, window.limit),
    resetAt: window.resetAt,
  };
}

/** Localized "…后重置 / resets in …" countdown, two largest units. */
function resetCountdown(
  t: ReturnType<typeof useT>,
  resetAt: string | undefined,
  now: number,
): string | undefined {
  if (resetAt === undefined) return undefined;
  const ms = Date.parse(resetAt) - now;
  if (Number.isNaN(ms) || ms <= 0) return t("usage.resetRefreshing");
  const totalMinutes = Math.ceil(ms / 60_000);
  if (totalMinutes >= 1440) {
    return t("usage.resetsInDays", {
      days: Math.floor(totalMinutes / 1440),
      hours: Math.floor((totalMinutes % 1440) / 60),
    });
  }
  if (totalMinutes >= 60) {
    return t("usage.resetsInHours", {
      hours: Math.floor(totalMinutes / 60),
      minutes: totalMinutes % 60,
    });
  }
  return t("usage.resetsInMinutes", { minutes: totalMinutes });
}

function QuotaTooltipSection({ label, state, now }: { label: string; state: QuotaWindowState; now: number }) {
  const t = useT();
  const resetText = resetCountdown(t, state.resetAt, now);
  return (
    <div className="flex flex-col gap-0.5">
      <span>{label}</span>
      {state.ratio === null ? (
        <span>{state.error !== undefined ? t("usage.unavailable", { error: state.error }) : t("usage.loading")}</span>
      ) : (
        <>
          <span>{t("usage.percentUsed", { percent: formatUsagePercent(state.ratio) })}</span>
          {resetText !== undefined && <span>{resetText}</span>}
        </>
      )}
    </div>
  );
}

/**
 * The managed plan's 5h and weekly quotas as one concentric indicator: the
 * outer ring tracks the 5h window (muted below 70%, yellow → red above), the
 * inner ring tracks the weekly window (blue → red over the full range).
 */
function QuotaRings({ fiveHour, weekly, now }: { fiveHour: QuotaWindowState; weekly: QuotaWindowState; now: number }) {
  const t = useT();
  const size = 18;
  const strokeWidth = 2;
  const outerRadius = (size - strokeWidth) / 2;
  // Inner ring leaves a 1px gap so the two strokes never overlap.
  const innerRadius = outerRadius - strokeWidth - 1;

  const outerColor = fiveHour.ratio !== null ? quotaRingColor(fiveHour.ratio) : undefined;
  const innerColor = weekly.ratio !== null ? weeklyRingColor(weekly.ratio) : undefined;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block -rotate-90" aria-hidden="true">
            <g
              className={outerColor !== undefined ? undefined : fiveHour.ratio === null ? "text-muted-foreground/50" : "text-muted-foreground"}
              style={outerColor !== undefined ? { color: outerColor } : undefined}
            >
              <RingCircles center={size / 2} radius={outerRadius} strokeWidth={strokeWidth} ratio={fiveHour.ratio} />
            </g>
            <g
              className={innerColor !== undefined ? undefined : "text-muted-foreground/50"}
              style={innerColor !== undefined ? { color: innerColor } : undefined}
            >
              <RingCircles center={size / 2} radius={innerRadius} strokeWidth={strokeWidth} ratio={weekly.ratio} />
            </g>
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex flex-col gap-1.5">
          <QuotaTooltipSection label={t("usage.fiveHourLimit")} state={fiveHour} now={now} />
          <QuotaTooltipSection label={t("usage.weeklyLimit")} state={weekly} now={now} />
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Compact usage indicators inlined into the input box's button row: a Claude
 * Code style ring for the context window plus one concentric ring pair for
 * the managed plan's 5h (outer) / weekly (inner) quotas. Percentages stay in
 * the tooltip so the row fits a narrow sidebar. The quota rings only appear
 * while a managed:kimi-code model is selected and degrade to a grey error
 * state when the fetch fails; the context ring is driven by the session's
 * status updates and is unaffected.
 */
export function UsageStatusBar() {
  const t = useT();
  const contextUsage = useChatStore((state) => state.lastStatus?.context_usage ?? undefined);
  const contextTokens = useChatStore((state) => state.lastStatus?.context_tokens ?? undefined);
  const maxContextTokens = useChatStore((state) => state.lastStatus?.max_context_tokens ?? undefined);
  const currentModel = useSettingsStore((state) => state.currentModel);
  const models = useSettingsStore((state) => state.models);
  const isLoggedIn = useSettingsStore((state) => state.isLoggedIn);

  const isManagedProvider = getModelById(models, currentModel)?.provider === MANAGED_KIMI_CODE_PROVIDER;

  const [usage, setUsage] = useState<ManagedUsageView | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Poll the managed usage endpoint while a managed model is selected;
  // re-runs when the provider or login state changes.
  useEffect(() => {
    if (!isManagedProvider) {
      setUsage(null);
      setUsageError(null);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      bridge
        .getManagedUsage()
        .then((result) => {
          if (cancelled) return;
          if (result.ok) {
            setUsage(result.usage);
            setUsageError(null);
          } else {
            setUsageError(result.error);
          }
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setUsageError(error instanceof Error ? error.message : String(error));
        });
    };
    refresh();
    const timer = setInterval(refresh, USAGE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isManagedProvider, isLoggedIn]);

  // Minute tick so the "resets in Xh Xm" countdowns stay honest between polls.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const contextRatio =
    contextUsage ??
    (contextTokens !== undefined && maxContextTokens !== undefined
      ? usageRatio(contextTokens, maxContextTokens)
      : undefined);
  const contextDetail =
    contextTokens !== undefined && maxContextTokens !== undefined && maxContextTokens > 0
      ? t("usage.tokenCount", { used: formatTokenCount(contextTokens), limit: formatTokenCount(maxContextTokens) })
      : undefined;

  let quota: { fiveHour: QuotaWindowState; weekly: QuotaWindowState } | null = null;
  if (isManagedProvider) {
    if (usageError === null && usage === null) {
      // First fetch still in flight: show both rings as grey placeholders.
      quota = { fiveHour: { ratio: null }, weekly: { ratio: null } };
    } else {
      const fiveHour = quotaWindowState(usage?.fiveHour, usageError);
      const weekly = quotaWindowState(usage?.summary, usageError);
      if (fiveHour !== null || weekly !== null) {
        // A window missing from a successful response degrades to grey.
        quota = { fiveHour: fiveHour ?? { ratio: null }, weekly: weekly ?? { ratio: null } };
      }
    }
  }

  if (contextRatio === undefined && quota === null) return null;

  return (
    <div className="flex h-6 items-center gap-1.5 select-none">
      {contextRatio !== undefined && <ContextRing ratio={contextRatio} label={t("usage.contextWindow")} detail={contextDetail} />}
      {quota !== null && <QuotaRings fiveHour={quota.fiveHour} weekly={quota.weekly} now={now} />}
    </div>
  );
}
