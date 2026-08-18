/**
 * Scenario: the VS Code host owns one Kimi harness and routes Webviews to shared SDK sessions.
 * Responsibilities: create/resume/switch, per-session settings, multi-view ownership, detach, and disposal.
 * Wiring: KimiRuntime and SessionRuntime are real; in-memory Session/KimiHarness fakes form the public SDK boundary.
 * Run: pnpm exec vitest run --config apps/vscode/vitest.config.ts test/kimi-runtime.test.ts
 */

import type {
  ApprovalHandler,
  CreateSessionOptions,
  Event,
  GenerateSessionTitleInput,
  JsonObject,
  KimiHarness,
  PermissionMode,
  PromptInput,
  QuestionHandler,
  ResumeSessionInput,
  Session,
  SessionStatus,
  SessionSummary,
  ThinkingEffort,
} from "@moonshot-ai/kimi-code-sdk";
import { describe, expect, it, vi } from "vitest";

import { Events } from "../shared/bridge";
import { KimiRuntime, type OpenSessionOptions } from "../src/runtime/kimi-runtime";

const sdkFactories = vi.hoisted(() => {
  const v1Harness = { homeDir: "/tmp/kimi-runtime-v1-home", close: vi.fn(async () => undefined) };
  const v2Harness = { homeDir: "/tmp/kimi-runtime-v2-home", close: vi.fn(async () => undefined) };
  return {
    v1Harness,
    v2Harness,
    createKimiHarness: vi.fn(() => v1Harness),
    createKimiHarnessV2: vi.fn(() => v2Harness),
  };
});

vi.mock("@moonshot-ai/kimi-code-sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("@moonshot-ai/kimi-code-sdk")>();
  return {
    ...original,
    createKimiHarness: sdkFactories.createKimiHarness,
    createKimiHarnessV2: sdkFactories.createKimiHarnessV2,
  };
});

interface FakeSessionBoundary {
  readonly session: Session;
  readonly setModels: string[];
  readonly setThinkingEfforts: ThinkingEffort[];
  readonly setPermissions: PermissionMode[];
  readonly metadataUpdates: JsonObject[];
  readonly handlerInstallations: { approval: number; question: number };
  readonly subscriptionCount: () => number;
  readonly closeCount: () => number;
  readonly emit: (event: Event) => void;
  readonly setPromptImpl: (impl: (input: string | PromptInput) => Promise<void>) => void;
}

function createFakeSession(
  id: string,
  workDir: string,
  initial: Partial<SessionStatus> = {},
  metadata?: JsonObject,
): FakeSessionBoundary {
  const listeners = new Set<(event: Event) => void>();
  const setModels: string[] = [];
  const setThinkingEfforts: ThinkingEffort[] = [];
  const setPermissions: PermissionMode[] = [];
  const metadataUpdates: JsonObject[] = [];
  const handlerInstallations = { approval: 0, question: 0 };
  let subscriptions = 0;
  let closes = 0;
  let promptImpl: (input: string | PromptInput) => Promise<void> = async () => {};
  let status: SessionStatus = {
    model: initial.model ?? "kimi-test",
    thinkingEffort: initial.thinkingEffort ?? "off",
    permission: initial.permission ?? "manual",
    planMode: initial.planMode ?? false,
    contextTokens: 0,
    maxContextTokens: 128_000,
    contextUsage: 0,
  };
  let summary: SessionSummary = {
    id,
    workDir,
    sessionDir: `/home/sessions/${id}`,
    createdAt: 1,
    updatedAt: 2,
    metadata,
  };

  const session = {
    id,
    workDir,
    get summary() {
      return summary;
    },
    set summary(value: SessionSummary | undefined) {
      if (value !== undefined) summary = value;
    },
    setApprovalHandler(handler: ApprovalHandler | undefined) {
      if (handler !== undefined) handlerInstallations.approval += 1;
    },
    setQuestionHandler(handler: QuestionHandler | undefined) {
      if (handler !== undefined) handlerInstallations.question += 1;
    },
    onEvent(listener: (event: Event) => void) {
      subscriptions += 1;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async prompt(input: string | PromptInput) {
      await promptImpl(input);
    },
    async steer(_input: string | PromptInput) {},
    async cancel() {},
    async getStatus() {
      return status;
    },
    async getGoal() {
      return { goal: null };
    },
    async setModel(model: string) {
      setModels.push(model);
      status = { ...status, model };
    },
    async setThinking(effort: ThinkingEffort) {
      setThinkingEfforts.push(effort);
      status = { ...status, thinkingEffort: effort };
    },
    async setPermission(permission: PermissionMode) {
      setPermissions.push(permission);
      status = { ...status, permission };
    },
    async updateMetadata(patch: JsonObject) {
      metadataUpdates.push(patch);
      summary = { ...summary, metadata: { ...summary.metadata, ...patch } };
    },
    async close() {
      closes += 1;
    },
  } as unknown as Session;

  return {
    session,
    setModels,
    setThinkingEfforts,
    setPermissions,
    metadataUpdates,
    handlerInstallations,
    subscriptionCount: () => subscriptions,
    closeCount: () => closes,
    emit: (event: Event) => {
      for (const listener of [...listeners]) listener(event);
    },
    setPromptImpl: (impl) => {
      promptImpl = impl;
    },
  };
}

interface FakeHarnessBoundary {
  readonly harness: KimiHarness;
  readonly createInputs: CreateSessionOptions[];
  readonly resumeInputs: ResumeSessionInput[];
  readonly closeSessionIds: string[];
  readonly deleteSessionIds: string[];
  readonly titleRequests: GenerateSessionTitleInput[];
  readonly closeCount: () => number;
  readonly sessions: Map<string, FakeSessionBoundary>;
  addSession(
    id: string,
    workDir: string,
    initial?: Partial<SessionStatus>,
    metadata?: JsonObject,
  ): FakeSessionBoundary;
}

function createFakeHarness(
  normalizeCreatedWorkDir: (workDir: string) => string = (workDir) => workDir,
): FakeHarnessBoundary {
  const sessions = new Map<string, FakeSessionBoundary>();
  const createInputs: CreateSessionOptions[] = [];
  const resumeInputs: ResumeSessionInput[] = [];
  const closeSessionIds: string[] = [];
  const deleteSessionIds: string[] = [];
  const titleRequests: GenerateSessionTitleInput[] = [];
  let creates = 0;
  let closes = 0;

  const addSession = (
    id: string,
    workDir: string,
    initial?: Partial<SessionStatus>,
    metadata?: JsonObject,
  ) => {
    const boundary = createFakeSession(id, workDir, initial, metadata);
    sessions.set(id, boundary);
    return boundary;
  };

  const harness = {
    async createSession(options: CreateSessionOptions) {
      createInputs.push(options);
      creates += 1;
      return addSession(
        `created-${creates}`,
        normalizeCreatedWorkDir(options.workDir),
        {
          model: options.model,
          thinkingEffort: options.thinking,
          permission: options.permission,
        },
        options.metadata,
      ).session;
    },
    async resumeSession(input: ResumeSessionInput) {
      resumeInputs.push(input);
      const boundary = sessions.get(input.id);
      if (boundary === undefined) throw new Error(`Unknown session: ${input.id}`);
      return boundary.session;
    },
    async closeSession(id: string) {
      closeSessionIds.push(id);
    },
    async deleteSession(id: string) {
      deleteSessionIds.push(id);
    },
    // The runtime enables the fork experiments on first use.
    async getConfig() {
      return {};
    },
    async setConfig() {
      return {};
    },
    async generateSessionTitle(input: GenerateSessionTitleInput) {
      titleRequests.push(input);
      return undefined;
    },
    async close() {
      closes += 1;
    },
  } as unknown as KimiHarness;

  return {
    harness,
    createInputs,
    resumeInputs,
    closeSessionIds,
    deleteSessionIds,
    titleRequests,
    closeCount: () => closes,
    sessions,
    addSession,
  };
}

function openOptions(overrides: Partial<OpenSessionOptions> = {}): OpenSessionOptions {
  return {
    webviewId: "view-1",
    workDir: "/workspace",
    model: "kimi-test",
    effort: "off",
    yoloMode: false,
    ...overrides,
  };
}

function createRuntime(
  normalizeCreatedWorkDir?: (workDir: string) => string,
) {
  const sdk = createFakeHarness(normalizeCreatedWorkDir);
  const runtime = new KimiRuntime({
    version: "0.6.0",
    harness: sdk.harness,
    broadcast: () => undefined,
    captureBaseline: () => undefined,
    log: () => undefined,
  });
  return { runtime, sdk };
}

describe("Kimi runtime (owns shared SDK sessions for Webviews)", () => {
  it("creates the v2 harness by default and the v1 harness for rollback", async () => {
    const defaults = new KimiRuntime({
      version: "0.6.0",
      broadcast: () => undefined,
      captureBaseline: () => undefined,
      log: () => undefined,
    });
    expect(sdkFactories.createKimiHarnessV2).toHaveBeenCalledOnce();
    expect(sdkFactories.createKimiHarnessV2).toHaveBeenCalledWith({
      homeDir: undefined,
      identity: {
        productName: "kimi-code-vscode",
        version: "0.6.0",
        platform: "kimi_code_vscode",
      },
      uiMode: "vscode",
    });
    expect(sdkFactories.createKimiHarness).not.toHaveBeenCalled();
    expect(defaults.harness).toBe(sdkFactories.v2Harness as unknown as KimiHarness);
    await defaults.dispose();

    const rollback = new KimiRuntime({
      version: "0.6.0",
      useAgentCoreV1: true,
      broadcast: () => undefined,
      captureBaseline: () => undefined,
      log: () => undefined,
    });
    expect(sdkFactories.createKimiHarness).toHaveBeenCalledOnce();
    expect(rollback.harness).toBe(sdkFactories.v1Harness as unknown as KimiHarness);
    await rollback.dispose();
  });

  it("forwards the requested settings but starts a new session in manual mode", async () => {
    const { runtime, sdk } = createRuntime();

    const opened = await runtime.openSession(
      openOptions({ model: "kimi-k2", effort: "high", yoloMode: true }),
    );

    // Permission mode is per-session; the global yolo setting never applies
    // to a newly created session.
    expect(sdk.createInputs).toEqual([
      {
        workDir: "/workspace",
        model: "kimi-k2",
        thinking: "high",
        permission: "manual",
        metadata: { vscode_legacy_approval: { yolo: false, afk: false } },
      },
    ]);
    expect(opened.subscribers).toEqual(["view-1"]);
  });

  it("accepts the normalized SDK workDir when a Windows session is created", async () => {
    const { runtime } = createRuntime((workDir) => workDir.replaceAll("\\", "/"));

    const opened = await runtime.openSession(openOptions({
      workDir: "C:\\Users\\Example User\\项目",
    }));

    expect(opened.session.workDir).toBe("C:/Users/Example User/项目");
  });

  it("resumes a Windows session when only separators and casing differ", async () => {
    const { runtime, sdk } = createRuntime();
    sdk.addSession("saved-win", "C:/Users/Example User/项目");

    const opened = await runtime.openSession(openOptions({
      sessionId: "saved-win",
      workDir: "c:\\users\\example user\\项目",
    }));

    expect(opened.id).toBe("saved-win");
  });

  it("uses high thinking when a new session receives an empty effort", async () => {
    const { runtime, sdk } = createRuntime();

    await runtime.openSession(openOptions({ effort: "   " }));

    expect(sdk.createInputs[0]?.thinking).toBe("high");
  });

  it("resumes the requested SDK session instead of creating a replacement", async () => {
    const { runtime, sdk } = createRuntime();
    sdk.addSession("saved-1", "/workspace");

    const opened = await runtime.openSession(openOptions({ sessionId: "saved-1" }));

    expect(opened.id).toBe("saved-1");
    expect(sdk.resumeInputs).toEqual([{ id: "saved-1", includeSubagents: true }]);
    expect(sdk.createInputs).toEqual([]);
  });

  it("switches a Webview to the requested session", async () => {
    const { runtime, sdk } = createRuntime();
    await runtime.openSession(openOptions());
    sdk.addSession("saved-2", "/workspace");

    const selected = await runtime.openSession(openOptions({ sessionId: "saved-2" }));

    expect(runtime.getSessionForView("view-1")?.id).toBe("saved-2");
    expect(selected.id).toBe("saved-2");
  });

  it("closes an unshared old session when its Webview switches away", async () => {
    const { runtime, sdk } = createRuntime();
    const old = await runtime.openSession(openOptions());
    const oldBoundary = sdk.sessions.get(old.id)!;
    sdk.addSession("saved-2", "/workspace");

    await runtime.openSession(openOptions({ sessionId: "saved-2" }));

    expect(oldBoundary.closeCount()).toBe(1);
  });

  it("shares one SDK subscription when two Webviews attach to the same session", async () => {
    const { runtime, sdk } = createRuntime();
    const first = await runtime.openSession(openOptions({ webviewId: "view-1" }));
    const boundary = sdk.sessions.get(first.id)!;

    const second = await runtime.openSession(
      openOptions({ webviewId: "view-2", sessionId: first.id }),
    );

    expect(second).toBe(first);
    expect(first.subscribers).toEqual(["view-1", "view-2"]);
    expect(boundary.subscriptionCount()).toBe(1);
    expect(boundary.handlerInstallations).toEqual({ approval: 1, question: 1 });
  });

  it("preserves the resumed session's model instead of reapplying the configured default", async () => {
    const { runtime, sdk } = createRuntime();
    const session = sdk.addSession("saved-1", "/workspace", { model: "old-model" });

    const opened = await runtime.openSession(openOptions({ sessionId: "saved-1", model: "new-model" }));

    expect(session.setModels).toEqual([]);
    await expect(opened.session.getStatus()).resolves.toMatchObject({ model: "old-model" });
  });

  it("preserves the resumed session's thinking effort instead of reapplying the configured default", async () => {
    const { runtime, sdk } = createRuntime();
    const session = sdk.addSession("saved-1", "/workspace", { thinkingEffort: "max" });

    const opened = await runtime.openSession(openOptions({ sessionId: "saved-1", effort: "medium" }));

    expect(session.setThinkingEfforts).toEqual([]);
    await expect(opened.session.getStatus()).resolves.toMatchObject({ thinkingEffort: "max" });
  });

  it("announces the session's actual status to the attaching view so the display matches it", async () => {
    const sdk = createFakeHarness();
    const broadcasts: { event: string; data: unknown; webviewId?: string }[] = [];
    const runtime = new KimiRuntime({
      version: "0.6.0",
      harness: sdk.harness,
      broadcast: (event, data, webviewId) => {
        broadcasts.push({ event, data, webviewId });
      },
      captureBaseline: () => undefined,
      log: () => undefined,
    });
    sdk.addSession(
      "saved-1",
      "/workspace",
      {
        model: "kimi-test",
        thinkingEffort: "max",
        planMode: true,
        permission: "auto",
      },
      { vscode_legacy_approval: { yolo: false, afk: true } },
    );

    await runtime.openSession(openOptions({ sessionId: "saved-1", effort: "medium" }));

    expect(broadcasts).toContainEqual({
      event: Events.StreamEvent,
      data: {
        type: "StatusUpdate",
        payload: { model: "kimi-test", thinking_effort: "max", plan_mode: true, swarm_mode: false, permission: "auto", goal: null },
        _sessionId: "saved-1",
      },
      webviewId: "view-1",
    });
  });

  it("uses the yolo setting as the initial value for an unmarked resumed session", async () => {
    const { runtime, sdk } = createRuntime();
    const session = sdk.addSession("saved-1", "/workspace", { permission: "manual" });

    await runtime.openSession(openOptions({ sessionId: "saved-1", yoloMode: true }));

    expect(session.metadataUpdates).toEqual([
      { vscode_legacy_approval: { yolo: true, afk: false } },
    ]);
  });

  it("keeps the persisted manual flags when the global yolo setting is on", async () => {
    const { runtime, sdk } = createRuntime();
    const session = sdk.addSession(
      "saved-1",
      "/workspace",
      { permission: "manual" },
      { vscode_legacy_approval: { yolo: false, afk: false } },
    );

    const opened = await runtime.openSession(openOptions({ sessionId: "saved-1", yoloMode: true }));

    // The global setting no longer overrides a session's persisted mode.
    expect(session.setPermissions).toEqual([]);
    expect(session.metadataUpdates).toEqual([]);
    expect(opened.legacyApprovalFlags).toEqual({ yolo: false, afk: false });
  });

  it("keeps the persisted yolo flag when the global yolo setting is off", async () => {
    const { runtime, sdk } = createRuntime();
    const session = sdk.addSession(
      "saved-1",
      "/workspace",
      { permission: "yolo" },
      { vscode_legacy_approval: { yolo: true, afk: false } },
    );

    const opened = await runtime.openSession(openOptions({ sessionId: "saved-1", yoloMode: false }));

    expect(session.setPermissions).toEqual([]);
    expect(session.metadataUpdates).toEqual([]);
    expect(opened.legacyApprovalFlags).toEqual({ yolo: true, afk: false });
  });

  it("restores persisted afk even when the global yolo setting is on", async () => {
    const { runtime, sdk } = createRuntime();
    const session = sdk.addSession(
      "saved-1",
      "/workspace",
      { permission: "manual" },
      { vscode_legacy_approval: { yolo: false, afk: true } },
    );

    const opened = await runtime.openSession(openOptions({ sessionId: "saved-1", yoloMode: true }));

    expect(session.setPermissions).toEqual(["auto"]);
    expect(opened.legacyApprovalFlags).toEqual({ yolo: false, afk: true });
  });

  it("restores persisted afk with core auto permission", async () => {
    const { runtime, sdk } = createRuntime();
    const session = sdk.addSession(
      "saved-1",
      "/workspace",
      { permission: "manual" },
      { vscode_legacy_approval: { yolo: false, afk: true } },
    );

    await runtime.openSession(openOptions({ sessionId: "saved-1", yoloMode: false }));

    expect(session.setPermissions).toEqual(["auto"]);
  });

  it("maps the three permission modes onto canonical legacy flags and persists them", async () => {
    const { runtime, sdk } = createRuntime();
    const opened = await runtime.openSession(openOptions());
    const boundary = sdk.sessions.get(opened.id)!;

    await opened.setPermissionMode("auto");
    expect(opened.legacyApprovalFlags).toEqual({ yolo: false, afk: true });
    await expect(opened.session.getStatus()).resolves.toMatchObject({ permission: "auto" });

    await opened.setPermissionMode("yolo");
    expect(opened.legacyApprovalFlags).toEqual({ yolo: true, afk: false });
    await expect(opened.session.getStatus()).resolves.toMatchObject({ permission: "yolo" });

    await opened.setPermissionMode("manual");
    expect(opened.legacyApprovalFlags).toEqual({ yolo: false, afk: false });
    await expect(opened.session.getStatus()).resolves.toMatchObject({ permission: "manual" });

    expect(boundary.setPermissions).toEqual(["auto", "yolo", "manual"]);
    expect(boundary.metadataUpdates).toEqual([
      { vscode_legacy_approval: { yolo: false, afk: true } },
      { vscode_legacy_approval: { yolo: true, afk: false } },
      { vscode_legacy_approval: { yolo: false, afk: false } },
    ]);
  });

  it("keeps a shared session open when one of its Webviews detaches", async () => {
    const { runtime, sdk } = createRuntime();
    const opened = await runtime.openSession(openOptions({ webviewId: "view-1" }));
    await runtime.openSession(openOptions({ webviewId: "view-2", sessionId: opened.id }));
    const boundary = sdk.sessions.get(opened.id)!;

    await runtime.detachView("view-1");

    expect(boundary.closeCount()).toBe(0);
    expect(runtime.getSessionForView("view-2")?.id).toBe(opened.id);
  });

  it("closes an SDK session when its last Webview detaches", async () => {
    const { runtime, sdk } = createRuntime();
    const opened = await runtime.openSession(openOptions());
    const boundary = sdk.sessions.get(opened.id)!;

    await runtime.detachView("view-1");

    expect(boundary.closeCount()).toBe(1);
    expect(runtime.getSession(opened.id)).toBeUndefined();
  });

  it("reattaches the same resumed session without replacing its handlers", async () => {
    const { runtime, sdk } = createRuntime();
    const boundary = sdk.addSession("saved-1", "/workspace");
    const first = await runtime.attachResumedSession("view-1", boundary.session);

    const second = await runtime.attachResumedSession("view-1", boundary.session);

    expect(second).toBe(first);
    expect(boundary.subscriptionCount()).toBe(1);
    expect(boundary.handlerInstallations).toEqual({ approval: 1, question: 1 });
    expect(boundary.closeCount()).toBe(0);
  });

  it("removes every Webview mapping when a shared session is closed", async () => {
    const { runtime } = createRuntime();
    const opened = await runtime.openSession(openOptions({ webviewId: "view-1" }));
    await runtime.openSession(openOptions({ webviewId: "view-2", sessionId: opened.id }));

    await runtime.closeSession(opened.id);

    expect(runtime.getSessionForView("view-1")).toBeUndefined();
    expect(runtime.getSessionForView("view-2")).toBeUndefined();
  });

  it("delegates deletion after the active session has been closed", async () => {
    const { runtime, sdk } = createRuntime();
    const opened = await runtime.openSession(openOptions());
    const boundary = sdk.sessions.get(opened.id)!;

    await runtime.deleteSession(opened.id);

    expect(boundary.closeCount()).toBe(1);
    expect(sdk.deleteSessionIds).toEqual([opened.id]);
  });

  it("closes every active SDK session when the host runtime is disposed", async () => {
    const { runtime, sdk } = createRuntime();
    const first = await runtime.openSession(openOptions({ webviewId: "view-1" }));
    const secondBoundary = sdk.addSession("saved-2", "/workspace");
    await runtime.openSession(openOptions({ webviewId: "view-2", sessionId: "saved-2" }));

    await runtime.dispose();

    expect(sdk.sessions.get(first.id)?.closeCount()).toBe(1);
    expect(secondBoundary.closeCount()).toBe(1);
    expect(sdk.closeCount()).toBe(1);
  });

  it("does not retain a resumed session when it belongs to a different working directory", async () => {
    const { runtime, sdk } = createRuntime();
    const foreign = sdk.addSession("foreign-1", "/other-workspace");

    await expect(
      runtime.openSession(openOptions({ sessionId: "foreign-1" })),
    ).rejects.toThrow("The selected session belongs to a different working directory.");

    expect(runtime.getSession("foreign-1")).toBeUndefined();
    expect(foreign.closeCount()).toBe(1);
  });

  function createRecordingRuntime() {
    const sdk = createFakeHarness();
    const broadcasts: Array<{ event: string; data: unknown }> = [];
    const runtime = new KimiRuntime({
      version: "test",
      harness: sdk.harness,
      broadcast: (event, data) => {
        broadcasts.push({ event, data });
      },
      captureBaseline: () => undefined,
      log: () => undefined,
    });
    return { runtime, sdk, broadcasts };
  }

  it("fails a reentrant prompt without disturbing the running turn", async () => {
    const { runtime, sdk, broadcasts } = createRecordingRuntime();
    const opened = await runtime.openSession(openOptions());
    const boundary = sdk.sessions.get(opened.id)!;

    let releaseTurn!: () => void;
    boundary.setPromptImpl(() => new Promise<void>((resolve) => {
      releaseTurn = resolve;
    }));
    const first = opened.prompt("first message");
    boundary.emit({ type: "turn.started", agentId: "main", sessionId: opened.id, turnId: "t1" } as unknown as Event);
    expect(opened.isBusy).toBe(true);

    await expect(opened.prompt("concurrent message")).resolves.toEqual({ status: "failed" });

    // The rejection surfaces as a mid-turn warning; the active turn is untouched.
    expect(opened.isBusy).toBe(true);
    const busyWarning = broadcasts.find(({ data }) => (data as { type?: string }).type === "error");
    expect(busyWarning?.data).toMatchObject({
      type: "error",
      phase: "runtime",
      detail: "A response is already being generated for this session.",
      terminal: false,
    });

    boundary.emit({ type: "turn.ended", agentId: "main", sessionId: opened.id, turnId: "t1", reason: "completed" } as unknown as Event);
    releaseTurn();
    await expect(first).resolves.toEqual({ status: "finished" });
    expect(opened.isBusy).toBe(false);
  });

  it("rejects a prompt during an exclusive operation with a terminal error", async () => {
    const { runtime, broadcasts } = createRecordingRuntime();
    const opened = await runtime.openSession(openOptions());

    let releaseExclusive!: () => void;
    const exclusive = opened.runExclusiveAfterCancelling(
      () => new Promise<void>((resolve) => {
        releaseExclusive = resolve;
      }),
    );
    // No active work means no later stream_complete: the rejection must be
    // terminal so the caller's composer can unlock.
    expect(opened.isBusy).toBe(true);

    await expect(opened.prompt("during fork")).resolves.toEqual({ status: "failed" });
    const rejection = broadcasts.find(({ data }) => (data as { type?: string }).type === "error");
    expect(rejection?.data).toMatchObject({ type: "error", phase: "runtime" });
    expect((rejection?.data as Record<string, unknown>)["terminal"]).toBeUndefined();

    releaseExclusive();
    await exclusive;
    expect(opened.isBusy).toBe(false);
  });

  it("marks a mid-turn core error as non-terminal until the turn ends", async () => {
    const { runtime, sdk, broadcasts } = createRecordingRuntime();
    const opened = await runtime.openSession(openOptions());
    const boundary = sdk.sessions.get(opened.id)!;

    let releaseTurn!: () => void;
    boundary.setPromptImpl(() => new Promise<void>((resolve) => {
      releaseTurn = resolve;
    }));
    const first = opened.prompt("first message");
    boundary.emit({ type: "turn.started", agentId: "main", sessionId: opened.id, turnId: "t1" } as unknown as Event);

    boundary.emit({
      type: "error",
      agentId: "main",
      sessionId: opened.id,
      code: "records.write_failed",
      message: "Failed to write agent records: EACCES",
    } as unknown as Event);

    // The turn is still running: no settlement, no terminal error on the wire.
    expect(opened.isBusy).toBe(true);
    const warning = broadcasts.find(({ data }) => (data as { type?: string }).type === "error");
    expect(warning?.data).toMatchObject({
      type: "error",
      code: "records.write_failed",
      phase: "runtime",
      terminal: false,
    });

    boundary.emit({ type: "turn.ended", agentId: "main", sessionId: opened.id, turnId: "t1", reason: "completed" } as unknown as Event);
    releaseTurn();
    await expect(first).resolves.toEqual({ status: "finished" });
    expect(opened.isBusy).toBe(false);
  });

  it("requests an AI session title after a completed turn only", async () => {
    const { runtime, sdk } = createRecordingRuntime();
    const opened = await runtime.openSession(openOptions());
    const boundary = sdk.sessions.get(opened.id)!;

    boundary.setPromptImpl(() => Promise.resolve());
    const turn = opened.prompt("first message");
    boundary.emit({ type: "turn.started", agentId: "main", sessionId: opened.id, turnId: "t1" } as unknown as Event);
    boundary.emit({ type: "turn.ended", agentId: "main", sessionId: opened.id, turnId: "t1", reason: "completed" } as unknown as Event);
    await expect(turn).resolves.toEqual({ status: "finished" });
    expect(sdk.titleRequests).toEqual([{ id: opened.id }]);

    const cancelled = opened.prompt("second message");
    boundary.emit({ type: "turn.started", agentId: "main", sessionId: opened.id, turnId: "t2" } as unknown as Event);
    boundary.emit({ type: "turn.ended", agentId: "main", sessionId: opened.id, turnId: "t2", reason: "cancelled" } as unknown as Event);
    await expect(cancelled).resolves.toEqual({ status: "cancelled" });
    expect(sdk.titleRequests).toHaveLength(1);
  });

  it("keeps preflight failures terminal", async () => {
    const { runtime, sdk, broadcasts } = createRecordingRuntime();
    const opened = await runtime.openSession(openOptions());
    const boundary = sdk.sessions.get(opened.id)!;

    boundary.setPromptImpl(() => Promise.reject(new Error("provider down")));

    await expect(opened.prompt("hi")).resolves.toEqual({ status: "failed" });
    const failure = broadcasts.find(({ data }) => (data as { type?: string }).type === "error");
    expect(failure?.data).toMatchObject({ type: "error", phase: "preflight" });
    expect((failure?.data as Record<string, unknown>)["terminal"]).toBeUndefined();
    expect(opened.isBusy).toBe(false);
  });
});
