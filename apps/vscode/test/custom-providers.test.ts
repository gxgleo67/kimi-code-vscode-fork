/**
 * Scenario: VS Code–managed custom providers (e.g. DeepSeek) cross the bridge.
 * Responsibilities: alias/env-var derivation, the config.toml section surgery
 * (insert / replace / remove, never writing the API key), and the add/remove
 * handlers (SecretStorage is the only place the key lands; process.env mirrors
 * it for the engine; a dangling [secondary_model] recipe is cleared).
 * Wiring: the real TOML surgery and handlers; the harness, SecretStorage, and
 * VS Code are replaced.
 * Run: pnpm --filter kimi-code exec vitest run test/custom-providers.test.ts
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Methods, validateRpcMessage } from "../shared/bridge";
import type { KimiConfig as WebviewKimiConfig } from "../shared/legacy-sdk";
import {
  envVarForAlias,
  isCustomProvider,
  isValidCustomProviderAlias,
  removeCustomProvider,
  secretKeyForAlias,
  upsertCustomProvider,
  upsertCustomProviderSections,
} from "../src/config/custom-providers";
import { customProviderHandlers } from "../src/handlers/custom-provider.handler";
import type { HandlerContext } from "../src/handlers/types";

vi.mock("vscode", () => ({
  commands: { executeCommand: vi.fn(async () => undefined) },
}));

const addHandler = customProviderHandlers[Methods.AddCustomProvider]!;
const removeHandler = customProviderHandlers[Methods.RemoveCustomProvider]!;

const BASE_TOML = `default_model = "main"

[providers.local]
type = "kimi"
base_url = "http://127.0.0.1:1/v1"
api_key = "sk-test"

[models.main]
provider = "local"
model = "mock-main"
max_context_size = 128000
`;

const BASE_CONFIG = {
  defaultModel: "main",
  providers: {
    local: { type: "kimi", apiKey: "sk-test", baseUrl: "http://127.0.0.1:1/v1" },
  },
  models: {
    main: { provider: "local", model: "mock-main", maxContextSize: 128000 },
  },
};

const ADD_PARAMS = {
  alias: "deepseek",
  providerType: "openai",
  baseUrl: "https://api.deepseek.com/v1",
  modelId: "deepseek-chat",
  maxContextSize: 131072,
  displayName: "DeepSeek",
  apiKey: "sk-deepseek-secret",
};

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  delete process.env[envVarForAlias("deepseek")];
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

async function tempConfig(text: string = BASE_TOML): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kimi-vscode-custom-provider-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const configPath = join(dir, "config.toml");
  await writeFile(configPath, text, "utf8");
  return configPath;
}

interface FakeBoundary {
  readonly ctx: HandlerContext;
  readonly harness: { getConfig: ReturnType<typeof vi.fn>; configPath: string };
  readonly secrets: {
    store: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    values: Map<string, string>;
  };
  setConfig: (config: unknown) => void;
}

function fakeContext(configPath: string, initialConfig: unknown): FakeBoundary {
  let current = initialConfig;
  // The first getConfig call is the pre-write conflict check and must observe
  // the old config; later calls (post-write reloads) observe `current`.
  let calls = 0;
  const harness = {
    getConfig: vi.fn(async () => structuredClone(calls++ === 0 ? initialConfig : current)),
    configPath,
  };
  const values = new Map<string, string>();
  const secrets = {
    values,
    store: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      values.delete(key);
    }),
    get: vi.fn(async (key: string) => values.get(key)),
    keys: vi.fn(async () => [...values.keys()]),
  };
  const ctx = {
    harness,
    secrets,
    logError: vi.fn(),
  } as unknown as HandlerContext;
  return {
    ctx,
    harness,
    secrets,
    setConfig: (config) => {
      current = config;
    },
  };
}

function configWithCustomProvider() {
  return {
    ...structuredClone(BASE_CONFIG),
    providers: {
      ...structuredClone(BASE_CONFIG).providers,
      deepseek: {
        type: "openai",
        baseUrl: "https://api.deepseek.com/v1",
        apiKeyEnvVar: "KIMIFORK_PROVIDER_KEY_DEEPSEEK",
        source: { managed_by: "vscode-custom" },
      },
    },
    models: {
      ...structuredClone(BASE_CONFIG).models,
      deepseek: {
        provider: "deepseek",
        model: "deepseek-chat",
        maxContextSize: 131072,
        displayName: "DeepSeek",
      },
    },
  };
}

describe("alias derivation", () => {
  it("sanitizes the env var name from the alias", () => {
    expect(envVarForAlias("deepseek")).toBe("KIMIFORK_PROVIDER_KEY_DEEPSEEK");
    expect(envVarForAlias("my-provider")).toBe("KIMIFORK_PROVIDER_KEY_MY_PROVIDER");
  });

  it("derives the secret key from the alias", () => {
    expect(secretKeyForAlias("deepseek")).toBe("kimifork.providerKey.deepseek");
  });

  it("accepts only lowercase letters, digits and dashes", () => {
    expect(isValidCustomProviderAlias("deepseek")).toBe(true);
    expect(isValidCustomProviderAlias("my-provider-2")).toBe(true);
    expect(isValidCustomProviderAlias("")).toBe(false);
    expect(isValidCustomProviderAlias("-deepseek")).toBe(false);
    expect(isValidCustomProviderAlias("DeepSeek")).toBe(false);
    expect(isValidCustomProviderAlias("deep_seek")).toBe(false);
    expect(isValidCustomProviderAlias("deep.seek")).toBe(false);
  });
});

describe("upsertCustomProviderSections", () => {
  it("appends provider and model sections without writing the API key", () => {
    const out = upsertCustomProviderSections(BASE_TOML, {
      alias: "deepseek",
      providerType: "openai",
      baseUrl: "https://api.deepseek.com/v1",
      modelId: "deepseek-chat",
      modelAlias: "deepseek",
      maxContextSize: 131072,
      displayName: "DeepSeek",
    });
    expect(out).toContain("[providers.deepseek]");
    expect(out).toContain('type = "openai"');
    expect(out).toContain('api_key_env_var = "KIMIFORK_PROVIDER_KEY_DEEPSEEK"');
    expect(out).toContain('source = { managed_by = "vscode-custom" }');
    expect(out).toContain("[models.deepseek]");
    expect(out).toContain("max_context_size = 131072");
    expect(out).toContain('display_name = "DeepSeek"');
    expect(out).toContain("[models.main]");
    expect(out).not.toContain("sk-deepseek-secret");
  });

  it("replaces an existing entry instead of duplicating it", () => {
    const once = upsertCustomProviderSections(BASE_TOML, {
      alias: "deepseek",
      providerType: "openai",
      baseUrl: "https://api.deepseek.com/v1",
      modelId: "deepseek-chat",
      modelAlias: "deepseek",
      maxContextSize: 131072,
    });
    const twice = upsertCustomProviderSections(once, {
      alias: "deepseek",
      providerType: "openai",
      baseUrl: "https://api2.deepseek.com/v1",
      modelId: "deepseek-reasoner",
      modelAlias: "deepseek",
      maxContextSize: 65536,
    });
    expect(twice.match(/\[providers\.deepseek\]/g)).toHaveLength(1);
    expect(twice.match(/\[models\.deepseek\]/g)).toHaveLength(1);
    expect(twice).toContain("https://api2.deepseek.com/v1");
    expect(twice).not.toContain("deepseek-chat");
  });
});

describe("TOML surgery on disk", () => {
  it("upsert writes a schema-valid config", async () => {
    const configPath = await tempConfig();
    await upsertCustomProvider(configPath, {
      alias: "deepseek",
      providerType: "openai",
      baseUrl: "https://api.deepseek.com/v1",
      modelId: "deepseek-chat",
      modelAlias: "deepseek",
      maxContextSize: 131072,
    });
    const text = await readFile(configPath, "utf8");
    expect(text).toContain("[providers.deepseek]");
    expect(text).toContain("[models.deepseek]");
    expect(text).toContain("[providers.local]");
  });

  it("remove strips both sections and optionally the secondary recipe", async () => {
    const withRecipe = `${BASE_TOML}
[secondary_model]
model = "deepseek"
`;
    const configPath = await tempConfig(withRecipe);
    await upsertCustomProvider(configPath, {
      alias: "deepseek",
      providerType: "openai",
      baseUrl: "https://api.deepseek.com/v1",
      modelId: "deepseek-chat",
      modelAlias: "deepseek",
      maxContextSize: 131072,
    });
    await removeCustomProvider(configPath, {
      alias: "deepseek",
      modelAlias: "deepseek",
      clearSecondaryRecipe: true,
    });
    const text = await readFile(configPath, "utf8");
    expect(text).not.toContain("[providers.deepseek]");
    expect(text).not.toContain("[models.deepseek]");
    expect(text).not.toContain("[secondary_model]");
    expect(text).toContain("[models.main]");
  });
});

describe("addCustomProvider handler", () => {
  it("stores the key in SecretStorage, writes the env reference, reloads and returns models", async () => {
    const configPath = await tempConfig();
    const { ctx, harness, secrets, setConfig } = fakeContext(configPath, BASE_CONFIG);
    // After the TOML write the reload observes the new provider.
    setConfig(configWithCustomProvider());

    const result: WebviewKimiConfig = await addHandler(ADD_PARAMS, ctx);

    expect(secrets.store).toHaveBeenCalledWith("kimifork.providerKey.deepseek", "sk-deepseek-secret");
    expect(process.env["KIMIFORK_PROVIDER_KEY_DEEPSEEK"]).toBe("sk-deepseek-secret");
    const text = await readFile(configPath, "utf8");
    expect(text).toContain('api_key_env_var = "KIMIFORK_PROVIDER_KEY_DEEPSEEK"');
    expect(text).not.toContain("sk-deepseek-secret");
    expect(harness.getConfig).toHaveBeenLastCalledWith({ reload: true });
    const deepseek = result.models.find((model) => model.id === "deepseek");
    expect(deepseek).toMatchObject({ provider: "deepseek", custom: true, name: "DeepSeek" });
    // The main model default is never touched by a custom provider.
    expect(result.defaultModel).toBe("main");
  });

  it("rejects an alias colliding with an existing non-custom provider", async () => {
    const configPath = await tempConfig();
    const { ctx, secrets } = fakeContext(configPath, BASE_CONFIG);
    await expect(addHandler({ ...ADD_PARAMS, alias: "local" }, ctx)).rejects.toThrow(
      'A provider named "local" already exists',
    );
    expect(secrets.store).not.toHaveBeenCalled();
  });

  it("rejects invalid aliases before touching anything", async () => {
    const configPath = await tempConfig();
    const { ctx, harness, secrets } = fakeContext(configPath, BASE_CONFIG);
    await expect(addHandler({ ...ADD_PARAMS, alias: "DeepSeek" }, ctx)).rejects.toThrow(
      "Invalid provider alias",
    );
    expect(secrets.store).not.toHaveBeenCalled();
    expect(harness.getConfig).not.toHaveBeenCalled();
  });

  it("allows re-adding over an existing custom provider", async () => {
    const configPath = await tempConfig();
    const { ctx, secrets, setConfig } = fakeContext(configPath, configWithCustomProvider());
    setConfig(configWithCustomProvider());
    const result: WebviewKimiConfig = await addHandler({ ...ADD_PARAMS, apiKey: "sk-rotated" }, ctx);
    expect(secrets.store).toHaveBeenCalledWith("kimifork.providerKey.deepseek", "sk-rotated");
    expect(result.models.find((model) => model.id === "deepseek")).toMatchObject({ custom: true });
  });
});

describe("removeCustomProvider handler", () => {
  it("strips the sections, deletes the secret and clears a dangling subagent recipe", async () => {
    const withRecipe = `${BASE_TOML}
[secondary_model]
model = "deepseek"
`;
    const configPath = await tempConfig(withRecipe);
    await upsertCustomProvider(configPath, {
      alias: "deepseek",
      providerType: "openai",
      baseUrl: "https://api.deepseek.com/v1",
      modelId: "deepseek-chat",
      modelAlias: "deepseek",
      maxContextSize: 131072,
    });
    process.env["KIMIFORK_PROVIDER_KEY_DEEPSEEK"] = "sk-deepseek-secret";
    const initial = {
      ...configWithCustomProvider(),
      secondaryModel: { model: "deepseek" },
    };
    const { ctx, secrets, setConfig } = fakeContext(configPath, initial);
    secrets.values.set("kimifork.providerKey.deepseek", "sk-deepseek-secret");
    // After removal the reload observes the config without the provider.
    setConfig(BASE_CONFIG);

    const result: WebviewKimiConfig = await removeHandler({ alias: "deepseek", modelAlias: "deepseek" }, ctx);

    const text = await readFile(configPath, "utf8");
    expect(text).not.toContain("[providers.deepseek]");
    expect(text).not.toContain("[secondary_model]");
    expect(secrets.delete).toHaveBeenCalledWith("kimifork.providerKey.deepseek");
    expect(process.env["KIMIFORK_PROVIDER_KEY_DEEPSEEK"]).toBeUndefined();
    expect(result.models.map((model) => model.id)).toEqual(["main"]);
  });

  it("refuses to remove a provider it does not own", async () => {
    const configPath = await tempConfig();
    const { ctx, secrets } = fakeContext(configPath, BASE_CONFIG);
    await expect(removeHandler({ alias: "local", modelAlias: "main" }, ctx)).rejects.toThrow(
      'Provider "local" is not a custom provider managed by VS Code',
    );
    expect(secrets.delete).not.toHaveBeenCalled();
    expect(await readFile(configPath, "utf8")).toBe(BASE_TOML);
  });
});

describe("custom provider bridge validation", () => {
  function validateAdd(params: unknown) {
    return validateRpcMessage({ id: "1", method: Methods.AddCustomProvider, params });
  }

  it("accepts a well-formed add request", () => {
    expect(validateAdd(ADD_PARAMS).ok).toBe(true);
    const { displayName, ...withoutDisplayName } = ADD_PARAMS;
    void displayName;
    expect(validateAdd(withoutDisplayName).ok).toBe(true);
  });

  it("rejects malformed add requests", () => {
    expect(validateAdd({ ...ADD_PARAMS, alias: "" }).ok).toBe(false);
    expect(validateAdd({ ...ADD_PARAMS, apiKey: "" }).ok).toBe(false);
    expect(validateAdd({ ...ADD_PARAMS, maxContextSize: 0 }).ok).toBe(false);
    expect(validateAdd({ ...ADD_PARAMS, maxContextSize: 1.5 }).ok).toBe(false);
    expect(validateAdd({ ...ADD_PARAMS, displayName: 3 }).ok).toBe(false);
  });

  it("validates remove requests", () => {
    expect(
      validateRpcMessage({
        id: "1",
        method: Methods.RemoveCustomProvider,
        params: { alias: "deepseek", modelAlias: "deepseek" },
      }).ok,
    ).toBe(true);
    expect(
      validateRpcMessage({
        id: "1",
        method: Methods.RemoveCustomProvider,
        params: { alias: "deepseek" },
      }).ok,
    ).toBe(false);
  });
});

describe("isCustomProvider", () => {
  it("recognizes only the vscode-custom managed_by marker", () => {
    expect(isCustomProvider({ source: { managed_by: "vscode-custom" } })).toBe(true);
    expect(isCustomProvider({ source: { managed_by: "other" } })).toBe(false);
    expect(isCustomProvider({})).toBe(false);
    expect(isCustomProvider(undefined)).toBe(false);
  });
});
