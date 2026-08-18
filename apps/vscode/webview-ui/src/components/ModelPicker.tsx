import { useState } from "react";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ModelPickerDialog } from "./ModelPickerDialog";
import { getModelById, groupModelsByProvider, useSettingsStore } from "@/stores";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { useFavoriteModels } from "./inputarea/hooks/useFavoriteModels";
import type { ModelConfig } from "shared/legacy-sdk";

interface ModelPickerProps {
  /** Media-filtered model list — the only models safe to switch to. */
  availableModels: ModelConfig[];
  /** Mid-conversation switches lose the prompt cache — surface the cost note. */
  hasConversationHistory: boolean;
  disabled?: boolean;
}

function effortLabel(effort: string): string {
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

/** Model switcher: the pill shows "name · effort" and opens a quick dropdown
 *  (starred + current-provider models, thinking segments, cache note); the
 *  full searchable picker lives behind "More models...". */
export function ModelPicker({ availableModels, hasConversationHistory, disabled }: ModelPickerProps) {
  const t = useT();
  const currentModel = useSettingsStore((s) => s.currentModel);
  const models = useSettingsStore((s) => s.models);
  const thinkingEffort = useSettingsStore((s) => s.thinkingEffort);
  const updateModel = useSettingsStore((s) => s.updateModel);
  const selectThinkingEffort = useSettingsStore((s) => s.selectThinkingEffort);
  const getCurrentThinkingMode = useSettingsStore((s) => s.getCurrentThinkingMode);
  const { favorites } = useFavoriteModels();
  const [dialogOpen, setDialogOpen] = useState(false);

  const hasModels = availableModels.length > 0;
  // The button label reads from the full list: a media-incompatible current
  // model still has a name worth showing until the auto-switch lands.
  const currentModelConfig = getModelById(models, currentModel);
  const thinkingMode = getCurrentThinkingMode();
  const alwaysOn = currentModelConfig?.capabilities.includes("always_thinking") === true;

  const currentProvider = currentModelConfig?.provider;
  const currentProviderGroup = groupModelsByProvider(availableModels).find((group) => group.provider === currentProvider);
  const favoriteModels = availableModels.filter(
    (model) => favorites.includes(model.id) && model.provider !== currentProvider,
  );

  const thinkingOptions =
    thinkingMode === "effort"
      ? alwaysOn
        ? (currentModelConfig?.support_efforts ?? [])
        : ["off", ...(currentModelConfig?.support_efforts ?? [])]
      : thinkingMode === "switch"
        ? ["on", "off"]
        : thinkingMode === "always"
          ? ["on"]
          : [];

  // always-on models still take an effort tier (Low/High/Max) — only the off
  // switch is gone. Readonly is for models with no tier choice at all.
  const thinkingReadonly = thinkingOptions.length <= 1;

  const thinkingSegmentLabel = (option: string): string => {
    if (option === "off") return t("modelPicker.thinkingOff");
    if (option === "on") return t("modelPicker.thinkingOn");
    return effortLabel(option);
  };

  const showEffortSuffix = thinkingEffort !== "" && thinkingEffort !== "off";
  const buttonLabel = currentModelConfig === undefined ? t("input.noModels") : currentModelConfig.name;

  const modelItem = (model: ModelConfig) => (
    <DropdownMenuItem
      key={model.id}
      onClick={() => updateModel(model.id)}
      className={cn("text-xs px-2 py-1.5 cursor-pointer", currentModel === model.id && "bg-accent")}
    >
      <span className="flex-1 min-w-0 truncate">{model.name}</span>
      <IconCheck className={cn("size-3", currentModel !== model.id && "opacity-0")} />
    </DropdownMenuItem>
  );

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild disabled={disabled}>
              <button
                type="button"
                disabled={disabled}
                className={cn(
                  "flex items-center gap-0.5 h-6 px-1.5 min-w-0 rounded-md transition-all text-xs",
                  "bg-muted/50 text-muted-foreground",
                  disabled ? "cursor-default" : "cursor-pointer hover:bg-muted hover:text-foreground",
                )}
              >
                <span className="flex min-w-0 items-center">
                  <span className="truncate">{buttonLabel}</span>
                  {currentModelConfig !== undefined && showEffortSuffix && (
                    <span className="shrink-0 text-blue-500">{" · "}{effortLabel(thinkingEffort)}</span>
                  )}
                </span>
                {hasModels && <IconChevronDown className="size-3.5 shrink-0" />}
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{buttonLabel}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent className="w-56" align="end">
          {favoriteModels.length > 0 && (
            <>
              <DropdownMenuLabel>{t("modelPicker.favorites")}</DropdownMenuLabel>
              {favoriteModels.map(modelItem)}
              <DropdownMenuSeparator />
            </>
          )}
          {currentProviderGroup !== undefined && (
            <>
              <DropdownMenuLabel>{currentProviderGroup.label}</DropdownMenuLabel>
              {currentProviderGroup.models.map(modelItem)}
            </>
          )}
          {thinkingOptions.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5">
                <div className="mb-1 text-xs font-medium text-muted-foreground">{t("modelPicker.thinking")}</div>
                {thinkingReadonly ? (
                  <div className="text-xs leading-snug text-muted-foreground">{t("thinking.alwaysOn")}</div>
                ) : (
                  <div className="flex gap-1 rounded-md bg-muted/50 p-1">
                    {thinkingOptions.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => selectThinkingEffort(option)}
                        className={cn(
                          "flex-1 rounded px-2 py-1 text-sm font-semibold transition-colors cursor-pointer",
                          option === thinkingEffort ? "bg-blue-500 text-white shadow-sm" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {thinkingSegmentLabel(option)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          {hasConversationHistory && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-[10px] leading-snug whitespace-normal text-muted-foreground">
                {t("input.switchCacheNote")}
              </div>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setDialogOpen(true)} className="text-xs px-2 py-1.5 cursor-pointer">
            {t("modelPicker.more")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ModelPickerDialog open={dialogOpen} onOpenChange={setDialogOpen} models={availableModels} />
    </>
  );
}
