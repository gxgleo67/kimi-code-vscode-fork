import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Methods } from "../shared/bridge";
import {
  ExternalAcpBackend,
  buildExternalAcpArgs,
  contentToAcpBlocks,
  isValidAcpAccount,
  isValidAcpTarget,
} from "../src/runtime/external-acp";

const FAKE_AGENT = String.raw`#!/usr/bin/env node
const readline = require("node:readline");
const mode = process.env.FAKE_ACP_MODE || "normal";
let promptId;
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
const update = (sessionId, value) => send({ method: "session/update", params: { sessionId, update: value } });
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true, listSessions: true } } });
    return;
  }
  if (message.id === 700 && message.result) {
    update("session-1", { sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "completed", rawOutput: { ok: true } });
    send({ id: promptId, result: { stopReason: "end_turn" } });
    return;
  }
  if (message.method === "session/new") {
    send({ id: message.id, result: { sessionId: "session-1" } });
    return;
  }
  if (message.method === "session/load") {
    update(message.params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "replayed" } });
    send({ id: message.id, result: { sessionId: message.params.sessionId } });
    return;
  }
  if (message.method === "session/list") {
    if (mode === "exit") {
      setTimeout(() => process.exit(9), 10);
      return;
    }
    send({ id: message.id, result: { sessions: [{ sessionId: "session-1", cwd: message.params.cwd, title: "Test session", updatedAt: 42 }] } });
    return;
  }
  if (message.method === "session/prompt") {
    promptId = message.id;
    update(message.params.sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking" } });
    update(message.params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "answer" } });
    if (mode === "permission") {
      update(message.params.sessionId, { sessionUpdate: "tool_call", toolCallId: "tool-1", title: "Write file", kind: "edit", status: "pending", rawInput: { path: "file.txt" } });
      send({ id: 700, method: "session/request_permission", params: { sessionId: message.params.sessionId, toolCall: { toolCallId: "tool-1", title: "Write file", kind: "edit", status: "pending" }, options: [{ optionId: "allow", kind: "allow_once", name: "Allow" }] } });
    } else {
      send({ id: message.id, result: { stopReason: "end_turn" } });
    }
    return;
  }
  if (message.method === "session/delete") {
    send({ id: message.id, result: {} });
  }
});
`;

const roots: string[] = [];

async function createAgent(mode = "normal"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kimi-external-acp-"));
  roots.push(root);
  const path = join(root, "fake-agent.cjs");
  await writeFile(path, FAKE_AGENT, "utf8");
  await chmod(path, 0o755);
  process.env["FAKE_ACP_MODE"] = mode;
  return path;
}

function context(workDir: string, broadcast: (event: string, data: unknown, webviewId?: string) => void) {
  return {
    webviewId: "view-1",
    workDir,
    workspaceRoot: workDir,
    broadcast,
    saveAllDirty: async () => undefined,
  };
}

afterEach(async () => {
  delete process.env["FAKE_ACP_MODE"];
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("external ACP configuration", () => {
  it("validates isolated targets and preserves deduplicated account order", () => {
    expect(isValidAcpTarget("kimi-vscode-fork")).toBe(true);
    expect(isValidAcpTarget("../unsafe")).toBe(false);
    expect(isValidAcpTarget("con")).toBe(false);
    expect(isValidAcpAccount("account-a")).toBe(true);
    expect(isValidAcpAccount("--account")).toBe(false);
    expect(buildExternalAcpArgs({ command: "router", target: "zed", accounts: ["b", "a", "b", " "] })).toEqual([
      "--target", "zed", "--account", "b", "--account", "a",
    ]);
  });

  it("converts text and inline data images into ACP content blocks", () => {
    expect(contentToAcpBlocks("hello")).toEqual([{ type: "text", text: "hello" }]);
    expect(contentToAcpBlocks([
      { type: "text", text: "look" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ])).toEqual([
      { type: "text", text: "look" },
      { type: "image", data: "AAAA", mimeType: "image/png" },
    ]);
  });
});

describe("ExternalAcpBackend", () => {
  it("maps initialize, session/new, streaming updates, and session/list", async () => {
    const command = await createAgent();
    const events: Array<{ event: string; data: any; webviewId?: string }> = [];
    const backend = new ExternalAcpBackend({ command, target: "vscode", accounts: ["account-a", "account-b"] }, () => undefined);
    const view = context(await mkdtemp(join(tmpdir(), "kimi-workspace-")), (event, data, webviewId) => events.push({ event, data, webviewId }));
    roots.push(view.workDir);
    await expect(backend.handle(Methods.CheckLoginStatus, {}, view)).resolves.toEqual({ loggedIn: true });
    await expect(backend.handle(Methods.StreamChat, { content: "hello" }, view)).resolves.toEqual({ done: true });
    expect(events.map((entry) => entry.data.type)).toEqual([
      "session_start", "TurnBegin", "StepBegin", "ContentPart", "ContentPart", "stream_complete",
    ]);
    await expect(backend.handle(Methods.GetKimiSessions, {}, view)).resolves.toEqual([
      { id: "session-1", workDir: view.workDir, updatedAt: 42, brief: "Test session" },
    ]);
    await backend.dispose();
  });

  it("registers a load placeholder before replay notifications", async () => {
    const command = await createAgent();
    const events: any[] = [];
    const backend = new ExternalAcpBackend({ command, target: "vscode", accounts: [] }, () => undefined);
    const view = context(await mkdtemp(join(tmpdir(), "kimi-workspace-")), (_event, data) => events.push(data));
    roots.push(view.workDir);
    await expect(backend.handle(Methods.LoadKimiSessionHistory, { kimiSessionId: "session-1" }, view)).resolves.toEqual([
      expect.objectContaining({ type: "ContentPart", payload: { type: "text", text: "replayed" } }),
    ]);
    expect(events).toHaveLength(1);
    await backend.dispose();
  });

  it("bridges permission requests through respondApproval", async () => {
    const command = await createAgent("permission");
    const events: any[] = [];
    const backend = new ExternalAcpBackend({ command, target: "vscode", accounts: [] }, () => undefined);
    const view = context(await mkdtemp(join(tmpdir(), "kimi-workspace-")), (_event, data) => events.push(data));
    roots.push(view.workDir);
    const prompt = backend.handle(Methods.StreamChat, { content: "change it" }, view);
    await vi.waitFor(() => expect(events.some((event) => event.type === "ApprovalRequest")).toBe(true));
    await expect(backend.handle(Methods.RespondApproval, { requestId: "700", response: "approve" }, view)).resolves.toEqual({ ok: true });
    await expect(prompt).resolves.toEqual({ done: true });
    await backend.dispose();
  });

  it("rejects pending requests when the ACP process exits", async () => {
    const command = await createAgent("exit");
    const backend = new ExternalAcpBackend({ command, target: "vscode", accounts: [] }, () => undefined);
    const view = context(await mkdtemp(join(tmpdir(), "kimi-workspace-")), () => undefined);
    roots.push(view.workDir);
    await backend.handle(Methods.CheckLoginStatus, {}, view);
    await expect(backend.handle(Methods.GetKimiSessions, {}, view)).rejects.toThrow("外部 ACP 进程已退出");
    await backend.dispose();
  });
});
