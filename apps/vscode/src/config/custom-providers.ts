import { readFile, rename, rm, writeFile } from "node:fs/promises";

import type * as vscode from "vscode";
import { createKimiConfigRpc } from "@moonshot-ai/kimi-code-sdk";

import { stripTomlSection } from "./secondary-model";

/**
 * VS Code–managed custom providers (e.g. DeepSeek).
 *
 * The API key never touches config.toml: it lives in VS Code SecretStorage
 * (system-encrypted) under `kimifork.providerKey.<alias>` and is mirrored into
 * `process.env.KIMIFORK_PROVIDER_KEY_<ALIAS>` early in activate(), before the
 * embedded engine is constructed. The `[providers.<alias>]` section carries
 * only the indirect reference `api_key_env_var`, which the engine resolves at
 * provider-construction time (the MCP bearerTokenEnvVar precedent). Every
 * config reload re-reads process.env, so SecretStorage changes propagate on
 * the next reload.
 */
export const SECRET_KEY_PREFIX = "kimifork.providerKey.";
export const ENV_VAR_PREFIX = "KIMIFORK_PROVIDER_KEY_";
export const CUSTOM_PROVIDER_MANAGED_BY = "vscode-custom";

/**
 * Index of custom-provider aliases, stored as a JSON string array inside
 * SecretStorage itself: this @types/vscode version has no SecretStorage.keys(),
 * so the index is how activate() finds the secrets to inject. Alias names are
 * not sensitive; only the sibling `kimifork.providerKey.<alias>` values are.
 */
const ALIAS_INDEX_KEY = "kimifork.providerKeyIndex";

export const CUSTOM_PROVIDER_TYPES = ["openai", "anthropic", "kimi"] as const;
export type CustomProviderType = (typeof CUSTOM_PROVIDER_TYPES)[number];

// Lowercase letters/digits/dashes, starting with a letter or digit — safe as a
// bare TOML key inside [providers.<alias>] / [models.<alias>] headers.
const ALIAS_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function isValidCustomProviderAlias(alias: string): boolean {
  return ALIAS_PATTERN.test(alias);
}

export function envVarForAlias(alias: string): string {
  return `${ENV_VAR_PREFIX}${alias.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

export function secretKeyForAlias(alias: string): string {
  return `${SECRET_KEY_PREFIX}${alias}`;
}

interface ProviderSourceCarrier {
  readonly source?: Record<string, unknown>;
}

/** Whether a `[providers]` entry was created (and is owned) by this feature. */
export function isCustomProvider(provider: ProviderSourceCarrier | undefined): boolean {
  return provider?.source?.["managed_by"] === CUSTOM_PROVIDER_MANAGED_BY;
}

/**
 * Push every stored custom-provider key into process.env so the engine's next
 * config reload can resolve the `api_key_env_var` references. Must run before
 * the harness is constructed; only the alias is logged, never the secret.
 * Index entries whose secret disappeared are pruned.
 */
export async function injectProviderSecrets(
  secrets: vscode.SecretStorage,
  log: (message: string) => void,
): Promise<void> {
  const aliases = await listProviderAliases(secrets);
  const surviving: string[] = [];
  for (const alias of aliases) {
    if ((await secrets.get(secretKeyForAlias(alias))) === undefined) continue;
    surviving.push(alias);
    await syncProviderSecret(secrets, secretKeyForAlias(alias), log);
  }
  if (surviving.length !== aliases.length) {
    await writeAliasIndex(secrets, surviving);
  }
}

export async function listProviderAliases(secrets: vscode.SecretStorage): Promise<string[]> {
  const raw = await secrets.get(ALIAS_INDEX_KEY);
  if (raw === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((alias): alias is string => typeof alias === "string");
  } catch {
    return [];
  }
}

export async function registerProviderAlias(
  secrets: vscode.SecretStorage,
  alias: string,
): Promise<void> {
  const aliases = await listProviderAliases(secrets);
  if (aliases.includes(alias)) return;
  await writeAliasIndex(secrets, [...aliases, alias]);
}

export async function unregisterProviderAlias(
  secrets: vscode.SecretStorage,
  alias: string,
): Promise<void> {
  const aliases = await listProviderAliases(secrets);
  if (!aliases.includes(alias)) return;
  await writeAliasIndex(secrets, aliases.filter((entry) => entry !== alias));
}

async function writeAliasIndex(secrets: vscode.SecretStorage, aliases: string[]): Promise<void> {
  await secrets.store(ALIAS_INDEX_KEY, JSON.stringify(aliases));
}

/** Mirror one SecretStorage key (set or deleted) into process.env. */
export async function syncProviderSecret(
  secrets: vscode.SecretStorage,
  key: string,
  log: (message: string) => void,
): Promise<void> {
  const alias = key.slice(SECRET_KEY_PREFIX.length);
  const envVar = envVarForAlias(alias);
  const value = await secrets.get(key);
  if (value === undefined || value.length === 0) {
    delete process.env[envVar];
    log(`Custom provider key removed for "${alias}" (${envVar})`);
  } else {
    process.env[envVar] = value;
    log(`Custom provider key injected for "${alias}" (${envVar})`);
  }
}

export interface CustomProviderSpec {
  readonly alias: string;
  readonly providerType: CustomProviderType;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly modelAlias: string;
  readonly maxContextSize: number;
  readonly displayName?: string;
}

/**
 * Insert or replace the `[providers.<alias>]` and `[models.<modelAlias>]`
 * sections of config.toml. The rewritten text is validated against the config
 * schema before it atomically replaces the original; the caller reloads the
 * harness afterwards. Never writes the API key — only the env var reference.
 */
export async function upsertCustomProvider(configPath: string, spec: CustomProviderSpec): Promise<void> {
  const text = await readFile(configPath, "utf8");
  const updated = upsertCustomProviderSections(text, spec);
  await writeConfigToml(configPath, updated);
}

/** Pure section rewrite, exported for tests. */
export function upsertCustomProviderSections(text: string, spec: CustomProviderSpec): string {
  let out = stripTomlSection(text, `providers.${spec.alias}`);
  out = stripTomlSection(out, `models.${spec.modelAlias}`);
  return appendSections(out, [providerSectionToml(spec), modelSectionToml(spec)]);
}

/**
 * Remove the provider/model sections of a custom provider. When the subagent
 * (secondary) recipe points at the removed model, it is stripped in the same
 * write so no dangling model reference survives.
 */
export async function removeCustomProvider(
  configPath: string,
  target: { alias: string; modelAlias: string; clearSecondaryRecipe: boolean },
): Promise<void> {
  const text = await readFile(configPath, "utf8");
  let out = stripTomlSection(text, `providers.${target.alias}`);
  out = stripTomlSection(out, `models.${target.modelAlias}`);
  if (target.clearSecondaryRecipe) {
    out = stripTomlSection(out, "secondary_model");
  }
  if (out === text) return;
  await writeConfigToml(configPath, out);
}

function providerSectionToml(spec: CustomProviderSpec): string {
  return [
    `[providers.${spec.alias}]`,
    `type = ${tomlString(spec.providerType)}`,
    `base_url = ${tomlString(spec.baseUrl)}`,
    `api_key_env_var = ${tomlString(envVarForAlias(spec.alias))}`,
    `source = { managed_by = ${tomlString(CUSTOM_PROVIDER_MANAGED_BY)} }`,
  ].join("\n");
}

function modelSectionToml(spec: CustomProviderSpec): string {
  const lines = [
    `[models.${spec.modelAlias}]`,
    `provider = ${tomlString(spec.alias)}`,
    `model = ${tomlString(spec.modelId)}`,
    `max_context_size = ${String(spec.maxContextSize)}`,
  ];
  if (spec.displayName !== undefined && spec.displayName.length > 0) {
    lines.push(`display_name = ${tomlString(spec.displayName)}`);
  }
  return lines.join("\n");
}

function appendSections(text: string, sections: string[]): string {
  let out = text;
  if (out.length > 0 && !out.endsWith("\n")) out += "\n";
  if (out.trim().length > 0) out += "\n";
  return out + sections.map((section) => `${section}\n`).join("\n");
}

/** Minimal TOML basic-string escaping; newlines are rejected by callers. */
export function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export async function writeConfigToml(configPath: string, text: string): Promise<void> {
  await createKimiConfigRpc().validateConfigToml({ text, filePath: configPath });
  const tempPath = `${configPath}.tmp-${process.pid}`;
  try {
    await writeFile(tempPath, text, { encoding: "utf8", mode: 0o600 });
    await rename(tempPath, configPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
