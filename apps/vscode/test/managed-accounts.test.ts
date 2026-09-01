/**
 * Scenario: additional managed Kimi Code accounts ("账号 N") get their own
 * provider + credential slot + model aliases in config.toml.
 * Responsibilities: slot allocation, account discovery from the parsed
 * config, TOML section surgery (upsert idempotent / remove with dangling
 * default_model and [secondary_model] cleanup).
 * Wiring: pure text transforms plus real file writes through the schema
 * validator; no harness involved.
 * Run: pnpm --filter kimi-code exec vitest run test/managed-accounts.test.ts
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ManagedKimiCodeModelInfo } from "@moonshot-ai/kimi-code-sdk";

import {
  accountAliasIds,
  accountEntryForSlot,
  listExtraAccounts,
  nextAccountSlot,
  removeAccount,
  removeAccountSections,
  upsertAccount,
  upsertAccountSections,
} from "../src/config/managed-accounts";

const BASE_TOML = `default_model = "kimi-code/kimi-for-coding"

[providers."managed:kimi-code"]
type = "kimi"
base_url = "https://api.kimi.com/coding/v1"
api_key = ""
oauth = { storage = "file", key = "oauth/kimi-code" }

[models."kimi-code/kimi-for-coding"]
provider = "managed:kimi-code"
model = "kimi-for-coding"
max_context_size = 262144
capabilities = ["thinking", "image_in", "video_in", "tool_use"]
`;

const BASE_CONFIG = {
  defaultModel: "kimi-code/kimi-for-coding",
  providers: {
    "managed:kimi-code": {
      type: "kimi",
      apiKey: "",
      oauth: { storage: "file", key: "oauth/kimi-code" },
    },
  },
  models: {
    "kimi-code/kimi-for-coding": { provider: "managed:kimi-code", model: "kimi-for-coding" },
  },
};

const MODELS: ManagedKimiCodeModelInfo[] = [
  {
    id: "kimi-for-coding",
    contextLength: 262144,
    supportsReasoning: true,
    supportsImageIn: true,
    supportsVideoIn: true,
    displayName: "Kimi for Coding",
  },
  {
    id: "kimi-claude",
    contextLength: 200000,
    supportsReasoning: true,
    supportsImageIn: false,
    supportsVideoIn: false,
    protocol: "anthropic",
    supportEfforts: ["low", "high"],
    defaultEffort: "high",
  },
];

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

async function tempConfig(text: string = BASE_TOML): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kimi-managed-accounts-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "config.toml");
  await writeFile(path, text, "utf8");
  return path;
}

describe("managed account slots", () => {
  it("allocates the smallest free slot and rediscovers accounts from config", () => {
    expect(nextAccountSlot(BASE_CONFIG)).toBe(2);

    const withTwo = upsertAccountSections(BASE_TOML, accountEntryForSlot(2), MODELS, "https://api.kimi.com/coding/v1");
    expect(withTwo).toContain(`[providers."managed:kimi-code-2"]`);
    expect(withTwo).toContain(`oauth = { storage = "file", key = "oauth/kimi-code-2" }`);
    expect(withTwo).toContain(`model_source = "static"`);
    expect(withTwo).toContain(`source = { managed_by = "vscode-kimi-account" }`);
    expect(withTwo).toContain(`[models."kimi-code-2/kimi-for-coding"]`);
    expect(withTwo).toContain(`provider = "managed:kimi-code-2"`);
    // Anthropic-protocol models keep the beta routing flags.
    expect(withTwo).toContain(`[models."kimi-code-2/kimi-claude"]`);
    expect(withTwo).toContain(`beta_api = true`);
    expect(withTwo).toContain(`adaptive_thinking = true`);
    expect(withTwo).toContain(`support_efforts = ["low", "high"]`);
    // The primary account is untouched.
    expect(withTwo).toContain(`oauth = { storage = "file", key = "oauth/kimi-code" }`);
    expect(withTwo).toContain(`[models."kimi-code/kimi-for-coding"]`);
  });

  it("lists extra accounts from the provider marker and ignores the primary", () => {
    const config = {
      providers: {
        ...BASE_CONFIG.providers,
        "managed:kimi-code-2": {
          type: "kimi",
          oauth: { storage: "file", key: "oauth/kimi-code-2" },
          source: { managed_by: "vscode-kimi-account" },
        },
        deepseek: { type: "openai", source: { managed_by: "vscode-custom" } },
      },
    };
    expect(listExtraAccounts(config)).toEqual([accountEntryForSlot(2)]);
    // A hand-written provider with the same naming contract is still found.
    expect(
      listExtraAccounts({
        providers: {
          "managed:kimi-code-3": { type: "kimi", oauth: { storage: "file", key: "oauth/kimi-code-3" } },
        },
      }),
    ).toEqual([accountEntryForSlot(3)]);
    // A lookalike id without the matching oauth key is not ours.
    expect(
      listExtraAccounts({ providers: { "managed:kimi-code-4": { type: "kimi" } } }),
    ).toEqual([]);
  });

  it("reuses the slot of a removed account", () => {
    const config = {
      providers: {
        ...BASE_CONFIG.providers,
        "managed:kimi-code-3": { oauth: { key: "oauth/kimi-code-3" } },
      },
    };
    expect(nextAccountSlot(config)).toBe(2);
  });

  it("maps aliases to their account via the provider pointer", () => {
    const config = {
      models: {
        "kimi-code/kimi-for-coding": { provider: "managed:kimi-code" },
        "kimi-code-2/a": { provider: "managed:kimi-code-2" },
        "kimi-code-2/b": { provider: "managed:kimi-code-2" },
      },
    };
    expect(accountAliasIds(config, accountEntryForSlot(2))).toEqual(["kimi-code-2/a", "kimi-code-2/b"]);
  });
});

describe("account section removal", () => {
  const WITH_TWO = upsertAccountSections(
    `default_model = "kimi-code-2/kimi-for-coding"

[secondary_model]
model = "kimi-code-2/kimi-claude"

` + BASE_TOML,
    accountEntryForSlot(2),
    MODELS,
    "https://api.kimi.com/coding/v1",
  );

  it("strips provider, aliases, and dangling references", () => {
    const out = removeAccountSections(WITH_TWO, accountEntryForSlot(2), [
      "kimi-code-2/kimi-claude",
      "kimi-code-2/kimi-for-coding",
    ]);
    expect(out).not.toContain("managed:kimi-code-2");
    expect(out).not.toContain("kimi-code-2/");
    expect(out).not.toContain("secondary_model");
    // A default_model pointing at the removed account is dropped…
    expect(out).not.toMatch(/^default_model/m);
    // …while the primary account survives intact.
    expect(out).toContain(`oauth = { storage = "file", key = "oauth/kimi-code" }`);
    expect(out).toContain(`[models."kimi-code/kimi-for-coding"]`);
  });

  it("keeps default_model and secondary_model when they point elsewhere", () => {
    const base = `default_model = "kimi-code/kimi-for-coding"

[secondary_model]
model = "kimi-code/kimi-for-coding"

` + BASE_TOML;
    const withTwo = upsertAccountSections(base, accountEntryForSlot(2), MODELS, "https://api.kimi.com/coding/v1");
    const out = removeAccountSections(withTwo, accountEntryForSlot(2), [
      "kimi-code-2/kimi-claude",
      "kimi-code-2/kimi-for-coding",
    ]);
    expect(out).toContain(`default_model = "kimi-code/kimi-for-coding"`);
    expect(out).toContain("[secondary_model]");
    expect(out).not.toContain("managed:kimi-code-2");
  });
});

describe("account file writes", () => {
  it("upserts and removes through the schema-validated writer", async () => {
    const configPath = await tempConfig();
    const entry = accountEntryForSlot(2);
    await upsertAccount(configPath, entry, MODELS, "https://api.kimi.com/coding/v1");

    let text = await readFile(configPath, "utf8");
    expect(text).toContain(`[providers."managed:kimi-code-2"]`);

    // Re-login rewrites instead of duplicating.
    await upsertAccount(configPath, entry, MODELS, "https://api.kimi.com/coding/v1");
    text = await readFile(configPath, "utf8");
    expect(text.match(/managed:kimi-code-2"\]/g)?.length).toBe(1);

    await removeAccount(configPath, entry, [
      "kimi-code-2/kimi-claude",
      "kimi-code-2/kimi-for-coding",
    ]);
    text = await readFile(configPath, "utf8");
    expect(text).not.toContain("managed:kimi-code-2");
    expect(text).toContain(`[providers."managed:kimi-code"]`);
  });
});
