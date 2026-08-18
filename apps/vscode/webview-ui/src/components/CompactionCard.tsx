import { useState } from "react";
import { IconChevronDown, IconChevronRight, IconLoader2 } from "@tabler/icons-react";
import { useChatStore } from "@/stores";
import { useT } from "@/i18n";
import { Markdown } from "./Markdown";
import { cn } from "@/lib/utils";

interface CompactionCardProps {
  /** Post-compaction summary written by the compactor; expandable when present. */
  summary?: string;
  /** Live context size right after the compaction. */
  tokenCount?: number;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

export function CompactionCard({ summary, tokenCount }: CompactionCardProps) {
  const t = useT();
  const isCompacting = useChatStore((s) => s.isCompacting);
  const [expanded, setExpanded] = useState(false);
  const expandable = !isCompacting && summary !== undefined && summary.trim().length > 0;

  return (
    <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
      <div
        className={cn("flex items-center gap-3 px-3 py-2.5", expandable && "cursor-pointer select-none hover:bg-muted/40 transition-colors")}
        onClick={expandable ? () => setExpanded((v) => !v) : undefined}
      >
        {isCompacting ? (
          <IconLoader2 className="size-4 text-blue-500 animate-spin" />
        ) : (
          <div className="size-4 flex items-center justify-center">
            <div className="size-2 rounded-full bg-emerald-500" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-foreground">{isCompacting ? t("compaction.compacting") : t("compaction.compacted")}</div>
          {!isCompacting && tokenCount !== undefined && (
            <div className="text-[10px] text-muted-foreground">{t("compaction.contextAfter", { tokens: formatTokens(tokenCount) })}</div>
          )}
        </div>
        {expandable && (
          expanded
            ? <IconChevronDown className="size-4 shrink-0 text-muted-foreground" />
            : <IconChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
      </div>
      {expandable && expanded && (
        <div className="border-t border-border/60 px-3 py-2 max-h-72 overflow-y-auto">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">{t("compaction.summary")}</div>
          <Markdown content={summary} className="text-xs leading-relaxed" enableEnrichment />
        </div>
      )}
    </div>
  );
}
