import { useState } from "react";
import { IconChevronDown, IconChevronRight, IconLoader2 } from "@tabler/icons-react";
import { useChatStore } from "@/stores";
import { useT } from "@/i18n";
import { Markdown } from "./Markdown";
import { cn } from "@/lib/utils";

interface CompactionCardProps {
  /** Post-compaction summary written by the compactor; expandable when present. */
  summary?: string;
  /** Context size right after the compaction. */
  tokenCount?: number;
  /** Context size captured when the compaction started. */
  preTokens?: number;
  trigger?: "manual" | "auto";
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

/** Claude-Code-style one-liner: "已压缩上下文 · 手动 · 释放 138k tokens ⌄".
 *  The line stays in the timeline (unlike the full rebuilt view) and the
 *  summary only shows when the user expands it; the full post-compaction
 *  context remains available via the context pill. */
export function CompactionCard({ summary, tokenCount, preTokens, trigger }: CompactionCardProps) {
  const t = useT();
  const isCompacting = useChatStore((s) => s.isCompacting);
  const [expanded, setExpanded] = useState(false);

  if (isCompacting) {
    return (
      <div className="flex items-center gap-2 px-1 py-0.5 text-[11px] text-muted-foreground">
        <IconLoader2 className="size-3.5 text-blue-500 animate-spin" />
        <span>{t("compaction.compacting")}</span>
      </div>
    );
  }

  const freed =
    preTokens !== undefined && tokenCount !== undefined && preTokens > tokenCount
      ? preTokens - tokenCount
      : undefined;
  const parts = [t("compaction.compacted")];
  if (trigger !== undefined) {
    parts.push(t(trigger === "manual" ? "compaction.triggerManual" : "compaction.triggerAuto"));
  }
  if (freed !== undefined) {
    parts.push(t("compaction.freed", { tokens: formatTokens(freed) }));
  }

  const expandable = summary !== undefined && summary.trim().length > 0;

  return (
    <div className="px-1 py-0.5">
      <div
        className={cn(
          "flex items-center gap-2 text-[11px] text-muted-foreground",
          expandable && "cursor-pointer select-none hover:text-foreground/80 transition-colors",
        )}
        onClick={expandable ? () => setExpanded((v) => !v) : undefined}
      >
        <div className="size-1.5 rounded-full bg-emerald-500" />
        <span>{parts.join(" · ")}</span>
        {expandable &&
          (expanded ? <IconChevronDown className="size-3.5" /> : <IconChevronRight className="size-3.5" />)}
      </div>
      {expandable && expanded && (
        <div className="mt-1 ml-3.5 border-l-2 border-border/60 pl-3 max-h-72 overflow-y-auto">
          <Markdown content={summary} className="text-xs leading-relaxed text-muted-foreground" enableEnrichment />
        </div>
      )}
    </div>
  );
}
