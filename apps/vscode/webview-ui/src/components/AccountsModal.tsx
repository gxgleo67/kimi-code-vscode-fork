import { useEffect, useState } from "react";
import { IconLoader2, IconUserCircle, IconPlus, IconX } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores";
import { bridge } from "@/services";
import { useT } from "@/i18n";
import type { ManagedAccountInfo } from "shared/types";

interface AccountsModalProps {
  /** App-level auth refresh (models + login gating) after any account change. */
  onAuthAction?: () => void;
}

function accountLabel(t: ReturnType<typeof useT>, account: ManagedAccountInfo): string {
  return account.slot === 1 ? t("accounts.primary") : t("accounts.accountN", { slot: account.slot });
}

/**
 * Managed Kimi Code account manager: every account owns a provider group in
 * the model picker (Kimi Code / Kimi Code N), so which account a session uses
 * is just which group its model belongs to — several windows can run on
 * different accounts concurrently.
 */
export function AccountsModal({ onAuthAction }: AccountsModalProps) {
  const { accountsModalOpen, setAccountsModalOpen, accounts, setAccounts, syncModelsConfig } = useSettingsStore();
  /** Provider currently authing; "new" while the add-account flow runs. */
  const [busy, setBusy] = useState<string | null>(null);
  const [busyIsLogin, setBusyIsLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  useEffect(() => {
    if (!accountsModalOpen) return;
    setError(null);
    bridge
      .getAccounts()
      .then(setAccounts)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [accountsModalOpen, setAccounts]);

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
              return (
                <div key={account.provider} className="flex items-center gap-2.5 rounded-md border px-2.5 py-2">
                  {account.avatar !== undefined ? (
                    <img src={account.avatar} alt="" className="size-7 rounded-full" referrerPolicy="no-referrer" />
                  ) : (
                    <IconUserCircle className="size-7 text-muted-foreground/60" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{accountLabel(t, account)}</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {account.loggedIn
                        ? [account.nickname, account.email].filter((v) => v !== undefined && v.length > 0).join(" · ") || t("accounts.loggedIn")
                        : t("accounts.notLoggedIn")}
                    </div>
                  </div>
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
        </div>
      </div>
    </div>
  );
}
