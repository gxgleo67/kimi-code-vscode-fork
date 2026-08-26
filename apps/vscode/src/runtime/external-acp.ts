import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface, type Interface } from "node:readline";

import { Events, Methods } from "../../shared/bridge";
import type { ContentPart, SessionInfo } from "../../shared/legacy-sdk";

interface JsonObject {
  [key: string]: unknown;
}

interface JsonRpcMessage extends JsonObject {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

interface ExternalAcpSession {
  readonly id: string;
  readonly workDir: string;
  updatedAt: number;
  title?: string;
  history: Array<Record<string, unknown>>;
  active: boolean;
  toolArgs: Map<string, string>;
}

interface ExternalTerminal {
  readonly id: string;
  readonly sessionId: string;
  readonly child: ChildProcessWithoutNullStreams;
  readonly outputByteLimit: number;
  output: string;
  truncated: boolean;
  exitCode: number | null | undefined;
  signal: string | null | undefined;
  readonly exited: Promise<void>;
}

export interface ExternalAcpConfig {
  readonly command: string;
  readonly target: string;
  readonly accounts: readonly string[];
}

export interface ExternalAcpContext {
  readonly webviewId: string;
  readonly workDir: string | null;
  readonly workspaceRoot: string | null;
  readonly broadcast: (event: string, data: unknown, webviewId?: string) => void;
  readonly saveAllDirty: () => Promise<void>;
}

const ROUTED_METHODS = new Set<string>([
  Methods.CheckLoginStatus,
  Methods.Login,
  Methods.Logout,
  Methods.GetManagedUsage,
  Methods.GetModels,
  Methods.SaveConfig,
  Methods.AddCustomProvider,
  Methods.RemoveCustomProvider,
  Methods.GetCustomProvider,
  Methods.GetSlashCommands,
  Methods.GetMCPServers,
  Methods.AddMCPServer,
  Methods.UpdateMCPServer,
  Methods.RemoveMCPServer,
  Methods.AuthMCP,
  Methods.ResetAuthMCP,
  Methods.TestMCP,
  Methods.StreamChat,
  Methods.AbortChat,
  Methods.ResetSession,
  Methods.SetPlanMode,
  Methods.SetPermissionMode,
  Methods.SetSwarmMode,
  Methods.GetGoalState,
  Methods.CreateGoal,
  Methods.ControlGoal,
  Methods.GetBackgroundTasks,
  Methods.GetSessionContext,
  Methods.SteerChat,
  Methods.RespondApproval,
  Methods.RespondQuestion,
  Methods.GetKimiSessions,
  Methods.GetAllKimiSessions,
  Methods.GetRegisteredWorkDirs,
  Methods.LoadKimiSessionHistory,
  Methods.GetLiveSession,
  Methods.DeleteKimiSession,
  Methods.RenameKimiSession,
  Methods.ForkKimiSession,
]);

/**
 * Minimal ACP client used by the VS Code fork when the external backend is
 * selected. It deliberately keeps the wire layer independent from the SDK so
 * the router remains the sole owner of account selection and token refresh.
 */
export class ExternalAcpBackend {
  private client: AcpProcess | undefined;
  private readonly sessions = new Map<string, ExternalAcpSession>();
  private readonly sessionByWebview = new Map<string, string>();
  private readonly contexts = new Map<string, ExternalAcpContext>();
  private readonly terminals = new Map<string, ExternalTerminal>();
  private readonly pendingPermissions = new Map<
    string,
    { resolve: (value: JsonObject) => void; reject: (error: Error) => void; context: ExternalAcpContext; params: JsonObject }
  >();
  private readonly config: ExternalAcpConfig;
  private readonly log: (message: string, error?: unknown) => void;
  private closed = false;

  constructor(config: ExternalAcpConfig, log: (message: string, error?: unknown) => void) {
    this.config = config;
    this.log = log;
  }

  handles(method: string): boolean {
    return ROUTED_METHODS.has(method);
  }

  async handle(method: string, params: any, context: ExternalAcpContext): Promise<unknown> {
    this.contexts.set(context.webviewId, context);
    switch (method) {
      case Methods.CheckLoginStatus:
        await this.ensureClient();
        return { loggedIn: true };
      case Methods.Login:
      case Methods.Logout:
        throw new Error("登录状态由 Kimi Subscription Router 管理，请在 Kimi CLI 中完成登录或切换账号。");
      case Methods.GetManagedUsage:
        return { ok: false, error: "外部 ACP backend 不提供独立用量接口。" };
      case Methods.GetModels:
        return externalModelConfig();
      case Methods.SaveConfig:
        throw new Error("外部 ACP backend 的模型和思考设置由 Kimi CLI 配置管理。");
      case Methods.AddCustomProvider:
      case Methods.RemoveCustomProvider:
      case Methods.GetCustomProvider:
      case Methods.SetPermissionMode:
        throw new Error("外部 ACP backend 的模型、权限和 provider 由 Kimi CLI 配置管理。");
      case Methods.GetSlashCommands:
        return [];
      case Methods.GetMCPServers:
        return [];
      case Methods.AddMCPServer:
      case Methods.UpdateMCPServer:
      case Methods.RemoveMCPServer:
      case Methods.AuthMCP:
      case Methods.ResetAuthMCP:
      case Methods.TestMCP:
        throw new Error("外部 ACP backend 不支持在 VS Code 中管理 MCP，请使用 Kimi CLI 配置。");
      case Methods.StreamChat:
        return this.streamChat(params, context);
      case Methods.AbortChat:
        return this.abortChat(context);
      case Methods.ResetSession:
        await this.resetSession(context.webviewId);
        return { ok: true };
      case Methods.SetPlanMode:
      case Methods.SetSwarmMode:
      case Methods.GetGoalState:
      case Methods.CreateGoal:
      case Methods.ControlGoal:
      case Methods.GetBackgroundTasks:
      case Methods.GetSessionContext:
      case Methods.SteerChat:
        throw new Error("外部 ACP backend 尚未暴露该 SDK 专属能力。");
      case Methods.RespondApproval:
        return this.respondApproval(params);
      case Methods.RespondQuestion:
        return { ok: false };
      case Methods.GetKimiSessions:
      case Methods.GetAllKimiSessions:
        return this.listSessions(context);
      case Methods.GetRegisteredWorkDirs:
        return this.listWorkDirs(context);
      case Methods.LoadKimiSessionHistory:
        return this.loadSessionHistory(params.kimiSessionId, context);
      case Methods.GetLiveSession:
        return { sessionId: this.sessionByWebview.get(context.webviewId) ?? null };
      case Methods.DeleteKimiSession:
        return this.deleteSession(params.sessionId, context);
      case Methods.RenameKimiSession:
        throw new Error("外部 ACP backend 不支持重命名会话。");
      case Methods.ForkKimiSession:
        throw new Error("外部 ACP backend 不支持 fork 会话。");
      default:
        throw new Error(`Unsupported external ACP method: ${method}`);
    }
  }

  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pendingPermissions.values()) {
      pending.resolve({ outcome: { outcome: "cancelled" } });
    }
    this.pendingPermissions.clear();
    for (const terminal of this.terminals.values()) {
      if (terminal.exitCode === undefined && terminal.signal === undefined) terminal.child.kill();
    }
    this.terminals.clear();
    await this.client?.close();
    this.client = undefined;
    this.sessions.clear();
    this.sessionByWebview.clear();
    this.contexts.clear();
  }

  async disposeView(webviewId: string): Promise<void> {
    const sessionId = this.sessionByWebview.get(webviewId);
    if (sessionId !== undefined) {
      const session = this.sessions.get(sessionId);
      if (session?.active === true && this.client !== undefined && this.client.isAlive) {
        await this.client.notify("session/cancel", { sessionId }).catch(() => undefined);
      }
      for (const [terminalId, terminal] of this.terminals) {
        if (terminal.sessionId === sessionId) {
          if (terminal.exitCode === undefined && terminal.signal === undefined) terminal.child.kill();
          this.terminals.delete(terminalId);
        }
      }
      this.sessionByWebview.delete(webviewId);
    }
    this.contexts.delete(webviewId);
  }

  private async streamChat(params: {
    content: string | ContentPart[];
    model?: string;
    sessionId?: string;
  }, context: ExternalAcpContext): Promise<{ done: boolean }> {
    if (!context.workDir) {
      this.emitError(context, "NO_WORKSPACE", "请先打开一个工作区。", "preflight");
      return { done: false };
    }
    await context.saveAllDirty();
    const session = await this.ensureSession(params.sessionId, context);
    const prompt = contentToAcpBlocks(params.content);
    session.active = true;
    session.updatedAt = Date.now();
    this.emit(context, session, "TurnBegin", { user_input: params.content });
    this.emit(context, session, "StepBegin", { n: 1 });
    try {
      const result = await (await this.ensureClient()).request("session/prompt", {
        sessionId: session.id,
        prompt,
      });
      session.active = false;
      const stopReason = isObject(result) && result["stopReason"] === "cancelled" ? "cancelled" : "finished";
      this.emit(context, session, "stream_complete", { result: { status: stopReason } });
      return { done: stopReason === "finished" };
    } catch (error) {
      session.active = false;
      this.emitError(context, "external_acp", error instanceof Error ? error.message : String(error), "runtime", session.id);
      this.emit(context, session, "stream_complete", { result: { status: "failed" } });
      return { done: false };
    }
  }

  private async abortChat(context: ExternalAcpContext): Promise<{ aborted: boolean }> {
    const sessionId = this.sessionByWebview.get(context.webviewId);
    const session = sessionId === undefined ? undefined : this.sessions.get(sessionId);
    if (session === undefined || !session.active) return { aborted: false };
    await (await this.ensureClient()).notify("session/cancel", { sessionId: session.id });
    session.active = false;
    this.emit(context, session, "stream_complete", { result: { status: "cancelled" } });
    return { aborted: true };
  }

  private async ensureSession(sessionId: string | undefined, context: ExternalAcpContext): Promise<ExternalAcpSession> {
    const workDir = context.workDir;
    if (workDir === null) throw new Error("请先打开一个工作区。");
    if (sessionId !== undefined) {
      const existing = this.sessions.get(sessionId);
      if (existing !== undefined) {
        if (existing.workDir !== workDir) throw new Error("所选会话属于另一个工作目录。");
        this.sessionByWebview.set(context.webviewId, existing.id);
        return existing;
      }
      const placeholder: ExternalAcpSession = {
        id: sessionId,
        workDir,
        updatedAt: Date.now(),
        history: [],
        active: false,
        toolArgs: new Map(),
      };
      // Register before requesting the replay: ACP servers may emit
      // session/update notifications before the session/load response.
      this.sessions.set(sessionId, placeholder);
      this.sessionByWebview.set(context.webviewId, sessionId);
      try {
        const loaded = await (await this.ensureClient()).request("session/load", {
          sessionId,
          cwd: workDir,
          mcpServers: [],
        });
        const session = this.sessionFromResponse(loaded, sessionId, workDir);
        session.history = placeholder.history;
        session.toolArgs = placeholder.toolArgs;
        this.sessions.set(session.id, session);
        this.sessionByWebview.set(context.webviewId, session.id);
        return session;
      } catch (error) {
        this.sessions.delete(sessionId);
        if (this.sessionByWebview.get(context.webviewId) === sessionId) this.sessionByWebview.delete(context.webviewId);
        throw error;
      }
    }
    const currentId = this.sessionByWebview.get(context.webviewId);
    if (currentId !== undefined) {
      const current = this.sessions.get(currentId);
      if (current !== undefined && current.workDir === workDir) return current;
    }
    const result = await (await this.ensureClient()).request("session/new", {
      cwd: workDir,
      mcpServers: [],
    });
    const session = this.sessionFromResponse(result, undefined, workDir);
    this.sessions.set(session.id, session);
    this.sessionByWebview.set(context.webviewId, session.id);
    this.emit(context, session, "session_start", { sessionId: session.id });
    return session;
  }

  private async listSessions(context: ExternalAcpContext): Promise<SessionInfo[]> {
    const result = await (await this.ensureClient()).request("session/list", {
      cwd: context.workspaceRoot ?? context.workDir ?? undefined,
    });
    const rows = isObject(result) && Array.isArray(result["sessions"]) ? result["sessions"] : Array.isArray(result) ? result : [];
    return rows.filter(isObject).map((row) => {
      const id = stringValue(row["sessionId"]) ?? stringValue(row["id"]) ?? "";
      const workDir = stringValue(row["cwd"]) ?? stringValue(row["workDir"]) ?? context.workDir ?? "";
      const title = stringValue(row["title"]);
      return {
        id,
        workDir,
        updatedAt: numberValue(row["updatedAt"]) ?? Date.now(),
        brief: title ?? id,
      };
    }).filter((row) => row.id.length > 0 && (context.workspaceRoot === null || isInside(row.workDir, context.workspaceRoot)));
  }

  private async listWorkDirs(context: ExternalAcpContext): Promise<string[]> {
    const sessions = await this.listSessions(context);
    return [...new Set(sessions.map((session) => session.workDir))].toSorted();
  }

  private async loadSessionHistory(sessionId: string, context: ExternalAcpContext): Promise<Array<Record<string, unknown>>> {
    const session = this.sessions.get(sessionId);
    if (session !== undefined) return session.history;
    await this.ensureSession(sessionId, context);
    return this.sessions.get(sessionId)?.history ?? [];
  }

  private async deleteSession(sessionId: string, context: ExternalAcpContext): Promise<{ ok: boolean }> {
    await (await this.ensureClient()).request("session/delete", { sessionId });
    this.sessions.delete(sessionId);
    for (const [webviewId, id] of this.sessionByWebview) {
      if (id === sessionId) this.sessionByWebview.delete(webviewId);
    }
    return { ok: true };
  }

  private async resetSession(webviewId: string): Promise<void> {
    const sessionId = this.sessionByWebview.get(webviewId);
    if (sessionId !== undefined) {
      const session = this.sessions.get(sessionId);
      if (session?.active === true) await (await this.ensureClient()).notify("session/cancel", { sessionId });
      this.sessionByWebview.delete(webviewId);
    }
  }

  private async respondApproval(params: { requestId: string; response: unknown }): Promise<{ ok: boolean }> {
    const pending = this.pendingPermissions.get(params.requestId);
    if (pending === undefined) return { ok: false };
    const response = isObject(params.response) ? params.response : { decision: params.response };
    const decision = response["decision"];
    const options = Array.isArray(pending.params["options"]) ? pending.params["options"].filter(isObject) : [];
    const selected = options.find((option) => option["kind"] === (decision === "approve_for_session" ? "allow_always" : "allow_once")) ?? options[0];
    pending.resolve(decision === "reject"
      ? { outcome: { outcome: "cancelled" } }
      : { outcome: { outcome: "selected", optionId: stringValue(selected?.["optionId"]) ?? "allow" } });
    this.pendingPermissions.delete(params.requestId);
    return { ok: true };
  }

  private async ensureClient(): Promise<AcpProcess> {
    if (this.closed) throw new Error("外部 ACP backend 已关闭。");
    if (this.client !== undefined && this.client.isAlive) return this.client;
    this.client = undefined;
    const args = buildExternalAcpArgs(this.config);
    const client = new AcpProcess(
      this.config.command,
      args,
      this.log,
      (message) => this.onMessage(message),
      (message) => this.handleClientRequest(message),
      (error) => this.onClientExit(error),
    );
    this.client = client;
    try {
      await client.start();
      return client;
    } catch (error) {
      this.client = undefined;
      await client.close();
      throw error;
    }
  }

  private onMessage(message: JsonRpcMessage): void {
    if (message.method === "session/update" && isObject(message.params)) {
      this.onSessionUpdate(message.params);
      return;
    }
  }

  private onClientExit(error: Error): void {
    for (const pending of this.pendingPermissions.values()) pending.reject(error);
    this.pendingPermissions.clear();
    if (!this.closed) this.log("外部 ACP 进程已退出", error);
  }

  private async handleClientRequest(message: JsonRpcMessage): Promise<unknown> {
    if (!isObject(message.params)) throw new Error("ACP 请求缺少 params。");
    switch (message.method) {
      case "session/request_permission":
        return this.requestPermission(message);
      case "fs/read_text_file":
        return this.readTextFile(message.params);
      case "fs/write_text_file":
        return this.writeTextFile(message.params);
      case "terminal/create":
        return this.createTerminal(message.params);
      case "terminal/output":
        return this.terminalOutput(message.params);
      case "terminal/wait_for_exit":
        return this.waitForTerminal(message.params);
      case "terminal/kill":
        return this.killTerminal(message.params);
      case "terminal/release":
        return this.releaseTerminal(message.params);
      default:
        throw new Error(`外部 ACP 请求未支持: ${message.method ?? "unknown"}`);
    }
  }

  private requestPermission(message: JsonRpcMessage): Promise<JsonObject> {
    const params = message.params as JsonObject;
    const sessionId = stringValue(params["sessionId"]);
    const session = sessionId === undefined ? undefined : this.sessions.get(sessionId);
    if (session === undefined) return Promise.reject(new Error("ACP permission request 的 session 不存在。"));
    const webviewId = [...this.sessionByWebview.entries()].find(([, id]) => id === session.id)?.[0];
    if (webviewId === undefined) return Promise.reject(new Error("ACP permission request 没有对应的 webview。"));
    const requestId = String(message.id);
    const context = this.contexts.get(webviewId);
    if (context === undefined) return Promise.reject(new Error("ACP permission request 没有对应的上下文。"));
    return new Promise<JsonObject>((resolve, reject) => {
      this.pendingPermissions.set(requestId, { resolve, reject, context, params });
      const toolCall = isObject(params["toolCall"]) ? params["toolCall"] : {};
      context.broadcast(Events.StreamEvent, {
        type: "ApprovalRequest",
        payload: {
          id: requestId,
          tool_call_id: stringValue(toolCall["toolCallId"]) ?? "",
          sender: "Kimi ACP",
          action: stringValue(toolCall["title"]) ?? "Tool call",
          description: stringValue(toolCall["title"]) ?? "Kimi ACP 请求执行工具操作。",
        },
      }, webviewId);
    });
  }

  private async readTextFile(params: JsonObject): Promise<{ content: string }> {
    const session = this.requireSession(params);
    const path = await this.resolveWorkspacePath(session, stringValue(params["path"]), false);
    let content = await readFile(path, "utf8");
    const line = numberValue(params["line"]);
    const limit = numberValue(params["limit"]);
    if (line !== undefined && line > 0) content = content.split(/\r?\n/).slice(line - 1).join("\n");
    if (limit !== undefined) content = content.split(/\r?\n/).slice(0, limit).join("\n");
    return { content };
  }

  private async writeTextFile(params: JsonObject): Promise<Record<string, never>> {
    const session = this.requireSession(params);
    const path = await this.resolveWorkspacePath(session, stringValue(params["path"]), true);
    const content = params["content"];
    if (typeof content !== "string") throw new Error("ACP 写文件请求缺少字符串 content。");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
    return {};
  }

  private async createTerminal(params: JsonObject): Promise<{ terminalId: string }> {
    const session = this.requireSession(params);
    const command = stringValue(params["command"]);
    if (command === undefined) throw new Error("ACP terminal/create 请求缺少 command。");
    const requestedCwd = stringValue(params["cwd"]) ?? session.workDir;
    const cwd = await this.resolveWorkspacePath(session, requestedCwd, false);
    const args = Array.isArray(params["args"]) ? params["args"].filter((value): value is string => typeof value === "string") : [];
    const env = { ...process.env };
    if (Array.isArray(params["env"])) {
      for (const entry of params["env"].filter(isObject)) {
        const name = stringValue(entry["name"]);
        const value = entry["value"];
        if (name !== undefined && typeof value === "string") env[name] = value;
      }
    }
    const child = spawn(command, args, { cwd, env, shell: false, stdio: "pipe" });
    const terminalId = randomUUID();
    const outputByteLimit = numberValue(params["outputByteLimit"]) ?? 1024 * 1024;
    let resolveExit!: () => void;
    const exited = new Promise<void>((resolve) => { resolveExit = resolve; });
    const terminal: ExternalTerminal = {
      id: terminalId,
      sessionId: session.id,
      child,
      outputByteLimit: Math.max(0, outputByteLimit),
      output: "",
      truncated: false,
      exitCode: undefined,
      signal: undefined,
      exited,
    };
    const append = (chunk: Buffer | string) => appendTerminalOutput(terminal, chunk);
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => {
      append(error.message);
      terminal.exitCode = null;
      terminal.signal = null;
      resolveExit();
    });
    child.on("close", (code, signal) => {
      terminal.exitCode = code;
      terminal.signal = signal;
      resolveExit();
    });
    this.terminals.set(terminalId, terminal);
    return { terminalId };
  }

  private terminalOutput(params: JsonObject): { output: string; truncated: boolean; exitStatus?: JsonObject } {
    const terminal = this.requireTerminal(params);
    return {
      output: terminal.output,
      truncated: terminal.truncated,
      ...(terminal.exitCode !== undefined || terminal.signal !== undefined
        ? { exitStatus: { exitCode: terminal.exitCode ?? null, signal: terminal.signal ?? null } }
        : {}),
    };
  }

  private async waitForTerminal(params: JsonObject): Promise<JsonObject> {
    const terminal = this.requireTerminal(params);
    await terminal.exited;
    return { exitCode: terminal.exitCode ?? null, signal: terminal.signal ?? null };
  }

  private killTerminal(params: JsonObject): Record<string, never> {
    const terminal = this.requireTerminal(params);
    if (terminal.exitCode === undefined && terminal.signal === undefined) terminal.child.kill();
    return {};
  }

  private releaseTerminal(params: JsonObject): Record<string, never> {
    const terminal = this.requireTerminal(params);
    if (terminal.exitCode === undefined && terminal.signal === undefined) terminal.child.kill();
    this.terminals.delete(terminal.id);
    return {};
  }

  private requireSession(params: JsonObject): ExternalAcpSession {
    const sessionId = stringValue(params["sessionId"]);
    const session = sessionId === undefined ? undefined : this.sessions.get(sessionId);
    if (session === undefined) throw new Error("ACP 请求的 session 不存在。");
    return session;
  }

  private requireTerminal(params: JsonObject): ExternalTerminal {
    const terminalId = stringValue(params["terminalId"]);
    const terminal = terminalId === undefined ? undefined : this.terminals.get(terminalId);
    const sessionId = stringValue(params["sessionId"]);
    if (terminal === undefined || terminal.sessionId !== sessionId) throw new Error("ACP 请求的 terminal 不存在。");
    return terminal;
  }

  private async resolveWorkspacePath(session: ExternalAcpSession, requested: string | undefined, allowMissing: boolean): Promise<string> {
    if (requested === undefined || !isAbsolute(requested)) throw new Error("ACP 文件路径必须是绝对路径。");
    const candidate = resolve(requested);
    const root = resolve(session.workDir);
    if (!isInside(candidate, root)) throw new Error("ACP 文件或终端目录必须位于工作区内。");
    const realRoot = await realpath(root);
    let realCandidate: string;
    try {
      realCandidate = await realpath(candidate);
    } catch (error) {
      if (!allowMissing) throw error;
      realCandidate = join(await realpathForMissingPath(dirname(candidate)), basename(candidate));
    }
    if (!isInside(realCandidate, realRoot)) throw new Error("ACP 路径不能通过符号链接离开工作区。");
    return candidate;
  }

  private onSessionUpdate(params: JsonObject): void {
    const sessionId = stringValue(params["sessionId"]);
    const update = isObject(params["update"]) ? params["update"] : undefined;
    if (sessionId === undefined || update === undefined) return;
    const session = this.sessions.get(sessionId);
    if (session === undefined) return;
    const webviewId = [...this.sessionByWebview.entries()].find(([, id]) => id === session.id)?.[0];
    if (webviewId === undefined) return;
    const context = this.contexts.get(webviewId);
    if (context === undefined) return;
    const kind = stringValue(update["sessionUpdate"]);
    switch (kind) {
      case "agent_message_chunk":
        this.emit(context, session, "ContentPart", { type: "text", text: textFromContent(update["content"]) });
        break;
      case "agent_thought_chunk":
        this.emit(context, session, "ContentPart", { type: "think", think: textFromContent(update["content"]) });
        break;
      case "tool_call": {
        const id = stringValue(update["toolCallId"]) ?? "tool";
        const args = update["rawInput"] === undefined ? null : JSON.stringify(update["rawInput"]);
        session.toolArgs.set(id, args ?? "");
        this.emit(context, session, "ToolCall", {
          type: "function",
          id,
          function: { name: stringValue(update["title"]) ?? "Tool", arguments: args },
        });
        break;
      }
      case "tool_call_update": {
        const id = stringValue(update["toolCallId"]) ?? "tool";
        const text = textFromContent(update["content"]);
        const previous = session.toolArgs.get(id) ?? "";
        if (text.length > previous.length && update["status"] !== "completed" && update["status"] !== "failed") {
          session.toolArgs.set(id, text);
          this.emit(context, session, "ToolCallPart", { tool_call_id: id, arguments_part: text.slice(previous.length) });
        }
        if (update["status"] === "completed" || update["status"] === "failed") {
          this.emit(context, session, "ToolResult", {
            tool_call_id: id,
            return_value: {
              is_error: update["status"] === "failed",
              output: text,
              message: text,
              display: [],
            },
          });
        }
        break;
      }
      case "usage_update": {
        const usage = isObject(update["usage"]) ? update["usage"] : {};
        this.emit(context, session, "StatusUpdate", {
          token_usage: {
            input_other: numberValue(usage["inputTokens"]) ?? 0,
            output: numberValue(usage["outputTokens"]) ?? 0,
            input_cache_read: numberValue(usage["cacheReadTokens"]) ?? 0,
            input_cache_creation: numberValue(usage["cacheCreationTokens"]) ?? 0,
          },
        });
        break;
      }
      default:
        break;
    }
  }

  private sessionFromResponse(result: unknown, fallbackId: string | undefined, workDir: string): ExternalAcpSession {
    const object = isObject(result) ? result : {};
    const id = stringValue(object["sessionId"]) ?? fallbackId;
    if (id === undefined || id.length === 0) throw new Error("ACP 未返回有效 sessionId。");
    return { id, workDir, updatedAt: Date.now(), history: [], active: false, toolArgs: new Map() };
  }

  private emit(context: ExternalAcpContext, session: ExternalAcpSession, type: string, payload: unknown): void {
    const event = type === "session_start" || type === "stream_complete"
      ? { type, ...(payload as JsonObject), _sessionId: session.id }
      : { type, payload, _sessionId: session.id };
    session.history.push(event);
    context.broadcast(Events.StreamEvent, event, context.webviewId);
  }

  private emitError(context: ExternalAcpContext, code: string, message: string, phase: "preflight" | "runtime", sessionId?: string): void {
    context.broadcast(Events.StreamEvent, { type: "error", code, message, phase, ...(sessionId === undefined ? {} : { _sessionId: sessionId }) }, context.webviewId);
  }
}

class AcpProcess {
  private child: ChildProcessWithoutNullStreams | undefined;
  private exited = false;
  private lines: Interface | undefined;
  private nextId = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly onMessageCallback: (message: JsonRpcMessage) => void;
  private readonly onRequestCallback: (message: JsonRpcMessage) => Promise<unknown>;
  private readonly onExitCallback: (error: Error) => void;
  private readonly log: (message: string, error?: unknown) => void;
  private readonly command: string;
  private readonly args: readonly string[];

  constructor(
    command: string,
    args: readonly string[],
    log: (message: string, error?: unknown) => void,
    onMessage: (message: JsonRpcMessage) => void,
    onRequest: (message: JsonRpcMessage) => Promise<unknown>,
    onExit: (error: Error) => void,
  ) {
    this.command = command;
    this.args = args;
    this.log = log;
    this.onMessageCallback = onMessage;
    this.onRequestCallback = onRequest;
    this.onExitCallback = onExit;
  }

  get isAlive(): boolean {
    return this.child !== undefined && !this.exited && !this.child.killed;
  }

  async start(): Promise<void> {
    this.child = spawn(this.command, [...this.args], { stdio: "pipe", shell: false });
    this.child.stderr.on("data", (chunk) => this.log(`external ACP: ${String(chunk).trimEnd()}`));
    this.child.on("error", (error) => {
      this.exited = true;
      this.failPending(error);
      this.onExitCallback(error);
    });
    this.child.on("exit", (code, signal) => {
      this.exited = true;
      const error = new Error(`外部 ACP 进程已退出 (${code ?? signal ?? "unknown"})。`);
      this.failPending(error);
      this.onExitCallback(error);
    });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => this.receive(line));
    await this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      clientInfo: { name: "Kimi Code VS Code Fork", version: "0.8.6" },
    });
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = ++this.nextId;
    const message = JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
    return new Promise((resolve, reject) => {
      const child = this.child;
      if (child === undefined || child.stdin.destroyed) {
        reject(new Error("外部 ACP 进程不可用。"));
        return;
      }
      this.pending.set(String(id), { resolve, reject });
      child.stdin.write(`${message}\n`, (error) => {
        if (error !== undefined && error !== null) {
          this.pending.delete(String(id));
          reject(error);
        }
      });
    });
  }

  notify(method: string, params?: unknown): Promise<void> {
    const child = this.child;
    if (child === undefined || child.stdin.destroyed) return Promise.reject(new Error("外部 ACP 进程不可用。"));
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) })}\n`);
    return Promise.resolve();
  }

  respond(id: string | number, result: unknown): void {
    const child = this.child;
    if (child === undefined || child.stdin.destroyed) return;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
  }

  async close(): Promise<void> {
    this.lines?.close();
    this.failPending(new Error("外部 ACP backend 已关闭。"));
    const child = this.child;
    this.child = undefined;
    if (child === undefined) return;
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill();
    await new Promise<void>((resolve) => child.once("close", () => resolve()));
  }

  private receive(line: string): void {
    if (line.trim().length === 0) return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch (error) {
      this.log("external ACP returned invalid JSON", error);
      return;
    }
    if (message.id !== undefined && message.id !== null && (message.result !== undefined || message.error !== undefined)) {
      const key = String(message.id);
      const pending = this.pending.get(key);
      if (pending === undefined) return;
      this.pending.delete(key);
      if (message.error !== undefined) {
        pending.reject(new Error(message.error.message ?? `ACP request failed (${message.error.code ?? "unknown"})`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method !== undefined && message.id !== undefined && message.id !== null) {
      void this.onRequestCallback(message)
        .then((result) => this.respond(message.id!, result))
        .catch((error) => this.respondError(message.id!, error));
      return;
    }
    this.onMessageCallback(message);
  }

  private respondError(id: string | number, error: unknown): void {
    const child = this.child;
    if (child === undefined || child.stdin.destroyed) return;
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
    })}\n`);
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function externalModelConfig(): { defaultModel: string; defaultThinking: boolean; defaultThinkingEffort: string; models: Array<Record<string, unknown>> } {
  return {
    defaultModel: "kimi-k2",
    defaultThinking: true,
    defaultThinkingEffort: "high",
    models: [{ id: "kimi-k2", name: "Kimi (external ACP)", provider: "kimi", capabilities: ["text", "tools"], support_efforts: ["off", "low", "medium", "high"], default_effort: "high" }],
  };
}

export function buildExternalAcpArgs(config: ExternalAcpConfig): string[] {
  if (!isValidAcpTarget(config.target)) {
    throw new Error("ACP target 必须是 1-64 个小写字母、数字、点、下划线或连字符，并以字母或数字结尾。");
  }
  const accounts = [...new Set(config.accounts.map((account) => account.trim()).filter((account) => account.length > 0))];
  for (const account of accounts) {
    if (!isValidAcpAccount(account)) {
      throw new Error("ACP account ID 不能包含控制字符或以连字符开头。");
    }
  }
  return ["--target", config.target, ...accounts.flatMap((account) => ["--account", account])];
}

export function isValidAcpAccount(account: string): boolean {
  return account.length > 0 && !account.startsWith("-") && !/[\u0000-\u001f\u007f]/.test(account);
}

export function isValidAcpTarget(target: string): boolean {
  return /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(target)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(target);
}

export function contentToAcpBlocks(content: string | ContentPart[]): Array<Record<string, unknown>> {
  if (typeof content === "string") return [{ type: "text", text: content }];
  const blocks: Array<Record<string, unknown>> = [];
  for (const part of content) {
    if (part.type === "text") blocks.push({ type: "text", text: part.text });
    else if (part.type === "image_url" && part.image_url.url.startsWith("data:")) {
      const match = /^data:([^;,]+);base64,(.*)$/s.exec(part.image_url.url);
      if (match) blocks.push({ type: "image", data: match[2], mimeType: match[1] });
    }
  }
  return blocks.length === 0 ? [{ type: "text", text: "(VS Code 提交的媒体内容无法由当前 ACP backend 传递。)" }] : blocks;
}

function textFromContent(value: unknown): string {
  if (isObject(value) && value["type"] === "text" && typeof value["text"] === "string") return value["text"];
  if (!Array.isArray(value)) return "";
  return value.filter(isObject).map((part) => textFromContent(part["content"] ?? part)).join("");
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isInside(path: string, root: string): boolean {
  const normalizedRoot = root.replace(/[\\/]$/, "");
  const normalizedPath = path.replace(/[\\/]$/, "");
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`) || normalizedPath.startsWith(`${normalizedRoot}\\`);
}

async function realpathForMissingPath(path: string): Promise<string> {
  let current = path;
  const suffix: string[] = [];
  while (true) {
    try {
      const resolved = await realpath(current);
      return suffix.reverse().reduce((parent, part) => join(parent, part), resolved);
    } catch (error) {
      const parent = dirname(current);
      if (parent === current) throw error;
      suffix.push(basename(current));
      current = parent;
    }
  }
}

function appendTerminalOutput(terminal: ExternalTerminal, chunk: Buffer | string): void {
  const combined = terminal.output + chunk.toString();
  const limit = terminal.outputByteLimit;
  if (Buffer.byteLength(combined, "utf8") <= limit) {
    terminal.output = combined;
    return;
  }
  const bytes = Buffer.from(combined, "utf8");
  terminal.output = bytes.subarray(Math.max(0, bytes.length - limit)).toString("utf8");
  terminal.truncated = true;
}
