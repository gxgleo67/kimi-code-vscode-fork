import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { KimiEyesLogo } from "./KimiEyesLogo";

/**
 * Shared loading module: the animated Kimi eyes badge on the left and the
 * loading label on the right, in a frosted-glass pill that pops in (the web
 * GlobalLoading entrance). Use centered wherever a view is loading.
 */
export function KimiLoading({ text, className }: { text?: string; className?: string }) {
  const t = useT();
  return (
    <div
      role="status"
      className={cn(
        "kimi-loading-pop flex items-center gap-2.5 rounded-lg border border-border/60 bg-background/70 px-4 py-2.5 shadow-lg backdrop-blur-md",
        className,
      )}
    >
      <KimiEyesLogo className="w-8 h-auto shrink-0" />
      <span className="text-xs text-muted-foreground">{text ?? t("common.loading")}</span>
    </div>
  );
}
