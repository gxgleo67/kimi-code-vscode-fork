import { useState } from "react";
import { IconSettings, IconServer, IconLogout, IconLogin, IconLoader2, IconRefresh, IconFileText, IconFolder, IconCheck, IconLanguage, IconRecycle } from "@tabler/icons-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/stores";
import { bridge } from "@/services";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";

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
  const { setMCPModalOpen, isLoggedIn, setIsLoggedIn, extensionConfig } = useSettingsStore();
  const t = useT();

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
  const handleToggleAutoCompact = (enabled: boolean) => {
    useSettingsStore.getState().setExtensionConfig({ ...extensionConfig, autoCompactContext: enabled });
    void bridge.setAutoCompactContext(enabled).catch(() => undefined);
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
            <IconRecycle className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">
              {t("menu.autoCompact")}
              <span className="block text-[10px] text-muted-foreground leading-snug">{t("menu.autoCompactDesc")}</span>
            </span>
            <Switch
              size="sm"
              checked={extensionConfig.autoCompactContext}
              onCheckedChange={handleToggleAutoCompact}
              aria-label={t("menu.autoCompact")}
            />
          </div>
        </div>

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
