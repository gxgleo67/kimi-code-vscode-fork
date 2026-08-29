import { useChatStore } from "@/stores";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { IconArrowUp, IconArrowDown, IconRefresh } from "@tabler/icons-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function TokenInfo() {
  const lastStatus = useChatStore((s) => s.lastStatus);
  const tokenUsage = useChatStore((s) => s.tokenUsage);
  const activeTokenUsage = useChatStore((s) => s.activeTokenUsage);
  const t = useT();

  const inputTotal =
    tokenUsage.input_other +
    tokenUsage.input_cache_read +
    tokenUsage.input_cache_creation +
    activeTokenUsage.input_other +
    activeTokenUsage.input_cache_read +
    activeTokenUsage.input_cache_creation;

  const outputTotal = tokenUsage.output + activeTokenUsage.output;

  const contextPercent = lastStatus?.context_usage ? Math.round(lastStatus.context_usage * 1000) / 10 : 0;

  return (
    <div className="space-y-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{t("status.tokenUsage")}</div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="flex flex-col">
          <span className="text-muted-foreground text-[10px]">{t("status.context")}</span>
          <span className={cn(contextPercent > 80 && "text-amber-500", contextPercent > 95 && "text-destructive")}>{contextPercent}%</span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground text-[10px]">{t("status.input")}</span>
          <span>{inputTotal.toLocaleString()}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground text-[10px]">{t("status.output")}</span>
          <span>{outputTotal.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

export function ChatStatus() {
  const lastStatus = useChatStore((s) => s.lastStatus);
  const tokenUsage = useChatStore((s) => s.tokenUsage);
  const activeTokenUsage = useChatStore((s) => s.activeTokenUsage);
  const t = useT();

  if (!lastStatus) {
    return null;
  }

  const retrying = lastStatus.retrying;

  const inputTotal =
    tokenUsage.input_other +
    tokenUsage.input_cache_read +
    tokenUsage.input_cache_creation +
    activeTokenUsage.input_other +
    activeTokenUsage.input_cache_read +
    activeTokenUsage.input_cache_creation;

  const outputTotal = tokenUsage.output + activeTokenUsage.output;

  // The context-usage block is intentionally absent here: the composer's
  // status row already shows the context ring, so the pill keeps tokens only.
  return (
    <div className="flex items-center gap-3 text-[10px] text-muted-foreground border border-border/40 rounded-full px-2 py-0.5 select-none h-6 box-border mr-2 @max-[240px]:hidden">
      {retrying && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1 text-amber-500">
              <IconRefresh className="size-3" />
              {t("status.retry", { attempt: retrying.next_attempt, max: retrying.max_attempts })}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {t("status.retryingIn", { seconds: Math.ceil(retrying.delay_ms / 1000), message: retrying.message })}
          </TooltipContent>
        </Tooltip>
      )}
      {retrying && <div className="w-px h-3 bg-border/50" />}
      <div className="flex items-center gap-1.5 @max-[440px]:hidden" title={t("status.totalInputTokens")}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1.5">
              <IconArrowUp className="size-3 opacity-70" />
              <span>{inputTotal.toLocaleString()}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>{t("status.totalInputTokens")}</TooltipContent>
        </Tooltip>
      </div>
      <div className="w-px h-3 bg-border/50 @max-[440px]:hidden" />
      <div className="flex items-center gap-1.5 @max-[440px]:hidden" title={t("status.totalOutputTokens")}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1.5">
              <IconArrowDown className="size-3 opacity-70" />
              <span>{outputTotal.toLocaleString()}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>{t("status.totalOutputTokens")}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
