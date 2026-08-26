import { useRef, useMemo, useState, useEffect, useCallback } from "react";
import { useMemoizedFn } from "ahooks";
import { IconSend, IconPlayerStop, IconPaperclip, IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ActionMenu } from "../ActionMenu";
import { SlashCommandMenu } from "../SlashCommandMenu";
import { FilePickerMenu } from "../FilePickerMenu";
import { MediaThumbnail } from "../MediaThumbnail";
import { MediaPreviewModal } from "../MediaPreviewModal";
import { BottomToolbar } from "../BottomToolbar";
import { StatusPills } from "../StatusPills";
import { SubagentModelDialog } from "../SubagentModelDialog";
import { ModeButtons } from "../ModeButtons";
import { ModelPicker } from "../ModelPicker";
import { YoloModeButton } from "../YoloModeButton";
import { ComposerOverflowMenu } from "../ComposerOverflowMenu";
import { UsageStatusBar } from "../UsageStatusBar";
import { useElementWidth } from "@/hooks/useElementWidth";
import {
  getModelById,
  getMediaFallbackModel,
  getModelsForMedia,
  isMainModel,
  useChatStore,
  useSettingsStore,
} from "@/stores";
import { bridge, Events } from "@/services";
import { Content } from "@/lib/content";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { useSlashMenu, findActiveToken } from "./hooks/useSlashMenu";
import { useFilePicker } from "./hooks/useFilePicker";
import { useMediaUpload } from "./hooks/useMediaUpload";
import { useClickOutside } from "./hooks/useClickOutside";
import { useInputHistory } from "./hooks/useInputHistory";
import { computeMentionInsert } from "./utils";

interface InputAreaProps {
  onAuthAction?: () => void;
}

/** Responsive collapse thresholds for the composer's button row (px). Below
 *  the first the text labels hide (icon-only); below the second the whole
 *  left cluster folds into a single "⋯" overflow menu. Tuned for the longest
 *  (Chinese) labels; adjust together if a label set grows. */
const COLLAPSE_ICONS_BELOW = 560;
const COLLAPSE_OVERFLOW_BELOW = 340;

export function InputArea({ onAuthAction }: InputAreaProps) {
  const t = useT();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [previewMedia, setPreviewMedia] = useState<string | null>(null);
  // Paperclip-pinned file picker: opened without inserting a "@", so
  // cancelling the picker never leaves a stray character in the composer.
  const [filePickerPinned, setFilePickerPinned] = useState(false);

  const isStreaming = useChatStore((s) => s.isStreaming);
  const stopping = useChatStore((s) => s.stopping);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const steerNow = useChatStore((s) => s.steerNow);
  const abort = useChatStore((s) => s.abort);
  const draftMedia = useChatStore((s) => s.draftMedia);
  const removeDraftMedia = useChatStore((s) => s.removeDraftMedia);
  const hasProcessingMedia = useChatStore((s) => s.hasProcessingMedia);
  const getMediaInConversation = useChatStore((s) => s.getMediaInConversation);
  const pendingInput = useChatStore((s) => s.pendingInput);
  const planMode = useChatStore((s) => s.planMode);
  const goalArmed = useChatStore((s) => s.goalArmed);
  // A switch from a non-empty conversation resends the accumulated context,
  // losing the prompt cache — surface the cost note in the switcher dropdowns.
  const hasConversationHistory = useChatStore((s) => s.messages.some((message) => message.role === "user"));
  const currentModel = useSettingsStore((s) => s.currentModel);
  const updateModel = useSettingsStore((s) => s.updateModel);
  const models = useSettingsStore((s) => s.models);
  const extensionConfig = useSettingsStore((s) => s.extensionConfig);
  const permissionMode = useSettingsStore((s) => s.permissionMode);
  const selectPermissionMode = useSettingsStore((s) => s.selectPermissionMode);

  const isProcessing = hasProcessingMedia();

  const mediaReq = useMemo(() => {
    const media = getMediaInConversation();
    return { image: media.hasImage, video: media.hasVideo };
  }, [getMediaInConversation, draftMedia]);

  // Subagent-only custom providers must never be offered as the main model.
  const mainModels = useMemo(() => models.filter(isMainModel), [models]);
  const availableModels = useMemo(() => getModelsForMedia(mainModels, mediaReq), [mainModels, mediaReq]);
  const currentModelConfig = getModelById(models, currentModel);

  // Auto-switch model if current model doesn't support required media
  useEffect(() => {
    if (!mediaReq.image && !mediaReq.video) {
      return;
    }
    const isCurrentModelValid = availableModels.some((m) => m.id === currentModel);
    if (isCurrentModelValid) {
      return;
    }
    const fallbackModel = getMediaFallbackModel(availableModels, currentModelConfig);
    if (fallbackModel !== undefined) {
      updateModel(fallbackModel.id);
    }
  }, [mediaReq.image, mediaReq.video, currentModel, currentModelConfig, availableModels, updateModel]);

  // Restore pending input
  useEffect(() => {
    if (!pendingInput || isStreaming) {
      return;
    }

    // 输入框已有新内容时丢弃待恢复输入，避免过期回填
    if (text.trim()) {
      useChatStore.setState({ pendingInput: null });
      return;
    }

    // 一次性消费：恢复后立即清除，防止之后每次 isStreaming 翻 false 再次回填
    const textContent = Content.getText(pendingInput.content);
    useChatStore.setState({ pendingInput: null });
    if (textContent) {
      setText(textContent);
      setTimeout(() => {
        textareaRef.current?.focus();
        adjustHeight();
      }, 0);
    }
  }, [pendingInput, isStreaming, text]);

  const activeToken = useMemo(() => findActiveToken(text, cursorPos), [text, cursorPos]);

  const { handlePaste, handlePickMedia } = useMediaUpload();

  const adjustHeight = useMemoizedFn(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
    }
  });

  const {
    handleKey: handleHistoryKey,
    add: addToHistory,
    reset: resetHistoryIndex,
  } = useInputHistory({
    text,
    setText,
    onHeightChange: () => setTimeout(adjustHeight, 0),
  });

  const clearInput = useMemoizedFn(() => {
    setText("");
    setCursorPos(0);
    setTimeout(adjustHeight, 0);
  });

  const removeActiveToken = useMemoizedFn(() => {
    if (!activeToken) return;
    const newText = text.slice(0, activeToken.start) + text.slice(cursorPos);
    const newCursorPos = activeToken.start;
    setText(newText);
    setCursorPos(newCursorPos);
    setTimeout(() => {
      textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos);
      adjustHeight();
    }, 0);
  });

  const handleSend = useMemoizedFn(() => {
    if (isProcessing || (!text.trim() && draftMedia.length === 0)) {
      return;
    }

    addToHistory(text);
    sendMessage(text);
    clearInput();
  });

  // Alt+Enter: send immediately — steers into a busy turn without touching
  // the queue; a plain send when idle.
  const handleSendImmediate = useMemoizedFn(() => {
    if (isProcessing || (!text.trim() && draftMedia.length === 0)) {
      return;
    }

    addToHistory(text);
    steerNow(text);
    clearInput();
  });

  const handleSlashCommand = useMemoizedFn((name: string) => {
    sendMessage(`/${name}`);
    clearInput();
  });

  const applyMention = useMemoizedFn((filePath: string) => {
    setFilePickerPinned(false);
    const { newText, newCursorPos } = computeMentionInsert({
      text,
      cursorPos,
      filePath,
      activeToken,
      isAppend: false,
    });

    setText(newText);
    setCursorPos(newCursorPos);
    setTimeout(() => {
      textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos);
      textareaRef.current?.focus();
      adjustHeight();
    }, 0);
  });

  const {
    showSlashMenu,
    filteredCommands,
    selectedIndex: slashSelectedIndex,
    setSelectedIndex: setSlashSelectedIndex,
    handleSlashMenuKey,
    resetSlashMenu,
  } = useSlashMenu(activeToken, handleSlashCommand, removeActiveToken);

  const {
    showFileMenu,
    filePickerMode,
    folderPath,
    fileItems,
    selectedIndex: fileSelectedIndex,
    isLoading: isFileLoading,
    showMediaOption,
    setSelectedIndex: setFileSelectedIndex,
    setFilePickerMode,
    setFolderPath,
    handleFileMenuKey,
    resetFilePicker,
  } = useFilePicker(
    activeToken,
    filePickerPinned,
    applyMention,
    () => {
      setFilePickerPinned(false);
      void handlePickMedia();
    },
    () => {
      setFilePickerPinned(false);
      removeActiveToken();
    },
  );

  const closeMenus = useCallback(() => {
    setFilePickerPinned(false);
    if (showSlashMenu || showFileMenu) {
      removeActiveToken();
    }
  }, [showSlashMenu, showFileMenu, removeActiveToken]);

  useClickOutside([textareaRef, menuRef], showSlashMenu || showFileMenu, closeMenus);

  useEffect(() => {
    resetSlashMenu();
  }, [showSlashMenu, resetSlashMenu]);

  useEffect(() => {
    if (!showFileMenu) {
      resetFilePicker();
    }
  }, [showFileMenu, resetFilePicker]);

  useEffect(() => {
    const unsub = bridge.on<{ mention: string }>(Events.InsertMention, ({ mention }) => {
      setText((prev) => prev + mention + " ");

      setTimeout(() => {
        textareaRef.current?.focus();
        adjustHeight();
      }, 0);
    });

    return unsub;
  }, [adjustHeight]);

  const handleKeyDown = useMemoizedFn((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) {
      return;
    }

    if (handleSlashMenuKey(e)) {
      return;
    }

    if (handleFileMenuKey(e)) {
      return;
    }

    if (handleHistoryKey(e)) {
      return;
    }

    // Alt+Enter: send immediately (queue bypass via steer); Shift+Enter keeps
    // its default newline role. This branch must precede the plain-Enter
    // checks below — they don't test altKey.
    if (e.key === "Enter" && e.altKey) {
      e.preventDefault();
      handleSendImmediate();
      return;
    }

    if (extensionConfig.useCtrlEnterToSend) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
      }
    } else {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    }
  });

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    setCursorPos(e.target.selectionStart);
    resetHistoryIndex();
    setTimeout(adjustHeight, 0);
  };

  const handleSelect = () => {
    setCursorPos(textareaRef.current?.selectionStart ?? 0);
  };

  const handleAddButtonClick = useMemoizedFn(() => {
    // Pin the file picker open without typing "@": cancelling it then leaves
    // the composer text untouched.
    setFilePickerPinned(true);
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  });

  const hasModels = availableModels.length > 0;
  const canSend = (text.trim() || draftMedia.length > 0) && !isProcessing;

  // Measure the button row and degrade gracefully as the sidebar narrows:
  // full labels → icon-only → "⋯" overflow menu. The compact-composer setting
  // forces icon-only at any width; the model name never compacts either way.
  const { ref: toolbarRef, width: toolbarWidth } = useElementWidth<HTMLDivElement>();
  const collapse =
    toolbarWidth < COLLAPSE_OVERFLOW_BELOW
      ? "overflow"
      : extensionConfig.compactComposer || toolbarWidth < COLLAPSE_ICONS_BELOW
        ? "icons"
        : "full";
  const compact = collapse !== "full";

  return (
    <div className="p-2 pt-0! flex flex-col min-h-0">
      <BottomToolbar />
      <StatusPills />
      <div className="relative shrink-0">
        {showSlashMenu && filteredCommands.length > 0 && (
          <div ref={menuRef} className="absolute bottom-full left-0 right-0 mb-2 z-10">
            <SlashCommandMenu
              commands={filteredCommands}
              query={activeToken?.query || ""}
              selectedIndex={slashSelectedIndex}
              onSelect={handleSlashCommand}
              onHover={setSlashSelectedIndex}
            />
          </div>
        )}

        {showFileMenu && (
          <div ref={menuRef} className="absolute bottom-full left-0 right-0 mb-2 z-10">
            <FilePickerMenu
              mode={filePickerMode}
              items={fileItems}
              currentPath={folderPath}
              selectedIndex={fileSelectedIndex}
              isLoading={isFileLoading}
              showMediaOption={showMediaOption}
              onSelectMedia={() => {
                void handlePickMedia();
              }}
              onSwitchToFolder={() => {
                setFilePickerMode("folder");
                setFolderPath("");
                setFileSelectedIndex(0);
              }}
              onSwitchToSearch={() => {
                setFilePickerMode("search");
                setFolderPath("");
                setFileSelectedIndex(0);
              }}
              onSelectItem={(item) => applyMention(item.path)}
              onNavigateUp={() => {
                setFolderPath(folderPath.split("/").slice(0, -1).join("/"));
                setFileSelectedIndex(0);
              }}
              onNavigateInto={(item) => {
                setFilePickerMode("folder");
                setFolderPath(item.path);
                setFileSelectedIndex(0);
              }}
              onHover={setFileSelectedIndex}
            />
          </div>
        )}

        {/* Permission-mode cue: only the frame stroke changes color — blue for
            plan, amber for yolo, red for auto (plan wins over both; colors
            match the permission button: auto is the fully autonomous mode).
            The background always stays the default. */}
        <div
          className={cn(
            "border rounded-md overflow-hidden",
            planMode
              ? "border-blue-500"
              : permissionMode === "yolo"
                ? "border-amber-500"
                : permissionMode === "auto"
                  ? "border-destructive"
                  : "border-input",
          )}
        >
          {draftMedia.length > 0 && (
            <div className="flex gap-2 p-2 overflow-x-auto">
              {draftMedia.map((item) => (
                <MediaThumbnail
                  key={item.id}
                  src={item.dataUri}
                  size="sm"
                  onClick={item.dataUri ? () => setPreviewMedia(item.dataUri!) : undefined}
                  onRemove={() => removeDraftMedia(item.id)}
                />
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onSelect={handleSelect}
            onPaste={handlePaste}
            placeholder={goalArmed ? t("modes.goalPlaceholder") : isStreaming ? t("input.placeholderStreaming") : t("input.placeholder")}
            className={cn(
              "w-full min-h-12 max-h-35 px-2.5 py-1.5 text-xs leading-relaxed",
              "bg-transparent resize-none outline-none border-none overflow-y-auto",
              "placeholder:text-muted-foreground",
            )}
          />

          <div ref={toolbarRef} className="flex items-center justify-between px-1.5 pb-1.5">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {collapse === "overflow" ? (
                <ComposerOverflowMenu disabled={isStreaming} onAddFiles={handleAddButtonClick} />
              ) : (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon-xs" onClick={handleAddButtonClick} className="text-muted-foreground">
                        <IconPaperclip className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("input.addFilesOrMedia")}</TooltipContent>
                  </Tooltip>
                  <YoloModeButton
                    mode={permissionMode}
                    disabled={isStreaming}
                    compact={compact}
                    onSelect={selectPermissionMode}
                  />
                  <ModeButtons compact={compact} />
                  <SubagentModelDialog disabled={isStreaming} />
                </>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <UsageStatusBar />
              <ModelPicker
                availableModels={availableModels}
                hasConversationHistory={hasConversationHistory}
                disabled={isStreaming || !hasModels}
              />
              <ActionMenu onAuthAction={onAuthAction} />

              {isStreaming ? (
                <Button variant="destructive" size="icon-xs" onClick={abort}>
                  <IconPlayerStop className="size-3.5" />
                </Button>
              ) : stopping ? (
                <Button variant="destructive" size="icon-xs" disabled>
                  <IconLoader2 className="size-3.5 animate-spin" />
                </Button>
              ) : (
                <Button variant="default" size="icon-xs" onClick={handleSend} disabled={!canSend}>
                  <IconSend className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
      <MediaPreviewModal src={previewMedia} onClose={() => setPreviewMedia(null)} />
    </div>
  );
}
