import * as vscode from "vscode";
import {
  effectiveModelAlias,
  SECONDARY_DERIVED_MODEL_ALIAS,
  type KimiConfig as SdkKimiConfig,
  type ModelAlias,
  type ThinkingEffort,
} from "@moonshot-ai/kimi-code-sdk";

import { Methods } from "../../shared/bridge";
import type {
  KimiConfig as WebviewKimiConfig,
  ModelConfig,
  SecondaryModelSelection,
  SlashCommandInfo,
} from "../../shared/legacy-sdk";
import type { ExtensionConfig, SessionConfig } from "../../shared/types";
import { removeSecondaryModelSection } from "../config/secondary-model";
import { isCustomProvider } from "../config/custom-providers";
import { VSCodeSettings } from "../config/vscode-settings";
import type { Handler, HandlerContext } from "./types";

const SLASH_COMMANDS: SlashCommandInfo[] = [
  { name: "init", aliases: [], description: "Analyze the codebase and generate AGENTS.md" },
  { name: "compact", aliases: [], description: "Compact the conversation context" },
  { name: "clear", aliases: ["reset"], description: "Clear the context" },
  { name: "yolo", aliases: [], description: "Toggle YOLO mode (auto-approve tool actions; may still ask questions)" },
  {
    name: "auto",
    aliases: ["afk"],
    description: "Toggle Auto mode (fully autonomous; the agent will not ask questions)",
  },
  { name: "plan", aliases: [], description: "Toggle plan mode. Usage: /plan [on|off|view|clear]" },
  {
    name: "add-dir",
    aliases: [],
    description: "Add a directory to the workspace. Usage: /add-dir <path>",
  },
  { name: "export", aliases: [], description: "Export current session context to a markdown file" },
  { name: "import", aliases: [], description: "Import context from a file or session ID" },
];

const saveConfig: Handler<SessionConfig, { ok: boolean }> = async (params, ctx) => {
  const effort = sessionConfigEffort(params);
  const effortChanged = params.effortChanged !== false;
  const config = await ctx.harness.getConfig({ reload: true });
  const model = config.models?.[params.model];
  const full = thinkingConfig(
    effort,
    model === undefined ? undefined : effectiveModelAlias(model).supportEfforts,
  );
  // Re-confirming the effort already shown is not an explicit choice —
  // persist the model but leave the stored effort preference alone (the TUI's
  // persistModelSelection rule).
  const patch = effortChanged ? full : { enabled: full.enabled };
  if (
    config.defaultModel !== params.model
    || config.thinking?.enabled !== patch.enabled
    || (effortChanged && config.thinking?.effort !== patch.effort)
  ) {
    await ctx.harness.setConfig({
      defaultModel: params.model,
      thinking: patch,
    });
  }

  const runtime = ctx.getSession();
  if (runtime !== undefined) {
    const status = await runtime.session.getStatus();
    if (status.model !== params.model) await runtime.session.setModel(params.model);
    if (status.thinkingEffort !== effort) await runtime.session.setThinking(effort);
  }

  if (params.secondaryModel !== undefined) {
    await persistSecondaryModel(ctx, config, params.secondaryModel);
  }
  return { ok: true };
};

/**
 * Persist-then-apply for the `[secondary_model]` recipe, mirroring the TUI's
 * /secondary_model flow: write the recipe (or remove it for "follow the main
 * model"), then push the resolved snapshot into every live session.
 */
async function persistSecondaryModel(
  ctx: HandlerContext,
  config: SdkKimiConfig,
  selection: SecondaryModelSelection | null,
): Promise<void> {
  if (selection !== null) {
    // The synthesized `__secondary__` derived entry is a runtime artifact of
    // the recipe, never a valid selection (the Webview filters it out; this
    // is the host-side backstop).
    if (
      selection.model === SECONDARY_DERIVED_MODEL_ALIAS
      || config.models?.[selection.model] === undefined
    ) {
      throw new Error(`Unknown secondary model: ${selection.model}`);
    }
    await ctx.harness.setConfig({
      secondaryModel: {
        model: selection.model,
        ...(selection.defaultEffort === undefined
          ? {}
          : { defaultEffort: selection.defaultEffort }),
      },
    });
    await ctx.runtime.applyPersistedSecondaryModelToActiveSessions();
    return;
  }
  // "Follow the main model": the v1 deep-merge patch cannot delete keys and
  // atomic section replacement is a v2-only capability, so on v1 the
  // [secondary_model] section is stripped from config.toml directly before
  // the core reloads it.
  if (ctx.harness.supportsAtomicSectionReplace()) {
    await ctx.harness.replaceConfigSections({ secondaryModel: undefined });
  } else {
    await removeSecondaryModelSection(ctx.harness.configPath);
    await ctx.harness.getConfig({ reload: true });
  }
  // Live sessions reject applyPersistedSecondaryModel once no recipe exists
  // (v1's persist-first guard): they keep their spawn-time binding until
  // recreated, while new sessions follow the main model.
  try {
    await ctx.runtime.applyPersistedSecondaryModelToActiveSessions();
  } catch (error) {
    ctx.logError("Secondary model cleared; live sessions keep their spawn-time binding", error);
  }
}

const getExtensionConfig: Handler<void, ExtensionConfig> = async () => {
  return VSCodeSettings.getExtensionConfig();
};

const setLanguage: Handler<{ language: "en" | "zh" }, { ok: boolean }> = async (params) => {
  await vscode.workspace.getConfiguration("kimifork").update("language", params.language, vscode.ConfigurationTarget.Global);
  return { ok: true };
};

const setAutoCompactContext: Handler<{ enabled: boolean }, { ok: boolean }> = async (params) => {
  await vscode.workspace.getConfiguration("kimifork").update("autoCompactContext", params.enabled, vscode.ConfigurationTarget.Global);
  return { ok: true };
};

const setCompactComposer: Handler<{ enabled: boolean }, { ok: boolean }> = async (params) => {
  await vscode.workspace.getConfiguration("kimifork").update("compactComposer", params.enabled, vscode.ConfigurationTarget.Global);
  return { ok: true };
};

const openSettings: Handler<void, { ok: boolean }> = async () => {
  await vscode.commands.executeCommand("workbench.action.openSettings", "kimifork");
  return { ok: true };
};

const getModels: Handler<void, WebviewKimiConfig> = async (_, ctx) => {
  const config = await ctx.harness.getConfig({ reload: true });
  return toWebviewConfig(config);
};

const getSlashCommands: Handler<void, SlashCommandInfo[]> = async (_, ctx) => {
  if (!ctx.workDir) return SLASH_COMMANDS;
  try {
    const skills = await ctx.harness.listWorkspaceSkills(ctx.workDir);
    const skillCommands = skills
      .filter((skill) => isUserActivatableSkill(skill.type))
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map((skill) => ({
        name: `skill:${skill.name}`,
        aliases: [],
        description: skill.description ?? "",
      }));
    return [...SLASH_COMMANDS, ...skillCommands];
  } catch (error) {
    ctx.logError("Unable to list workspace skills", error);
    return SLASH_COMMANDS;
  }
};

const showLogs: Handler<void, { ok: boolean }> = async (_, ctx) => {
  ctx.showLogs();
  return { ok: true };
};

const reloadWebview: Handler<void, { ok: boolean }> = async (_, ctx) => {
  await ctx.closeSession();
  ctx.fileManager.clearTracked(ctx.webviewId);
  ctx.reloadWebview();
  return { ok: true };
};

export const configHandlers = {
  [Methods.SaveConfig]: saveConfig,
  [Methods.GetExtensionConfig]: getExtensionConfig,
  [Methods.SetLanguage]: setLanguage,
  [Methods.SetAutoCompactContext]: setAutoCompactContext,
  [Methods.SetCompactComposer]: setCompactComposer,
  [Methods.OpenSettings]: openSettings,
  [Methods.GetModels]: getModels,
  [Methods.GetSlashCommands]: getSlashCommands,
  [Methods.ShowLogs]: showLogs,
  [Methods.ReloadWebview]: reloadWebview,
} as Record<string, Handler<any, any>>;

export function toWebviewConfig(config: SdkKimiConfig): WebviewKimiConfig {
  const models: ModelConfig[] = Object.entries(config.models ?? {})
    // The synthesized `__secondary__` derived entry is a runtime artifact of
    // the [secondary_model] recipe — never selectable (mirrors the TUI's
    // picker filter).
    .filter(([id]) => id !== SECONDARY_DERIVED_MODEL_ALIAS)
    .map(([id, model]) => toWebviewModel(id, model, config.providers))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  return {
    defaultModel: config.defaultModel ?? models[0]?.id ?? null,
    defaultThinking: config.thinking?.enabled !== false,
    defaultThinkingEffort: config.thinking?.effort,
    secondaryModel: toWebviewSecondaryModel(config.secondaryModel),
    models,
  };
}

/** A recipe without a `model` pointer binds nothing — project it as "follow the main model". */
function toWebviewSecondaryModel(
  secondary: SdkKimiConfig["secondaryModel"],
): SecondaryModelSelection | null {
  if (secondary?.model === undefined) return null;
  return {
    model: secondary.model,
    ...(secondary.defaultEffort === undefined ? {} : { defaultEffort: secondary.defaultEffort }),
  };
}

function toWebviewModel(
  id: string,
  model: ModelAlias,
  providers: SdkKimiConfig["providers"] | undefined,
): ModelConfig {
  const effective = effectiveModelAlias(model);
  return {
    id,
    name: effective.displayName ?? effective.model ?? id,
    provider: effective.provider,
    capabilities: [...(effective.capabilities ?? [])],
    max_context_tokens: effective.maxContextSize,
    adaptive_thinking: effective.adaptiveThinking,
    support_efforts:
      effective.supportEfforts === undefined ? undefined : [...effective.supportEfforts],
    default_effort: effective.defaultEffort,
    ...(isCustomProvider(providers?.[effective.provider]) ? { custom: true } : {}),
  };
}

function sessionConfigEffort(config: SessionConfig): ThinkingEffort {
  if (config.effort !== undefined) return config.effort as ThinkingEffort;
  return config.thinking === true ? "on" : "off";
}

/**
 * Project a thinking effort to the `[thinking]` config patch persisted to
 * config.toml — mirrors the TUI's thinkingEffortToConfig. "off" disables
 * thinking; "on" is the boolean-model on-signal, so it only persists
 * `enabled`. A concrete effort persists as the global default, EXCEPT the
 * model's highest declared level — the last entry of `support_efforts` —
 * which is session-only and records just `enabled`, so the most expensive
 * tier never becomes the global default for every new session. When the
 * model's levels are unknown the concrete effort is persisted as-is.
 */
function thinkingConfig(
  effort: ThinkingEffort,
  supportEfforts?: readonly string[],
): { enabled: boolean; effort?: string } {
  if (effort === "off") return { enabled: false };
  if (effort === "on") return { enabled: true };
  const top = supportEfforts?.at(-1);
  if (top !== undefined && effort === top) return { enabled: true };
  return { enabled: true, effort };
}

function isUserActivatableSkill(type: string | undefined): boolean {
  return type === undefined || type === "prompt" || type === "inline" || type === "flow";
}
