import { cn } from "@/lib/utils";
import { RiveMascot } from "./RiveMascot";

/**
 * Desktop-style working indicator: the animated Kimi mascot next to a
 * breathing status label ("请求中…" until the first content streams, then
 * "工作中…"). Rendered only while a turn is in flight.
 */
export function WorkingIndicator({ label, className }: { label: string; className?: string }) {
  return (
    <div role="status" className={cn("inline-flex items-center gap-2 self-start", className)}>
      <RiveMascot className="w-4.5 shrink-0" />
      <span className="kimi-think-breathe text-[11px] font-medium tracking-wide text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
