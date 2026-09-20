import { cn } from "@/lib/utils";

/**
 * Desktop-style working indicator: the Kimi face — a small rounded-rect blue
 * badge whose eyes glance around and blink — next to a breathing status label
 * ("请求中…" until the first content streams, then "工作中…"). Pure CSS,
 * mirrors the desktop app's WorkingIndicator (no Rive/wasm needed). Rendered
 * only while a turn is in flight.
 */
export function WorkingIndicator({ label, className }: { label: string; className?: string }) {
  return (
    <div role="status" className={cn("kimi-working-indicator", className)}>
      <span className="kimi-wi-face" aria-hidden="true">
        <span className="kimi-wi-eyes">
          <span className="kimi-wi-eye kimi-wi-eye--left" />
          <span className="kimi-wi-eye kimi-wi-eye--right" />
        </span>
      </span>
      <span className="kimi-wi-label">{label}</span>
    </div>
  );
}
