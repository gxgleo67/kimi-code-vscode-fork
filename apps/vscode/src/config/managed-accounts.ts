import { readFile } from "node:fs/promises";

import type { ManagedKimiCodeModelInfo } from "@moonshot-ai/kimi-code-sdk";

import { tomlString, writeConfigToml } from "./custom-providers";
import { stripTomlSection } from "./secondary-model";

/**
 * Additional managed Kimi Code accounts ("账号 2", "账号 3", …).
 *
 * The primary account is untouched official machinery: provider
 * `managed:kimi-code`, credential slot `oauth/kimi-code`, aliases
 * `kimi-code/<model>`. Each extra account gets its own provider
 * `managed:kimi-code-<N>`, its own credential slot `oauth/kimi-code-<N>`
 * (stored as `credentials/kimi-code-<N>.json`), and aliases
 * `kimi-code-<N>/<model>`. The engine resolves non-primary providers' oauth
 * refs verbatim, so every account's requests carry its own token; the model
 * picker's provider groups double as the account switcher.
 *
 * Providers carry `source = { managed_by = "vscode-kimi-account" }` so this
 * feature can find its own entries again, and `model_source = "static"` so
 * the engine's oauth-catalog refresh (which only owns the primary provider)
 * never rewrites their alias sets.
 */

export const PRIMARY_MANAGED_PROVIDER = "managed:kimi-code";
export const ACCOUNT_MANAGED_BY = "vscode-kimi-account";

const ACCOUNT_PROVIDER_PATTERN = /^managed:kimi-code-(\d+)$/;

export interface ManagedAccountEntry {
  /** Provider id, e.g. `managed:kimi-code-2`. */
  readonly provider: string;
  /** Numeric slot, 2 and up (1 is the primary account). */
  readonly slot: number;
  /** OAuth credential key, e.g. `oauth/kimi-code-2`. */
  readonly oauthKey: string;
  /** Model alias prefix, e.g. `kimi-code-2/`. */
  readonly aliasPrefix: string;
}

interface ProviderRecordCarrier {
  readonly oauth?: { readonly storage?: string | undefined; readonly key?: string | undefined } | undefined;
  readonly source?: Record<string, unknown> | undefined;
  readonly [key: string]: unknown;
}

export function accountEntryForSlot(slot: number): ManagedAccountEntry {
  return {
    provider: `managed:kimi-code-${slot}`,
    slot,
    oauthKey: `oauth/kimi-code-${slot}`,
    aliasPrefix: `kimi-code-${slot}/`,
  };
}

function isAccountProvider(providerId: string, record: ProviderRecordCarrier): boolean {
  if (record.source?.["managed_by"] === ACCOUNT_MANAGED_BY) return true;
  // Marker lost (hand-edited config, engine rewrite): fall back to the naming
  // contract — a `managed:kimi-code-<N>` id plus the matching oauth key.
  const match = ACCOUNT_PROVIDER_PATTERN.exec(providerId);
  return match !== null && record.oauth?.key === `oauth/kimi-code-${match[1]}`;
}

/** Extra accounts present in the parsed config, sorted by slot. */
export function listExtraAccounts(config: {
  readonly providers?: Record<string, ProviderRecordCarrier> | undefined;
}): ManagedAccountEntry[] {
  const out: ManagedAccountEntry[] = [];
  for (const [id, record] of Object.entries(config.providers ?? {})) {
    if (!isAccountProvider(id, record)) continue;
    const slot = Number(ACCOUNT_PROVIDER_PATTERN.exec(id)?.[1]);
    if (Number.isInteger(slot) && slot >= 2) out.push(accountEntryForSlot(slot));
  }
  return out.sort((left, right) => left.slot - right.slot);
}

/** Smallest free slot (2+), so removed accounts leave no permanent holes. */
export function nextAccountSlot(config: {
  readonly providers?: Record<string, unknown> | undefined;
}): number {
  let slot = 2;
  while (Object.hasOwn(config.providers ?? {}, accountEntryForSlot(slot).provider)) slot += 1;
  return slot;
}

/** Aliases belonging to an account, found by their provider pointer. */
export function accountAliasIds(
  config: { readonly models?: Record<string, { readonly provider?: string | undefined }> | undefined },
  entry: ManagedAccountEntry,
): string[] {
  return Object.entries(config.models ?? {})
    .filter(([, model]) => model.provider === entry.provider)
    .map(([id]) => id)
    .sort();
}

function capabilitiesToml(model: ManagedKimiCodeModelInfo): string | undefined {
  const caps = new Set<string>();
  switch (model.supportsThinkingType) {
    case "only":
      caps.add("thinking");
      caps.add("always_thinking");
      break;
    case "both":
      caps.add("thinking");
      break;
    case "no":
      break;
    case undefined:
      if (model.supportsReasoning) caps.add("thinking");
      break;
  }
  if (model.supportsImageIn) caps.add("image_in");
  if (model.supportsVideoIn) caps.add("video_in");
  if (model.supportsToolUse ?? true) caps.add("tool_use");
  if (caps.size === 0) return undefined;
  return `capabilities = [${[...caps].map(tomlString).join(", ")}]`;
}

function modelSectionToml(entry: ManagedAccountEntry, model: ManagedKimiCodeModelInfo): string {
  // Mirrors toManagedModelAlias: anthropic-protocol models route through the
  // beta Messages API, and adaptive thinking is only advertised when the model
  // can think at all.
  const thinkingCapable =
    model.supportsThinkingType === "only" ||
    model.supportsThinkingType === "both" ||
    (model.supportsThinkingType === undefined && model.supportsReasoning);
  const lines = [
    `[models.${tomlString(`${entry.aliasPrefix}${model.id}`)}]`,
    `provider = ${tomlString(entry.provider)}`,
    `model = ${tomlString(model.id)}`,
    `max_context_size = ${String(model.contextLength)}`,
  ];
  const capabilities = capabilitiesToml(model);
  if (capabilities !== undefined) lines.push(capabilities);
  if (model.displayName !== undefined) lines.push(`display_name = ${tomlString(model.displayName)}`);
  if (model.supportEfforts !== undefined && model.supportEfforts.length > 0) {
    lines.push(`support_efforts = [${model.supportEfforts.map(tomlString).join(", ")}]`);
  }
  if (model.defaultEffort !== undefined) lines.push(`default_effort = ${tomlString(model.defaultEffort)}`);
  if (model.protocol === "anthropic") {
    lines.push(`protocol = "anthropic"`, "beta_api = true");
    if (thinkingCapable) lines.push("adaptive_thinking = true");
  }
  return lines.join("\n");
}

function providerSectionToml(entry: ManagedAccountEntry, baseUrl: string): string {
  return [
    `[providers.${tomlString(entry.provider)}]`,
    `type = "kimi"`,
    `base_url = ${tomlString(baseUrl)}`,
    `api_key = ""`,
    `oauth = { storage = "file", key = ${tomlString(entry.oauthKey)} }`,
    `model_source = "static"`,
    `source = { managed_by = ${tomlString(ACCOUNT_MANAGED_BY)} }`,
  ].join("\n");
}

/**
 * Replace one account's provider + model sections in config.toml text
 * (idempotent: existing sections for the account are stripped first).
 */
export function upsertAccountSections(
  text: string,
  entry: ManagedAccountEntry,
  models: readonly ManagedKimiCodeModelInfo[],
  baseUrl: string,
): string {
  let out = stripTomlSection(text, `providers.${tomlString(entry.provider)}`);
  for (const line of modelSectionHeaders(text, entry)) {
    out = stripTomlSection(out, line);
  }
  const sections = [providerSectionToml(entry, baseUrl), ...models.map((m) => modelSectionToml(entry, m))];
  if (out.length > 0 && !out.endsWith("\n")) out += "\n";
  if (out.trim().length > 0) out += "\n";
  return out + sections.map((section) => `${section}\n`).join("\n");
}

/**
 * Remove one account's provider + model sections. Top-level `default_model`
 * and a `[secondary_model]` recipe pointing at the removed aliases are
 * cleaned up so no dangling reference survives.
 */
export function removeAccountSections(
  text: string,
  entry: ManagedAccountEntry,
  aliasIds: readonly string[],
): string {
  let out = stripTomlSection(text, `providers.${tomlString(entry.provider)}`);
  for (const alias of aliasIds) {
    out = stripTomlSection(out, `models.${tomlString(alias)}`);
  }
  out = stripDanglingDefaultModel(out, new Set(aliasIds));
  const secondary = readSecondaryModelPointer(out);
  if (secondary !== undefined && aliasIds.includes(secondary)) {
    out = stripTomlSection(out, "secondary_model");
  }
  return out;
}

/** Upsert + validate + atomic write; caller reloads the harness afterwards. */
export async function upsertAccount(
  configPath: string,
  entry: ManagedAccountEntry,
  models: readonly ManagedKimiCodeModelInfo[],
  baseUrl: string,
): Promise<void> {
  const text = await readFile(configPath, "utf8");
  await writeConfigToml(configPath, upsertAccountSections(text, entry, models, baseUrl));
}

/** Remove + validate + atomic write; caller reloads the harness afterwards. */
export async function removeAccount(
  configPath: string,
  entry: ManagedAccountEntry,
  aliasIds: readonly string[],
): Promise<void> {
  const text = await readFile(configPath, "utf8");
  const updated = removeAccountSections(text, entry, aliasIds);
  if (updated === text) return;
  await writeConfigToml(configPath, updated);
}

/** Section names (unbracketed) of every `[models."<prefix>…"]` in the text. */
function modelSectionHeaders(text: string, entry: ManagedAccountEntry): string[] {
  // Match inside the quoted key: `[models."kimi-code-2/` — the closing quote
  // only comes after the model id, so it must not be part of the prefix.
  const prefix = `[models."${entry.aliasPrefix}`;
  const names: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(prefix) && trimmed.endsWith("]")) {
      names.push(trimmed.slice(1, -1));
    }
  }
  return names;
}

function stripDanglingDefaultModel(text: string, removed: ReadonlySet<string>): string {
  const lines = text.split("\n");
  const out = lines.filter((line) => {
    const match = /^default_model\s*=\s*"([^"]+)"\s*$/.exec(line.trim());
    return match === null || !removed.has(match[1]!);
  });
  return out.join("\n");
}

function readSecondaryModelPointer(text: string): string | undefined {
  const match = /\[secondary_model\]\s*\n(?:[^\n[]*\n)*?model\s*=\s*"([^"]+)"/.exec(text);
  return match?.[1];
}
