import { useEffect, useState } from "react";
import { IconSettings, IconServer, IconLogout, IconLogin, IconLoader2, IconRefresh, IconFileText, IconFolder, IconCheck, IconLanguage, IconViewportNarrow, IconUsers, IconChevronRight } from "@tabler/icons-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/stores";
import { bridge } from "@/services";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { type ManagedUsageView } from "shared/managed-usage";
import { QuotaRings, quotaWindowState } from "./UsageStatusBar";

interface ActionMenuProps {
  className?: string;
  onAuthAction?: () => void;
}

function MenuSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <div className="px-2.5 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center justify-between">
        <span>{title}</span>
        {subtitle && <span className="normal-case tracking-normal">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function MenuItem({ onClick, disabled, danger, children }: { onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-accent transition-colors text-left cursor-pointer",
        disabled && "opacity-50 cursor-not-allowed",
        danger && "text-red-500 hover:text-red-600",
      )}
    >
      {children}
    </button>
  );
}

export function ActionMenu({ className, onAuthAction }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { setMCPModalOpen, setAccountsModalOpen, isLoggedIn, setIsLoggedIn, extensionConfig, accounts, setAccounts, models, currentModel } = useSettingsStore();
  const t = useT();
  /** provider → usage; undefined = not fetched, null = in flight, "error" = failed. */
  const [usageByProvider, setUsageByProvider] = useState<Record<string, ManagedUsageView | "error" | null>>({});
  const [switchingProvider, setSwitchingProvider] = useState<string | null>(null);
  /** Snapshot for the quota tooltips' reset countdowns; refreshed per open. */
  const [now, setNow] = useState(() => Date.now());
  /** The account serving this window's current session (from the composer's model). */
  const currentProvider = models.find((model) => model.id === currentModel)?.provider;

  // Load the account list (and each account's quota) every time the menu
  // opens, so the inline second-level rows stay honest.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setNow(Date.now());
    setUsageByProvider({});
    void bridge
      .getAccounts()
      .then((list) => {
        if (cancelled) return;
        setAccounts(list);
        for (const account of list) {
          if (!account.loggedIn) continue;
          setUsageByProvider((prev) => ({ ...prev, [account.provider]: null }));
          bridge
            .getManagedUsage(account.provider)
            .then((result) => {
              if (cancelled) return;
              setUsageByProvider((prev) => ({ ...prev, [account.provider]: result.ok ? result.usage : "error" }));
            })
            .catch(() => {
              if (cancelled) return;
              setUsageByProvider((prev) => ({ ...prev, [account.provider]: "error" }));
            });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, setAccounts]);

  const handleOpenAccounts = () => {
    setAccountsModalOpen(true);
    setOpen(false);
  };

  // Quick account switch: session-level only (the global default model stays
  // with the starred account), so each window can run on its own account.
  // A signed-out account opens the management dialog instead — there is
  // nothing to switch to until it logs in.
  const handleSwitchAccount = (account: (typeof accounts)[number]) => {
    if (!account.loggedIn) {
      handleOpenAccounts();
      return;
    }
    if (account.provider === currentProvider || switchingProvider !== null) return;
    setSwitchingProvider(account.provider);
    void bridge
      .switchAccount(account.provider)
      .then((result) => {
        if (!result.success || result.model === undefined) {
          toast.error(t("accounts.switchFailed", { error: result.error ?? "unknown" }));
          return;
        }
        // Same gate as updateModel: status announcements still carry the old
        // model until the pick lands on the engine session.
        useSettingsStore.setState({ currentModel: result.model, pendingModelSync: result.model });
        toast.success(t("accounts.switched", { name: account.displayName ?? account.nickname ?? t("accounts.accountN", { slot: account.slot }) }));
        setOpen(false);
      })
      .catch((error: unknown) => {
        toast.error(t("accounts.switchFailed", { error: error instanceof Error ? error.message : String(error) }));
      })
      .finally(() => setSwitchingProvider(null));
  };

  const handleOpenSettings = () => {
    void bridge.openSettings();
    setOpen(false);
  };

  const handleOpenMCPServers = () => {
    setMCPModalOpen(true);
    setOpen(false);
  };

  const handleChangeWorkDir = () => {
    useSettingsStore.getState().setWorkDirModalOpen(true);
    setOpen(false);
  };

  const handleReset = () => {
    setOpen(false);
    void bridge.reloadWebview();
  };

  const handleShowLogs = () => {
    void bridge.showLogs();
    setOpen(false);
  };

  const handleSetLanguage = (language: "en" | "zh") => {
    void bridge.setLanguage(language);
    setOpen(false);
  };

  // Optimistic flip; the ExtensionConfigChanged broadcast confirms the write.
  // The popover stays open so the toggle feels like a setting, not a command.
  // A failed write rolls the flip back loudly — a silently dropped save looked
  // exactly like "the setting is lost on reload".
  const handleToggleCompactComposer = (enabled: boolean) => {
    useSettingsStore.getState().setExtensionConfig({ ...extensionConfig, compactComposer: enabled });
    void bridge.setCompactComposer(enabled).catch((error: unknown) => {
      useSettingsStore.getState().setExtensionConfig({ ...useSettingsStore.getState().extensionConfig, compactComposer: !enabled });
      toast.error(t("toast.saveSettingFailed", { error: error instanceof Error ? error.message : String(error) }));
    });
  };

  const handleAuthAction = async () => {
    setLoading(true);
    try {
      if (isLoggedIn) {
        await bridge.logout();
        setIsLoggedIn(false);
      } else {
        const result = await bridge.login();
        if (result.success) {
          setIsLoggedIn(true);
        } else {
          toast.error(result.error ?? t("menu.signInFailed"));
        }
      }
    } finally {
      setLoading(false);
      setOpen(false);
    }
    onAuthAction?.();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" className={cn("text-muted-foreground", className)}>
          <IconSettings className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[calc(100vw-1rem)] max-w-72 p-1.5 gap-0!" align="end" side="top">
        <MenuSection title={t("menu.settings")}>
          <MenuItem onClick={handleChangeWorkDir}>
            <IconFolder className="size-4 text-muted-foreground" />
            <span className="flex-1">{t("menu.workingDirectory")}</span>
          </MenuItem>
          <MenuItem onClick={handleOpenMCPServers}>
            <IconServer className="size-4 text-muted-foreground" />
            <span className="flex-1">{t("menu.mcpServers")}</span>
          </MenuItem>
          <MenuItem onClick={handleOpenSettings}>
            <IconSettings className="size-4 text-muted-foreground" />
            <span className="flex-1">{t("menu.generalConfig")}</span>
            <span className="text-[10px] text-muted-foreground">↗</span>
          </MenuItem>
        </MenuSection>

        <Separator className="my-px" />

        <MenuSection title={t("menu.language")}>
          <MenuItem
            onClick={() => {
              handleSetLanguage("en");
            }}
          >
            <IconLanguage className="size-4 text-muted-foreground" />
            <span className="flex-1">English</span>
            <IconCheck className={cn("size-4", extensionConfig.language === "en" ? "text-blue-500" : "opacity-0")} />
          </MenuItem>
          <MenuItem
            onClick={() => {
              handleSetLanguage("zh");
            }}
          >
            <IconLanguage className="size-4 text-muted-foreground" />
            <span className="flex-1">中文</span>
            <IconCheck className={cn("size-4", extensionConfig.language === "zh" ? "text-blue-500" : "opacity-0")} />
          </MenuItem>
        </MenuSection>

        <Separator className="my-px" />

        <div className="py-1">
          <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
            <IconViewportNarrow className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">
              {t("menu.compactComposer")}
              <span className="block text-[10px] text-muted-foreground leading-snug">{t("menu.compactComposerDesc")}</span>
            </span>
            <Switch
              size="sm"
              checked={extensionConfig.compactComposer}
              onCheckedChange={handleToggleCompactComposer}
              aria-label={t("menu.compactComposer")}
            />
          </div>
        </div>

        <Separator className="my-px" />

        <MenuSection title={t("menu.manageAccounts")}>
          {accounts.map((account) => {
            const usage = usageByProvider[account.provider];
            const quota = account.loggedIn && usage !== undefined && usage !== null && usage !== "error"
              ? {
                  fiveHour: quotaWindowState(usage.fiveHour, null) ?? { ratio: null },
                  weekly: quotaWindowState(usage.summary, null) ?? { ratio: null },
                }
              : undefined;
            return (
              <MenuItem key={account.provider} onClick={() => handleSwitchAccount(account)}>
                <span className={cn("size-1.5 rounded-full shrink-0 ml-2", account.loggedIn ? "bg-green-500" : "bg-muted-foreground/40")} />
                <span className="truncate">
                  {account.displayName ?? account.nickname ?? t("accounts.accountN", { slot: account.slot })}
                </span>
                {account.isDefault === true && <span className="text-[9px] text-blue-500 shrink-0">{t("accounts.defaultBadge")}</span>}
                {switchingProvider === account.provider
                  ? <IconLoader2 className="size-3.5 animate-spin text-muted-foreground shrink-0" />
                  : account.provider === currentProvider && <IconCheck className="size-3.5 text-blue-500 shrink-0" />}
                <span className="flex-1" />
                {quota !== undefined && (
                  <span onClick={(e) => e.stopPropagation()} className="shrink-0 flex items-center">
                    <QuotaRings fiveHour={quota.fiveHour} weekly={quota.weekly} now={now} />
                  </span>
                )}
              </MenuItem>
            );
          })}
          <MenuItem onClick={handleOpenAccounts}>
            <IconUsers className="size-4 text-muted-foreground" />
            <span className="flex-1">{t("accounts.manage")}</span>
            <IconChevronRight className="size-3.5 text-muted-foreground" />
          </MenuItem>
        </MenuSection>

        <Separator className="my-px" />

        <MenuSection title={t("menu.support")} subtitle={extensionConfig.version ? `v${extensionConfig.version}` : undefined}>
          <MenuItem onClick={handleShowLogs}>
            <IconFileText className="size-4 text-muted-foreground" />
            <span className="flex-1">{t("menu.showLogs")}</span>
          </MenuItem>
          <MenuItem onClick={handleReset}>
            <IconRefresh className="size-4 text-muted-foreground" />
            <span className="flex-1">{t("menu.resetKimi")}</span>
          </MenuItem>
        </MenuSection>

        <Separator className="my-px" />

        <MenuSection title={t("menu.account")}>
          <MenuItem
            onClick={() => {
              void handleAuthAction();
            }}
            disabled={loading}
            danger={isLoggedIn}
          >
            {loading ? <IconLoader2 className="size-4 animate-spin" /> : isLoggedIn ? <IconLogout className="size-4" /> : <IconLogin className="size-4 text-muted-foreground" />}
            <span className="flex-1">{loading ? t("menu.processing") : isLoggedIn ? t("menu.signOut") : t("menu.signIn")}</span>
          </MenuItem>
        </MenuSection>
      </PopoverContent>
    </Popover>
  );
}
