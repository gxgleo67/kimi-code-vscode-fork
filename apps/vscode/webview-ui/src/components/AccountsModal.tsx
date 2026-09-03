import { useEffect, useState } from "react";
import { IconLoader2, IconUserCircle, IconPlus, IconX, IconPencil, IconCheck, IconStar, IconStarFilled } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useSettingsStore } from "@/stores";
import { bridge } from "@/services";
import { formatDateTime } from "@/lib/utils";
import { useT } from "@/i18n";
import { KimiLogo } from "./KimiLogo";
import { CustomProviderSection } from "./CustomProviderSection";
import { resetCountdown } from "./UsageStatusBar";
import { formatUsagePercent, usageRatio, type ManagedUsageView } from "shared/managed-usage";
import type { ManagedAccountInfo } from "shared/types";

interface AccountsModalProps {
  /** App-level auth refresh (models + login gating) after any account change. */
  onAuthAction?: () => void;
}

function accountLabel(t: ReturnType<typeof useT>, account: ManagedAccountInfo): string {
  return account.slot === 1 ? t("accounts.primary") : t("accounts.accountN", { slot: account.slot });
}

function accountTitle(t: ReturnType<typeof useT>, account: ManagedAccountInfo): string {
  return account.displayName ?? account.nickname ?? accountLabel(t, account);
}

/** Avatar with the default Kimi logo as fallback — both when the profile has
 *  no avatar and when the remote image fails to load. */
function AccountAvatar({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  if (src === undefined || failed) {
    return (
      <span className="size-7 shrink-0 rounded-full bg-muted flex items-center justify-center overflow-hidden">
        <KimiLogo className="size-4" />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      className="size-7 shrink-0 rounded-full"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

function usageBrief(t: ReturnType<typeof useT>, usage: ManagedUsageView | null | "error"): string | null {
  if (usage === null) return t("accounts.usageLoading");
  if (usage === "error") return t("accounts.usageUnavailable");
  const parts: string[] = [];
  if (usage.fiveHour !== undefined) {
    parts.push(`${t("usage.fiveHourLimit")} ${formatUsagePercent(usageRatio(usage.fiveHour.used, usage.fiveHour.limit))}%`);
  }
  if (usage.summary !== undefined) {
    parts.push(`${t("usage.weeklyLimit")} ${formatUsagePercent(usageRatio(usage.summary.used, usage.summary.limit))}%`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Always-visible line under the quota brief: each window's reset countdown
 *  plus the exact reset timestamp. */
function usageResetLine(t: ReturnType<typeof useT>, usage: ManagedUsageView): string | null {
  const now = Date.now();
  const windows = [
    [t("usage.fiveHourLimit"), usage.fiveHour],
    [t("usage.weeklyLimit"), usage.summary],
  ] as const;
  const parts: string[] = [];
  for (const [label, window] of windows) {
    if (window?.resetAt === undefined) continue;
    const countdown = resetCountdown(t, window.resetAt, now);
    const parsed = Date.parse(window.resetAt);
    if (countdown === undefined || !Number.isFinite(parsed)) continue;
    parts.push(`${label} ${countdown}(${formatDateTime(parsed)})`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Managed Kimi Code account manager: every account owns a provider group in
 * the model picker (Kimi Code / Kimi Code N), so which account a session uses
 * is just which group its model belongs to — several windows can run on
 * different accounts concurrently. Also hosts third-party providers (e.g.
 * DeepSeek) through the shared CustomProviderSection.
 */
export function AccountsModal({ onAuthAction }: AccountsModalProps) {
  const { accountsModalOpen, setAccountsModalOpen, accounts, setAccounts, syncModelsConfig } = useSettingsStore();
  /** Provider currently authing; "new" while the add-account flow runs. */
  const [busy, setBusy] = useState<string | null>(null);
  const [busyIsLogin, setBusyIsLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** provider → usage; "error" marks a failed fetch. */
  const [usageByProvider, setUsageByProvider] = useState<Record<string, ManagedUsageView | "error" | null>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const t = useT();

  useEffect(() => {
    if (!accountsModalOpen) return;
    setError(null);
    setUsageByProvider({});
    bridge
      .getAccounts()
      .then(setAccounts)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [accountsModalOpen, setAccounts]);

  // Quota per logged-in account, best-effort; a failing endpoint never blocks
  // the account list itself.
  useEffect(() => {
    if (!accountsModalOpen) return;
    for (const account of accounts) {
      if (!account.loggedIn) continue;
      setUsageByProvider((prev) => ({ ...prev, [account.provider]: null }));
      bridge
        .getManagedUsage(account.provider)
        .then((result) => {
          setUsageByProvider((prev) => ({
            ...prev,
            [account.provider]: result.ok ? result.usage : "error",
          }));
        })
        .catch(() => {
          setUsageByProvider((prev) => ({ ...prev, [account.provider]: "error" }));
        });
    }
  }, [accountsModalOpen, accounts]);

  if (!accountsModalOpen) return null;

  const refresh = async () => {
    setAccounts(await bridge.getAccounts());
  };

  const runAuth = async (provider: string, action: "login" | "logout") => {
    setBusy(provider);
    setBusyIsLogin(action === "login");
    setError(null);
    try {
      const result =
        action === "login" ? await bridge.loginAccount(provider) : await bridge.logoutAccount(provider);
      if (!result.success) {
        setError(result.error ?? t(action === "login" ? "accounts.loginFailed" : "accounts.logoutFailed"));
        return;
      }
      if (result.config !== undefined) syncModelsConfig(result.config);
      await refresh();
      onAuthAction?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const saveRename = async (provider: string) => {
    try {
      const result = await bridge.renameAccount(provider, nameDraft);
      if (!result.success) {
        setError(result.error ?? t("accounts.renameFailed"));
        return;
      }
      setRenaming(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const makeDefault = async (provider: string) => {
    setBusy(provider);
    setBusyIsLogin(false);
    setError(null);
    try {
      const result = await bridge.setDefaultAccount(provider);
      if (!result.success) {
        setError(result.error ?? t("accounts.setDefaultFailed"));
        return;
      }
      if (result.config !== undefined) syncModelsConfig(result.config);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <IconUserCircle className="size-4 text-blue-500" />
          <h2 className="text-xs font-medium">{t("accounts.title")}</h2>
        </div>
        <Button variant="ghost" size="icon" className="size-6" onClick={() => setAccountsModalOpen(false)}>
          <IconX className="size-3.5" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-3 py-3 space-y-3">
          {error !== null && (
            <div className="rounded border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            {accounts.map((account) => {
              const isBusy = busy === account.provider;
              const usage = usageByProvider[account.provider];
              const usageText = account.loggedIn ? usageBrief(t, usage ?? null) : null;
              const resetLine =
                account.loggedIn && usage !== undefined && usage !== null && usage !== "error"
                  ? usageResetLine(t, usage)
                  : null;
              return (
                <div key={account.provider} className="flex items-center gap-2.5 rounded-md border px-2.5 py-2">
                  <AccountAvatar src={account.avatar} />
                  <div className="flex-1 min-w-0">
                    {renaming === account.provider ? (
                      <div className="flex items-center gap-1">
                        <Input
                          value={nameDraft}
                          onChange={(event) => setNameDraft(event.target.value)}
                          placeholder={accountLabel(t, account)}
                          className="h-6 text-xs flex-1"
                          autoFocus
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void saveRename(account.provider);
                            if (event.key === "Escape") setRenaming(null);
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 shrink-0"
                          onClick={() => void saveRename(account.provider)}
                        >
                          <IconCheck className="size-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-medium truncate">{accountTitle(t, account)}</span>
                        {account.isDefault === true && (
                          <span className="text-[9px] px-1 rounded bg-blue-500/10 text-blue-500 shrink-0">
                            {t("accounts.defaultBadge")}
                          </span>
                        )}
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground p-0.5 cursor-pointer shrink-0"
                          title={t("accounts.rename")}
                          onClick={() => {
                            setRenaming(account.provider);
                            setNameDraft(account.displayName ?? "");
                          }}
                        >
                          <IconPencil className="size-3" />
                        </button>
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground truncate">
                      {account.loggedIn
                        ? [accountLabel(t, account), account.nickname, account.email]
                            .filter((v): v is string => v !== undefined && v.length > 0)
                            .filter((v) => v !== accountTitle(t, account))
                            .join(" · ") || t("accounts.loggedIn")
                        : t("accounts.notLoggedIn")}
                    </div>
                    {usageText !== null && (
                      <div className="text-[10px] text-muted-foreground truncate">{usageText}</div>
                    )}
                    {resetLine !== null && (
                      <div className="text-[10px] text-muted-foreground/80 truncate">{resetLine}</div>
                    )}
                  </div>
                  {account.loggedIn && (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-amber-500 p-1 cursor-pointer shrink-0 disabled:opacity-50"
                      title={account.isDefault === true ? t("accounts.defaultBadge") : t("accounts.setDefault")}
                      disabled={busy !== null || account.isDefault === true}
                      onClick={() => void makeDefault(account.provider)}
                    >
                      {account.isDefault === true ? <IconStarFilled className="size-3.5 text-amber-500" /> : <IconStar className="size-3.5" />}
                    </button>
                  )}
                  <span
                    className={`size-1.5 rounded-full shrink-0 ${account.loggedIn ? "bg-green-500" : "bg-muted-foreground/40"}`}
                    title={account.loggedIn ? t("accounts.loggedIn") : t("accounts.notLoggedIn")}
                  />
                  <Button
                    variant={account.loggedIn ? "outline" : "default"}
                    size="sm"
                    className="h-6 text-xs shrink-0"
                    disabled={busy !== null}
                    onClick={() => void runAuth(account.provider, account.loggedIn ? "logout" : "login")}
                  >
                    {isBusy ? (
                      <IconLoader2 className="size-3 animate-spin" />
                    ) : account.loggedIn ? (
                      t("accounts.logout")
                    ) : account.slot === 1 ? (
                      t("accounts.login")
                    ) : (
                      t("accounts.relogin")
                    )}
                  </Button>
                </div>
              );
            })}
          </div>

          {busy !== null && busyIsLogin && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <IconLoader2 className="size-3 animate-spin" />
              {t("accounts.waiting")}
            </p>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs w-full"
            disabled={busy !== null}
            onClick={() => void runAuth("new", "login")}
          >
            {busy === "new" ? <IconLoader2 className="size-3 animate-spin mr-1" /> : <IconPlus className="size-3 mr-1" />}
            {t("accounts.add")}
          </Button>

          <p className="text-[10px] text-muted-foreground leading-snug">{t("accounts.hint")}</p>

          <Separator />

          <CustomProviderSection title={t("accounts.customProviders")} />
        </div>
      </div>
    </div>
  );
}
