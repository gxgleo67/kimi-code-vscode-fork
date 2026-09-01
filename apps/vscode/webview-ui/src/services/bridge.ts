import { Methods, Events } from "shared/bridge";
import type {
  AddCustomProviderParams,
  ApprovalResponse,
  BackgroundTaskItem,
  ContentPart,
  CustomProviderDetails,
  GoalStateInfo,
  MCPServerConfig,
  RemoveCustomProviderParams,
  SessionContextSnapshot,
  SessionInfo,
  KimiConfig,
  MCPTestResult,
  LoginResult,
  UpdateMCPServerRequest,
} from "shared/legacy-sdk";
import type { ManagedUsageResult } from "shared/managed-usage";
import type {
  FileChange,
  SessionConfig,
  ExtensionConfig,
  PermissionMode,
  WorkspaceStatus,
  LoginStatus,
  ManagedAccountInfo,
  AccountAuthResult,
  UIStreamEvent,
} from "shared/types";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const OAUTH_REQUEST_TIMEOUT_MS = 16 * 60 * 1000;
// Turn-length RPCs (StreamChat) resolve only when the whole turn ends, so a
// fixed client-side deadline misfires on long turns — the turn lifecycle is
// already tracked by stream events (TurnBegin / stream_complete / error).
const NO_REQUEST_TIMEOUT_MS = 0;

interface VSCodeAPI {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeAPI;

class Bridge {
  private vscode: VSCodeAPI;
  private pending = new Map<string, PendingRequest>();
  private eventHandlers = new Map<string, Set<(data: unknown) => void>>();
  private requestId = 0;
  private webviewId: string;

  constructor() {
    this.webviewId = document.body.getAttribute("data-webviewid") || `unknown_${Date.now()}`;

    if (typeof acquireVsCodeApi === "function") {
      this.vscode = acquireVsCodeApi();
    } else {
      console.warn("[Kimi Bridge] Running outside VS Code, using mock");
      this.vscode = {
        postMessage: (msg) => console.log("[Kimi Mock]", msg),
        getState: () => undefined,
        setState: () => {},
      };
    }

    window.addEventListener("message", this.handleMessage);
  }

  private handleMessage = (event: MessageEvent) => {
    const msg = event.data;

    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject, timeout } = this.pending.get(msg.id)!;
      clearTimeout(timeout);
      this.pending.delete(msg.id);

      if (msg.error) {
        reject(new Error(msg.error));
      } else {
        resolve(msg.result);
      }
      return;
    }

    if (msg.event) {
      const handlers = this.eventHandlers.get(msg.event);
      handlers?.forEach((h) => h(msg.data));
    }
  };

  private call<T>(method: string, params?: unknown, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
    const id = `${++this.requestId}_${Date.now()}`;

    return new Promise((resolve, reject) => {
      const timeout =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`Bridge ${method} timed out`));
            }, timeoutMs)
          : undefined;

      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timeout });
      this.vscode.postMessage({ id, method, params, webviewId: this.webviewId });
    });
  }

  on<T>(event: string, handler: (data: T) => void): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler as (data: unknown) => void);

    return () => {
      this.eventHandlers.get(event)?.delete(handler as (data: unknown) => void);
    };
  }

  checkWorkspace() {
    return this.call<WorkspaceStatus>(Methods.CheckWorkspace);
  }

  getInputHistory() {
    return this.call<string[]>(Methods.GetInputHistory);
  }

  addInputHistory(text: string) {
    return this.call<{ ok: boolean }>(Methods.AddInputHistory, { text });
  }

  getSlashCommands() {
    return this.call<import("shared/legacy-sdk").SlashCommandInfo[]>(Methods.GetSlashCommands);
  }

  checkLoginStatus() {
    return this.call<LoginStatus>(Methods.CheckLoginStatus);
  }

  login() {
    return this.call<LoginResult>(Methods.Login, undefined, OAUTH_REQUEST_TIMEOUT_MS);
  }

  logout() {
    return this.call<LoginResult>(Methods.Logout);
  }

  getManagedUsage(provider?: string) {
    return this.call<ManagedUsageResult>(Methods.GetManagedUsage, provider === undefined ? undefined : { provider });
  }

  getAccounts() {
    return this.call<ManagedAccountInfo[]>(Methods.GetAccounts);
  }

  loginAccount(provider: string) {
    return this.call<AccountAuthResult>(Methods.LoginAccount, { provider }, OAUTH_REQUEST_TIMEOUT_MS);
  }

  logoutAccount(provider: string) {
    return this.call<AccountAuthResult>(Methods.LogoutAccount, { provider });
  }

  saveConfig(sessionConfig: SessionConfig) {
    return this.call<{ ok: boolean }>(Methods.SaveConfig, sessionConfig);
  }

  getExtensionConfig() {
    return this.call<ExtensionConfig>(Methods.GetExtensionConfig);
  }

  setLanguage(language: "en" | "zh") {
    return this.call<{ ok: boolean }>(Methods.SetLanguage, { language });
  }

  setCompactComposer(enabled: boolean) {
    return this.call<{ ok: boolean }>(Methods.SetCompactComposer, { enabled });
  }

  setPermissionMode(mode: PermissionMode) {
    return this.call<{ ok: boolean }>(Methods.SetPermissionMode, { mode });
  }

  openSettings() {
    return this.call<{ ok: boolean }>(Methods.OpenSettings);
  }

  openFolder() {
    return this.call<{ ok: boolean }>(Methods.OpenFolder);
  }

  getModels() {
    return this.call<KimiConfig>(Methods.GetModels);
  }

  addCustomProvider(params: AddCustomProviderParams) {
    return this.call<KimiConfig>(Methods.AddCustomProvider, params);
  }

  removeCustomProvider(params: RemoveCustomProviderParams) {
    return this.call<KimiConfig>(Methods.RemoveCustomProvider, params);
  }

  getCustomProvider(alias: string) {
    return this.call<CustomProviderDetails>(Methods.GetCustomProvider, { alias });
  }

  getMCPServers() {
    return this.call<MCPServerConfig[]>(Methods.GetMCPServers);
  }

  addMCPServer(serverConfig: MCPServerConfig) {
    return this.call<MCPServerConfig[]>(Methods.AddMCPServer, serverConfig);
  }

  updateMCPServer(originalName: string, serverConfig: MCPServerConfig) {
    const request: UpdateMCPServerRequest = { originalName, server: serverConfig };
    return this.call<MCPServerConfig[]>(Methods.UpdateMCPServer, request);
  }

  removeMCPServer(name: string) {
    return this.call<MCPServerConfig[]>(Methods.RemoveMCPServer, { name });
  }

  authMCP(name: string) {
    return this.call<{ ok: boolean }>(Methods.AuthMCP, { name }, OAUTH_REQUEST_TIMEOUT_MS);
  }

  resetAuthMCP(name: string) {
    return this.call<{ ok: boolean }>(Methods.ResetAuthMCP, { name });
  }

  testMCP(name: string) {
    return this.call<MCPTestResult>(Methods.TestMCP, { name });
  }

  streamChat(content: string | ContentPart[], model: string, effort: string, planMode: boolean, sessionId?: string, permissionMode?: import("shared/types").PermissionMode, goalObjective?: string) {
    // No client-side deadline: this RPC spans the whole turn, and the turn
    // outcome is delivered as stream events — a timeout here used to reject
    // mid-turn on long runs and roll the sent text back into the composer.
    return this.call<{ done: boolean }>(Methods.StreamChat, { content, model, effort, planMode, sessionId, permissionMode, goalObjective }, NO_REQUEST_TIMEOUT_MS);
  }

  abortChat() {
    return this.call<{ aborted: boolean }>(Methods.AbortChat);
  }

  resetSession() {
    return this.call<{ ok: boolean }>(Methods.ResetSession);
  }

  getProjectFiles(params?: { query?: string; directory?: string }) {
    return this.call<import("shared/types").ProjectFile[]>(Methods.GetProjectFiles, params);
  }

  respondApproval(requestId: string, response: ApprovalResponse) {
    return this.call<{ ok: boolean }>(Methods.RespondApproval, { requestId, response });
  }

  respondQuestion(rpcRequestId: string, questionRequestId: string, answers: Record<string, string>) {
    return this.call<{ ok: boolean }>(Methods.RespondQuestion, { rpcRequestId, questionRequestId, answers });
  }

  getKimiSessions() {
    return this.call<SessionInfo[]>(Methods.GetKimiSessions);
  }

  getAllKimiSessions() {
    return this.call<SessionInfo[]>(Methods.GetAllKimiSessions);
  }

  getRegisteredWorkDirs() {
    return this.call<string[]>(Methods.GetRegisteredWorkDirs);
  }

  setWorkDir(workDir: string | null) {
    return this.call<{ ok: boolean; workDir: string }>(Methods.SetWorkDir, { workDir });
  }

  browseWorkDir() {
    return this.call<{ ok: boolean; workDir: string | null }>(Methods.BrowseWorkDir);
  }

  loadSessionHistory(sessionId: string) {
    return this.call<UIStreamEvent[]>(Methods.LoadKimiSessionHistory, { kimiSessionId: sessionId });
  }

  getLiveSession() {
    return this.call<{ sessionId: string | null }>(Methods.GetLiveSession);
  }

  deleteSession(sessionId: string) {
    return this.call<{ ok: boolean }>(Methods.DeleteKimiSession, { sessionId });
  }

  forkSession(sessionId: string, turnIndex: number) {
    return this.call<{ sessionId: string } | null>(Methods.ForkKimiSession, { sessionId, turnIndex });
  }

  undoTurns(sessionId: string, count: number) {
    return this.call<{ ok: true } | { ok: false; code: string; message: string }>(
      Methods.UndoKimiTurns,
      { sessionId, count },
    );
  }

  pickMedia(maxCount: number, includeVideo = true) {
    return this.call<string[]>(Methods.PickMedia, { maxCount, includeVideo });
  }

  checkFileExists(filePath: string) {
    return this.call<boolean>(Methods.CheckFileExists, { filePath });
  }

  checkFilesExist(paths: string[]) {
    return this.call<Record<string, boolean>>(Methods.CheckFilesExist, { paths });
  }

  openFile(filePath: string) {
    return this.call<{ ok: boolean }>(Methods.OpenFile, { filePath });
  }

  openFileDiff(filePath: string) {
    return this.call<{ ok: boolean }>(Methods.OpenFileDiff, { filePath });
  }

  trackFiles(paths: string[]) {
    return this.call<FileChange[]>(Methods.TrackFiles, { paths });
  }

  clearTrackedFiles() {
    return this.call<{ ok: boolean }>(Methods.ClearTrackedFiles);
  }

  revertFiles(filePath?: string) {
    return this.call<{ ok: boolean }>(Methods.RevertFiles, { filePath });
  }

  keepChanges(filePath?: string) {
    return this.call<{ ok: boolean }>(Methods.KeepChanges, { filePath });
  }

  getImageDataUri(filePath: string) {
    return this.call<string | null>(Methods.GetImageDataUri, { filePath });
  }

  getBlobDataUri(ref: string) {
    return this.call<string | null>(Methods.GetBlobDataUri, { ref });
  }

  readPlanFile(filePath: string) {
    return this.call<string>(Methods.ReadPlanFile, { filePath });
  }

  openPlanFile(filePath: string) {
    return this.call<{ ok: boolean }>(Methods.OpenPlanFile, { filePath });
  }

  setPlanMode(enabled: boolean) {
    return this.call<{ ok: boolean; planMode: boolean }>(Methods.SetPlanMode, { enabled });
  }

  setSwarmMode(enabled: boolean) {
    return this.call<{ ok: boolean; swarmMode: boolean }>(Methods.SetSwarmMode, { enabled });
  }

  getGoalState() {
    return this.call<{ goal: GoalStateInfo | null }>(Methods.GetGoalState);
  }

  createGoal(objective: string) {
    return this.call<{ ok: boolean }>(Methods.CreateGoal, { objective });
  }

  controlGoal(action: "pause" | "resume" | "cancel") {
    return this.call<{ ok: boolean }>(Methods.ControlGoal, { action });
  }

  getBackgroundTasks() {
    return this.call<{ tasks: BackgroundTaskItem[] }>(Methods.GetBackgroundTasks);
  }

  getSessionContext() {
    return this.call<{ ok: boolean; snapshot: SessionContextSnapshot | null }>(Methods.GetSessionContext);
  }

  renameSession(sessionId: string, title: string) {
    return this.call<{ ok: boolean }>(Methods.RenameKimiSession, { sessionId, title });
  }

  steerChat(content: string | ContentPart[]) {
    return this.call<{ ok: boolean }>(Methods.SteerChat, { content });
  }

  showLogs() {
    return this.call<{ ok: boolean }>(Methods.ShowLogs);
  }

  reloadWebview() {
    return this.call<{ ok: boolean }>(Methods.ReloadWebview);
  }
}

export const bridge = new Bridge();
export { Events };
