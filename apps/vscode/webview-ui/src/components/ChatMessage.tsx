import { useState, Fragment, memo } from "react";
import { IconLoader3, IconGitFork, IconPencil, IconTrash } from "@tabler/icons-react";
import { cn, formatMessageTime } from "@/lib/utils";
import { Content } from "@/lib/content";
import { Markdown } from "./Markdown";
import { ToolCallCard } from "./ToolRenderers";
import { CopyButton } from "./CopyButton";
import { ThinkingBlock } from "./ThinkingBlock";
import { CompactionCard } from "./CompactionCard";
import { MediaThumbnail } from "./MediaThumbnail";
import { MediaPreviewModal } from "./MediaPreviewModal";
import { InlineError } from "./InlineError";
import { PlanCard } from "./PlanCard";
import { KimiLogo } from "./KimiLogo";
import { StreamingConfirmDialog } from "./StreamingConfirmDialog";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { toast } from "@/components/ui/sonner";
import { useChatStore, useSettingsStore } from "@/stores";
import { bridge } from "@/services";
import { useT } from "@/i18n";
import type { ChatMessage as ChatMessageType, UIStep, UIStepItem } from "@/stores/chat.store";
import type { ContentPart } from "shared/legacy-sdk";

interface ChatMessageProps {
  message: ChatMessageType;
  /** 0-indexed turn number for this message */
  turnIndex?: number;
  /** Turn index a user bubble opens; drives the rollback (delete/edit) menu. */
  userTurnIndex?: number;
  /** Total visible turns in the transcript; undo count = totalTurns - userTurnIndex. */
  totalTurns?: number;
  isStreaming?: boolean;
}

function ThinkingIndicator() {
  const t = useT();
  return (
    <div className="flex items-center gap-2 mt-1 text-blue-500/80 py-1">
      <IconLoader3 className="size-3.5 animate-spin" />
      <span className="text-[11px] font-medium tracking-wide">{t("chat.processing")}</span>
    </div>
  );
}

function SteerBubble({ content }: { content: string | ContentPart[] }) {
  const [previewMedia, setPreviewMedia] = useState<string | null>(null);
  const text = typeof content === "string" ? content : Content.getText(content);
  const images = Content.getImages(content);
  const videos = Content.getVideos(content);
  return (
    <div className="flex justify-end my-1">
      <div className="max-w-[85%] px-3 py-1 rounded-2xl rounded-br-md bg-zinc-100 dark:bg-zinc-800 text-foreground">
        {text && <p className="text-xs leading-relaxed">{text}</p>}
        <MessageMedia images={images} videos={videos} onPreview={setPreviewMedia} />
      </div>
      <MediaPreviewModal src={previewMedia} onClose={() => setPreviewMedia(null)} />
    </div>
  );
}

function StepItemRenderer({ item }: { item: UIStepItem }) {
  switch (item.type) {
    case "thinking":
      return <ThinkingBlock content={item.content} finished={item.finished} />;
    case "text":
      return <Markdown content={item.content} className="text-xs leading-relaxed" enableEnrichment={item.finished === true} />;
    case "tool_use":
      return <ToolCallCard call={item.call} result={item.result} subagentSteps={item.subagent_steps} subagentModel={item.subagentModel} />;
    case "compaction":
      return <CompactionCard summary={item.summary} tokenCount={item.tokenCount} preTokens={item.preTokens} trigger={item.trigger} />;
    case "steer":
      return <SteerBubble content={item.content} />;
    default:
      return null;
  }
}

function StepContent({ step, showConnector }: { step: UIStep; showConnector?: boolean }) {
  const hasItems = step.items.length > 0;
  const hasToolOrThinking = step.items.some((item) => item.type === "tool_use" || item.type === "thinking" || item.type === "compaction");
  const showIndicator = hasToolOrThinking;
  const hasActiveItem = step.items.some((item) => (item.type === "text" || item.type === "thinking") && !item.finished);

  if (!hasItems) {
    return null;
  }

  return (
    <div className="flex gap-2">
      {showIndicator ? (
        <div className="hidden @[420px]:flex shrink-0 w-5 flex-col items-center relative">
          <div
            className={cn("size-1.5 rounded-full mt-2 shrink-0 relative z-10", hasActiveItem ? "bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.6)] animate-pulse" : "bg-blue-400")}
          />
          {showConnector && (
            <div
              className={cn(
                "absolute left-1/2 w-px",
                hasActiveItem ? "bg-gradient-to-b from-zinc-300 to-transparent dark:from-zinc-600 dark:to-transparent" : "bg-zinc-300 dark:bg-zinc-600",
              )}
              style={{ top: "calc(0.5rem + 0.1875rem)", bottom: "calc(-0.75rem - 0.5rem - 0.1875rem)", transform: "translateX(-50%)" }}
            />
          )}
        </div>
      ) : (
        <div className="hidden @[420px]:block shrink-0 w-5" />
      )}
      <div className="flex-1 min-w-0 space-y-2">
        {step.items.map((item, idx) => (
          <StepItemRenderer key={`${step.n}-${idx}`} item={item} />
        ))}
      </div>
    </div>
  );
}

function MessageMedia({ images, videos, onPreview }: { images: string[]; videos: string[]; onPreview: (src: string) => void }) {
  if (images.length === 0 && videos.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-2 my-2">
      {images.map((src, idx) => (
        <MediaThumbnail key={`img-${idx}`} src={src} size="md" onClick={() => onPreview(src)} />
      ))}
      {videos.map((src, idx) => (
        <MediaThumbnail key={`vid-${idx}`} src={src} size="md" onClick={() => onPreview(src)} />
      ))}
    </div>
  );
}

interface StepGroup {
  planMode: boolean;
  steps: UIStep[];
  startIndex: number;
}

function groupStepsByPlanMode(steps: UIStep[]): StepGroup[] {
  const groups: StepGroup[] = [];
  for (let i = 0; i < steps.length; i++) {
    const isPlan = steps[i].planMode === true;
    const last = groups.at(-1);
    if (last && last.planMode === isPlan) {
      last.steps.push(steps[i]);
    } else {
      groups.push({ planMode: isPlan, steps: [steps[i]], startIndex: i });
    }
  }
  return groups;
}

interface ForkButtonProps {
  turnIndex: number;
  className?: string;
}

function ForkButton({ turnIndex, className }: ForkButtonProps) {
  const t = useT();
  const [showConfirm, setShowConfirm] = useState(false);
  const [isForking, setIsForking] = useState(false);
  const sessionId = useChatStore((s) => s.sessionId);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const loadSession = useChatStore((s) => s.loadSession);
  const setHistoryLoading = useChatStore((s) => s.setHistoryLoading);

  const handleFork = () => {
    if (!sessionId || turnIndex < 0) return;
    setShowConfirm(true);
  };

  const doFork = async () => {
    if (!sessionId) return;

    setIsForking(true);
    setHistoryLoading(true);
    try {
      const result = await bridge.forkSession(sessionId, turnIndex);
      if (result) {
        // Load the forked session
        const events = await bridge.loadSessionHistory(result.sessionId);
        await loadSession(result.sessionId, events);
      }
    } catch (error) {
      toast.error(t("chat.forkFailed", { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setHistoryLoading(false);
      setIsForking(false);
      setShowConfirm(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        className={cn(
          "h-5 w-5 text-muted-foreground hover:text-foreground transition-all border-0! hover:bg-zinc-200 dark:hover:bg-zinc-800 cursor-pointer",
          isForking && "opacity-50 pointer-events-none",
          className,
        )}
        onClick={handleFork}
        disabled={isForking || !sessionId}
        title={t("chat.forkTooltip")}
      >
        <IconGitFork className="size-3.5" />
      </Button>

      <StreamingConfirmDialog
        open={showConfirm}
        onOpenChange={setShowConfirm}
        title={t("chat.forkTitle")}
        description={isStreaming ? t("chat.forkDescStreaming") : t("chat.forkDesc")}
        confirmLabel={t("chat.fork")}
        onConfirm={() => { void doFork(); }}
        confirmLoading={isForking}
        confirmDisabled={isForking}
        cancelDisabled={isForking}
      />
    </>
  );
}

function UserMessage({ message, userTurnIndex, totalTurns }: { message: ChatMessageType; userTurnIndex?: number; totalTurns?: number }) {
  const t = useT();
  const [previewMedia, setPreviewMedia] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"edit" | "delete" | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const sessionId = useChatStore((s) => s.sessionId);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const loadSession = useChatStore((s) => s.loadSession);
  const setHistoryLoading = useChatStore((s) => s.setHistoryLoading);
  const displayContent = Content.getText(message.content);
  const images = Content.getImages(message.content);
  const videos = Content.getVideos(message.content);

  const rollbackable = userTurnIndex !== undefined && totalTurns !== undefined && userTurnIndex >= 0 && totalTurns > userTurnIndex;
  const rollbackCount = rollbackable ? totalTurns - userTurnIndex : 0;

  // Delete and edit share one engine operation: undo every turn from this
  // message on. Undo only appends a rollback marker — the records stay in the
  // session log but stop feeding the context. Edit additionally refills the
  // composer so the user resends a corrected version.
  const doRollback = async (action: "edit" | "delete") => {
    if (!sessionId || !rollbackable) return;
    setIsWorking(true);
    setHistoryLoading(true);
    try {
      const result = await bridge.undoTurns(sessionId, rollbackCount);
      if (!result.ok) {
        toast.error(t("chat.rollbackFailed", { error: result.message }));
        return;
      }
      const events = await bridge.loadSessionHistory(sessionId);
      await loadSession(sessionId, events);
      if (action === "edit") {
        // loadSession clears pendingInput, so refill afterwards: InputArea's
        // restore effect then drops the original text back into the composer.
        const { currentModel } = useSettingsStore.getState();
        useChatStore.setState({ pendingInput: { content: message.content, model: currentModel } });
      }
    } catch (error) {
      toast.error(t("chat.rollbackFailed", { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setHistoryLoading(false);
      setIsWorking(false);
      setPendingAction(null);
    }
  };

  const bubble = (
    <div className={cn("max-w-[85%] px-3.5 py-1.5 rounded-2xl rounded-br-md", "bg-zinc-100 dark:bg-zinc-800", "text-foreground")}>
      {displayContent && (
        // FIX: removed whitespace-pre-wrap — it conflicted with ReactMarkdown's
        // block-level elements (<p>, <ol>, <li>), doubling vertical spacing.
        // ReactMarkdown already handles paragraph breaks from \n\n.
        <div className="text-xs leading-relaxed wrap-break-word">
          <Markdown content={displayContent} enableEnrichment enableLocalImageRender={false} />
        </div>
      )}
      <MessageMedia images={images} videos={videos} onPreview={setPreviewMedia} />
    </div>
  );

  return (
    <div className="px-3 pt-3 pb-1 flex justify-end items-end gap-2">
      <span className="shrink-0 mb-1.5 text-[10px] text-muted-foreground/60">{formatMessageTime(message.timestamp)}</span>
      {rollbackable ? (
        <ContextMenu>
          <ContextMenuTrigger asChild disabled={isWorking}>{bubble}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => setPendingAction("edit")}>
              <IconPencil />
              {t("chat.editMessage")}
            </ContextMenuItem>
            <ContextMenuItem variant="destructive" onSelect={() => setPendingAction("delete")}>
              <IconTrash />
              {t("chat.deleteMessage")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        bubble
      )}
      <MediaPreviewModal src={previewMedia} onClose={() => setPreviewMedia(null)} />
      <StreamingConfirmDialog
        open={pendingAction !== null}
        onOpenChange={(open) => { if (!open) setPendingAction(null); }}
        title={pendingAction === "edit" ? t("chat.editRollbackTitle") : t("chat.deleteRollbackTitle")}
        description={
          isStreaming
            ? t(pendingAction === "edit" ? "chat.editRollbackDescStreaming" : "chat.deleteRollbackDescStreaming")
            : t(pendingAction === "edit" ? "chat.editRollbackDesc" : "chat.deleteRollbackDesc")
        }
        confirmLabel={t(pendingAction === "edit" ? "chat.editMessage" : "chat.deleteMessage")}
        onConfirm={() => { if (pendingAction !== null) void doRollback(pendingAction); }}
        confirmLoading={isWorking}
        confirmDisabled={isWorking}
        cancelDisabled={isWorking}
      />
    </div>
  );
}

function AssistantMessage({ message, turnIndex, isStreaming }: { message: ChatMessageType; turnIndex?: number; isStreaming?: boolean }) {
  const [previewMedia, setPreviewMedia] = useState<string | null>(null);
  const isCompacting = useChatStore((s) => s.isCompacting);

  const steps = message.steps || [];
  const hasSteps = steps.length > 0;
  const images = Content.getImages(message.content);
  const videos = Content.getVideos(message.content);

  const stepHasIndicator = steps.map((step) => step.items.some((item) => item.type === "tool_use" || item.type === "thinking" || item.type === "compaction"));

  const contentToCopy = (() => {
    if (!hasSteps) {
      return typeof message.content === "string" ? message.content : "";
    }
    const lastStep = steps[steps.length - 1];
    const textItems = lastStep.items.filter((item) => item.type === "text");
    if (textItems.length > 0) {
      return textItems.map((item) => (item as { type: "text"; content: string }).content).join("\n");
    }
    return typeof message.content === "string" ? message.content : "";
  })();

  if (!isStreaming && !hasMessageContent(message) && !message.inlineError) {
    return null;
  }

  const displayContent = typeof message.content === "string" ? message.content : "";
  const isShowingInlineError = message.inlineError && !isStreaming;

  return (
    <div className="@container px-3 py-3 group/message">
      <div className="flex gap-3 flex-col">
        <div className="flex flex-row items-center justify-start gap-2">
          {/* kimi-logo.png is 3:2 — object-contain keeps it unstretched in the square slot */}
          <KimiLogo className="shrink-0 size-5 object-contain" />
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Kimi</div>
          <span className="text-[10px] normal-case tracking-normal text-muted-foreground/60">{formatMessageTime(message.timestamp)}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-col">
            <div className="[&>*:not(:last-child)]:mb-3">
              {hasSteps &&
                groupStepsByPlanMode(steps).map((group, gi) => {
                  const totalSteps = steps.length;
                  const stepsContent = group.steps.map((step, i) => {
                    const globalIndex = group.startIndex + i;
                    const isLastInGroup = i === group.steps.length - 1;
                    const isLastOverall = globalIndex === totalSteps - 1;
                    const hasIndicator = stepHasIndicator[globalIndex];
                    const hasNextIndicator = stepHasIndicator.slice(globalIndex + 1).some(Boolean);
                    const showConnector = hasIndicator && hasNextIndicator && !isLastInGroup && !isLastOverall;
                    return <StepContent key={step.n} step={step} showConnector={showConnector} />;
                  });

                  if (group.planMode) {
                    return <PlanCard key={`plan-${gi}`}>{stepsContent}</PlanCard>;
                  }
                  return <Fragment key={`normal-${gi}`}>{stepsContent}</Fragment>;
                })}
              {!hasSteps && displayContent && <Markdown content={displayContent} className="text-xs leading-relaxed @[420px]:pl-5" enableEnrichment={!isStreaming} />}
              {(images.length > 0 || videos.length > 0) && (
                <div className="@[420px]:pl-5">
                  <MessageMedia images={images} videos={videos} onPreview={setPreviewMedia} />
                </div>
              )}
            </div>

            {/* 内嵌错误显示 */}
            {isShowingInlineError && message.inlineError && (
              <div className="@[420px]:pl-5">
                <InlineError error={message.inlineError} />
              </div>
            )}
            <div className="flex flex-row items-center space-between">
              <div className="inline-flex flex-1">{isStreaming && !isShowingInlineError && !isCompacting && <ThinkingIndicator />}</div>
              <div className="inline-flex flex-1" />
              {!isStreaming && contentToCopy.trim().length > 0 && (
                <div className="flex justify-start pt-1 gap-1 opacity-0 group-hover/message:opacity-100 transition-opacity duration-100">
                  <CopyButton content={contentToCopy} />
                  {message.forkable !== false && turnIndex !== undefined && turnIndex >= 0 && <ForkButton turnIndex={turnIndex} />}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <MediaPreviewModal src={previewMedia} onClose={() => setPreviewMedia(null)} />
    </div>
  );
}

function hasMessageContent(message: ChatMessageType): boolean {
  if (!Content.isEmpty(message.content)) {
    return true;
  }
  return message.steps?.some((s) => s.items.length > 0) ?? false;
}

export const ChatMessage = memo(function ChatMessage({ message, turnIndex, userTurnIndex, totalTurns, isStreaming }: ChatMessageProps) {
  if (message.role === "user") {
    return <UserMessage message={message} userTurnIndex={userTurnIndex} totalTurns={totalTurns} />;
  }
  return <AssistantMessage message={message} turnIndex={turnIndex} isStreaming={isStreaming} />;
});
