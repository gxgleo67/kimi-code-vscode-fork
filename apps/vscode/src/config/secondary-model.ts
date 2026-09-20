import { readFile, rename, rm, writeFile } from "node:fs/promises";

import { createKimiConfigRpc } from "@moonshot-ai/kimi-code-sdk";

/**
 * Remove the `[secondary_model]` section from config.toml. The v1 config
 * patch is a whole-document deep merge that cannot delete keys, so clearing
 * the recipe ("subagents follow the main model") has to rewrite the file
 * itself. The rewritten text is validated against the config schema before
 * it replaces the original; the caller reloads the harness afterwards.
 */
export async function removeSecondaryModelSection(configPath: string): Promise<void> {
  const text = await readFile(configPath, "utf8");
  const stripped = stripTomlSection(text, "secondary_model");
  if (stripped === text) return;
  await replaceConfigText(configPath, stripped);
}

/**
 * Model aliases referenced by the `[secondary_model]` recipe that have no
 * `[models.<alias>]` section. The engine fail-fast validates the recipe on
 * every session create/resume, so one stale alias (e.g. left behind after a
 * custom provider was removed or renamed) bricks every conversation; the
 * caller strips the recipe instead.
 */
export function findStaleSecondaryModelRefs(text: string): string[] {
  const defined = new Set<string>();
  const refs: string[] = [];
  let section = "";
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const header = /^\[(.+)\]$/.exec(trimmed);
    if (header !== null) {
      section = header[1]!;
      const models = /^models\.(?:"([^"]+)"|([A-Za-z0-9_-]+))/.exec(section);
      if (models !== null) defined.add(models[1] ?? models[2]!);
      continue;
    }
    if (section === "secondary_model") {
      const pointer = /^(?:model|default_model)\s*=\s*"([^"]+)"/.exec(trimmed);
      if (pointer !== null) refs.push(pointer[1]!);
    } else if (section === "secondary_model.models") {
      const key = /^(?:"([^"]+)"|([A-Za-z0-9_-]+))\s*=/.exec(trimmed);
      if (key !== null) refs.push(key[1] ?? key[2]!);
    }
  }
  return [...new Set(refs.filter((ref) => !defined.has(ref)))];
}

/**
 * Strip the `[secondary_model]` section when it references undefined models,
 * so a stale recipe can no longer fail every session creation. Returns the
 * stale aliases that triggered the strip, or an empty array when the recipe
 * is intact (and the file is left untouched).
 */
export async function stripStaleSecondaryModelRecipe(configPath: string): Promise<string[]> {
  const text = await readFile(configPath, "utf8");
  const stale = findStaleSecondaryModelRefs(text);
  if (stale.length === 0) return [];
  await replaceConfigText(configPath, stripTomlSection(text, "secondary_model"));
  return stale;
}

async function replaceConfigText(configPath: string, text: string): Promise<void> {
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

/**
 * Remove a top-level `[name]` TOML section: its header line plus every
 * following line up to (excluding) the next section header. Only whole-line
 * removal, so the rest of the document is preserved byte for byte.
 */
export function stripTomlSection(text: string, section: string): string {
  const header = `[${section}]`;
  const subPrefix = `[${section}.`;
  const lines = text.split("\n");
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === header) {
      skipping = true;
      continue;
    }
    if (skipping && trimmed.startsWith("[") && trimmed.endsWith("]")) {
      // Sub-table headers of the stripped section (e.g. `[providers.x.source]`,
      // which the engine's serializer expands inline tables into on rewrite)
      // belong to it and must be stripped too; any other header ends the skip.
      skipping = trimmed.startsWith(subPrefix);
      if (skipping) continue;
    }
    if (!skipping) {
      out.push(line);
    }
  }
  return out.join("\n");
}
