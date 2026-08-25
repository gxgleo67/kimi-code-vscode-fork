import { create } from "zustand";
import { bridge } from "@/services";
import { toast } from "@/components/ui/sonner";
import { t } from "@/i18n";
import type { ExtensionConfig, PermissionMode } from "shared/types";
import type { KimiConfig, MCPServerConfig, ModelConfig, SecondaryModelSelection, ThinkingMode, SlashCommandInfo } from "shared/legacy-sdk";

let settingsSaveRevision = 0;
export const MANAGED_KIMI_CODE_PROVIDER = "managed:kimi-code";

function saveConfigWithRollback(
  config: Parameters<typeof bridge.saveConfig>[0],
  rollback: Partial<SettingsState>,
  set: (state: Partial<SettingsState>) => void,
): void {
  const revision = ++settingsSaveRevision;
  void bridge.saveConfig(config).catch((error: unknown) => {
    // A later selection supersedes this request; rolling an older request back
    // would overwrite the user's latest choice.
    if (revision !== settingsSaveRevision) return;
    set(rollback);
    toast.error(t("toast.saveModelSettingsFailed", { error: error instanceof Error ? error.message : String(error) }));
  });
}

export const DEFAULT_EXTENSION_CONFIG: ExtensionConfig = {
  yoloMode: false,
  autosave: true,
  useCtrlEnterToSend: false,
  enableNewConversationShortcut: false,
  showThinkingContent: true,
  showThinkingExpanded: true,
  language: "en",
  defaultThinkingEffort: "high",
  autoCompactContext: false,
  compactComposer: false,
  version: "",
};

/** Metadata-driven only; mirrors the TUI's thinkingAvailability rules. */
export function getModelThinkingMode(model: ModelConfig): ThinkingMode {
  if ((model.support_efforts?.length ?? 0) > 0) {
    return "effort";
  }
  if (model.capabilities.includes("always_thinking")) {
    return "always";
  }
  if (model.capabilities.includes("thinking") || model.adaptive_thinking === true) {
    return "switch";
  }
  return "none";
}

export function providerDisplayName(provider: string): string {
  if (provider === MANAGED_KIMI_CODE_PROVIDER) return "Kimi Code";
  if (provider.startsWith("managed:")) return provider.slice("managed:".length);
  return provider;
}

export interface ModelProviderGroup {
  provider: string;
  label: string;
  models: ModelConfig[];
}

export function groupModelsByProvider(models: ModelConfig[]): ModelProviderGroup[] {
  const grouped = new Map<string, ModelConfig[]>();
  for (const model of models) {
    const group = grouped.get(model.provider);
    if (group === undefined) {
      grouped.set(model.provider, [model]);
    } else {
      group.push(model);
    }
  }
  return [...grouped.entries()]
    .map(([provider, providerModels]) => ({
      provider,
      label: providerDisplayName(provider),
      models: providerModels.toSorted((left, right) => left.name.localeCompare(right.name)),
    }))
    .toSorted((left, right) => left.label.localeCompare(right.label));
}

export function requiresManagedProviderLogin(
  models: ModelConfig[],
  defaultModel: string | null,
  loggedIn: boolean,
): boolean {
  if (loggedIn) return false;
  const activeModel = getModelById(models, defaultModel ?? "") ?? models[0];
  return activeModel?.provider === MANAGED_KIMI_CODE_PROVIDER;
}

function defaultEffortForModel(model: ModelConfig, defaultThinking: boolean, configuredEffort?: string): string {
  const mode = getModelThinkingMode(model);
  if (mode === "none") return "off";
  const efforts = model.support_efforts ?? [];
  if (efforts.length > 0) {
    const alwaysOn = model.capabilities.includes("always_thinking");
    if (!defaultThinking && !alwaysOn) return "off";
    if (configuredEffort && efforts.includes(configuredEffort)) return configuredEffort;
    if (model.default_effort && efforts.includes(model.default_effort)) return model.default_effort;
    return efforts[Math.floor(efforts.length / 2)] ?? "off";
  }
  if (mode === "always") return "on";
  return defaultThinking ? "on" : "off";
}

/**
 * The VSCode `kimifork.defaultThinkingEffort` setting wins over the engine
 * config when the current model supports the value; anything else falls back
 * to the engine/model defaults.
 */
function preferredDefaultEffort(
  model: ModelConfig,
  defaultThinking: boolean,
  configuredEffort: string | undefined,
  settingEffort: string,
): string {
  const mode = getModelThinkingMode(model);
  if (mode === "none") return "off";
  const alwaysOn = model.capabilities.includes("always_thinking");
  if (settingEffort === "off") return alwaysOn ? defaultEffortForModel(model, defaultThinking, configuredEffort) : "off";
  if ((model.support_efforts ?? []).includes(settingEffort)) return settingEffort;
  return defaultEffortForModel(model, defaultThinking, configuredEffort);
}

export function isImageModel(model: ModelConfig): boolean {
  return model.capabilities.includes("image_in");
}

export function isVideoModel(model: ModelConfig): boolean {
  return model.capabilities.includes("video_in");
}

export function getModelById(models: ModelConfig[], id: string): ModelConfig | undefined {
  return models.find((m) => m.id === id);
}

/**
 * Whether a model may be selected as the MAIN conversation model. VS Code–
 * managed custom providers (added from the subagent dialog) exist only to
 * bind subagents, so they must stay out of the main model picker.
 */
export function isMainModel(model: ModelConfig): boolean {
  return model.custom !== true;
}

export interface MediaRequirements {
  image: boolean;
  video: boolean;
}

export function getModelsForMedia(models: ModelConfig[], mediaReq: MediaRequirements): ModelConfig[] {
  return models.filter((m) => {
    if (mediaReq.image && !isImageModel(m)) {
      return false;
    }
    if (mediaReq.video && !isVideoModel(m)) {
      return false;
    }
    return true;
  });
}

export function getMediaFallbackModel(
  compatibleModels: ModelConfig[],
  currentModel?: ModelConfig,
): ModelConfig | undefined {
  return compatibleModels.find((model) => model.provider === currentModel?.provider)
    ?? compatibleModels[0];
}

interface SettingsState {
  currentModel: string;
  thinkingEffort: string;
  /** Composer picks not yet applied to the engine session (they only reach
   *  it when the next prompt is sent); until then stale status announcements
   *  must not overwrite them. Session switches clear these. */
  pendingModelSync: string | null;
  pendingEffortSync: string | null;
  /** Active session's permission mode; engine truth arrives via StatusUpdate. */
  permissionMode: PermissionMode;
  extensionConfig: ExtensionConfig;
  mcpServers: MCPServerConfig[];
  mcpModalOpen: boolean;
  workDirModalOpen: boolean;
  currentWorkDir: string | null;
  workspaceRoot: string | null;
  models: ModelConfig[];
  defaultModel: string | null;
  defaultThinking: boolean;
  defaultThinkingEffort?: string;
  /** Subagent (secondary) model recipe; null = subagents follow the main model. */
  secondaryModel: SecondaryModelSelection | null;
  modelsLoaded: boolean;
  wireSlashCommands: SlashCommandInfo[];
  slashCommands: SlashCommandInfo[];
  isLoggedIn: boolean;

  setCurrentModel: (model: string) => void;
  setThinkingEffort: (effort: string) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  resetThinkingEffortToDefault: () => void;
  selectPermissionMode: (mode: PermissionMode) => void;
  updateModel: (modelId: string) => void;
  updateSecondaryModel: (selection: SecondaryModelSelection | null) => void;
  toggleThinking: () => void;
  selectThinkingEffort: (effort: string) => void;
  setExtensionConfig: (config: ExtensionConfig) => void;
  setMCPServers: (servers: MCPServerConfig[]) => void;
  setMCPModalOpen: (open: boolean) => void;
  setWorkDirModalOpen: (open: boolean) => void;
  setCurrentWorkDir: (workDir: string | null) => void;
  setWorkspaceRoot: (root: string | null) => void;
  initModels: (models: ModelConfig[], defaultModel: string | null, defaultThinking: boolean, defaultThinkingEffort?: string, secondaryModel?: SecondaryModelSelection | null) => void;
  /** Apply a refreshed config after custom-provider add/remove: models + subagent recipe only. */
  syncModelsConfig: (config: KimiConfig) => void;
  setWireSlashCommands: (commands: SlashCommandInfo[]) => void;
  setIsLoggedIn: (loggedIn: boolean) => void;
  /** Drop pending composer picks (session switch — engine truth wins again). */
  clearPendingSync: () => void;
  getCurrentThinkingMode: () => ThinkingMode;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  currentModel: "",
  thinkingEffort: "high",
  permissionMode: "manual",
  extensionConfig: DEFAULT_EXTENSION_CONFIG,
  mcpServers: [],
  mcpModalOpen: false,
  workDirModalOpen: false,
  currentWorkDir: null,
  workspaceRoot: null,
  models: [],
  defaultModel: null,
  defaultThinking: false,
  secondaryModel: null,
  modelsLoaded: false,
  wireSlashCommands: [],
  slashCommands: [],
  isLoggedIn: false,
  pendingModelSync: null,
  pendingEffortSync: null,

  setCurrentModel: (currentModel) => set({ currentModel }),

  setThinkingEffort: (thinkingEffort) => set({ thinkingEffort }),

  setPermissionMode: (permissionMode) => set({ permissionMode }),

  /** Reset the composer effort to the configured default (new conversation). */
  resetThinkingEffortToDefault: () => {
    const { models, currentModel, defaultThinking, defaultThinkingEffort, extensionConfig } = get();
    const model = getModelById(models, currentModel ?? "");
    if (!model) return;
    set({
      thinkingEffort: preferredDefaultEffort(model, defaultThinking, defaultThinkingEffort, extensionConfig.defaultThinkingEffort),
    });
  },

  selectPermissionMode: (mode) => {
    const previous = get().permissionMode;
    // Re-confirming the mode already shown is not an explicit choice.
    if (mode === previous) return;
    set({ permissionMode: mode });
    // No success toast: the top-of-window popup covered the UI, and the
    // composer button already reflects the new mode. When no live session
    // exists (ok=false) the selection rides along with the first prompt
    // (streamChat aligns it) and lands when the turn starts.
    void bridge.setPermissionMode(mode)
      .catch((error: unknown) => {
        set({ permissionMode: previous });
        toast.error(t("permMode.switchFailed", { error: error instanceof Error ? error.message : String(error) }));
      });
  },

  updateModel: (modelId) => {
    const { models, defaultThinking, defaultThinkingEffort, currentModel, thinkingEffort: previousEffort, extensionConfig } = get();
    const model = getModelById(models, modelId);
    if (!model) {
      return;
    }

    const thinkingEffort = preferredDefaultEffort(model, defaultThinking, defaultThinkingEffort, extensionConfig.defaultThinkingEffort);
    // Mark the pick as pending: until the next prompt applies it to the
    // engine session, status announcements still carry the previous model.
    set({ currentModel: modelId, thinkingEffort, pendingModelSync: modelId, pendingEffortSync: thinkingEffort });
    saveConfigWithRollback(
      {
        model: modelId,
        thinking: thinkingEffort !== "off",
        effort: thinkingEffort,
        effortChanged: thinkingEffort !== previousEffort,
      },
      { currentModel, thinkingEffort: previousEffort },
      set,
    );
  },

  updateSecondaryModel: (selection) => {
    const { models, secondaryModel: previous, currentModel, thinkingEffort } = get();
    if (selection !== null && getModelById(models, selection.model) === undefined) {
      return;
    }
    // Re-confirming the selection already shown is not an explicit choice —
    // skip the state update and the config write entirely.
    if (selection?.model === previous?.model && selection?.defaultEffort === previous?.defaultEffort) {
      return;
    }
    set({ secondaryModel: selection });
    saveConfigWithRollback(
      {
        model: currentModel,
        thinking: thinkingEffort !== "off",
        effort: thinkingEffort,
        // A secondary-model change must not touch the stored main-model
        // effort preference.
        effortChanged: false,
        secondaryModel: selection,
      },
      { secondaryModel: previous },
      set,
    );
  },

  toggleThinking: () => {
    const { models, currentModel, thinkingEffort, defaultThinking } = get();
    const model = getModelById(models, currentModel);
    if (!model) {
      return;
    }

    const thinkingMode = getModelThinkingMode(model);
    if (thinkingMode !== "switch") {
      return;
    } // Can only toggle in switch mode

    const newEffort = thinkingEffort === "off" ? "on" : "off";
    set({ thinkingEffort: newEffort, defaultThinking: newEffort !== "off", pendingEffortSync: newEffort });
    saveConfigWithRollback(
      { model: currentModel, thinking: newEffort !== "off", effort: newEffort },
      { thinkingEffort, defaultThinking },
      set,
    );
  },

  selectThinkingEffort: (effort) => {
    const { models, currentModel, thinkingEffort: previousEffort, defaultThinking, defaultThinkingEffort } = get();
    const model = getModelById(models, currentModel);
    if (!model) return;
    // Match the TUI's commitEffort rule: a boolean "on" never reaches the
    // engine for effort-capable models; resolve it to the model's default
    // effort first. "on" remains valid only for genuine boolean models.
    let thinkingEffort = effort;
    if (thinkingEffort === "on" && getModelThinkingMode(model) === "effort") {
      thinkingEffort = defaultEffortForModel(model, true, defaultThinkingEffort);
    }
    const allowed = model.support_efforts ?? [];
    const alwaysOn = model.capabilities.includes("always_thinking");
    if (thinkingEffort !== "off" && thinkingEffort !== "on" && !allowed.includes(thinkingEffort)) return;
    if (alwaysOn && thinkingEffort === "off") return;
    // Re-confirming the effort already shown is not an explicit choice —
    // skip the state update and the config write entirely.
    if (thinkingEffort === previousEffort) return;
    set({
      thinkingEffort,
      defaultThinking: thinkingEffort !== "off",
      pendingEffortSync: thinkingEffort,
      // The model's top declared tier is session-only (only the boolean
      // toggle is persisted), so it must not become the configured-effort
      // seed for future sessions.
      defaultThinkingEffort:
        thinkingEffort !== "off" && thinkingEffort !== "on" && thinkingEffort !== allowed.at(-1)
          ? thinkingEffort
          : defaultThinkingEffort,
    });
    saveConfigWithRollback(
      { model: currentModel, thinking: thinkingEffort !== "off", effort: thinkingEffort },
      { thinkingEffort: previousEffort, defaultThinking, defaultThinkingEffort },
      set,
    );
  },

  setExtensionConfig: (extensionConfig) => set({ extensionConfig }),

  setMCPServers: (mcpServers) => set({ mcpServers }),

  setMCPModalOpen: (mcpModalOpen) => set({ mcpModalOpen }),

  setWorkDirModalOpen: (workDirModalOpen) => set({ workDirModalOpen }),

  setCurrentWorkDir: (currentWorkDir) => set({ currentWorkDir }),

  setWorkspaceRoot: (workspaceRoot) => set({ workspaceRoot }),

  initModels: (models, defaultModel, defaultThinking, defaultThinkingEffort, secondaryModel) => {
    settingsSaveRevision += 1;
    const initialModel = defaultModel || models[0]?.id || "";
    const model = getModelById(models, initialModel);

    const thinkingEffort = model
      ? preferredDefaultEffort(model, defaultThinking, defaultThinkingEffort, get().extensionConfig.defaultThinkingEffort)
      : "off";

    set({
      models,
      defaultModel,
      defaultThinking,
      defaultThinkingEffort,
      secondaryModel: secondaryModel ?? null,
      modelsLoaded: true,
      currentModel: initialModel,
      thinkingEffort,
      // (Re)initialized from the engine config — no composer pick is in flight.
      pendingModelSync: null,
      pendingEffortSync: null,
    });
  },

  syncModelsConfig: (config) => {
    set({ models: config.models, secondaryModel: config.secondaryModel ?? null });
  },

  setWireSlashCommands: (commands) => {
    set({
      wireSlashCommands: commands,
      slashCommands: commands,
    });
  },

  setIsLoggedIn: (isLoggedIn) => set({ isLoggedIn }),

  clearPendingSync: () => set({ pendingModelSync: null, pendingEffortSync: null }),

  getCurrentThinkingMode: () => {
    const { models, currentModel } = get();
    const model = getModelById(models, currentModel);
    if (!model) {
      return "none";
    }
    return getModelThinkingMode(model);
  },
}));
