import { IconBolt, IconCheck, IconRocket, IconShield, IconShieldCheck } from "@tabler/icons-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT, type TranslationKey } from "@/i18n";
import { cn } from "@/lib/utils";
import type { PermissionMode } from "shared/types";

interface YoloModeButtonProps {
  mode: PermissionMode;
  disabled?: boolean;
  onSelect: (mode: PermissionMode) => void;
}

const MODE_ORDER: PermissionMode[] = ["manual", "yolo", "auto"];

const MODE_LABEL_KEYS: Record<PermissionMode, TranslationKey> = {
  manual: "permMode.manual",
  yolo: "permMode.yolo",
  auto: "permMode.auto",
};

const MODE_TOOLTIP_KEYS: Record<PermissionMode, TranslationKey> = {
  manual: "permMode.tooltipManual",
  yolo: "permMode.tooltipYolo",
  auto: "permMode.tooltipAuto",
};

const MODE_DESC_KEYS: Record<PermissionMode, TranslationKey> = {
  manual: "permMode.descManual",
  yolo: "permMode.descYolo",
  auto: "permMode.descAuto",
};

const MODE_ICONS: Record<PermissionMode, typeof IconShieldCheck> = {
  manual: IconShieldCheck,
  yolo: IconRocket,
  auto: IconBolt,
};

/** Escalating autonomy: manual is muted, yolo (auto-approve) amber, auto
 *  (fully autonomous, questions auto-dismissed) destructive red. */
const MODE_TEXT_COLOR: Record<PermissionMode, string> = {
  manual: "text-muted-foreground",
  yolo: "text-amber-500",
  auto: "text-destructive",
};

/** Per-session permission-mode picker: the button shows a shield plus the
 *  session's current mode; each dropdown row carries the mode's name and a
 *  one-line description of its behavior. */
export function YoloModeButton({ mode, disabled, onSelect }: YoloModeButtonProps) {
  const t = useT();
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button
              type="button"
              disabled={disabled}
              className={cn(
                "flex items-center gap-1 justify-center h-6 px-1.5 rounded-md transition-all text-xs",
                mode === "auto" && "bg-destructive/15 text-destructive hover:bg-destructive/25",
                mode === "yolo" && "bg-amber-500/15 text-amber-500 hover:bg-amber-500/25",
                mode === "manual" && "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
                disabled ? "cursor-default" : "cursor-pointer",
              )}
            >
              <IconShield className="size-3.5" />
              <span className="leading-none">{t(MODE_LABEL_KEYS[mode])}</span>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t(MODE_TOOLTIP_KEYS[mode])}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-60">
        {MODE_ORDER.map((option) => {
          const OptionIcon = MODE_ICONS[option];
          return (
            <DropdownMenuItem key={option} onClick={() => onSelect(option)} className="items-start gap-2 px-2 py-1.5 cursor-pointer">
              <OptionIcon className={cn("size-3.5 mt-0.5", MODE_TEXT_COLOR[option])} />
              <span className="flex-1 min-w-0">
                <span className={cn("block text-xs leading-tight", MODE_TEXT_COLOR[option])}>{t(MODE_LABEL_KEYS[option])}</span>
                <span className="block text-[10px] leading-snug whitespace-normal text-muted-foreground">
                  {t(MODE_DESC_KEYS[option])}
                </span>
              </span>
              <IconCheck className={cn("size-3.5 mt-0.5", option !== mode && "opacity-0")} />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
