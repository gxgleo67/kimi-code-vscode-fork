import { Fragment, useMemo, useState } from "react";
import { IconRobot } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getModelById, groupModelsByProvider, useSettingsStore } from "@/stores";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { CustomProviderSection } from "./CustomProviderSection";
import type { ModelConfig, SecondaryModelSelection } from "shared/legacy-sdk";

const SECONDARY_MODEL_DOCS_URL =
  "https://github.com/MoonshotAI/kimi-code/blob/main/docs/zh/configuration/config-files.md";
// Runtime artifact of a [secondary_model] recipe with patch fields — the host
// already filters it out of the model list; this is the picker-side backstop.
const SECONDARY_DERIVED_MODEL_ALIAS = "__secondary__";

interface SubagentModelDialogProps {
  disabled?: boolean;
  /** Controlled open state — when provided, no trigger button is rendered and
   *  the caller owns opening (used by the overflow menu). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function RadioRow({
  selected,
  label,
  suffix,
  onSelect,
}: {
  selected: boolean;
  label: string;
  suffix?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-xs transition-colors cursor-pointer",
        selected ? "bg-accent" : "hover:bg-accent/50",
      )}
    >
      <span
        className={cn(
          "flex size-3.5 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-blue-500" : "border-muted-foreground/40",
        )}
      >
        {selected && <span className="size-1.5 rounded-full bg-blue-500" />}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {suffix !== undefined && <span className="text-[10px] text-muted-foreground shrink-0">{suffix}</span>}
    </button>
  );
}

/**
 * Subagent (secondary) model settings: an icon button next to the thinking
 * button that opens a dialog instead of a dropdown, keeping the button row
 * free of a second model selector. Picking a row saves immediately via
 * updateSecondaryModel ("Follow main model" clears the recipe) and closes.
 *
 * Custom-provider management (e.g. DeepSeek) lives in CustomProviderSection,
 * shared with the accounts modal.
 */
export function SubagentModelDialog({ disabled, open: controlledOpen, onOpenChange: controlledOnOpenChange }: SubagentModelDialogProps) {
  const { models, secondaryModel, updateSecondaryModel } = useSettingsStore();
  const t = useT();
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    controlledOnOpenChange?.(next);
  };
  const modelGroups = useMemo(
    () => groupModelsByProvider(models.filter((model) => model.id !== SECONDARY_DERIVED_MODEL_ALIAS)),
    [models],
  );
  const showProviderGroups = modelGroups.length > 1;
  const hasModels = models.length > 0;
  const selectedModel = secondaryModel === null ? undefined : getModelById(models, secondaryModel.model);
  const label = selectedModel?.name ?? secondaryModel?.model;

  const handleSelect = (selection: SecondaryModelSelection | null) => {
    updateSecondaryModel(selection);
    setOpen(false);
  };

  return (
    <>
      {!isControlled && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setOpen(true)}
              disabled={disabled || !hasModels}
              className={cn(
                "relative flex items-center justify-center size-6 rounded-md transition-all",
                "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
                !disabled && hasModels ? "cursor-pointer" : "cursor-default",
              )}
            >
              <IconRobot className="size-4" />
              {secondaryModel !== null && (
                <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-blue-500" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {t("subagent.tooltip", { label: label ?? t("subagent.followsMain") })}
          </TooltipContent>
        </Tooltip>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("subagent.title")}</DialogTitle>
            <DialogDescription className="text-xs">{t("subagent.description")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1 max-h-64 overflow-y-auto -mx-1 px-1">
            <RadioRow
              selected={secondaryModel === null}
              label={t("subagent.followMain")}
              suffix={t("subagent.defaultSuffix")}
              onSelect={() => handleSelect(null)}
            />
            {modelGroups.map((group) => (
              <Fragment key={group.provider}>
                {showProviderGroups && (
                  <div className="px-3 pt-2 pb-1 text-[10px] text-muted-foreground uppercase tracking-wider">
                    {group.label}
                  </div>
                )}
                {group.models.map((model) => (
                  <RadioRow
                    key={model.id}
                    selected={secondaryModel?.model === model.id}
                    label={model.name}
                    onSelect={() => handleSelect({ model: model.id })}
                  />
                ))}
              </Fragment>
            ))}
          </div>

          <div className="pt-2 border-t border-border/50">
            <CustomProviderSection />
          </div>

          <div className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            <p>{t("subagent.infoBody")}</p>
            <p className="mt-1.5">
              {t("subagent.infoExperimental")}{" "}
              <a
                href={SECONDARY_MODEL_DOCS_URL}
                className="underline underline-offset-2 hover:text-foreground"
              >
                {t("subagent.docsLink")}
              </a>
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
