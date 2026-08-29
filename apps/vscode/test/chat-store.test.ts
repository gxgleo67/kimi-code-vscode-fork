/**
 * Scenario: the Webview chat store coordinates sent-message rollback and stop-button state with engine events.
 * Responsibilities: pendingInput survives only pre-engine failures; abort unlocks optimistically and resyncs with late engine traffic.
 * Wiring: the real Zustand chat store; only the bridge and toast boundaries are replaced.
 * Run: pnpm exec vitest run --config apps/vscode/vitest.config.ts test/chat-store.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  streamChat: vi.fn(),
  steerChat: vi.fn(),
  abortChat: vi.fn(),
  trackFiles: vi.fn(),
  getAllKimiSessions: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("@/services", () => ({
  bridge: {
    streamChat: boundary.streamChat,
    steerChat: boundary.steerChat,
    abortChat: boundary.abortChat,
    trackFiles: boundary.trackFiles,
    getAllKimiSessions: boundary.getAllKimiSessions,
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
  boundary.steerChat.mockReset();
  boundary.steerChat.mockResolvedValue({ ok: true });
  boundary.abortChat.mockReset();
  boundary.abortChat.mockResolvedValue({ aborted: true });
  boundary.trackFiles.mockReset();
  boundary.getAllKimiSessions.mockReset();
  boundary.getAllKimiSessions.mockResolvedValue([]);
  boundary.toastInfo.mockReset();
  boundary.toastError.mockReset();
  boundary.toastWarning.mockReset();
  useSettingsStore.getState().initModels(MODELS, "plain", false);
  useChatStore.setState({
    sessionId: null,
    sessionTitle: null,
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

  it("treats a late StreamChat rejection after the handshake as a runtime error, keeping the exchange", async () => {
    boundary.streamChat.mockRejectedValueOnce(new Error("Bridge StreamChat timed out"));
    useChatStore.getState().sendMessage("do the thing");
    beginTurn();

    // Flush the rejection handler microtask.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const state = useChatStore.getState();
    expect(state.isStreaming).toBe(false);
    expect(state.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(state.pendingInput).toBeNull();
    expect(state.messages[1]?.inlineError).toMatchObject({ code: "internal" });
  });

  it("ignores a StreamChat rejection that arrives after the turn already settled", async () => {
    let rejectStream: (error: Error) => void = () => undefined;
    boundary.streamChat.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectStream = reject;
        }),
    );
    useChatStore.getState().sendMessage("do the thing");
    beginTurn();
    useChatStore.getState().processEvent({ type: "stream_complete", result: { status: "finished" } });

    rejectStream(new Error("Bridge StreamChat timed out"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const state = useChatStore.getState();
    expect(state.isStreaming).toBe(false);
    expect(state.pendingInput).toBeNull();
    expect(state.messages[1]?.inlineError).toBeUndefined();
  });

  it("still rolls the input back when StreamChat rejects before the engine acknowledges", async () => {
    boundary.streamChat.mockRejectedValueOnce(new Error("connection lost"));
    useChatStore.getState().sendMessage("do the thing");

    await new Promise((resolve) => setTimeout(resolve, 0));

    const state = useChatStore.getState();
    expect(state.isStreaming).toBe(false);
    // No TurnBegin ever arrived: pendingInput (set at send) survives so the
    // composer restore effect can pick the text up.
    expect(state.pendingInput).toEqual({ content: "do the thing", model: "plain" });
    expect(state.messages).toHaveLength(0);
  });

  it("keeps the exchange when a preflight-coded error event arrives mid-turn", () => {
    useChatStore.getState().sendMessage("do the thing");
    beginTurn();

    useChatStore.getState().processEvent({
      type: "error",
      code: "session.state_invalid",
      message: "Session data is invalid.",
      phase: "preflight",
    });

    const state = useChatStore.getState();
    expect(state.isStreaming).toBe(false);
    expect(state.pendingInput).toBeNull();
    expect(state.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(state.messages[1]?.inlineError).toMatchObject({ code: "session.state_invalid" });
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
      // A completed session's replay closes its last turn…
      { type: "stream_complete", payload: { result: { status: "finished" } } },
      // …and history loads always end with the host's busy announcement.
      { type: "StatusUpdate", payload: { turn_active: false } },
    ]);

    // No terminal event in the replay: the post-replay flush must still apply
    // the buffered delta so the final pass can mark it finished.
    const last = useChatStore.getState().messages.at(-1);
    expect(last?.content).toBe("partial answer");
    expect(last?.steps?.at(-1)?.items).toEqual([{ type: "text", content: "partial answer", finished: true }]);
    expect(useChatStore.getState().isStreaming).toBe(false);
  });

  it("resolves the header title from the session brief when loading a session", async () => {
    boundary.getAllKimiSessions.mockResolvedValue([{ id: "session-1", brief: "Fix the login flow" }]);

    await useChatStore.getState().loadSession("session-1", [
      { type: "StatusUpdate", payload: { turn_active: false } },
    ]);

    // The brief lookup is async: wait for it to land.
    await vi.waitFor(() => {
      expect(useChatStore.getState().sessionTitle).toBe("Fix the login flow");
    });

    // Loading a session with no brief resets the title synchronously.
    boundary.getAllKimiSessions.mockResolvedValue([]);
    await useChatStore.getState().loadSession("session-2", [
      { type: "StatusUpdate", payload: { turn_active: false } },
    ]);
    expect(useChatStore.getState().sessionTitle).toBeNull();
  });

  it("keeps streaming when re-attaching to a session whose turn is still running", async () => {
    // The replay closes the still-open turn with stream_complete (history
    // display convention); the appended busy announcement must win, or the
    // re-attached composer unlocks while the engine keeps running.
    await useChatStore.getState().loadSession("session-1", [
      { type: "TurnBegin", payload: { user_input: "question" } },
      { type: "StepBegin", payload: { n: 1 } },
      { type: "ContentPart", payload: { type: "text", text: "partial answer" } },
      { type: "stream_complete", payload: { result: { status: "finished" } } },
      { type: "StatusUpdate", payload: { turn_active: true } },
    ]);

    expect(useChatStore.getState().isStreaming).toBe(true);
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

  it("discards the failed attempt's partial text when a step retries", () => {
    useChatStore.getState().sendMessage("do the thing");
    beginTurn();
    useChatStore.getState().processEvent({ type: "ContentPart", payload: { type: "text", text: "partial ans" } });

    // Provider fails retryably mid-stream; the engine will re-run the step and
    // re-stream its text from scratch under a new step number.
    useChatStore.getState().processEvent({
      type: "StatusUpdate",
      payload: { retrying: { next_attempt: 2, max_attempts: 5, delay_ms: 1000, message: "overloaded" } },
    });

    const duringRetry = useChatStore.getState().messages.at(-1);
    expect(duringRetry?.content).toBe("");
    expect(duringRetry?.steps).toHaveLength(0);
    expect(useChatStore.getState().lastStatus?.retrying).toMatchObject({ next_attempt: 2 });

    // The retried step re-streams the same text: no duplication.
    useChatStore.getState().processEvent({ type: "StepBegin", payload: { n: 2 } });
    useChatStore.getState().processEvent({ type: "ContentPart", payload: { type: "text", text: "partial ans" } });
    useChatStore.getState().processEvent({ type: "ContentPart", payload: { type: "text", text: "wer" } });
    useChatStore.getState().processEvent({ type: "stream_complete", result: { status: "finished" } });

    const last = useChatStore.getState().messages.at(-1);
    expect(last?.content).toBe("partial answer");
    expect(last?.steps).toHaveLength(1);
    expect(last?.steps?.at(-1)?.items).toEqual([{ type: "text", content: "partial answer", finished: true }]);
  });

  it("keeps the last step when a retry arrives after executed work", () => {
    useChatStore.getState().sendMessage("do the thing");
    beginTurn();
    useChatStore.getState().processEvent({ type: "ToolCall", payload: { id: "call-1", function: { name: "Read", arguments: "{}" } } });
    useChatStore.getState().processEvent({
      type: "ToolResult",
      payload: { tool_call_id: "call-1", return_value: { is_error: false, output: "ok", message: "" } },
    });

    useChatStore.getState().processEvent({
      type: "StatusUpdate",
      payload: { retrying: { next_attempt: 2, max_attempts: 5, delay_ms: 1000, message: "overloaded" } },
    });

    const items = useChatStore.getState().messages.at(-1)?.steps?.at(-1)?.items ?? [];
    expect(items.map((item) => item.type)).toEqual(["tool_use"]);
  });

  it("discards a retried subagent step's partial text", () => {
    useChatStore.getState().sendMessage("do the thing");
    beginTurn();
    useChatStore.getState().processEvent({ type: "ToolCall", payload: { id: "call-1", function: { name: "Agent", arguments: "{}" } } });
    useChatStore.getState().processEvent({
      type: "SubagentEvent",
      payload: { parent_tool_call_id: "call-1", event: { type: "StepBegin", payload: { n: 1 } } },
    });
    useChatStore.getState().processEvent({
      type: "SubagentEvent",
      payload: { parent_tool_call_id: "call-1", event: { type: "ContentPart", payload: { type: "text", text: "sub partial" } } },
    });

    useChatStore.getState().processEvent({
      type: "SubagentEvent",
      payload: { parent_tool_call_id: "call-1", event: { type: "StatusUpdate", payload: { retrying: { next_attempt: 2, max_attempts: 5, delay_ms: 1000, message: "overloaded" } } } },
    });

    const subagentSteps = useChatStore.getState().messages.at(-1)?.steps?.at(-1)?.items.at(-1);
    expect(subagentSteps?.type).toBe("tool_use");
    // The failed attempt's step is dropped; only the SubagentEvent handler's
    // pre-created empty step remains.
    expect(subagentSteps?.type === "tool_use" ? subagentSteps.subagent_steps : undefined).toEqual([
      { n: 1, items: [] },
    ]);
  });
});

describe("Webview steerNow (Alt+Enter immediate send)", () => {
  it("steers into a busy turn without touching the queue", () => {
    useChatStore.getState().sendMessage("first");
    beginTurn();

    useChatStore.getState().steerNow("jump in");

    expect(boundary.steerChat).toHaveBeenCalledWith("jump in");
    expect(boundary.streamChat).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().queue).toHaveLength(0);
  });

  it("takes the plain send path when the session is idle", () => {
    useChatStore.getState().steerNow("hello");

    expect(boundary.steerChat).not.toHaveBeenCalled();
    expect(boundary.streamChat).toHaveBeenCalledOnce();
    expect(useChatStore.getState().pendingInput).toEqual({ content: "hello", model: "plain" });
  });

  it("falls back to the normal path when the turn ended before the roundtrip", async () => {
    boundary.steerChat.mockResolvedValue({ ok: false });
    useChatStore.getState().sendMessage("first");
    beginTurn();

    useChatStore.getState().steerNow("jump in");

    // ok=false → sendMessage → still streaming → queued for the next drain.
    await vi.waitFor(() => {
      expect(useChatStore.getState().queue).toHaveLength(1);
    });
    expect(useChatStore.getState().queue[0]?.content).toBe("jump in");
  });
});
