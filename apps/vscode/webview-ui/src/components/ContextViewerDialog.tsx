import { useCallback, useEffect, useState } from "react";
import { IconClipboard, IconRefresh } from "@tabler/icons-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { bridge } from "@/services";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { toast } from "./ui/sonner";
import type { SessionContextSnapshot } from "shared/legacy-sdk";

interface ContextViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ROLE_CLASS: Record<string, string> = {
  user: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  assistant: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  system: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  tool: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
};

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

/** Read-only view of the agent's live context — after a compaction this is
 *  exactly what survived it, so the user can verify nothing important was
 *  lost before continuing. */
export function ContextViewerDialog({ open, onOpenChange }: ContextViewerDialogProps) {
  const t = useT();
  const [snapshot, setSnapshot] = useState<SessionContextSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await bridge.getSessionContext();
      setSnapshot(result.ok ? (result.snapshot ?? { tokenCount: 0, messages: [] }) : { tokenCount: 0, messages: [] });
    } catch (error) {
      console.error("[ContextViewer] Failed to load context:", error);
      toast.error(t("context.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const copyAll = () => {
    if (!snapshot) return;
    const text = snapshot.messages.map((message) => `[${message.role}]\n${message.text}`).join("\n\n---\n\n");
    void navigator.clipboard.writeText(text).then(() => toast.success(t("context.copied")));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{t("context.title")}</span>
            {snapshot && (
              <span className="text-xs font-normal text-muted-foreground">
                {t("context.stats", { tokens: formatTokens(snapshot.tokenCount), count: snapshot.messages.length })}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-1">
          <Button variant="outline" size="xs" onClick={() => void refresh()} disabled={loading}>
            <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
            {t("context.refresh")}
          </Button>
          <Button variant="outline" size="xs" onClick={copyAll} disabled={!snapshot || snapshot.messages.length === 0}>
            <IconClipboard className="size-3.5" />
            {t("context.copyAll")}
          </Button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border/60 bg-muted/30 p-2">
          {snapshot === null ? (
            <div className="py-8 text-center text-xs text-muted-foreground">{t("common.loading")}</div>
          ) : snapshot.messages.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">{t("context.empty")}</div>
          ) : (
            snapshot.messages.map((message, idx) => (
              <div key={idx} className="mb-2 last:mb-0">
                <span className={cn("inline-block rounded px-1.5 py-px text-[10px] font-medium", ROLE_CLASS[message.role] ?? ROLE_CLASS.system)}>
                  {message.role}
                </span>
                {message.isError && <span className="ml-1 text-[10px] text-destructive">error</span>}
                <div className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">{message.text}</div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
