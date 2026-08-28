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
  await createKimiConfigRpc().validateConfigToml({ text: stripped, filePath: configPath });
  const tempPath = `${configPath}.tmp-${process.pid}`;
  try {
    await writeFile(tempPath, stripped, { encoding: "utf8", mode: 0o600 });
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
