import { create } from "zustand";
import { produce } from "immer";
import { bridge } from "@/services";
import { Content } from "@/lib/content";
import { useApprovalStore } from "./approval.store";
import { toast } from "@/components/ui/sonner";
import { t } from "@/i18n";

import { useSettingsStore } from "./settings.store";
import { processEvent } from "./event-handlers";
import type { SessionContextSnapshot, StatusUpdate, ContentPart, GoalStateInfo, QuestionRequest, ToolResult } from "shared/legacy-sdk";
import type { UIStreamEvent } from "shared/types";

const HANDSHAKE_TIMEOUT_MS = 30_000;

export interface UIToolCall {
  id: string;
  name: string;
  arguments: string | null;
}

export interface UIStep {
  n: number;
  items: UIStepItem[];
  planMode?: boolean;
}

export interface InlineError {
  code: string;
  message: string;
  detail?: string; // 服务器原始错误信息
}

export type UIStepItem =
  | { type: "thinking"; content: string; finished?: boolean }
  | { type: "text"; content: string; finished?: boolean }
  | {
      type: "compaction";
      /** Post-compaction summary, patched in once the turn settles. */
      summary?: string;
      /** Context size right after the compaction. */
      tokenCount?: number;
      /** Context size captured when the compaction started. */
      preTokens?: number;
      trigger?: "manual" | "auto";
    }
  | { type: "steer"; content: string | ContentPart[] }
  | {
      type: "tool_use";
      id: string;
      call: UIToolCall;
      result?: ToolResult["return_value"];
      subagent_steps?: UIStep[];
      /** Bound model alias of the spawned subagent (SubagentSpawned event). */
      subagentModel?: string;
    };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string | ContentPart[];
  timestamp: number;
  steps?: UIStep[];
  status?: StatusUpdate;
  inlineError?: InlineError;
  /** False for host-only commands that do not create a forkable core turn. */
  forkable?: boolean;
}

export interface TokenUsage {
  input_other: number;
  output: number;
  input_cache_read: number;
  input_cache_creation: number;
}

function createEmptyTokenUsage(): TokenUsage {
  return { input_other: 0, output: 0, input_cache_read: 0, input_cache_creation: 0 };
}

export interface MediaInConversation {
  hasImage: boolean;
  hasVideo: boolean;
}

export interface DraftMediaItem {
  id: string;
  dataUri?: string;
}

export interface PendingInput {
  content: string | ContentPart[];
  model: string;
}

/** A resent message whose old [user, assistant] pair stays visible until the
 * engine accepts the retry (TurnBegin) — popping it up-front would lose the
 * exchange from view when the retry fails before the turn starts. */
export interface PendingRetry {
  content: string | ContentPart[];
}

export interface QueuedItem {
  id: string;
  content: string | ContentPart[];
  model: string;
  goalObjective?: string;
}

export interface ChatState {
  sessionId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  /** Stop requested, waiting for the engine's terminal event. */
  stopping: boolean;
  isCompacting: boolean;
  handshakeReceived: boolean;
  draftMedia: DraftMediaItem[];
  lastStatus: StatusUpdate | null;
  tokenUsage: TokenUsage;
  activeTokenUsage: TokenUsage;
  pendingInput: PendingInput | null;
  queue: QueuedItem[];
  pendingQuestion: QuestionRequest | null;
  planMode: boolean;
  swarmMode: boolean;
  goal: GoalStateInfo | null;
  /** One-shot arm: the next send creates a goal from the message text. */
  goalArmed: boolean;
  /** True while a history session is being fetched and replayed. */
  historyLoading: boolean;
  /** How the in-flight compaction was triggered; consumed by CompactionBegin. */
  pendingCompactTrigger: "manual" | "auto" | null;
  /** A retry in flight: the old exchange stays visible until TurnBegin replaces it. */
  pendingRetry: PendingRetry | null;

  sendMessage: (text: string) => void;
  setHistoryLoading: (loading: boolean) => void;
  retryLastMessage: () => void;
  processEvent: (event: UIStreamEvent) => void;
  loadSession: (sessionId: string, events: UIStreamEvent[]) => Promise<void>;
  startNewConversation: () => Promise<void>;
  abort: () => void;
  addDraftMedia: (id: string, dataUri?: string) => void;
  updateDraftMedia: (id: string, dataUri: string) => void;
  removeDraftMedia: (id: string) => void;
  clearDraftMedia: () => void;
  getMediaInConversation: () => MediaInConversation;
  hasProcessingMedia: () => boolean;
  respondQuestion: (answers: Record<string, string>) => Promise<void>;

  enqueue: (content: string | ContentPart[], model: string, goalObjective?: string) => void;
  removeFromQueue: (id: string) => void;
  editQueueItem: (id: string, content: string | ContentPart[]) => void;
  moveQueueItemUp: (id: string) => void;
  sendNextQueued: () => void;
}

let handshakeTimer: ReturnType<typeof setTimeout> | null = null;

function clearHandshakeTimer() {
  if (handshakeTimer) {
    clearTimeout(handshakeTimer);
    handshakeTimer = null;
  }
}

// Streamed text arrives as one bridge message per delta. Coalescing deltas
// within a short window turns a burst of messages into a single store update,
// so long conversations don't re-render once per token.
const TEXT_DELTA_WINDOW_MS = 50;

let pendingTextParts: string[] = [];
let textDeltaTimer: ReturnType<typeof setTimeout> | null = null;

/** Extract the text of a pure-text ContentPart delta; null for any other event. */
function textDeltaOf(event: UIStreamEvent): string | null {
  if (event.type !== "ContentPart" || !("payload" in event)) {
    return null;
  }
  const part = event.payload as ContentPart;
  return part.type === "text" && part.text ? part.text : null;
}

function clearTextDeltaTimer() {
  if (textDeltaTimer) {
    clearTimeout(textDeltaTimer);
    textDeltaTimer = null;
  }
}

/**
 * Apply buffered text deltas as one event, preserving arrival order. Must run
 * before processing any control event so it observes everything that arrived
 * before it.
 */
function flushTextDeltas() {
  clearTextDeltaTimer();
  if (pendingTextParts.length === 0) {
    return;
  }
  const text = pendingTextParts.join("");
  pendingTextParts = [];
  useChatStore.setState(
    produce((draft: ChatState) => {
      processEvent(draft, { type: "ContentPart", payload: { type: "text", text } });
    }),
  );
}

function clearAllInlineErrors(draft: ChatState): void {
  for (const msg of draft.messages) {
    if (msg.inlineError) {
      msg.inlineError = undefined;
    }
  }
}

/**
 * Fixed 256K threshold for the opt-in auto-compact: models with a 256K context
 * (e.g. K3-256k) overflow past this and start losing context.
 */
const AUTO_COMPACT_THRESHOLD_TOKENS = 256 * 1024;
/**
 * Context size that triggered the last auto-compact. An equal reading never
 * re-fires, so a compaction that fails to shrink the context can't loop.
 */
let lastAutoCompactTokens = 0;

/**
 * True while a live goal occupies the session (running or paused): a direct
 * prompt then is rejected by the engine with "already being generated", so it
 * must be queued the same as a streaming/stopping/compacting turn.
 */
function isGoalBusy(goal: GoalStateInfo | null): boolean {
  return goal !== null && (goal.status === "active" || goal.status === "paused");
}

/**
 * Opt-in (kimifork.autoCompactContext): when a turn ends with the context
 * above 256K tokens, send /compact as a normal follow-up turn. Skipped while a
 * goal is live (compaction would swallow the goal's next continuation turn)
 * and while the goal composer is armed (sendMessage would consume the arm).
 */
function maybeAutoCompact(get: () => ChatState): void {
  const { extensionConfig } = useSettingsStore.getState();
  if (!extensionConfig.autoCompactContext) return;
  const state = get();
  if (state.isStreaming || state.stopping) return;
  if (state.goal !== null && (state.goal.status === "active" || state.goal.status === "paused")) return;
  if (state.goalArmed) return;
  const tokens = state.lastStatus?.context_tokens;
  if (tokens === undefined || tokens === null || tokens <= AUTO_COMPACT_THRESHOLD_TOKENS) return;
  if (tokens === lastAutoCompactTokens) return;
  lastAutoCompactTokens = tokens;
  useChatStore.setState({ pendingCompactTrigger: "auto" });
  toast.info(t("toast.autoCompactStarted"));
  state.sendMessage("/compact");
}

/**
 * Set on CompactionEnd, consumed at the turn's stream_complete: the engine's
 * context is already replaced by then, so the summary and post-compaction
 * token count can be patched onto the compaction item. The chat history
 * itself is left untouched — inspecting the compacted context happens on
 * demand via the context pill (ContextViewerDialog).
 */
let compactionPatchPending = false;

async function patchCompactionItem(
  get: () => ChatState,
  set: (state: Partial<ChatState> | ((state: ChatState) => ChatState)) => void,
): Promise<void> {
  const sessionId = get().sessionId;
  let snapshot: SessionContextSnapshot | null = null;
  try {
    const result = await bridge.getSessionContext();
    if (result.ok) snapshot = result.snapshot;
  } catch {
    snapshot = null;
  }
  // A session switch while fetching must not patch another session's list.
  if (snapshot === null || get().sessionId !== sessionId) return;
  const summary = snapshot.messages.find((message) => message.kind === "compaction_summary")?.text;
  set(
    produce((draft: ChatState) => {
      for (let i = draft.messages.length - 1; i >= 0; i--) {
        const steps = draft.messages[i].steps;
        if (!steps) continue;
        let patched = false;
        for (let j = steps.length - 1; j >= 0 && !patched; j--) {
          for (let k = steps[j].items.length - 1; k >= 0; k--) {
            const item = steps[j].items[k];
            if (item.type === "compaction" && item.tokenCount === undefined) {
              if (summary !== undefined) item.summary = summary;
              item.tokenCount = snapshot.tokenCount;
              patched = true;
              break;
            }
          }
        }
        if (patched) break;
      }
    }),
  );
}

function doSend(state: ChatState, content: string | ContentPart[], model: string, goalObjective?: string) {
  const { sessionId, planMode } = state;
  const { thinkingEffort, permissionMode } = useSettingsStore.getState();

  // A user-typed /compact is manual; maybeAutoCompact marks its own send as
  // auto beforehand, and an engine-initiated compaction leaves the flag null.
  if (content === "/compact" && useChatStore.getState().pendingCompactTrigger === null) {
    useChatStore.setState({ pendingCompactTrigger: "manual" });
  }

  clearHandshakeTimer();
  handshakeTimer = setTimeout(() => {
    const s = useChatStore.getState();
    if (s.isStreaming && !s.handshakeReceived) {
      void bridge.abortChat().catch(() => undefined);
      s.processEvent({
        type: "error",
        code: "HANDSHAKE_TIMEOUT",
        message: "Connection timed out.",
        phase: "runtime",
      });
    }
  }, HANDSHAKE_TIMEOUT_MS);

  void bridge
    .streamChat(content, model, thinkingEffort, planMode, sessionId ?? undefined, permissionMode, goalObjective)
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      useChatStore.getState().processEvent({
        type: "error",
        code: "internal",
        message: "Unable to send the message.",
        detail,
        phase: "preflight",
      });
    });
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessionId: null,
  messages: [],
  isStreaming: false,
  stopping: false,
  isCompacting: false,
  handshakeReceived: false,
  draftMedia: [],
  lastStatus: null,
  tokenUsage: createEmptyTokenUsage(),
  activeTokenUsage: createEmptyTokenUsage(),
  pendingInput: null,
  queue: [],
  pendingQuestion: null,
  planMode: false,
  swarmMode: false,
  goal: null,
  goalArmed: false,
  historyLoading: false,
  pendingCompactTrigger: null,
  pendingRetry: null,

  sendMessage: (text) => {
    const { draftMedia, isStreaming, stopping, isCompacting, goalArmed, goal } = get();
    const { currentModel } = useSettingsStore.getState();
    const readyMedia = draftMedia.filter((m) => m.dataUri).map((m) => m.dataUri!);
    const content = readyMedia.length > 0 ? Content.build(text, readyMedia) : text;

    if (Content.isEmpty(content)) {
      return;
    }

    // Goal arm is one-shot: this send carries the objective (and the flag
    // clears) only when the message has text for the goal to use.
    const goalObjective = goalArmed && text.trim() ? text.trim() : undefined;
    if (goalObjective !== undefined) {
      set({ goalArmed: false });
    }

    // Enqueue instead of sending whenever the engine is busy or still
    // settling a turn (streaming, stop/compaction, or a live goal): a direct
    // prompt then is rejected with "already being generated" and the message
    // would be lost.
    if (isStreaming || stopping || isCompacting || isGoalBusy(goal)) {
      get().enqueue(content, currentModel, goalObjective);
      set({ draftMedia: [] });
      return;
    }

    // Clear draft and set streaming state
    set(
      produce((draft: ChatState) => {
        clearAllInlineErrors(draft);
        draft.draftMedia = [];
        draft.isStreaming = true;
        draft.stopping = false;
        draft.handshakeReceived = false;
        draft.pendingInput = { content, model: currentModel };
      }),
    );
    useApprovalStore.getState().clearRequests();

    doSend(get(), content, currentModel, goalObjective);
  },

  setHistoryLoading: (historyLoading) => set({ historyLoading }),

  retryLastMessage: () => {
    const { messages, isStreaming } = get();

    if (isStreaming) {
      return;
    }

    // The retried content comes from the transcript, not pendingInput:
    // TurnBegin clears pendingInput as soon as the engine accepts a message,
    // so by the time an inline error exists only the messages are reliable.
    const lastAssistant = messages.at(-1);
    const lastUser = messages.at(-2);
    if (lastAssistant?.role !== "assistant" || !lastAssistant.inlineError || lastUser?.role !== "user") {
      return;
    }

    const content = lastUser.content;
    const { currentModel } = useSettingsStore.getState();

    // Keep the failed exchange on screen while the retry is in flight: the
    // TurnBegin handler swaps the old pair out only once the engine has
    // accepted the resend, so a retry that fails before the turn starts
    // (e.g. quota still exhausted) can no longer make the round vanish.
    set(
      produce((draft: ChatState) => {
        draft.isStreaming = true;
        draft.stopping = false;
        draft.handshakeReceived = false;
        draft.pendingInput = { content, model: currentModel };
        draft.pendingRetry = { content };
      }),
    );
    useApprovalStore.getState().clearRequests();

    doSend(get(), content, currentModel);
  },

  processEvent: (event) => {
    // Pure-text deltas are buffered and applied in a single batch per window;
    // every other event is a control event and flushes the buffer first, so
    // application order matches arrival order.
    const textDelta = textDeltaOf(event);
    if (textDelta !== null) {
      // Ack the handshake on arrival: the engine has responded regardless of
      // when the buffered text gets applied.
      clearHandshakeTimer();
      if (!get().handshakeReceived) {
        set({ handshakeReceived: true });
      }
      pendingTextParts.push(textDelta);
      textDeltaTimer ??= setTimeout(flushTextDeltas, TEXT_DELTA_WINDOW_MS);
      return;
    }

    flushTextDeltas();

    // Mid-turn warnings (terminal === false) leave the turn, the composer, and
    // the queued messages untouched — the engine is still streaming, so they
    // are surfaced as a transient toast only.
    if (event.type === "error" && "terminal" in event && event.terminal === false) {
      clearHandshakeTimer();
      // A direct send that raced a still-busy engine (e.g. this view was
      // re-created mid-turn and had not learned the busy state yet) comes
      // back as a non-terminal rejection. The content still sits in
      // pendingInput with no TurnBegin — re-queue it so the drain after the
      // active turn delivers it instead of losing it.
      const pending = get().pendingInput;
      if (pending !== null && !get().handshakeReceived) {
        set(
          produce((draft: ChatState) => {
            draft.pendingInput = null;
            // Front of the queue: the rejected send predates anything queued
            // after it.
            draft.queue.unshift({ id: crypto.randomUUID(), content: pending.content, model: pending.model });
          }),
        );
        toast.info(t("toast.queuedAfterBusy"));
        return;
      }
      toast.warning(event.message);
      return;
    }
    // Clear handshake timeout on receiving valid response
    if (event.type === "TurnBegin" || event.type === "StepBegin" || event.type === "ContentPart") {
      clearHandshakeTimer();
      if (!get().handshakeReceived) {
        set({ handshakeReceived: true });
      }
    } else if (event.type === "stream_complete" || event.type === "error") {
      clearHandshakeTimer();
    }

    set(
      produce((draft: ChatState) => {
        processEvent(draft, event);
      }),
    );

    if (event.type === "CompactionEnd") {
      compactionPatchPending = true;
    }

    // Auto-send next queued item when streaming ends (complete or error)
    if (event.type === "stream_complete" || event.type === "error") {
      if (event.type === "stream_complete") {
        // Patch before anything else schedules a follow-up turn: the summary
        // and post-compaction token count land on the compaction item.
        if (compactionPatchPending) {
          compactionPatchPending = false;
          void patchCompactionItem(get, set);
        }
        maybeAutoCompact(get);
      }
      const { queue, isStreaming: stillStreaming } = get();
      if (!stillStreaming && queue.length > 0) {
        setTimeout(() => get().sendNextQueued(), 50);
      }
    }
  },

  loadSession: async (sessionId, events) => {
    clearHandshakeTimer();
    compactionPatchPending = false;
    // Switching sessions: apply anything still buffered before the reset.
    flushTextDeltas();

    // Abort any ongoing stream when switching sessions
    const { isStreaming: wasStreaming } = get();
    if (wasStreaming) {
      await bridge.abortChat();
    }

    set({
      sessionId,
      messages: [],
      isStreaming: false,
      stopping: false,
      isCompacting: false,
      handshakeReceived: false,
      draftMedia: [],
      lastStatus: null,
      tokenUsage: createEmptyTokenUsage(),
      activeTokenUsage: createEmptyTokenUsage(),
      pendingInput: null,
      queue: [],
      pendingQuestion: null,
      planMode: false,
      swarmMode: false,
      goal: null,
      goalArmed: false,
      pendingCompactTrigger: null,
      pendingRetry: null,
    });
    useApprovalStore.getState().clearRequests();

    // Replay folds every event in ONE store update: per-event set() calls
    // (each running produce + notifying subscribers) are what made long
    // histories stutter. Text deltas land directly via the inner handler —
    // the buffering path is for live streaming only.
    set(
      produce((draft: ChatState) => {
        for (const event of events) {
          processEvent(draft, event);
        }
        // All steps are finished when loading from history
        for (const msg of draft.messages) {
          if (msg.steps) {
            for (const step of msg.steps) {
              for (const item of step.items) {
                if (item.type === "text" || item.type === "thinking") {
                  item.finished = true;
                }
              }
            }
          }
        }
        draft.isStreaming = false;
        draft.isCompacting = false;
        draft.pendingQuestion = null;
      }),
    );
    useApprovalStore.getState().clearRequests();
  },

  startNewConversation: async () => {
    clearHandshakeTimer();
    compactionPatchPending = false;
    flushTextDeltas();

    // Abort any ongoing stream before starting new conversation
    const { isStreaming: wasStreaming } = get();
    if (wasStreaming) {
      await bridge.abortChat();
    }

    await bridge.resetSession();
    await bridge.clearTrackedFiles();
    // The next session is created fresh with the manual default; keep the
    // composer indicator truthful until its status announcement arrives.
    useSettingsStore.getState().setPermissionMode("manual");
    useSettingsStore.getState().resetThinkingEffortToDefault();
    set({
      sessionId: null,
      messages: [],
      isStreaming: false,
      stopping: false,
      isCompacting: false,
      handshakeReceived: false,
      draftMedia: [],
      lastStatus: null,
      tokenUsage: createEmptyTokenUsage(),
      activeTokenUsage: createEmptyTokenUsage(),
      pendingInput: null,
      queue: [],
      pendingQuestion: null,
      planMode: false,
      swarmMode: false,
      goal: null,
      goalArmed: false,
      pendingCompactTrigger: null,
      pendingRetry: null,
    });
    useApprovalStore.getState().clearRequests();
  },

  abort: () => {
    clearHandshakeTimer();
    // Deltas that arrived before the stop request still belong to the running
    // turn: apply them now so a buffered delta can't land after `stopping` is
    // set and flip the turn back to streaming.
    flushTextDeltas();
    if (!get().isStreaming) {
      return;
    }

    // Optimistic unlock: waiting for the engine's turn terminal left the UI
    // dead when the runtime was unbound or a tool never answered the cancel.
    // `stopping` marks the in-between state until a terminal event (or a
    // late delta, which flips the turn back to streaming) resolves it.
    set({ isStreaming: false, stopping: true, pendingQuestion: null });
    useApprovalStore.getState().clearRequests();

    void bridge
      .abortChat()
      .then(({ aborted }) => {
        if (!aborted) {
          // No runtime is bound on the extension side, so no terminal event
          // will ever arrive — force the local terminal state and flush
          // anything the user queued during the stop window.
          set({ stopping: false, isStreaming: false });
          toast.info(t("toast.noRunningTask"));
          if (get().queue.length > 0) {
            setTimeout(() => get().sendNextQueued(), 50);
          }
        }
      })
      .catch(() => {
        set({ stopping: false, isStreaming: false });
      });
  },

  addDraftMedia: (id, dataUri) => {
    set((s) => ({ draftMedia: [...s.draftMedia, { id, dataUri }] }));
  },

  updateDraftMedia: (id, dataUri) => {
    set((s) => ({
      draftMedia: s.draftMedia.map((m) => (m.id === id ? { ...m, dataUri } : m)),
    }));
  },

  removeDraftMedia: (id) => {
    set((s) => ({ draftMedia: s.draftMedia.filter((m) => m.id !== id) }));
  },

  clearDraftMedia: () => {
    set({ draftMedia: [] });
  },

  getMediaInConversation: () => {
    const { messages, draftMedia } = get();

    let hasImage = false;
    let hasVideo = false;

    for (const item of draftMedia) {
      if (!item.dataUri) {
        continue;
      }
      if (item.dataUri.startsWith("data:image/")) {
        hasImage = true;
      } else if (item.dataUri.startsWith("data:video/")) {
        hasVideo = true;
      }
    }

    for (const msg of messages) {
      if (Content.hasImages(msg.content)) {
        hasImage = true;
      }
      if (Content.hasVideos(msg.content)) {
        hasVideo = true;
      }
      if (hasImage && hasVideo) {
        break;
      }
    }

    return { hasImage, hasVideo };
  },

  hasProcessingMedia: () => {
    return get().draftMedia.some((m) => !m.dataUri);
  },

  respondQuestion: async (answers) => {
    const { pendingQuestion } = get();
    if (!pendingQuestion) return;
    await bridge.respondQuestion(pendingQuestion.id, pendingQuestion.id, answers);
    set({ pendingQuestion: null });
  },

  enqueue: (content, model, goalObjective) => {
    set((s) => ({
      queue: [...s.queue, { id: crypto.randomUUID(), content, model, goalObjective }],
    }));
  },

  removeFromQueue: (id) => {
    set((s) => ({ queue: s.queue.filter((q) => q.id !== id) }));
  },

  editQueueItem: (id, content) => {
    set((s) => ({
      queue: s.queue.map((q) => (q.id === id ? { ...q, content } : q)),
    }));
  },

  moveQueueItemUp: (id) => {
    set((s) => {
      const idx = s.queue.findIndex((q) => q.id === id);
      if (idx <= 0) {
        return s;
      }
      const next = [...s.queue];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return { queue: next };
    });
  },

  sendNextQueued: () => {
    const { queue, isStreaming, goal } = get();
    if (isStreaming || isGoalBusy(goal) || queue.length === 0) {
      return;
    }

    const [next, ...rest] = queue;

    set(
      produce((draft: ChatState) => {
        clearAllInlineErrors(draft);
        draft.queue = rest;
        draft.isStreaming = true;
        draft.stopping = false;
        draft.handshakeReceived = false;
        draft.pendingInput = { content: next.content, model: next.model };
        draft.draftMedia = [];
      }),
    );
    useApprovalStore.getState().clearRequests();

    doSend(get(), next.content, next.model, next.goalObjective);
  },
}));

// A live goal can settle (active/paused → complete/null) via a StatusUpdate
// without a stream_complete, so a message queued during its run would otherwise
// sit until the next turn. Drain it as soon as the goal releases the session.
useChatStore.subscribe((state, prevState) => {
  if (isGoalBusy(prevState.goal) && !isGoalBusy(state.goal) && !state.isStreaming && state.queue.length > 0) {
    setTimeout(() => useChatStore.getState().sendNextQueued(), 0);
  }
});
