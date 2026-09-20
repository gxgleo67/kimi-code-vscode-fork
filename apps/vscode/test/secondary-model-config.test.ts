/**
 * Scenario: the subagent (secondary) model setting crosses the VS Code bridge.
 * Responsibilities: project the `[secondary_model]` recipe to the Webview (minus the
 * synthesized `__secondary__` entry), persist selections (set / follow-main clear),
 * and live-apply them to active sessions.
 * Wiring: the real config handlers and config.toml section removal; the harness,
 * runtime, and VS Code are replaced.
 * Run: pnpm --filter kimi-code exec vitest run test/secondary-model-config.test.ts
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Methods, validateRpcMessage } from "../shared/bridge";
import type { SessionConfig } from "../shared/types";
import {
  findStaleSecondaryModelRefs,
  removeSecondaryModelSection,
  stripStaleSecondaryModelRecipe,
  stripTomlSection,
} from "../src/config/secondary-model";
import { configHandlers, toWebviewConfig } from "../src/handlers/config.handler";
import type { HandlerContext } from "../src/handlers/types";

vi.mock("vscode", () => ({
  commands: { executeCommand: vi.fn(async () => undefined) },
}));

const saveConfigHandler = configHandlers[Methods.SaveConfig]!;

const CONFIG_TOML = `default_model = "main"

[providers.local]
type = "kimi"
base_url = "http://127.0.0.1:1/v1"
api_key = "sk-test"

[models.main]
provider = "local"
model = "mock-main"
max_context_size = 128000

[models.cheap]
provider = "local"
model = "mock-cheap"
max_context_size = 128000

[secondary_model]
model = "cheap"
default_effort = "low"

[thinking]
enabled = true
`;

const SDK_CONFIG = {
  defaultModel: "main",
  thinking: { enabled: false },
  models: {
    main: { provider: "local", model: "mock-main", maxContextSize: 128000 },
    cheap: { provider: "local", model: "mock-cheap", maxContextSize: 128000 },
  },
};

interface FakeBoundary {
  readonly ctx: HandlerContext;
  readonly harness: {
    getConfig: ReturnType<typeof vi.fn>;
    setConfig: ReturnType<typeof vi.fn>;
    supportsAtomicSectionReplace: ReturnType<typeof vi.fn>;
    replaceConfigSections: ReturnType<typeof vi.fn>;
    configPath: string;
  };
  readonly applySecondary: ReturnType<typeof vi.fn>;
  readonly logError: ReturnType<typeof vi.fn>;
}

function fakeContext(options: { configPath?: string; atomicReplace?: boolean } = {}): FakeBoundary {
  const harness = {
    getConfig: vi.fn(async () => structuredClone(SDK_CONFIG)),
    setConfig: vi.fn(async () => ({})),
    supportsAtomicSectionReplace: vi.fn(() => options.atomicReplace === true),
    replaceConfigSections: vi.fn(async () => undefined),
    configPath: options.configPath ?? join(tmpdir(), "nonexistent-config.toml"),
  };
  const applySecondary = vi.fn(async () => undefined);
  const logError = vi.fn();
  const ctx = {
    harness,
    runtime: { applyPersistedSecondaryModelToActiveSessions: applySecondary },
    getSession: () => undefined,
    logError,
  } as unknown as HandlerContext;
  return { ctx, harness, applySecondary, logError };
}

function saveParams(secondaryModel: SessionConfig["secondaryModel"]): SessionConfig {
  // Matches the stored main config above, so the only config write a test can
  // observe is the secondary-model one.
  return { model: "main", thinking: false, effort: "off", effortChanged: false, secondaryModel };
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

async function tempConfig(text: string = CONFIG_TOML): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kimi-vscode-secondary-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const configPath = join(dir, "config.toml");
  await writeFile(configPath, text, "utf8");
  return configPath;
}

describe("toWebviewConfig", () => {
  it("projects the secondary-model recipe", () => {
    const webview = toWebviewConfig({
      ...structuredClone(SDK_CONFIG),
      secondaryModel: { model: "cheap", defaultEffort: "low" },
    } as never);
    expect(webview.secondaryModel).toEqual({ model: "cheap", defaultEffort: "low" });
  });

  it("projects null when no recipe exists or the recipe has no model pointer", () => {
    expect(toWebviewConfig(structuredClone(SDK_CONFIG) as never).secondaryModel).toBeNull();
    expect(
      toWebviewConfig({
        ...structuredClone(SDK_CONFIG),
        secondaryModel: { defaultEffort: "low" },
      } as never).secondaryModel,
    ).toBeNull();
  });

  it("filters the synthesized __secondary__ derived entry out of the model list", () => {
    const webview = toWebviewConfig({
      ...structuredClone(SDK_CONFIG),
      models: {
        ...structuredClone(SDK_CONFIG).models,
        __secondary__: { provider: "local", model: "mock-cheap", maxContextSize: 128000 },
      },
      secondaryModel: { model: "cheap", defaultEffort: "low" },
    } as never);
    expect(webview.models.map((model) => model.id)).not.toContain("__secondary__");
    expect(webview.models.map((model) => model.id)).toEqual(["cheap", "main"]);
  });
});

describe("saveConfig secondary model", () => {
  it("persists a selection, then live-applies it to active sessions", async () => {
    const { ctx, harness, applySecondary } = fakeContext();
    const result = await saveConfigHandler(saveParams({ model: "cheap" }), ctx);

    expect(result).toEqual({ ok: true });
    expect(harness.setConfig).toHaveBeenCalledTimes(1);
    expect(harness.setConfig).toHaveBeenCalledWith({ secondaryModel: { model: "cheap" } });
    expect(applySecondary).toHaveBeenCalledTimes(1);
  });

  it("persists an explicit default effort when the Webview sends one", async () => {
    const { ctx, harness } = fakeContext();
    await saveConfigHandler(saveParams({ model: "cheap", defaultEffort: "low" }), ctx);

    expect(harness.setConfig).toHaveBeenCalledWith({
      secondaryModel: { model: "cheap", defaultEffort: "low" },
    });
  });

  it("rejects an unknown model without writing config", async () => {
    const { ctx, harness, applySecondary } = fakeContext();
    await expect(saveConfigHandler(saveParams({ model: "missing" }), ctx)).rejects.toThrow(
      "Unknown secondary model: missing",
    );
    expect(harness.setConfig).not.toHaveBeenCalled();
    expect(applySecondary).not.toHaveBeenCalled();
  });

  it("rejects the synthesized __secondary__ entry as a selection", async () => {
    const { ctx, harness } = fakeContext();
    await expect(saveConfigHandler(saveParams({ model: "__secondary__" }), ctx)).rejects.toThrow(
      "Unknown secondary model: __secondary__",
    );
    expect(harness.setConfig).not.toHaveBeenCalled();
  });

  it("leaves the recipe alone when the Webview omits the field", async () => {
    const { ctx, harness, applySecondary } = fakeContext();
    const params = saveParams(undefined);
    delete params.secondaryModel;
    await saveConfigHandler(params, ctx);

    expect(harness.setConfig).not.toHaveBeenCalled();
    expect(harness.replaceConfigSections).not.toHaveBeenCalled();
    expect(applySecondary).not.toHaveBeenCalled();
  });

  it("clears via atomic section replacement when the harness supports it", async () => {
    const { ctx, harness, applySecondary } = fakeContext({ atomicReplace: true });
    await saveConfigHandler(saveParams(null), ctx);

    expect(harness.replaceConfigSections).toHaveBeenCalledWith({ secondaryModel: undefined });
    expect(harness.setConfig).not.toHaveBeenCalled();
    expect(applySecondary).toHaveBeenCalledTimes(1);
  });

  it("clears on v1 by stripping [secondary_model] from config.toml and reloading", async () => {
    const configPath = await tempConfig();
    const { ctx, harness, applySecondary } = fakeContext({ configPath });
    await saveConfigHandler(saveParams(null), ctx);

    expect(harness.replaceConfigSections).not.toHaveBeenCalled();
    const text = await readFile(configPath, "utf8");
    expect(text).not.toContain("[secondary_model]");
    expect(text).toContain("[models.cheap]");
    expect(text).toContain("[thinking]");
    expect(harness.getConfig).toHaveBeenCalledWith({ reload: true });
    expect(applySecondary).toHaveBeenCalledTimes(1);
  });

  it("tolerates live sessions rejecting the apply after a clear (persist-first guard)", async () => {
    const { ctx, applySecondary, logError } = fakeContext({ atomicReplace: true });
    applySecondary.mockRejectedValue(new Error("persist its recipe before applying it"));
    const result = await saveConfigHandler(saveParams(null), ctx);

    expect(result).toEqual({ ok: true });
    expect(logError).toHaveBeenCalledTimes(1);
  });
});

describe("SaveConfig bridge validation", () => {
  function validate(secondaryModel: unknown) {
    return validateRpcMessage({
      id: "1",
      method: Methods.SaveConfig,
      params: { model: "main", secondaryModel },
    });
  }

  it("accepts a selection, null (follow main), and an omitted field", () => {
    expect(validate({ model: "cheap" }).ok).toBe(true);
    expect(validate({ model: "cheap", defaultEffort: "low" }).ok).toBe(true);
    expect(validate(null).ok).toBe(true);
    expect(
      validateRpcMessage({ id: "1", method: Methods.SaveConfig, params: { model: "main" } }).ok,
    ).toBe(true);
  });

  it("rejects malformed selections", () => {
    expect(validate("cheap").ok).toBe(false);
    expect(validate({}).ok).toBe(false);
    expect(validate({ model: "" }).ok).toBe(false);
    expect(validate({ model: "cheap", defaultEffort: 3 }).ok).toBe(false);
  });
});

describe("stripTomlSection", () => {
  it("removes the section and preserves the rest byte for byte", () => {
    const stripped = stripTomlSection(CONFIG_TOML, "secondary_model");
    expect(stripped).not.toContain("[secondary_model]");
    expect(stripped).not.toContain('default_effort = "low"');
    expect(stripped).toContain('[models.cheap]\nprovider = "local"');
    expect(stripped).toContain("[thinking]\nenabled = true");
  });

  it("removes a trailing section without touching earlier content", () => {
    const text = "[a]\nx = 1\n\n[secondary_model]\nmodel = \"cheap\"\n";
    expect(stripTomlSection(text, "secondary_model")).toBe("[a]\nx = 1\n");
  });

  it("only matches the exact section header", () => {
    const text = "[secondary_model_extra]\nmodel = \"cheap\"\n";
    expect(stripTomlSection(text, "secondary_model")).toBe(text);
  });

  it("is a no-op when the section is absent", () => {
    const text = "[a]\nx = 1\n";
    expect(stripTomlSection(text, "secondary_model")).toBe(text);
  });
});

describe("removeSecondaryModelSection", () => {
  it("leaves a config without the section untouched", async () => {
    const text = CONFIG_TOML.replace(/\[secondary_model\][\s\S]*?\n\n/, "");
    const configPath = await tempConfig(text);
    await removeSecondaryModelSection(configPath);
    expect(await readFile(configPath, "utf8")).toBe(text);
  });

  it("writes a still-valid config with the section gone", async () => {
    const configPath = await tempConfig();
    await removeSecondaryModelSection(configPath);
    const text = await readFile(configPath, "utf8");
    expect(text).not.toContain("[secondary_model]");
    expect(text).toContain("[models.main]");
  });
});

describe("findStaleSecondaryModelRefs", () => {
  it("returns nothing when every referenced alias is defined", () => {
    expect(findStaleSecondaryModelRefs(CONFIG_TOML)).toEqual([]);
  });

  it("flags a model pointer with no [models] entry", () => {
    const text = '[models.main]\nprovider = "local"\n\n[secondary_model]\nmodel = "deepseek"\n';
    expect(findStaleSecondaryModelRefs(text)).toEqual(["deepseek"]);
  });

  it("flags default_model and pool table keys, deduplicated", () => {
    const text = [
      '[models."deepseek/deepseek-flash"]',
      'provider = "deepseek"',
      "",
      "[secondary_model]",
      'default_model = "deepseek/deepseek-flash"',
      "",
      "[secondary_model.models]",
      '"deepseek/deepseek-flash" = "fast"',
      'gone = "removed provider"',
      'gone = "duplicate key would be invalid TOML but parser tolerance aside"',
    ].join("\n");
    expect(findStaleSecondaryModelRefs(text)).toEqual(["gone"]);
  });

  it("reads quoted [models] aliases and ignores sub-table headers", () => {
    const text = [
      '[models."deepseek/deepseek-flash"]',
      'provider = "deepseek"',
      "",
      '[models."deepseek/deepseek-flash".source]',
      'managed_by = "vscode-custom"',
      "",
      "[secondary_model]",
      'model = "deepseek/deepseek-flash"',
    ].join("\n");
    expect(findStaleSecondaryModelRefs(text)).toEqual([]);
  });

  it("returns nothing when no [secondary_model] section exists", () => {
    expect(findStaleSecondaryModelRefs('[models.main]\nprovider = "local"\n')).toEqual([]);
  });
});

describe("stripStaleSecondaryModelRecipe", () => {
  it("strips a recipe pointing at an undefined model and keeps the rest", async () => {
    const configPath = await tempConfig(
      CONFIG_TOML.replace('model = "cheap"', 'model = "deepseek"'),
    );
    const stale = await stripStaleSecondaryModelRecipe(configPath);
    expect(stale).toEqual(["deepseek"]);
    const text = await readFile(configPath, "utf8");
    expect(text).not.toContain("[secondary_model]");
    expect(text).toContain("[models.cheap]");
    expect(text).toContain("[thinking]");
  });

  it("leaves a healthy recipe untouched", async () => {
    const configPath = await tempConfig();
    const stale = await stripStaleSecondaryModelRecipe(configPath);
    expect(stale).toEqual([]);
    expect(await readFile(configPath, "utf8")).toBe(CONFIG_TOML);
  });
});
