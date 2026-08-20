/**
 * Scenario: the Webview chat store coordinates sent-message rollback and stop-button state with engine events.
 * Responsibilities: pendingInput survives only pre-engine failures; abort unlocks optimistically and resyncs with late engine traffic.
 * Wiring: the real Zustand chat store; only the bridge and toast boundaries are replaced.
 * Run: pnpm exec vitest run --config apps/vscode/vitest.config.ts test/chat-store.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  streamChat: vi.fn(),
  abortChat: vi.fn(),
  trackFiles: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("@/services", () => ({
  bridge: {
    streamChat: boundary.streamChat,
    abortChat: boundary.abortChat,
    trackFiles: boundary.trackFiles,
  },
}));
vi.mock("@/components/ui/sonner", () => ({
  toast: { info: boundary.toastInfo, error: boundary.toastError, warning: boundary.toastWarning },
}));

import { useSettingsStore } from "../webview-ui/src/stores/settings.store";
import { useChatStore } from "../webview-ui/src/stores/chat.store";

const MODELS = [{ id: "plain", name: "Plain", provider: "managed:kimi-code", capabilities: [] }];

beforeEach(() => {
  boundary.streamChat.mockReset();
  boundary.streamChat.mockResolvedValue({ done: false });
  boundary.abortChat.mockReset();
  boundary.abortChat.mockResolvedValue({ aborted: true });
  boundary.trackFiles.mockReset();
  boundary.toastInfo.mockReset();
  boundary.toastError.mockReset();
  boundary.toastWarning.mockReset();
  useSettingsStore.getState().initModels(MODELS, "plain", false);
  useChatStore.setState({
    sessionId: null,
    messages: [],
    isStreaming: false,
    stopping: false,
    isCompacting: false,
    handshakeReceived: false,
    draftMedia: [],
    lastStatus: null,
    tokenUsage: { input_other: 0, output: 0, input_cache_read: 0, input_cache_creation: 0 },
    activeTokenUsage: { input_other: 0, output: 0, input_cache_read: 0, input_cache_creation: 0 },
    pendingInput: null,
    pendingRetry: null,
    queue: [],
    pendingQuestion: null,
    planMode: false,
  });
});

function beginTurn(input = "do the thing") {
  useChatStore.getState().processEvent({ type: "TurnBegin", payload: { user_input: input } });
  useChatStore.getState().processEvent({ type: "StepBegin", payload: { n: 1 } });
}

describe("Webview sent-message rollback", () => {
  it("clears pendingInput once the engine accepts the message", () => {
    useChatStore.getState().sendMessage("do the thing");
    expect(useChatStore.getState().pendingInput).toEqual({ content: "do the thing", model: "plain" });

    useChatStore.getState().processEvent({ type: "TurnBegin", payload: { user_input: "do the thing" } });

    expect(useChatStore.getState().pendingInput).toBeNull();
  });

  it("never rolls sent content back after a mid-turn runtime error", () => {
    useChatStore.getState().sendMessage("do the thing");
    beginTurn();

    useChatStore.getState().processEvent({
      type: "error",
      code: "provider.api_error",
      message: "Service temporarily unavailable.",
      phase: "runtime",
    });

    const state = useChatStore.getState();
    expect(state.isStreaming).toBe(false);
    expect(state.pendingInput).toBeNull();
  });

  it("keeps pendingInput for restore when the message never reaches the engine", () => {
    useChatStore.getState().sendMessage("do the thing");

    useChatStore.getState().processEvent({
      type: "error",
      code: "session.state_invalid",
      message: "Session data is invalid.",
      phase: "preflight",
    });

    expect(useChatStore.getState()).toMatchObject({
      isStreaming: false,
      pendingInput: { content: "do the thing", model: "plain" },
    });
  });

  it("does not roll input back when a turn begins after the handshake watchdog fired", () => {
    vi.useFakeTimers();
    try {
      useChatStore.getState().sendMessage("do the thing");
      vi.advanceTimersByTime(30_000);

      // Watchdog aborted and surfaced a local runtime error, unlocking the UI.
      expect(boundary.abortChat).toHaveBeenCalledTimes(1);
      expect(useChatStore.getState().isStreaming).toBe(false);

      // The engine actually started the turn anyway: the sent content must
      // not come back to the composer while the conversation runs.
      useChatStore.getState().processEvent({ type: "TurnBegin", payload: { user_input: "do the thing" } });

      expect(useChatStore.getState()).toMatchObject({ isStreaming: true, pendingInput: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it("resends the failed message on retry after pendingInput was cleared", () => {
    useChatStore.getState().sendMessage("do the thing");
    beginTurn();
    useChatStore.getState().processEvent({
      type: "error",
      code: "provider.api_error",
      message: "Service temporarily unavailable.",
      phase: "runtime",
    });
    expect(useChatStore.getState().pendingInput).toBeNull();

    useChatStore.getState().retryLastMessage();

    expect(boundary.streamChat).toHaveBeenCalledTimes(2);
    expect(boundary.streamChat).toHaveBeenLastCalledWith("do the thing", "plain", "off", false, undefined, "manual", undefined);
    const state = useChatStore.getState();
    expect(state.isStreaming).toBe(true);
    // The failed exchange stays visible until the engine accepts the resend.
    expect(state.messages).toHaveLength(2);
    expect(state.pendingRetry).toEqual({ content: "do the thing" });

    // TurnBegin for the retry swaps the stale pair (with its inline error) out.
    useChatStore.getState().processEvent({ type: "TurnBegin", payload: { user_input: "do the thing" } });
    const swapped = useChatStore.getState();
    expect(swapped.pendingRetry).toBeNull();
    expect(swapped.messages).toHaveLength(2);
    expect(swapped.messages[0]).toMatchObject({ role: "user", content: "do the thing" });
    expect(swapped.messages[1]).toMatchObject({ role: "assistant", content: "" });
    expect(swapped.messages[1]?.inlineError).toBeUndefined();
  });

  it("keeps the failed exchange visible when the retry fails before the turn starts", () => {
    useChatStore.getState().sendMessage("do the thing");
    beginTurn();
    useChatStore.getState().processEvent({
      type: "error",
      code: "provider.api_error",
      message: "Service temporarily unavailable.",
      phase: "runtime",
    });

    useChatStore.getState().retryLastMessage();
    // The resend is rejected before the engine starts a turn (e.g. quota is
    // still exhausted): the retried round must not disappear from the chat.
    useChatStore.getState().processEvent({
      type: "error",
      code: "provider.api_error",
      message: "Service temporarily unavailable.",
      phase: "preflight",
    });

    const state = useChatStore.getState();
    expect(state.isStreaming).toBe(false);
    expect(state.pendingRetry).toBeNull();
    expect(state.pendingInput).toBeNull();
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({ role: "user", content: "do the thing" });
    expect(state.messages[1]?.inlineError).toMatchObject({ code: "provider.api_error" });
  });
});

describe("Webview stop button state", () => {
  it("unlocks the composer optimistically and clears stopping on stream_complete", () => {
    useChatStore.getState().sendMessage("do the thing");
    beginTurn();

    useChatStore.getState().abort();

    expect(boundary.abortChat).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState()).toMatchObject({ isStreaming: false, stopping: true });

    useChatStore.getState().processEvent({ type: "stream_complete", result: { status: "cancelled" } });

    expect(useChatStore.getState()).toMatchObject({ isStreaming: false, stopping: false });
  });

  it("ignores abort when nothing is streaming", () => {
    useChatStore.getState().abort();

    expect(boundary.abortChat).not.toHaveBeenCalled();
    expect(useChatStore.getState()).toMatchObject({ isStreaming: false, stopping: false });
  });

  it("forces the terminal state when the extension has no runtime to abort", async () => {
    boundary.abortChat.mockResolvedValue({ aborted: false });
    useChatStore.getState().sendMessage("do the thing");
    beginTurn();

    useChatStore.getState().abort();

    await vi.waitFor(() => {
      expect(useChatStore.getState()).toMatchObject({ isStreaming: false, stopping: false });
    });
    expect(boundary.toastInfo).toHaveBeenCalledWith("No running task to stop.");
  });

  it("resumes streaming when the engine keeps sending deltas after an abort", () => {
    vi.useFakeTimers();
    try {
      useChatStore.getState().sendMessage("do the thing");
      beginTurn();
      useChatStore.getState().abort();
      expect(useChatStore.getState().stopping).toBe(true);

      useChatStore.getState().processEvent({ type: "ContentPart", payload: { type: "text", text: "still working" } });
      // Text deltas are batched: the flip back to streaming happens when the
      // batch flushes, at most one window after the delta arrived.
      vi.advanceTimersByTime(50);

      const state = useChatStore.getState();
      expect(state.isStreaming).toBe(true);
      expect(state.stopping).toBe(false);
      expect(state.messages.at(-1)?.content).toBe("still working");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears stopping when a new turn begins after an abort", () => {
    useChatStore.getState().sendMessage("do the thing");
    beginTurn();
    useChatStore.getState().abort();

    useChatStore.getState().processEvent({ type: "TurnBegin", payload: { user_input: "next question" } });

    expect(useChatStore.getState()).toMatchObject({ isStreaming: true, stopping: false, pendingInput: null });
  });
});

describe("Webview streaming text batching", () => {
  it("coalesces text deltas within one window into a single store update", () => {
    vi.useFakeTimers();
    try {
      useChatStore.getState().sendMessage("do the thing");
      beginTurn();

      const listener = vi.fn();
      const unsubscribe = useChatStore.subscribe(listener);

      useChatStore.getState().processEvent({ type: "ContentPart", payload: { type: "text", text: "Hello" } });
      useChatStore.getState().processEvent({ type: "ContentPart", payload: { type: "text", text: ", " } });
      useChatStore.getState().processEvent({ type: "ContentPart", payload: { type: "text", text: "world" } });
      // Buffered: nothing was applied yet, not even a no-op state update.
      expect(listener).not.toHaveBeenCalled();

      vi.advanceTimersByTime(50);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(useChatStore.getState().messages.at(-1)?.content).toBe("Hello, world");
      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushes buffered text before the next control event", () => {
    useChatStore.getState().sendMessage("do the thing");
    beginTurn();

    useChatStore.getState().processEvent({ type: "ContentPart", payload: { type: "text", text: "partial" } });
    useChatStore.getState().processEvent({ type: "ToolCall", payload: { id: "call-1", function: { name: "Read", arguments: "{}" } } });

    const last = useChatStore.getState().messages.at(-1);
    // The text landed synchronously, ahead of the tool call it preceded on the wire.
    expect(last?.content).toBe("partial");
    expect(last?.steps?.at(-1)?.items.map((item) => item.type)).toEqual(["text", "tool_use"]);
  });

  it("applies thinking deltas immediately without waiting for the window", () => {
    useChatStore.getState().sendMessage("do the thing");
    beginTurn();

    useChatStore.getState().processEvent({ type: "ContentPart", payload: { type: "think", think: "hmm" } });

    const items = useChatStore.getState().messages.at(-1)?.steps?.at(-1)?.items ?? [];
    expect(items).toEqual([{ type: "thinking", content: "hmm" }]);
  });

  it("flushes replayed text when loading a session, before items are marked finished", async () => {
    await useChatStore.getState().loadSession("session-1", [
      { type: "TurnBegin", payload: { user_input: "question" } },
      { type: "StepBegin", payload: { n: 1 } },
      { type: "ContentPart", payload: { type: "text", text: "partial answer" } },
    ]);

    // No terminal event in the replay: the post-replay flush must still apply
    // the buffered delta so the final pass can mark it finished.
    const last = useChatStore.getState().messages.at(-1);
    expect(last?.content).toBe("partial answer");
    expect(last?.steps?.at(-1)?.items).toEqual([{ type: "text", content: "partial answer", finished: true }]);
    expect(useChatStore.getState().isStreaming).toBe(false);
  });

  it("applies deltas buffered before abort without flipping the turn back to streaming", () => {
    vi.useFakeTimers();
    try {
      useChatStore.getState().sendMessage("do the thing");
      beginTurn();
      useChatStore.getState().processEvent({ type: "ContentPart", payload: { type: "text", text: "chunk" } });

      useChatStore.getState().abort();

      // The pre-abort delta belongs to the running turn: applied immediately,
      // before the stopping state was entered.
      const state = useChatStore.getState();
      expect(state).toMatchObject({ isStreaming: false, stopping: true });
      expect(state.messages.at(-1)?.content).toBe("chunk");

      // Nothing remains buffered, so the window elapsing must not revive streaming.
      vi.advanceTimersByTime(100);
      expect(useChatStore.getState()).toMatchObject({ isStreaming: false, stopping: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
