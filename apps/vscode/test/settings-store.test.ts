/**
 * Scenario: Webview state crosses the VS Code bridge during settings changes, MCP edits, and chat failures.
 * Responsibilities: model metadata and selections remain provider-aware; MCP edits stay lossless; chat errors recover visibly.
 * Wiring: the real Zustand store and MCP bridge; settings saves, toast, and the VS Code messaging API are the only replaced boundaries.
 * Run: pnpm exec vitest run --config apps/vscode/vitest.config.ts test/settings-store.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MCP_SECRET_MASK } from "../shared/legacy-sdk";

const boundary = vi.hoisted(() => ({
  saveConfig: vi.fn(),
  streamChat: vi.fn(),
  abortChat: vi.fn(),
  trackFiles: vi.fn(),
  setPermissionMode: vi.fn(),
  resetSession: vi.fn(),
  clearTrackedFiles: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/services", () => ({
  bridge: {
    saveConfig: boundary.saveConfig,
    streamChat: boundary.streamChat,
    abortChat: boundary.abortChat,
    trackFiles: boundary.trackFiles,
    setPermissionMode: boundary.setPermissionMode,
    resetSession: boundary.resetSession,
    clearTrackedFiles: boundary.clearTrackedFiles,
  },
}));
vi.mock("@/components/ui/sonner", () => ({
  toast: { error: boundary.toastError, warning: boundary.toastWarning, info: boundary.toastInfo, success: boundary.toastSuccess },
}));

import {
  DEFAULT_EXTENSION_CONFIG,
  getMediaFallbackModel,
  getModelThinkingMode,
  groupModelsByProvider,
  requiresManagedProviderLogin,
  useSettingsStore,
} from "../webview-ui/src/stores/settings.store";
import { useChatStore } from "../webview-ui/src/stores/chat.store";

const MODELS = [
  { id: "plain", name: "Plain", provider: "managed:kimi-code", capabilities: [] },
  {
    id: "reasoning",
    name: "Reasoning",
    provider: "managed:kimi-code",
    capabilities: ["thinking"],
    support_efforts: ["low", "high"],
    default_effort: "high",
  },
  { id: "always", name: "Always", provider: "managed:kimi-code", capabilities: ["always_thinking"] },
];

beforeEach(() => {
  boundary.saveConfig.mockReset();
  boundary.streamChat.mockReset();
  boundary.streamChat.mockResolvedValue({ done: false });
  boundary.abortChat.mockReset();
  boundary.abortChat.mockResolvedValue({ aborted: true });
  boundary.trackFiles.mockReset();
  boundary.setPermissionMode.mockReset();
  boundary.setPermissionMode.mockResolvedValue({ ok: true });
  boundary.resetSession.mockReset();
  boundary.resetSession.mockResolvedValue({ ok: true });
  boundary.clearTrackedFiles.mockReset();
  boundary.clearTrackedFiles.mockResolvedValue({ ok: true });
  boundary.toastError.mockReset();
  boundary.toastWarning.mockReset();
  boundary.toastInfo.mockReset();
  boundary.toastSuccess.mockReset();
  useSettingsStore.getState().initModels(MODELS, "plain", false);
  useSettingsStore.setState({ permissionMode: "manual", extensionConfig: DEFAULT_EXTENSION_CONFIG });
  useChatStore.setState({
    sessionId: null,
    messages: [],
    isStreaming: false,
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Webview model settings persistence", () => {
  it("persists the selected alias when display names collide across providers", () => {
    boundary.saveConfig.mockResolvedValue({ ok: true });
    useSettingsStore.getState().initModels([
      { id: "openai/shared", name: "Shared", provider: "openai", capabilities: [] },
      { id: "proxy/shared", name: "Shared", provider: "company-proxy", capabilities: [] },
    ], "openai/shared", false);

    useSettingsStore.getState().updateModel("proxy/shared");

    expect(boundary.saveConfig).toHaveBeenCalledWith({
      model: "proxy/shared",
      thinking: false,
      effort: "off",
      effortChanged: false,
    });
  });

  it("rolls back the optimistic model selection when saving fails", async () => {
    let rejectSave!: (error: Error) => void;
    boundary.saveConfig.mockReturnValue(new Promise((_resolve, reject) => {
      rejectSave = reject;
    }));

    useSettingsStore.getState().updateModel("reasoning");
    expect(useSettingsStore.getState()).toMatchObject({
      currentModel: "reasoning",
      // The VSCode default-effort setting ("high") wins for the effort-capable model.
      thinkingEffort: "high",
    });

    rejectSave(new Error("config.toml is read-only"));
    await vi.waitFor(() => {
      expect(useSettingsStore.getState()).toMatchObject({
        currentModel: "plain",
        thinkingEffort: "off",
      });
    });
    expect(boundary.toastError).toHaveBeenCalledWith(
      "Failed to save model settings: config.toml is read-only",
    );
  });

  it("does not let an older failed save overwrite a newer selection", async () => {
    let rejectFirst!: (error: Error) => void;
    boundary.saveConfig
      .mockReturnValueOnce(new Promise((_resolve, reject) => {
        rejectFirst = reject;
      }))
      .mockResolvedValueOnce({ ok: true });

    useSettingsStore.getState().updateModel("reasoning");
    useSettingsStore.getState().updateModel("always");
    rejectFirst(new Error("older request failed"));
    await Promise.resolve();

    expect(useSettingsStore.getState().currentModel).toBe("always");
    expect(boundary.toastError).not.toHaveBeenCalled();
  });
});

describe("Webview secondary model settings", () => {
  it("persists a subagent model selection without touching the stored main effort", () => {
    boundary.saveConfig.mockResolvedValue({ ok: true });

    useSettingsStore.getState().updateSecondaryModel({ model: "reasoning" });

    expect(useSettingsStore.getState().secondaryModel).toEqual({ model: "reasoning" });
    expect(boundary.saveConfig).toHaveBeenCalledWith({
      model: "plain",
      thinking: false,
      effort: "off",
      effortChanged: false,
      secondaryModel: { model: "reasoning" },
    });
  });

  it("persists null for 'follow main model'", () => {
    boundary.saveConfig.mockResolvedValue({ ok: true });
    useSettingsStore.getState().initModels(MODELS, "plain", false, undefined, { model: "reasoning" });

    useSettingsStore.getState().updateSecondaryModel(null);

    expect(useSettingsStore.getState().secondaryModel).toBeNull();
    expect(boundary.saveConfig).toHaveBeenCalledWith({
      model: "plain",
      thinking: false,
      effort: "off",
      effortChanged: false,
      secondaryModel: null,
    });
  });

  it("skips the write when the selection is unchanged", () => {
    boundary.saveConfig.mockResolvedValue({ ok: true });
    useSettingsStore.getState().updateSecondaryModel({ model: "reasoning" });
    useSettingsStore.getState().updateSecondaryModel({ model: "reasoning" });

    expect(boundary.saveConfig).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown model without writing", () => {
    useSettingsStore.getState().updateSecondaryModel({ model: "missing" });

    expect(useSettingsStore.getState().secondaryModel).toBeNull();
    expect(boundary.saveConfig).not.toHaveBeenCalled();
  });

  it("rolls back the optimistic selection when saving fails", async () => {
    let rejectSave!: (error: Error) => void;
    boundary.saveConfig.mockReturnValue(new Promise((_resolve, reject) => {
      rejectSave = reject;
    }));

    useSettingsStore.getState().updateSecondaryModel({ model: "reasoning" });
    expect(useSettingsStore.getState().secondaryModel).toEqual({ model: "reasoning" });

    rejectSave(new Error("config.toml is read-only"));
    await vi.waitFor(() => {
      expect(useSettingsStore.getState().secondaryModel).toBeNull();
    });
  });
});

describe("Webview permission mode selection", () => {
  it("applies the selection optimistically without any toast", async () => {
    useSettingsStore.getState().selectPermissionMode("auto");

    expect(useSettingsStore.getState().permissionMode).toBe("auto");
    expect(boundary.setPermissionMode).toHaveBeenCalledWith("auto");
    // The composer button reflects the change — no success toast by design.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(boundary.toastSuccess).not.toHaveBeenCalled();
  });

  it("skips the bridge call when re-confirming the current mode", () => {
    useSettingsStore.getState().selectPermissionMode("manual");

    expect(boundary.setPermissionMode).not.toHaveBeenCalled();
  });

  it("keeps the selection pending when the host has no live session", async () => {
    boundary.setPermissionMode.mockResolvedValue({ ok: false });

    useSettingsStore.getState().selectPermissionMode("yolo");
    expect(useSettingsStore.getState().permissionMode).toBe("yolo");

    // No toast here either: the selection stays and is carried by the next
    // streamChat call, the composer button shows it right away.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(boundary.toastSuccess).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().permissionMode).toBe("yolo");
  });

  it("rolls the selection back when the bridge call fails", async () => {
    boundary.setPermissionMode.mockRejectedValue(new Error("state is read-only"));

    useSettingsStore.getState().selectPermissionMode("yolo");

    await vi.waitFor(() => {
      expect(useSettingsStore.getState().permissionMode).toBe("manual");
    });
    expect(boundary.toastError).toHaveBeenCalledWith(
      "Failed to change permission mode: state is read-only",
    );
  });

  it("restores the session's permission mode and thinking effort from the announced status", () => {
    useChatStore.getState().processEvent({
      type: "StatusUpdate",
      payload: { permission: "auto", thinking_effort: "medium" },
    });

    expect(useSettingsStore.getState().permissionMode).toBe("auto");
    expect(useSettingsStore.getState().thinkingEffort).toBe("medium");
  });

  it("keeps the current permission mode when a status update omits it", () => {
    useSettingsStore.setState({ permissionMode: "yolo" });

    useChatStore.getState().processEvent({
      type: "StatusUpdate",
      payload: { context_usage: 0.5 },
    });

    expect(useSettingsStore.getState().permissionMode).toBe("yolo");
  });

  it("resets the permission mode to manual when starting a new conversation", async () => {
    useSettingsStore.setState({ permissionMode: "auto" });

    await useChatStore.getState().startNewConversation();

    expect(useSettingsStore.getState().permissionMode).toBe("manual");
  });
});

describe("Webview model metadata", () => {
  it("keeps same-named models in separate provider groups", () => {
    const groups = groupModelsByProvider([
      { id: "kimi/shared", name: "Shared", provider: "managed:kimi-code", capabilities: [] },
      { id: "proxy/shared", name: "Shared", provider: "company-proxy", capabilities: [] },
    ]);

    expect(groups.map((group) => ({
      provider: group.provider,
      label: group.label,
      models: group.models.map((model) => model.id),
    }))).toEqual([
      { provider: "company-proxy", label: "company-proxy", models: ["proxy/shared"] },
      { provider: "managed:kimi-code", label: "Kimi Code", models: ["kimi/shared"] },
    ]);
  });

  it("offers a thinking toggle when a model declares adaptive thinking", () => {
    expect(getModelThinkingMode({
      id: "anthropic/claude",
      name: "Claude",
      provider: "anthropic",
      capabilities: [],
      adaptive_thinking: true,
    })).toBe("switch");
  });

  it("prefers a compatible model from the current provider for media fallback", () => {
    const current = {
      id: "openai/text",
      name: "Text",
      provider: "openai",
      capabilities: [],
    };
    const fallback = getMediaFallbackModel([
      { id: "other/vision", name: "Vision A", provider: "other", capabilities: ["image_in"] },
      { id: "openai/vision", name: "Vision B", provider: "openai", capabilities: ["image_in"] },
    ], current);

    expect(fallback?.id).toBe("openai/vision");
  });

  it("does not require Kimi login when the default model uses a custom provider", () => {
    expect(requiresManagedProviderLogin([
      { id: "local/model", name: "Local", provider: "local", capabilities: [] },
    ], "local/model", false)).toBe(false);
  });

  it("requires Kimi login when the default model uses the managed provider", () => {
    expect(requiresManagedProviderLogin([
      { id: "kimi/model", name: "Kimi", provider: "managed:kimi-code", capabilities: [] },
    ], "kimi/model", false)).toBe(true);
  });
});

describe("Webview MCP update bridge", () => {
  it("sends a lossless structured MCP edit request to the extension host", async () => {
    const posted: unknown[] = [];
    let receiveMessage: ((event: { data: unknown }) => void) | undefined;
    vi.stubGlobal("document", {
      body: { getAttribute: () => "mcp-test-view" },
    });
    vi.stubGlobal("window", {
      addEventListener: (_type: string, listener: (event: { data: unknown }) => void) => {
        receiveMessage = listener;
      },
    });
    vi.stubGlobal("acquireVsCodeApi", () => ({
      postMessage: (message: { id: string }) => {
        posted.push(message);
        queueMicrotask(() => receiveMessage?.({ data: { id: message.id, result: [] } }));
      },
      getState: () => undefined,
      setState: () => undefined,
    }));
    vi.resetModules();
    const { bridge } = await import("../webview-ui/src/services/bridge");

    await bridge.updateMCPServer("old-name", {
      name: "new-name",
      transport: "stdio",
      command: "C:\\Program Files\\Example MCP\\server.exe",
      args: ["--config", "C:\\Users\\Example User\\mcp config.json"],
      env: { SERVICE_TOKEN: MCP_SECRET_MASK, DEBUG: "1" },
    });

    expect(posted).toEqual([
      expect.objectContaining({
        method: "updateMCPServer",
        webviewId: "mcp-test-view",
        params: {
          originalName: "old-name",
          server: {
            name: "new-name",
            transport: "stdio",
            command: "C:\\Program Files\\Example MCP\\server.exe",
            args: ["--config", "C:\\Users\\Example User\\mcp config.json"],
            env: { SERVICE_TOKEN: MCP_SECRET_MASK, DEBUG: "1" },
          },
        },
      }),
    ]);
  });
});

describe("Webview chat error recovery", () => {
  it("stops the pending state and keeps the input available when session setup fails", () => {
    useChatStore.getState().sendMessage("retry this request");

    useChatStore.getState().processEvent({
      type: "error",
      code: "session.state_invalid",
      message: "Session data is invalid.",
      detail: "state.json: Unexpected token at line 4",
      phase: "preflight",
    });

    expect(useChatStore.getState()).toMatchObject({
      isStreaming: false,
      isCompacting: false,
      pendingInput: { content: "retry this request", model: "plain" },
    });
  });

  it("stops the response and retains provider detail when a running turn fails", () => {
    useChatStore.getState().sendMessage("start a turn");
    useChatStore.getState().processEvent({
      type: "TurnBegin",
      payload: { user_input: "start a turn" },
    });
    useChatStore.getState().processEvent({ type: "StepBegin", payload: { n: 1 } });

    useChatStore.getState().processEvent({
      type: "error",
      code: "provider.api_error",
      message: "Service temporarily unavailable.",
      detail: "HTTP 400: function name is invalid",
      phase: "runtime",
    });

    expect(useChatStore.getState().isStreaming).toBe(false);
    expect(useChatStore.getState().messages.at(-1)?.inlineError).toEqual({
      code: "provider.api_error",
      message: "Service temporarily unavailable.",
      detail: "HTTP 400: function name is invalid",
    });
  });
});

describe("Webview thinking mode parity with the TUI", () => {
  it("derives thinking modes from metadata only, mirroring the TUI rules", () => {
    const base = { id: "m", name: "M", provider: "p", capabilities: [] as string[] };
    expect(getModelThinkingMode({ ...base, capabilities: ["thinking"], support_efforts: ["low", "high"] })).toBe("effort");
    expect(getModelThinkingMode({ ...base, capabilities: ["always_thinking"] })).toBe("always");
    expect(getModelThinkingMode({ ...base, capabilities: ["thinking"] })).toBe("switch");
    expect(getModelThinkingMode({ ...base, adaptive_thinking: true })).toBe("switch");
    expect(getModelThinkingMode({ ...base, name: "Kimi Thinking Pro" })).toBe("none");
    expect(getModelThinkingMode(base)).toBe("none");
  });
});

describe("Webview thinking effort parity with the TUI", () => {
  it("resolves a boolean \"on\" to the model default for effort-capable models", () => {
    boundary.saveConfig.mockResolvedValue({ ok: true });
    // Pin the VSCode default-effort setting to "no preference" so this test
    // exercises the engine-default path.
    useSettingsStore.setState((s) => ({ extensionConfig: { ...s.extensionConfig, defaultThinkingEffort: "" } }));
    useSettingsStore.getState().initModels(MODELS, "reasoning", false);

    useSettingsStore.getState().selectThinkingEffort("on");

    expect(useSettingsStore.getState().thinkingEffort).toBe("high");
    expect(boundary.saveConfig).toHaveBeenCalledWith({ model: "reasoning", thinking: true, effort: "high" });
  });

  it("prefers the persisted configured effort when resolving \"on\"", () => {
    boundary.saveConfig.mockResolvedValue({ ok: true });
    useSettingsStore.getState().initModels(MODELS, "reasoning", false);
    useSettingsStore.setState({ defaultThinkingEffort: "low" });

    useSettingsStore.getState().selectThinkingEffort("on");

    expect(useSettingsStore.getState().thinkingEffort).toBe("low");
  });

  it("keeps \"on\" for genuine boolean models", () => {
    boundary.saveConfig.mockResolvedValue({ ok: true });
    useSettingsStore.getState().initModels([
      { id: "bool", name: "Bool", provider: "openai", capabilities: ["thinking"] },
    ], "bool", false);

    useSettingsStore.getState().selectThinkingEffort("on");

    expect(useSettingsStore.getState().thinkingEffort).toBe("on");
    expect(boundary.saveConfig).toHaveBeenCalledWith({ model: "bool", thinking: true, effort: "on" });
  });

  it("persists disabling thinking with thinking false", () => {
    boundary.saveConfig.mockResolvedValue({ ok: true });
    useSettingsStore.getState().initModels(MODELS, "reasoning", true);

    useSettingsStore.getState().selectThinkingEffort("off");

    expect(useSettingsStore.getState().thinkingEffort).toBe("off");
    expect(boundary.saveConfig).toHaveBeenCalledWith({ model: "reasoning", thinking: false, effort: "off" });
  });

  it("rejects \"off\" for always-on effort models", () => {
    boundary.saveConfig.mockResolvedValue({ ok: true });
    useSettingsStore.getState().initModels([
      { id: "always-effort", name: "AE", provider: "openai", capabilities: ["always_thinking"], support_efforts: ["low", "high"] },
    ], "always-effort", true);
    const previous = useSettingsStore.getState().thinkingEffort;
    boundary.saveConfig.mockClear();

    useSettingsStore.getState().selectThinkingEffort("off");

    expect(useSettingsStore.getState().thinkingEffort).toBe(previous);
    expect(boundary.saveConfig).not.toHaveBeenCalled();
  });

  it("rejects efforts outside support_efforts", () => {
    boundary.saveConfig.mockResolvedValue({ ok: true });
    useSettingsStore.getState().initModels(MODELS, "reasoning", false);
    const previous = useSettingsStore.getState().thinkingEffort;
    boundary.saveConfig.mockClear();

    useSettingsStore.getState().selectThinkingEffort("ultra");

    expect(useSettingsStore.getState().thinkingEffort).toBe(previous);
    expect(boundary.saveConfig).not.toHaveBeenCalled();
  });

  it("skips the config write when re-confirming the current effort", () => {
    boundary.saveConfig.mockResolvedValue({ ok: true });
    useSettingsStore.getState().initModels(MODELS, "reasoning", true);
    expect(useSettingsStore.getState().thinkingEffort).toBe("high");
    boundary.saveConfig.mockClear();

    useSettingsStore.getState().selectThinkingEffort("high");

    expect(useSettingsStore.getState().thinkingEffort).toBe("high");
    expect(boundary.saveConfig).not.toHaveBeenCalled();
  });

  it("does not seed future sessions with the model's top declared tier", () => {
    boundary.saveConfig.mockResolvedValue({ ok: true });
    // No VSCode default-effort preference: the engine-default path applies.
    useSettingsStore.setState((s) => ({ extensionConfig: { ...s.extensionConfig, defaultThinkingEffort: "" } }));
    useSettingsStore.getState().initModels(MODELS, "reasoning", false);

    useSettingsStore.getState().selectThinkingEffort("high");

    expect(useSettingsStore.getState().thinkingEffort).toBe("high");
    expect(boundary.saveConfig).toHaveBeenCalledWith({ model: "reasoning", thinking: true, effort: "high" });
    expect(useSettingsStore.getState().defaultThinkingEffort).toBeUndefined();
  });

  it("seeds future sessions with a persisted non-top effort", () => {
    boundary.saveConfig.mockResolvedValue({ ok: true });
    useSettingsStore.getState().initModels(MODELS, "reasoning", false);

    useSettingsStore.getState().selectThinkingEffort("low");

    expect(useSettingsStore.getState().thinkingEffort).toBe("low");
    expect(useSettingsStore.getState().defaultThinkingEffort).toBe("low");
  });

  it("marks the effort as changed when a model switch resolves to a different effort", () => {
    boundary.saveConfig.mockResolvedValue({ ok: true });
    useSettingsStore.getState().initModels(MODELS, "reasoning", true);
    expect(useSettingsStore.getState().thinkingEffort).toBe("high");

    useSettingsStore.getState().updateModel("always");

    expect(useSettingsStore.getState().thinkingEffort).toBe("on");
    expect(boundary.saveConfig).toHaveBeenCalledWith({ model: "always", thinking: true, effort: "on", effortChanged: true });
  });
});

describe("Webview default thinking effort setting", () => {
  it("applies the VSCode default effort over engine and model defaults", () => {
    useSettingsStore.getState().initModels(MODELS, "reasoning", false);
    // DEFAULT_EXTENSION_CONFIG pins the setting to "high".
    expect(useSettingsStore.getState().thinkingEffort).toBe("high");
  });

  it("honors an explicit low default", () => {
    useSettingsStore.setState((s) => ({ extensionConfig: { ...s.extensionConfig, defaultThinkingEffort: "low" } }));
    useSettingsStore.getState().initModels(MODELS, "reasoning", true);
    expect(useSettingsStore.getState().thinkingEffort).toBe("low");
  });

  it("honors off unless the model always thinks", () => {
    useSettingsStore.setState((s) => ({ extensionConfig: { ...s.extensionConfig, defaultThinkingEffort: "off" } }));
    useSettingsStore.getState().initModels(MODELS, "reasoning", true);
    expect(useSettingsStore.getState().thinkingEffort).toBe("off");
  });

  it("falls back to the model default when the setting is unsupported", () => {
    useSettingsStore.setState((s) => ({ extensionConfig: { ...s.extensionConfig, defaultThinkingEffort: "medium" } }));
    useSettingsStore.getState().initModels(MODELS, "reasoning", true);
    expect(useSettingsStore.getState().thinkingEffort).toBe("high");
  });

  it("resets the composer effort to the setting default on a new conversation", async () => {
    boundary.saveConfig.mockResolvedValue({ ok: true });
    useSettingsStore.getState().initModels(MODELS, "reasoning", true);
    useSettingsStore.getState().selectThinkingEffort("low");

    await useChatStore.getState().startNewConversation();

    expect(useSettingsStore.getState().thinkingEffort).toBe("high");
  });
});

describe("Webview mid-turn warnings", () => {
  it("re-queues an in-flight send rejected by a still-busy engine", async () => {
    useChatStore.getState().sendMessage("first message");
    useChatStore.getState().sendMessage("queued follow-up");
    expect(useChatStore.getState().isStreaming).toBe(true);
    expect(useChatStore.getState().queue).toHaveLength(1);

    // The direct send raced a busy engine (e.g. a view re-created mid-turn):
    // rejected non-terminally before any TurnBegin acknowledged it.
    useChatStore.getState().processEvent({
      type: "error",
      code: "internal",
      message: "Internal error occurred.",
      detail: "A response is already being generated for this session.",
      phase: "runtime",
      terminal: false,
    });

    // The rejected content moves to the FRONT of the queue (it predates the
    // follow-up), the composer stays locked, and no toast shows — the queue
    // pill flashes its own reminder animation when the queue grows.
    expect(boundary.toastInfo).not.toHaveBeenCalled();
    expect(boundary.toastWarning).not.toHaveBeenCalled();
    const state = useChatStore.getState();
    expect(state.isStreaming).toBe(true);
    expect(state.pendingInput).toBeNull();
    expect(state.queue).toHaveLength(2);
    expect(state.queue[0]?.content).toBe("first message");
    expect(state.queue[1]?.content).toBe("queued follow-up");
    expect(state.messages.at(-1)?.inlineError).toBeUndefined();

    // The genuine terminal still completes the turn and drains the queue.
    useChatStore.getState().processEvent({ type: "stream_complete", result: { status: "finished" } });
    expect(useChatStore.getState().isStreaming).toBe(false);
    await vi.waitFor(() => {
      expect(boundary.streamChat).toHaveBeenCalledTimes(2);
    });
  });

  it("shows a non-terminal error as a toast when no send is in flight", () => {
    useChatStore.getState().sendMessage("queued follow-up");
    // Engine accepted it: TurnBegin clears pendingInput and locks the composer.
    useChatStore.getState().processEvent({ type: "TurnBegin", payload: { user_input: "queued follow-up" } });
    useChatStore.getState().sendMessage("next queued");
    expect(useChatStore.getState().queue).toHaveLength(1);

    useChatStore.getState().processEvent({
      type: "error",
      code: "internal",
      message: "Internal error occurred.",
      detail: "A response is already being generated for this session.",
      phase: "runtime",
      terminal: false,
    });

    // A mid-turn warning with nothing in flight disturbs nothing.
    expect(boundary.toastWarning).toHaveBeenCalledWith("Internal error occurred.");
    expect(boundary.toastInfo).not.toHaveBeenCalled();
    const state = useChatStore.getState();
    expect(state.isStreaming).toBe(true);
    expect(state.queue).toHaveLength(1);
    expect(state.queue[0]?.content).toBe("next queued");
    expect(state.messages.at(-1)?.inlineError).toBeUndefined();
  });
});
