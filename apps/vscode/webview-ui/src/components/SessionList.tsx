import { useEffect, useMemo, useRef, useState } from "react";
import { useRequest } from "ahooks";
import { IconSearch, IconDots, IconTrash, IconCheck, IconPencil } from "@tabler/icons-react";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StreamingConfirmDialog } from "./StreamingConfirmDialog";
import { KimiLoading } from "./KimiLoading";
import { bridge, Events } from "@/services";
import type { SessionInfo } from "shared/legacy-sdk";
import { cn } from "@/lib/utils";
import { useChatStore, useSettingsStore } from "@/stores";
import { cleanSystemTags } from "shared/utils";
import { toast } from "./ui/sonner";
import { useT } from "@/i18n";

interface SessionListProps {
  onClose: () => void;
}

function formatRelativeDate(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`;
  if (d < 7) return `${d}d`;
  return new Date(timestamp).toLocaleDateString();
}

interface SessionItemProps {
  session: SessionInfo;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  dirLabel: string | null; // null = current dir, string = relative path
}

function SessionItem({ session, isSelected, onSelect, onDelete, onRename, dirLabel }: SessionItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useT();
  const title = cleanSystemTags(session.brief) || t("session.untitled");

  const startEditing = () => {
    setDraftTitle(title);
    setEditing(true);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  };

  const commitEditing = () => {
    const next = draftTitle.trim();
    setEditing(false);
    if (next.length > 0 && next !== title) {
      onRename(next);
    }
  };

  return (
    <div
      className={cn("group relative px-2 py-1.5 rounded-md cursor-pointer transition-colors", isSelected ? "bg-accent" : "hover:bg-accent/50")}
      title={`${title}\n${session.workDir}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={editing ? undefined : onSelect}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onBlur={commitEditing}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") {
              e.preventDefault();
              commitEditing();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-full h-5 px-1 text-xs bg-background border border-ring rounded-sm outline-none"
          maxLength={200}
        />
      ) : (
        <div className="flex items-center gap-1.5 min-w-0">
          {isSelected && <IconCheck className="size-3 text-blue-500 shrink-0" />}
          <span className="text-xs text-foreground truncate flex-1 min-w-0">{title}</span>
          {dirLabel && <span className="text-[10px] text-muted-foreground/70 truncate max-w-20 shrink-0">{dirLabel}</span>}
          <span className="text-[10px] text-muted-foreground shrink-0">{formatRelativeDate(session.updatedAt)}</span>
          <div className={cn("transition-opacity shrink-0", isHovered ? "opacity-100" : "opacity-0")}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="p-1 -m-1 rounded hover:bg-muted transition-colors" onClick={(e) => e.stopPropagation()}>
                  <IconDots className="size-3.5 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-32">
                <DropdownMenuItem
                  className="text-xs cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    startEditing();
                  }}
                >
                  <IconPencil className="size-3.5 mr-2" />
                  {t("session.rename")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-xs text-destructive focus:text-destructive cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                >
                  <IconTrash className="size-3.5 mr-2" />
                  {t("common.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
    </div>
  );
}

export function SessionList({ onClose }: SessionListProps) {
  const { loadSession, sessionId, startNewConversation, isStreaming, setHistoryLoading } = useChatStore();
  const { workspaceRoot, currentWorkDir, setCurrentWorkDir } = useSettingsStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SessionInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pendingSession, setPendingSession] = useState<SessionInfo | null>(null);
  const t = useT();

  const { data: kimiSessions = [], loading, mutate, refresh } = useRequest(() => bridge.getAllKimiSessions(), {
    // Reopening the panel shows the cached list instantly and revalidates in
    // the background once it is stale — no spinner for warm opens.
    cacheKey: "kimi-all-sessions",
    staleTime: 10_000,
  });

  const handleRename = async (session: SessionInfo, title: string) => {
    // Optimistic: the row reflects the new title immediately; a failure
    // re-fetches so the persisted title wins.
    mutate((prev) => prev?.map((s) => (s.id === session.id ? { ...s, brief: title } : s)));
    try {
      const result = await bridge.renameSession(session.id, title);
      if (!result.ok) throw new Error("rename rejected");
    } catch (error) {
      console.error("[SessionList] Failed to rename session:", error);
      toast.error(t("session.unableToRename", { error: error instanceof Error ? error.message : String(error) }));
      refresh();
    }
  };

  // Live title refreshes (llm-generated title on the first prompt, renames):
  // patch the affected row in place instead of refetching the whole list.
  useEffect(() => {
    return bridge.on(Events.SessionMetaUpdated, (data: { sessionId: string; title?: string }) => {
      const title = data.title?.trim();
      if (!title) return;
      mutate((prev) => prev?.map((s) => (s.id === data.sessionId ? { ...s, brief: title } : s)));
    });
  }, [mutate]);

  const getWorkDirLabel = (sessionWorkDir: string): string | null => {
    const activeWorkDir = currentWorkDir || workspaceRoot;
    if (sessionWorkDir === activeWorkDir) return null;
    if (!workspaceRoot) return sessionWorkDir;
    // Show (root) for workspace root, relative path for subdirs
    if (sessionWorkDir === workspaceRoot) {
      return "/";
    }
    if (sessionWorkDir.startsWith(workspaceRoot)) {
      return "." + sessionWorkDir.slice(workspaceRoot.length);
    }
    return sessionWorkDir;
  };

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return kimiSessions;
    const q = searchQuery.toLowerCase();
    return kimiSessions.filter((s) => s.brief.toLowerCase().includes(q));
  }, [kimiSessions, searchQuery]);

  // Long histories render in batches — mounting hundreds of rows at once is
  // what made the panel stutter.
  const [visibleCount, setVisibleCount] = useState(100);
  useEffect(() => {
    setVisibleCount(100);
  }, [searchQuery]);
  const visibleSessions = filteredSessions.slice(0, visibleCount);
  const hiddenCount = filteredSessions.length - visibleSessions.length;

  const handleSelect = async (session: SessionInfo) => {
    console.log("[SessionList] Loading session:", session.id);

    // If streaming, show confirmation dialog
    if (isStreaming) {
      setPendingSession(session);
      return;
    }

    await doLoadSession(session);
  };

  const doLoadSession = async (session: SessionInfo) => {
    // Close the popover as soon as a session is picked instead of after the
    // load: resuming hydrates the whole wire log, and leaving the list open
    // over the loading veil for that duration reads as "stuck".
    onClose();
    // Show the loading veil right away: resuming a session means the engine
    // hydrates every agent's wire log, which can take a moment — without it
    // the UI looks frozen on the previous conversation.
    setHistoryLoading(true);
    try {
      // Switch workDir if session is from a different directory
      const activeWorkDir = currentWorkDir || workspaceRoot;
      if (session.workDir !== activeWorkDir) {
        const newWorkDir = session.workDir === workspaceRoot ? null : session.workDir;
        const result = await bridge.setWorkDir(newWorkDir);
        if (result.ok) {
          setCurrentWorkDir(newWorkDir);
        }
      }
      const events = await bridge.loadSessionHistory(session.id);
      await loadSession(session.id, events);
    } catch (error) {
      console.error("[SessionList] Failed to load session:", error);
      toast.error(t("session.unableToOpen", { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleConfirmSwitch = async () => {
    if (!pendingSession) return;
    await doLoadSession(pendingSession);
    setPendingSession(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    try {
      await bridge.deleteSession(deleteTarget.id);

      if (sessionId === deleteTarget.id) {
        await startNewConversation();
      }

      mutate((prev) => prev?.filter((s) => s.id !== deleteTarget.id) || []);
    } catch (error) {
      console.error("[SessionList] Failed to delete session:", error);
      toast.error(t("session.unableToDelete", { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <div className="flex flex-col max-h-[70vh]">
        <div className="p-2 border-b border-border shrink-0">
          <div className="relative">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input placeholder={t("session.searchPlaceholder")} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-8 h-8 text-xs" />
          </div>
        </div>
        <div className="overflow-y-auto flex-1 min-h-0">
          <div className="p-1.5 space-y-1">
            {loading && kimiSessions.length === 0 ? (
              <div className="flex justify-center py-8">
                <KimiLoading />
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">{searchQuery ? t("session.noneFound") : t("session.noneYet")}</div>
            ) : (
              <>
                {visibleSessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    isSelected={sessionId === session.id}
                    onSelect={() => {
                      void handleSelect(session);
                    }}
                    onDelete={() => setDeleteTarget(session)}
                    onRename={(title) => {
                      void handleRename(session, title);
                    }}
                    dirLabel={getWorkDirLabel(session.workDir)}
                  />
                ))}
                {hiddenCount > 0 && (
                  <button
                    className="w-full py-1.5 text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setVisibleCount((count) => count + 200)}
                  >
                    {t("session.showMore", { count: hiddenCount })}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <StreamingConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("session.deleteTitle")}
        description={t("session.deleteDesc")}
        confirmLabel={t("common.delete")}
        onConfirm={() => {
          void handleDelete();
        }}
        confirmDisabled={isDeleting}
        cancelDisabled={isDeleting}
        confirmLoading={isDeleting}
      />

      <StreamingConfirmDialog
        open={pendingSession !== null}
        onOpenChange={(open) => !open && setPendingSession(null)}
        title={t("session.switchTitle")}
        description={t("session.switchDesc")}
        confirmLabel={t("session.switch")}
        onConfirm={() => {
          void handleConfirmSwitch();
        }}
      />
    </>
  );
}
