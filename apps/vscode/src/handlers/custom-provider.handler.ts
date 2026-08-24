import { effectiveModelAlias } from "@moonshot-ai/kimi-code-sdk";

import type {
  AddCustomProviderParams,
  CustomProviderDetails,
  KimiConfig as WebviewKimiConfig,
  RemoveCustomProviderParams,
} from "../../shared/legacy-sdk";
import { Methods } from "../../shared/bridge";
import {
  CUSTOM_PROVIDER_TYPES,
  envVarForAlias,
  isCustomProvider,
  isValidCustomProviderAlias,
  registerProviderAlias,
  removeCustomProvider,
  secretKeyForAlias,
  unregisterProviderAlias,
  upsertCustomProvider,
  type CustomProviderType,
} from "../config/custom-providers";
import { toWebviewConfig } from "./config.handler";
import type { Handler } from "./types";

function requireNoNewlines(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || /[\r\n]/.test(trimmed)) {
    throw new Error(`Invalid ${field} for a custom provider.`);
  }
  return trimmed;
}

/**
 * Add a VS Code–managed custom provider: the API key goes to SecretStorage
 * (mirrored into process.env for the engine), config.toml receives only the
 * `api_key_env_var` reference, then the harness reloads. defaultModel is never
 * touched. Returns the refreshed model list so the Webview can update in place.
 * Also serves edits: an empty `apiKey` keeps the stored secret as-is.
 */
const addCustomProvider: Handler<AddCustomProviderParams, WebviewKimiConfig> = async (
  params,
  ctx,
) => {
  const alias = params.alias.trim();
  if (!isValidCustomProviderAlias(alias)) {
    throw new Error(
      `Invalid provider alias "${alias}": use lowercase letters, digits and dashes, starting with a letter or digit.`,
    );
  }
  if (!CUSTOM_PROVIDER_TYPES.includes(params.providerType as CustomProviderType)) {
    throw new Error(`Unsupported custom provider type: ${params.providerType}`);
  }
  const baseUrl = requireNoNewlines(params.baseUrl, "base URL");
  const modelId = requireNoNewlines(params.modelId, "model ID");
  const displayName =
    params.displayName === undefined ? undefined : requireNoNewlines(params.displayName, "display name");
  // Empty key means "edit without rotating the secret": only valid for an
  // existing custom provider that still has a stored key.
  const apiKey = params.apiKey.trim().length === 0 ? undefined : requireNoNewlines(params.apiKey, "API key");
  // One model per custom provider: the model alias is the provider alias.
  const modelAlias = alias;

  const config = await ctx.harness.getConfig({ reload: true });
  const existingProvider = config.providers[alias];
  if (existingProvider !== undefined && !isCustomProvider(existingProvider)) {
    throw new Error(`A provider named "${alias}" already exists in config.toml.`);
  }
  const existingModel = config.models?.[modelAlias];
  if (existingModel !== undefined && existingModel.provider !== alias) {
    throw new Error(`A model named "${modelAlias}" already exists in config.toml.`);
  }
  if (
    apiKey === undefined &&
    (existingProvider === undefined || (await ctx.secrets.get(secretKeyForAlias(alias))) === undefined)
  ) {
    throw new Error("An API key is required for a new custom provider.");
  }

  if (apiKey !== undefined) {
    await ctx.secrets.store(secretKeyForAlias(alias), apiKey);
    await registerProviderAlias(ctx.secrets, alias);
    process.env[envVarForAlias(alias)] = apiKey;
  }
  try {
    await upsertCustomProvider(ctx.harness.configPath, {
      alias,
      providerType: params.providerType as CustomProviderType,
      baseUrl,
      modelId,
      modelAlias,
      maxContextSize: params.maxContextSize,
      ...(displayName === undefined ? {} : { displayName }),
    });
  } catch (error) {
    // The TOML write failed: do not leave an orphaned secret behind for a
    // provider that never made it into the config.
    if (existingProvider === undefined) {
      try {
        await ctx.secrets.delete(secretKeyForAlias(alias));
        await unregisterProviderAlias(ctx.secrets, alias);
      } catch {
        // Best-effort rollback only.
      }
      delete process.env[envVarForAlias(alias)];
    }
    throw error;
  }

  const reloaded = await ctx.harness.getConfig({ reload: true });
  return toWebviewConfig(reloaded);
};

/**
 * Remove a custom provider: strip both config.toml sections (plus the
 * subagent recipe if it points at the removed model), delete the secret and
 * its process.env mirror, then reload.
 */
const removeCustomProviderHandler: Handler<RemoveCustomProviderParams, WebviewKimiConfig> = async (
  params,
  ctx,
) => {
  const config = await ctx.harness.getConfig({ reload: true });
  const provider = config.providers[params.alias];
  if (!isCustomProvider(provider)) {
    throw new Error(`Provider "${params.alias}" is not a custom provider managed by VS Code.`);
  }
  await removeCustomProvider(ctx.harness.configPath, {
    alias: params.alias,
    modelAlias: params.modelAlias,
    clearSecondaryRecipe: config.secondaryModel?.model === params.modelAlias,
  });
  await ctx.secrets.delete(secretKeyForAlias(params.alias));
  await unregisterProviderAlias(ctx.secrets, params.alias);
  delete process.env[envVarForAlias(params.alias)];

  const reloaded = await ctx.harness.getConfig({ reload: true });
  return toWebviewConfig(reloaded);
};

/**
 * Read back a VS Code–managed custom provider's editable details (never the
 * API key) so the dialog can prefill the edit form.
 */
const getCustomProviderHandler: Handler<{ alias: string }, CustomProviderDetails> = async (
  params,
  ctx,
) => {
  const config = await ctx.harness.getConfig({ reload: true });
  const provider = config.providers[params.alias];
  if (provider === undefined || !isCustomProvider(provider)) {
    throw new Error(`Provider "${params.alias}" is not a custom provider managed by VS Code.`);
  }
  const modelEntry = config.models?.[params.alias];
  if (modelEntry === undefined) {
    throw new Error(`Custom provider "${params.alias}" has no model section in config.toml.`);
  }
  const model = effectiveModelAlias(modelEntry);
  return {
    alias: params.alias,
    providerType: provider.type,
    baseUrl: provider.baseUrl ?? "",
    modelId: model.model ?? "",
    maxContextSize: model.maxContextSize ?? 131072,
    ...(model.displayName === undefined ? {} : { displayName: model.displayName }),
  };
};

export const customProviderHandlers = {
  [Methods.AddCustomProvider]: addCustomProvider,
  [Methods.RemoveCustomProvider]: removeCustomProviderHandler,
  [Methods.GetCustomProvider]: getCustomProviderHandler,
} as Record<string, Handler<any, any>>;
