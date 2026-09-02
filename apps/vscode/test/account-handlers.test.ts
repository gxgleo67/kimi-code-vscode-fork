/**
 * Scenario: account display names (globalState decoration) and the default
 * account pointer (config default_model) behind Methods.RenameAccount /
 * Methods.SetDefaultAccount.
 * Wiring: fake HandlerContext — in-memory harness config + memento; no engine.
 */
import { describe, expect, it, vi } from "vitest";

import { Methods } from "../shared/bridge";
import { accountHandlers } from "../src/handlers/accounts.handler";
import type { HandlerContext } from "../src/handlers/types";

vi.mock("vscode", () => ({
  env: { openExternal: vi.fn(async () => true) },
  Uri: { parse: (value: string) => ({ toString: () => value }) },
}));

const renameAccount = accountHandlers[Methods.RenameAccount]!;
const setDefaultAccount = accountHandlers[Methods.SetDefaultAccount]!;

interface FakeConfig {
  defaultModel?: string;
  providers: Record<string, unknown>;
  // `model` mirrors real config.toml entries — the SDK's effectiveModelAlias
  // name-matches it, so a bare `{ provider }` alias is not a valid fixture.
  models: Record<string, { provider: string; model: string }>;
}

function fakeContext(initial: FakeConfig, options?: { sessionModel?: string }) {
  let config = structuredClone(initial);
  const names = new Map<string, unknown>();
  const setConfig = vi.fn(async (patch: { defaultModel?: string }) => {
    config = { ...config, ...patch };
  });
  const setModel = vi.fn(async () => undefined);
  const runtime =
    options?.sessionModel === undefined
      ? undefined
      : { session: { getStatus: vi.fn(async () => ({ model: options.sessionModel })), setModel } };
  const ctx = {
    harness: {
      getConfig: vi.fn(async () => config),
      setConfig,
      configPath: "/tmp/fake-config.toml",
      auth: { status: vi.fn(async () => ({ providers: [] })) },
    },
    globalState: {
      get: vi.fn((key: string) => names.get(key)),
      update: vi.fn(async (key: string, value: unknown) => {
        names.set(key, value);
      }),
    },
    getSession: vi.fn(() => runtime),
    logError: vi.fn(),
  } as unknown as HandlerContext;
  return { ctx, names, setConfig, setModel, readConfig: () => config };
}

const CONFIG: FakeConfig = {
  defaultModel: "kimi-code/kimi-for-coding",
  providers: {
    "managed:kimi-code": {},
    "managed:kimi-code-2": {},
  },
  models: {
    "kimi-code/kimi-for-coding": { provider: "managed:kimi-code", model: "kimi-for-coding" },
    "kimi-code-2/kimi-for-coding": { provider: "managed:kimi-code-2", model: "kimi-for-coding" },
  },
};

describe("renameAccount", () => {
  it("stores and clears a display name in globalState", async () => {
    const { ctx, names } = fakeContext(CONFIG);

    const renamed = await renameAccount({ provider: "managed:kimi-code-2", name: " 工作号 " }, ctx);
    expect(renamed).toEqual({ success: true });
    expect(names.get("kimi.accountDisplayNames")).toEqual({ "managed:kimi-code-2": "工作号" });

    const cleared = await renameAccount({ provider: "managed:kimi-code-2", name: "  " }, ctx);
    expect(cleared).toEqual({ success: true });
    expect(names.get("kimi.accountDisplayNames")).toEqual({});
  });

  it("rejects unknown providers without touching storage", async () => {
    const { ctx, names } = fakeContext(CONFIG);

    const result = await renameAccount({ provider: "managed:kimi-code-9", name: "x" }, ctx);
    expect(result.success).toBe(false);
    expect(names.size).toBe(0);
  });
});

describe("setDefaultAccount", () => {
  it("points the default model at the account's own alias", async () => {
    const { ctx, setConfig, readConfig } = fakeContext(CONFIG);

    const result = await setDefaultAccount({ provider: "managed:kimi-code-2" }, ctx);
    expect(result.success).toBe(true);
    expect(setConfig).toHaveBeenCalledWith({ defaultModel: "kimi-code-2/kimi-for-coding" });
    expect(readConfig().defaultModel).toBe("kimi-code-2/kimi-for-coding");
    expect(result.config).toBeDefined();
  });

  it("is a no-op when the default already belongs to the account", async () => {
    const { ctx, setConfig } = fakeContext(CONFIG);

    const result = await setDefaultAccount({ provider: "managed:kimi-code" }, ctx);
    expect(result.success).toBe(true);
    expect(setConfig).not.toHaveBeenCalled();
  });

  it("fails loudly for an account without models", async () => {
    const { ctx } = fakeContext({
      ...CONFIG,
      providers: { ...CONFIG.providers, "managed:kimi-code-3": {} },
    });

    const result = await setDefaultAccount({ provider: "managed:kimi-code-3" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("no available models");
  });
});

describe("switchAccount", () => {
  const switchAccount = accountHandlers[Methods.SwitchAccount]!;

  it("applies the account's alias to the live session without touching the global default", async () => {
    const { ctx, setConfig, setModel, readConfig } = fakeContext(CONFIG, { sessionModel: "kimi-code/kimi-for-coding" });

    const result = await switchAccount({ provider: "managed:kimi-code-2" }, ctx);
    expect(result).toEqual({ success: true, model: "kimi-code-2/kimi-for-coding" });
    expect(setModel).toHaveBeenCalledWith("kimi-code-2/kimi-for-coding");
    expect(setConfig).not.toHaveBeenCalled();
    expect(readConfig().defaultModel).toBe("kimi-code/kimi-for-coding");
  });

  it("returns the alias without a live session (the first prompt applies it)", async () => {
    const { ctx, setConfig } = fakeContext(CONFIG);

    const result = await switchAccount({ provider: "managed:kimi-code-2" }, ctx);
    expect(result).toEqual({ success: true, model: "kimi-code-2/kimi-for-coding" });
    expect(setConfig).not.toHaveBeenCalled();
  });

  it("rejects unknown providers", async () => {
    const { ctx } = fakeContext(CONFIG);

    const result = await switchAccount({ provider: "managed:kimi-code-9" }, ctx);
    expect(result.success).toBe(false);
  });
});
