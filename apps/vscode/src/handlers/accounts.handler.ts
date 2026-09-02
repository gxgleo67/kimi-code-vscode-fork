import * as vscode from "vscode";

import { kimiCodeBaseUrl } from "@moonshot-ai/kimi-code-sdk";

import { Events, Methods } from "../../shared/bridge";
import type { AccountAuthResult, AccountSwitchResult, ManagedAccountInfo } from "../../shared/types";
import {
  accountAliasIds,
  accountEntryForSlot,
  listExtraAccounts,
  nextAccountSlot,
  PRIMARY_MANAGED_PROVIDER,
  removeAccount,
  upsertAccount,
  type ManagedAccountEntry,
} from "../config/managed-accounts";
import { updateLoginContext } from "../utils/context";
import { toWebviewConfig } from "./config.handler";
import type { Handler, HandlerContext } from "./types";

/**
 * Additional managed Kimi Code accounts: each is a `managed:kimi-code-<N>`
 * provider with its own OAuth credential slot, so two sessions can run on
 * different accounts at once (the model picker's provider groups act as the
 * account switcher). The primary account keeps the official login/provision
 * path untouched.
 */

const ACCOUNT_PROVIDER_ID = /^managed:kimi-code-(\d+)$/;

/** Display names are extension-side decoration, stored globally in globalState. */
const ACCOUNT_NAMES_KEY = "kimi.accountDisplayNames";

function entryFromProviderId(provider: string): ManagedAccountEntry {
  const match = ACCOUNT_PROVIDER_ID.exec(provider);
  if (match === null) throw new Error(`Unknown managed account provider: ${provider}`);
  return accountEntryForSlot(Number(match[1]));
}

interface AccountConfigView {
  readonly providers?: Record<string, unknown> | undefined;
  readonly models?: Record<string, { readonly provider?: string | undefined }> | undefined;
  readonly defaultModel?: string | undefined;
}

function accountProviderIds(config: AccountConfigView): string[] {
  return Object.keys(config.providers ?? {});
}

function isKnownAccountProvider(config: AccountConfigView, provider: string): boolean {
  return provider === PRIMARY_MANAGED_PROVIDER
    || (ACCOUNT_PROVIDER_ID.test(provider) && accountProviderIds(config).includes(provider));
}

/** Sorted alias ids belonging to an account (works for the primary too). */
function aliasesForProvider(
  config: { models?: Record<string, { provider?: string | undefined }> | undefined },
  provider: string,
): string[] {
  return Object.entries(config.models ?? {})
    .filter(([, model]) => model.provider === provider)
    .map(([id]) => id)
    .sort();
}

function readDisplayNames(ctx: HandlerContext): Record<string, string> {
  return ctx.globalState.get<Record<string, string>>(ACCOUNT_NAMES_KEY) ?? {};
}

async function describeAccount(
  ctx: HandlerContext,
  provider: string,
  slot: number,
  config: AccountConfigView,
): Promise<ManagedAccountInfo> {
  const status = await ctx.harness.auth.status(provider).catch(() => undefined);
  const info: ManagedAccountInfo = {
    provider,
    slot,
    loggedIn: status?.providers.some((p) => p.hasToken) ?? false,
  };
  const name = readDisplayNames(ctx)[provider]?.trim();
  if (name !== undefined && name.length > 0) info.displayName = name;
  const defaultModel = config.defaultModel;
  if (defaultModel !== undefined && aliasesForProvider(config, provider).includes(defaultModel)) {
    info.isDefault = true;
  }
  if (!info.loggedIn) return info;
  // Profile is a best-effort decoration for the account card; the endpoint
  // failing must not hide the account.
  const userInfo = await ctx.harness.auth.getManagedUserInfo(provider).catch(() => undefined);
  if (userInfo?.kind === "ok") {
    if (userInfo.userInfo.nickname.length > 0) info.nickname = userInfo.userInfo.nickname;
    if (userInfo.userInfo.email !== undefined) info.email = userInfo.userInfo.email;
    if (userInfo.userInfo.avatar !== undefined) info.avatar = userInfo.userInfo.avatar;
  }
  return info;
}

const getAccounts: Handler<void, ManagedAccountInfo[]> = async (_, ctx) => {
  const config = await ctx.harness.getConfig({ reload: true });
  const accounts = [await describeAccount(ctx, PRIMARY_MANAGED_PROVIDER, 1, config)];
  for (const entry of listExtraAccounts(config)) {
    accounts.push(await describeAccount(ctx, entry.provider, entry.slot, config));
  }
  return accounts;
};

async function reportAuthError(
  ctx: HandlerContext,
  message: string,
  error: unknown,
): Promise<AccountAuthResult> {
  ctx.logError(message, error);
  await updateLoginContext(ctx.harness).catch((statusError: unknown) => {
    ctx.logError("Unable to refresh login status after an account auth failure", statusError);
  });
  return { success: false, error: error instanceof Error ? error.message : String(error) };
}

const loginAccount: Handler<{ provider: string }, AccountAuthResult> = async (params, ctx) => {
  try {
    const onDeviceCode = async (authorization: {
      verificationUriComplete?: string;
      verificationUri: string;
    }) => {
      const url = authorization.verificationUriComplete || authorization.verificationUri;
      ctx.broadcast(Events.LoginUrl, { url }, ctx.webviewId);
      await vscode.env.openExternal(vscode.Uri.parse(url));
    };

    if (params.provider === PRIMARY_MANAGED_PROVIDER) {
      // Primary: the official flow provisions provider + models itself.
      await ctx.harness.auth.login(undefined, { onDeviceCode });
      await updateLoginContext(ctx.harness);
      const config = await ctx.harness.getConfig({ reload: true });
      return { success: true, config: toWebviewConfig(config) };
    }

    const config = await ctx.harness.getConfig({ reload: true });
    const entry =
      params.provider === "new"
        ? accountEntryForSlot(nextAccountSlot(config))
        : entryFromProviderId(params.provider);
    // Token only: the account's provider/models are written by the extension
    // below, not by the official provisioning (which owns the primary slot).
    await ctx.harness.auth.login(entry.provider, {
      onDeviceCode,
      oauthRef: { key: entry.oauthKey },
      provisionConfig: false,
    });
    const models = await ctx.harness.auth.listManagedModels(entry.provider);
    if (models.length === 0) {
      throw new Error("This account has no available models.");
    }
    const baseUrl =
      (config.providers?.[PRIMARY_MANAGED_PROVIDER] as { baseUrl?: string } | undefined)?.baseUrl
      ?? kimiCodeBaseUrl();
    await upsertAccount(ctx.harness.configPath, entry, models, baseUrl);
    await updateLoginContext(ctx.harness);
    const reloaded = await ctx.harness.getConfig({ reload: true });
    return { success: true, config: toWebviewConfig(reloaded) };
  } catch (error) {
    return reportAuthError(ctx, "Kimi account login failed", error);
  }
};

const logoutAccount: Handler<{ provider: string }, AccountAuthResult> = async (params, ctx) => {
  try {
    if (params.provider === PRIMARY_MANAGED_PROVIDER) {
      await ctx.harness.auth.logout();
      await updateLoginContext(ctx.harness);
      const config = await ctx.harness.getConfig({ reload: true });
      return { success: true, config: toWebviewConfig(config) };
    }

    const entry = entryFromProviderId(params.provider);
    const config = await ctx.harness.getConfig({ reload: true });
    if (config.providers?.[entry.provider] !== undefined) {
      await ctx.harness.auth.logout(entry.provider);
      await removeAccount(ctx.harness.configPath, entry, accountAliasIds(config, entry));
    }
    await updateLoginContext(ctx.harness);
    const reloaded = await ctx.harness.getConfig({ reload: true });
    return { success: true, config: toWebviewConfig(reloaded) };
  } catch (error) {
    return reportAuthError(ctx, "Kimi account logout failed", error);
  }
};

const renameAccount: Handler<{ provider: string; name: string }, AccountAuthResult> = async (params, ctx) => {
  const config = await ctx.harness.getConfig({ reload: true });
  if (!isKnownAccountProvider(config, params.provider)) {
    return { success: false, error: `Unknown managed account provider: ${params.provider}` };
  }
  const names = { ...readDisplayNames(ctx) };
  const name = params.name.trim();
  if (name.length === 0) {
    delete names[params.provider];
  } else {
    names[params.provider] = name;
  }
  await ctx.globalState.update(ACCOUNT_NAMES_KEY, names);
  return { success: true };
};

/** Point the config default model at the account, so new sessions start on it. */
const setDefaultAccount: Handler<{ provider: string }, AccountAuthResult> = async (params, ctx) => {
  try {
    const config = await ctx.harness.getConfig({ reload: true });
    if (!isKnownAccountProvider(config, params.provider)) {
      throw new Error(`Unknown managed account provider: ${params.provider}`);
    }
    const aliases = aliasesForProvider(config, params.provider);
    if (aliases.length === 0) {
      throw new Error("This account has no available models.");
    }
    const current = config.defaultModel;
    const target = current !== undefined && aliases.includes(current) ? current : aliases[0]!;
    if (current !== target) {
      await ctx.harness.setConfig({ defaultModel: target });
    }
    const reloaded = await ctx.harness.getConfig({ reload: true });
    return { success: true, config: toWebviewConfig(reloaded) };
  } catch (error) {
    return reportAuthError(ctx, "Set default account failed", error);
  }
};

/**
 * Switch THIS window's live session to the account, session-level only —
 * the global default model is untouched, so other windows keep their own
 * account. With no live session the returned alias rides along with the
 * first prompt (the composer applies its pick before the turn starts).
 */
const switchAccount: Handler<{ provider: string }, AccountSwitchResult> = async (params, ctx) => {
  try {
    const config = await ctx.harness.getConfig({ reload: true });
    if (!isKnownAccountProvider(config, params.provider)) {
      throw new Error(`Unknown managed account provider: ${params.provider}`);
    }
    const aliases = aliasesForProvider(config, params.provider);
    if (aliases.length === 0) {
      throw new Error("This account has no available models.");
    }
    const target = aliases[0]!;
    const runtime = ctx.getSession();
    if (runtime !== undefined) {
      const status = await runtime.session.getStatus();
      if (status.model !== target) await runtime.session.setModel(target);
    }
    return { success: true, model: target };
  } catch (error) {
    ctx.logError("Switch account failed", error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};

export const accountHandlers: Record<string, Handler<any, any>> = {
  [Methods.GetAccounts]: getAccounts,
  [Methods.LoginAccount]: loginAccount,
  [Methods.LogoutAccount]: logoutAccount,
  [Methods.RenameAccount]: renameAccount,
  [Methods.SetDefaultAccount]: setDefaultAccount,
  [Methods.SwitchAccount]: switchAccount,
};
