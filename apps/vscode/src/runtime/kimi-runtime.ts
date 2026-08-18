import {
  createKimiHarness,
  createKimiHarnessV2,
  type KimiHarness,
  type Session,
  type SessionSummary,
  type ThinkingEffort,
} from "@moonshot-ai/kimi-code-sdk";

import type { RuntimeBroadcast } from "./session-runtime";
import {
  corePermissionForLegacyApproval,
  legacyApprovalMetadata,
  readLegacyApprovalFlags,
  readMigratedLegacyApprovalFlags,
  type LegacyApprovalFlags,
} from "./legacy-approval";
import { SessionRuntime } from "./session-runtime";
import { areSameFsPath } from "../utils/fs-path";

export interface KimiRuntimeOptions {
  readonly version: string;
  readonly broadcast: RuntimeBroadcast;
  readonly captureBaseline: (
    session: Pick<SessionSummary, "id" | "workDir" | "metadata">,
    filePath: string,
    webviewIds: readonly string[],
  ) => void;
  readonly log: (message: string, error?: unknown) => void;
  readonly homeDir?: string;
  readonly harness?: KimiHarness;
  /**
   * Engine rollback: create the legacy v1 harness instead of the default v2
   * one. The decision is made once in `config/vscode-settings.ts`; a change
   * applies on the next window reload, when the runtime is rebuilt.
   */
  readonly useAgentCoreV1?: boolean;
}

export interface OpenSessionOptions {
  readonly webviewId: string;
  readonly workDir: string;
  readonly sessionId?: string;
  readonly model: string;
  readonly effort: string;
  /** Legacy global default; only seeds sessions without stored approval metadata. */
  readonly yoloMode: boolean;
}

/** Extension-host owner for one in-process Node SDK harness. */
export class KimiRuntime {
  readonly harness: KimiHarness;

  private readonly broadcast: RuntimeBroadcast;
  private readonly captureBaseline: KimiRuntimeOptions["captureBaseline"];
  private readonly log: KimiRuntimeOptions["log"];
  private readonly sessions = new Map<string, SessionRuntime>();
  private readonly sessionByView = new Map<string, string>();
  private experimentGate: Promise<void> | undefined;
  private closed = false;

  constructor(options: KimiRuntimeOptions) {
    this.broadcast = options.broadcast;
    this.captureBaseline = options.captureBaseline;
    this.log = options.log;
    const createHarness = options.useAgentCoreV1 ? createKimiHarness : createKimiHarnessV2;
    this.harness =
      options.harness ??
      createHarness({
        homeDir: options.homeDir,
        identity: {
          productName: "kimi-code-vscode",
          version: options.version,
          platform: "kimi_code_vscode",
        },
        uiMode: "vscode",
      });
  }

  getSessionForView(webviewId: string): SessionRuntime | undefined {
    const id = this.sessionByView.get(webviewId);
    return id === undefined ? undefined : this.sessions.get(id);
  }

  getSession(id: string): SessionRuntime | undefined {
    return this.sessions.get(id);
  }

  async openSession(options: OpenSessionOptions): Promise<SessionRuntime> {
    this.ensureOpen();
    await this.enableSecondaryModelExperiment();
    const current = this.getSessionForView(options.webviewId);
    const requestedId = options.sessionId ?? current?.id;

    if (
      current !== undefined &&
      requestedId === current.id &&
      areSameFsPath(current.session.workDir, options.workDir)
    ) {
      await applySessionSettings(current.session, options, current.legacyApprovalFlags);
      await current.announceStatus(options.webviewId);
      return current;
    }

    let runtime = requestedId === undefined ? undefined : this.sessions.get(requestedId);
    if (runtime !== undefined) {
      assertSessionWorkDir(runtime.session, options.workDir);
      await applySessionSettings(runtime.session, options, runtime.legacyApprovalFlags);
      await this.detachView(options.webviewId);
    } else {
      // Permission mode is per-session: new sessions always start in manual.
      // The global `kimifork.yoloMode` setting only survives as the fallback
      // for legacy sessions that predate the persisted approval metadata.
      const newSessionApproval: LegacyApprovalFlags = { yolo: false, afk: false };
      const session =
        requestedId === undefined
          ? await this.harness.createSession({
              workDir: options.workDir,
              model: options.model || undefined,
              thinking: normalizeEffort(options.effort),
              permission: corePermissionForLegacyApproval(newSessionApproval),
              metadata: legacyApprovalMetadata(newSessionApproval),
            })
          : await this.harness.resumeSession({ id: requestedId, includeSubagents: true });
      try {
        assertSessionWorkDir(session, options.workDir);
        const storedApproval = readLegacyApprovalFlags(session.summary?.metadata);
        const approval =
          storedApproval ??
          (await this.readMigratedLegacyApproval(session)) ??
          { yolo: options.yoloMode, afk: false };
        if (storedApproval === undefined) {
          await session.updateMetadata(legacyApprovalMetadata(approval));
        }
        await applySessionSettings(session, options, approval);
        await this.detachView(options.webviewId);
        runtime = this.wrapSession(session, approval);
      } catch (error) {
        await session.close().catch((closeError: unknown) => {
          this.log("Failed to close a rejected session", closeError);
        });
        throw error;
      }
    }

    runtime.subscribe(options.webviewId);
    this.sessionByView.set(options.webviewId, runtime.id);
    await runtime.announceStatus(options.webviewId);
    return runtime;
  }

  async attachResumedSession(
    webviewId: string,
    session: Session,
    defaultYoloMode = false,
  ): Promise<SessionRuntime> {
    await this.enableSecondaryModelExperiment();
    const existing = this.sessions.get(session.id);
    if (existing !== undefined && this.sessionByView.get(webviewId) === session.id) {
      existing.subscribe(webviewId);
      await existing.announceStatus(webviewId);
      return existing;
    }
    await this.detachView(webviewId);
    let runtime = existing ?? this.sessions.get(session.id);
    if (runtime === undefined) {
      try {
        const storedApproval = readLegacyApprovalFlags(session.summary?.metadata);
        const approval =
          storedApproval ??
          (await this.readMigratedLegacyApproval(session)) ??
          { yolo: defaultYoloMode, afk: false };
        if (storedApproval === undefined) {
          await session.updateMetadata(legacyApprovalMetadata(approval));
        }
        const status = await session.getStatus();
        const permission = corePermissionForLegacyApproval(approval);
        if (status.permission !== permission) await session.setPermission(permission);
        runtime = this.wrapSession(session, approval);
      } catch (error) {
        await session.close().catch((closeError: unknown) => {
          this.log("Failed to close a rejected session", closeError);
        });
        throw error;
      }
    }
    runtime.subscribe(webviewId);
    this.sessionByView.set(webviewId, runtime.id);
    await runtime.announceStatus(webviewId);
    return runtime;
  }

  async detachView(webviewId: string): Promise<void> {
    const id = this.sessionByView.get(webviewId);
    if (id === undefined) return;
    this.sessionByView.delete(webviewId);
    const runtime = this.sessions.get(id);
    if (runtime === undefined) return;
    runtime.unsubscribeView(webviewId);
    if (runtime.subscribers.length === 0) {
      this.sessions.delete(id);
      await runtime.close();
    }
  }

  async closeSession(id: string): Promise<void> {
    const runtime = this.sessions.get(id);
    if (runtime === undefined) {
      await this.harness.closeSession(id);
      return;
    }
    this.sessions.delete(id);
    for (const webviewId of runtime.subscribers) {
      this.sessionByView.delete(webviewId);
    }
    await runtime.close();
  }

  async deleteSession(id: string): Promise<void> {
    await this.closeSession(id);
    await this.harness.deleteSession(id);
  }

  /**
   * Push the persisted `[secondary_model]` recipe into every live session
   * (mirrors the TUI's persist-then-apply in /secondary_model). The v2 SDK
   * removed this API — its sessions read the recipe from config at spawn —
   * so the call is optional and only fires on the legacy v1 harness.
   */
  async applyPersistedSecondaryModelToActiveSessions(): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].map((session) => {
        const legacy = session.session as Session & { applyPersistedSecondaryModel?: () => Promise<void> };
        return legacy.applyPersistedSecondaryModel?.();
      }),
    );
  }

  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.all([...this.sessions.values()].map((session) => session.close()));
    this.sessions.clear();
    this.sessionByView.clear();
    await this.harness.close();
  }

  private wrapSession(session: Session, legacyApproval: LegacyApprovalFlags): SessionRuntime {
    const runtime = new SessionRuntime({
      session,
      legacyApproval,
      broadcast: this.broadcast,
      captureBaseline: this.captureBaseline,
      log: this.log,
    });
    this.sessions.set(session.id, runtime);
    return runtime;
  }

  private async readMigratedLegacyApproval(
    session: Session,
  ): Promise<LegacyApprovalFlags | undefined> {
    const metadata = session.summary?.metadata;
    try {
      return await readMigratedLegacyApprovalFlags(metadata);
    } catch (error) {
      this.log("Unable to restore legacy session approval settings", error);
      return undefined;
    }
  }

  /**
   * Gate the secondary-model experiment on so subagents can bind a separately
   * configured model (the TUI gates /secondary_model on the same flag). Lazy
   * and serialized with the first session flow: a config write racing an
   * unrelated write from another client sharing this home would interleave
   * v1's whole-document read-merge-write and clobber it, so the flag is
   * persisted on first use rather than fire-and-forget at construction, and
   * skipped entirely once already set. A failed write (e.g. a broken
   * config.toml) is logged, never fatal.
   */
  private enableSecondaryModelExperiment(): Promise<void> {
    this.experimentGate ??= (async () => {
      try {
        const config = await this.harness.getConfig();
        if (config.experimental?.["secondary-model"] === true) return;
        await this.harness.setConfig({ experimental: { "secondary-model": true } });
      } catch (error) {
        this.log("Unable to enable the secondary-model experiment", error);
      }
    })();
    return this.experimentGate;
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error("Kimi runtime is closed.");
  }
}

async function applySessionSettings(
  session: Session,
  options: OpenSessionOptions,
  legacyApproval: LegacyApprovalFlags,
): Promise<void> {
  const status = await session.getStatus();
  // Model and thinking effort are applied only when the session is created
  // (see openSession). An existing session keeps its own — the global config
  // values are defaults for new sessions, matching CLI/TUI resume semantics.
  // Changes made in the pickers reach the active session through the
  // SaveConfig handler instead.
  const permission = corePermissionForLegacyApproval(legacyApproval);
  if (status.permission !== permission) {
    await session.setPermission(permission);
  }
}

export function normalizeEffort(effort: string): ThinkingEffort {
  // Empty effort means "no explicit choice": new sessions default to high.
  // Models without a "high" tier fall back to their own default in the
  // engine; the Webview display follows the session's announced status.
  return (effort.trim() || "high") as ThinkingEffort;
}

function assertSessionWorkDir(session: Pick<Session, "workDir">, expectedWorkDir: string): void {
  if (!areSameFsPath(session.workDir, expectedWorkDir)) {
    throw new Error("The selected session belongs to a different working directory.");
  }
}
