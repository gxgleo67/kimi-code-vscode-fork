import { useEffect, useState } from "react";
import { useRequest } from "ahooks";
import {
  IconBrain,
  IconCircleCheck,
  IconCircleX,
  IconFileCode,
  IconListCheck,
  IconLoader2,
  IconStack2,
  IconSubtask,
  IconTerminal2,
} from "@tabler/icons-react";
import { bridge, Events } from "@/services";
import { useChatStore } from "@/stores";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { getTodoBlock, TodoStatusIcon } from "./ToolRenderers";
import { FileChangesPanel } from "./FileChangesPanel";
import { QueuedMessagesPanel } from "./QueuedMessagesPanel";
import { ContextViewerDialog } from "./ContextViewerDialog";
import type { BackgroundTaskItem } from "shared/legacy-sdk";
import type { FileChange } from "shared/types";
import type { ChatMessage } from "@/stores/chat.store";

type PanelId = "queue" | "changes" | "bash" | "agents" | "todos";

const TASKS_POLL_INTERVAL_MS = 2500;
const MAX_PANEL_TASKS = 20;
const FAILED_STATUSES = new Set(["failed", "timed_out", "killed", "lost"]);

type TodoItems = { title: string; status: string }[];

/** Last SetTodoList result wins — it replaces the list rather than appending. */
function findLastTodoItems(messages: ChatMessage[]): TodoItems | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const steps = messages[i].steps;
    if (!steps) continue;
    for (let j = steps.length - 1; j >= 0; j--) {
      const items = steps[j].items;
      for (let k = items.length - 1; k >= 0; k--) {
        const item = items[k];
        if (item.type === "tool_use" && item.call.name === "SetTodoList") {
          return getTodoBlock(item.result?.display)?.items ?? null;
        }
      }
    }
  }
  return null;
}

function taskDurationSeconds(task: BackgroundTaskItem): number {
  return Math.max(0, Math.round(((task.endedAt ?? Date.now()) - task.startedAt) / 1000));
}

/** Running first, then most recently finished/started; capped for the panel. */
function sortTasks(tasks: BackgroundTaskItem[]): BackgroundTaskItem[] {
  return [...tasks]
    .sort((a, b) => {
      const aRunning = a.status === "running";
      const bRunning = b.status === "running";
      if (aRunning !== bRunning) return aRunning ? -1 : 1;
      return (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt);
    })
    .slice(0, MAX_PANEL_TASKS);
}

function TaskStatusIcon({ status }: { status: string }) {
  if (status === "running") {
    return <IconLoader2 className="size-3.5 animate-spin text-blue-500" />;
  }
  if (status === "completed") {
    return <IconCircleCheck className="size-3.5 text-emerald-500" />;
  }
  return <IconCircleX className="size-3.5 text-destructive" />;
}

function TaskRow({ task }: { task: BackgroundTaskItem }) {
  const t = useT();
  const failed = FAILED_STATUSES.has(task.status);
  const seconds = taskDurationSeconds(task);
  const statusText =
    task.status === "running"
      ? t("pills.statusRunning", { seconds })
      : task.status === "completed"
        ? t("pills.statusDone", { seconds })
        : t("pills.statusFailed", { seconds });
  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <TaskStatusIcon status={task.status} />
      <span className={cn("flex-1 min-w-0 truncate text-xs", failed && "text-destructive")}>{task.description}</span>
      <span className="shrink-0 rounded bg-muted px-1 py-px text-[9px] text-muted-foreground">
        {task.kind === "process" ? t("pills.badgeBash") : t("pills.badgeAgent")}
      </span>
      <span className={cn("shrink-0 text-[10px] tabular-nums", failed ? "text-destructive" : "text-muted-foreground")}>
        {statusText}
      </span>
    </div>
  );
}

/** Pills row above the input box. Left side keeps the classic fork modules
 *  (queued messages / file changes); the newer modules (background bash /
 *  sub-agent / todos / context viewer) sit on the right and stay hidden until
 *  the current conversation has actually used them — the context viewer pill
 *  appears once a compaction ran in this session. The whole row hides when
 *  there is nothing to show. */
export function StatusPills() {
  const t = useT();
  const sessionId = useChatStore((s) => s.sessionId);
  const queue = useChatStore((s) => s.queue);
  // The selector returns the todo block's own array, so immer's structural
  // sharing keeps the reference stable across unrelated message updates.
  const todoItems = useChatStore((s) => findLastTodoItems(s.messages));
  // "Compaction was used in this conversation" — drives the context pill.
  const hasCompaction = useChatStore(
    (s) => s.isCompacting || s.messages.some((m) => m.steps?.some((step) => step.items.some((item) => item.type === "compaction"))),
  );
  const [openPanel, setOpenPanel] = useState<PanelId | null>(null);
  const [fileChanges, setFileChanges] = useState<FileChange[]>([]);
  const [contextOpen, setContextOpen] = useState(false);

  useEffect(() => {
    return bridge.on<FileChange[]>(Events.FileChangesUpdated, setFileChanges);
  }, []);

  const { data, mutate } = useRequest(() => bridge.getBackgroundTasks(), {
    pollingInterval: TASKS_POLL_INTERVAL_MS,
    pollingWhenHidden: false,
    ready: sessionId !== null,
  });

  // The poll target is the extension's current session for this view — after
  // a session switch the previous session's tasks must not linger until the
  // next poll returns.
  useEffect(() => {
    mutate(undefined);
  }, [sessionId, mutate]);

  const tasks = sessionId === null ? [] : (data?.tasks ?? []);
  const bashTasks = tasks.filter((task) => task.kind === "process");
  const agentTasks = tasks.filter((task) => task.kind === "agent");
  const todoTotal = todoItems?.length ?? 0;
  const todoDone = todoItems?.filter((item) => item.status === "done").length ?? 0;
  const fileStats = fileChanges.reduce(
    (acc, change) => ({ additions: acc.additions + change.additions, deletions: acc.deletions + change.deletions }),
    { additions: 0, deletions: 0 },
  );

  // Close a panel whose data has gone away.
  useEffect(() => {
    if (openPanel === "queue" && queue.length === 0) setOpenPanel(null);
    if (openPanel === "changes" && fileChanges.length === 0) setOpenPanel(null);
    if (openPanel === "bash" && bashTasks.length === 0) setOpenPanel(null);
    if (openPanel === "agents" && agentTasks.length === 0) setOpenPanel(null);
    if (openPanel === "todos" && todoItems === null) setOpenPanel(null);
  }, [openPanel, queue.length, fileChanges.length, bashTasks.length, agentTasks.length, todoItems]);

  const hasQueue = queue.length > 0;
  const hasChanges = fileChanges.length > 0;
  const hasBash = bashTasks.length > 0;
  const hasAgents = agentTasks.length > 0;
  const hasTodos = todoItems !== null && todoTotal > 0;
  if (!hasQueue && !hasChanges && !hasBash && !hasAgents && !hasTodos && !hasCompaction) {
    return null;
  }

  const togglePanel = (panel: PanelId) => {
    setOpenPanel((prev) => (prev === panel ? null : panel));
  };

  const pillClass = (active: boolean) =>
    cn(
      "flex items-center gap-1.5 px-2 py-0.5 rounded text-xs transition-colors cursor-pointer",
      active ? "bg-accent text-accent-foreground" : "hover:bg-muted/50 text-muted-foreground",
    );

  const runningBash = bashTasks.filter((task) => task.status === "running").length;
  const runningAgents = agentTasks.filter((task) => task.status === "running").length;

  return (
    <div className="shrink-0 mb-0.5">
      {openPanel !== null && (
        <div className="mb-0.5 max-h-40 overflow-y-auto border border-border/60 rounded-md bg-card">
          {(openPanel === "bash" || openPanel === "agents" || openPanel === "todos") && (
            <div className="border-b border-border/60 px-2 py-1 text-xs font-medium">
              {openPanel === "bash" && t("pills.bashTitle", { count: runningBash })}
              {openPanel === "agents" && t("pills.agentsTitle", { count: runningAgents })}
              {openPanel === "todos" && t("pills.todosTitle", { done: todoDone, total: todoTotal })}
            </div>
          )}
          {openPanel === "queue" && <QueuedMessagesPanel />}
          {openPanel === "changes" && <FileChangesPanel changes={fileChanges} />}
          {(openPanel === "bash" || openPanel === "agents" || openPanel === "todos") && (
            <div className="px-2 py-1">
              {openPanel === "bash" && sortTasks(bashTasks).map((task) => <TaskRow key={task.taskId} task={task} />)}
              {openPanel === "agents" && sortTasks(agentTasks).map((task) => <TaskRow key={task.taskId} task={task} />)}
              {openPanel === "todos" &&
                todoItems?.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-1 py-0.5">
                    <div className="mt-0.5">
                      <TodoStatusIcon status={item.status} />
                    </div>
                    <span className={cn("text-xs leading-relaxed", item.status === "done" && "line-through text-muted-foreground")}>
                      {item.title}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-1 py-0.5 min-h-7">
        <div className="flex items-center gap-1 min-w-0">
          {hasQueue && (
            <button type="button" onClick={() => togglePanel("queue")} className={pillClass(openPanel === "queue")}>
              <IconStack2 className="size-3.5" />
              <span>{t("queue.queuedCount", { count: queue.length })}</span>
            </button>
          )}
          {hasChanges && (
            <button type="button" onClick={() => togglePanel("changes")} className={pillClass(openPanel === "changes")}>
              <IconFileCode className="size-3.5" />
              <span>{t("changes.changedCount", { count: fileChanges.length })}</span>
              <span className="text-[10px] tabular-nums">
                <span className="text-green-600 dark:text-green-400">+{fileStats.additions}</span>{" "}
                <span className="text-red-600 dark:text-red-400">-{fileStats.deletions}</span>
              </span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {hasBash && (
            <button type="button" onClick={() => togglePanel("bash")} className={pillClass(openPanel === "bash")}>
              <IconTerminal2 className="size-3.5" />
              <span>{t("pills.bash", { count: bashTasks.length })}</span>
            </button>
          )}
          {hasAgents && (
            <button type="button" onClick={() => togglePanel("agents")} className={pillClass(openPanel === "agents")}>
              <IconSubtask className="size-3.5" />
              <span>{t("pills.agents", { count: agentTasks.length })}</span>
            </button>
          )}
          {hasTodos && (
            <button type="button" onClick={() => togglePanel("todos")} className={pillClass(openPanel === "todos")}>
              <IconListCheck className="size-3.5" />
              <span>{t("pills.todos", { done: todoDone, total: todoTotal })}</span>
            </button>
          )}
          {hasCompaction && (
            <button type="button" onClick={() => setContextOpen(true)} className={pillClass(false)} title={t("context.tooltip")}>
              <IconBrain className="size-3.5" />
              <span>{t("context.label")}</span>
            </button>
          )}
        </div>
      </div>

      <ContextViewerDialog open={contextOpen} onOpenChange={setContextOpen} />
    </div>
  );
}
