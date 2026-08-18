import { Fragment, useMemo, useState } from "react";
import { IconPlus, IconRobot, IconTrash } from "@tabler/icons-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getModelById, groupModelsByProvider, useSettingsStore } from "@/stores";
import { bridge } from "@/services";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import type { KimiConfig, ModelConfig, SecondaryModelSelection } from "shared/legacy-sdk";

const SECONDARY_MODEL_DOCS_URL =
  "https://github.com/MoonshotAI/kimi-code/blob/main/docs/zh/configuration/config-files.md";
// Runtime artifact of a [secondary_model] recipe with patch fields — the host
// already filters it out of the model list; this is the picker-side backstop.
const SECONDARY_DERIVED_MODEL_ALIAS = "__secondary__";
// Mirrors the host-side ALIAS_PATTERN in src/config/custom-providers.ts.
const ALIAS_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const PROVIDER_TYPES = ["openai", "anthropic", "kimi"] as const;

interface SubagentModelDialogProps {
  disabled?: boolean;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Subagent (secondary) model settings: an icon button next to the thinking
 * button that opens a dialog instead of a dropdown, keeping the button row
 * free of a second model selector. Picking a row saves immediately via
 * updateSecondaryModel ("Follow main model" clears the recipe) and closes.
 *
 * The dialog also manages VS Code–managed custom providers (e.g. DeepSeek):
 * adding one stores the API key in Secret Storage and writes only an
 * api_key_env_var reference to config.toml; removing one strips both config
 * sections and deletes the key.
 */
export function SubagentModelDialog({ disabled }: SubagentModelDialogProps) {
  const { models, secondaryModel, updateSecondaryModel, syncModelsConfig } = useSettingsStore();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ModelConfig | null>(null);
  const [deleting, setDeleting] = useState(false);
  const modelGroups = useMemo(
    () => groupModelsByProvider(models.filter((model) => model.id !== SECONDARY_DERIVED_MODEL_ALIAS)),
    [models],
  );
  const customModels = useMemo(() => models.filter((model) => model.custom === true), [models]);
  const showProviderGroups = modelGroups.length > 1;
  const hasModels = models.length > 0;
  const selectedModel = secondaryModel === null ? undefined : getModelById(models, secondaryModel.model);
  const label = selectedModel?.name ?? secondaryModel?.model;

  const handleSelect = (selection: SecondaryModelSelection | null) => {
    updateSecondaryModel(selection);
    setOpen(false);
  };

  const handleAdded = (config: KimiConfig, alias: string) => {
    syncModelsConfig(config);
    setFormOpen(false);
    toast.success(t("subagent.added", { alias }));
  };

  const handleDelete = async () => {
    if (deleteTarget === null) return;
    setDeleting(true);
    try {
      const config = await bridge.removeCustomProvider({
        alias: deleteTarget.provider,
        modelAlias: deleteTarget.id,
      });
      syncModelsConfig(config);
      toast.success(t("subagent.removed", { alias: deleteTarget.provider }));
      setDeleteTarget(null);
    } catch (error) {
      toast.error(t("subagent.error.removeFailed", { error: errorMessage(error) }));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
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

          <div className="pt-2 border-t border-border/50 space-y-2">
            <div className="px-1 text-[10px] text-muted-foreground uppercase tracking-wider">
              {t("subagent.customProviders")}
            </div>
            {customModels.map((model) => (
              <div key={model.id} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/30">
                <span className="flex-1 truncate text-xs">{model.name}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{model.provider}</span>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(model)}
                  className="text-muted-foreground hover:text-destructive p-1 cursor-pointer"
                >
                  <IconTrash className="size-3" />
                </button>
              </div>
            ))}
            {!formOpen && (
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <IconPlus className="size-3.5" />
                {t("subagent.addCustomProvider")}
              </button>
            )}
            {formOpen && (
              <CustomProviderForm onAdded={handleAdded} onCancel={() => setFormOpen(false)} />
            )}
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

      <AlertDialog open={deleteTarget !== null} onOpenChange={(next) => !next && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("subagent.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("subagent.deleteDesc", { alias: deleteTarget?.provider ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void handleDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? t("common.deleting") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CustomProviderForm({
  onAdded,
  onCancel,
}: {
  onAdded: (config: KimiConfig, alias: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [alias, setAlias] = useState("");
  const [providerType, setProviderType] = useState<(typeof PROVIDER_TYPES)[number]>("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelId, setModelId] = useState("");
  const [maxContextSize, setMaxContextSize] = useState("131072");
  const [displayName, setDisplayName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmedAlias = alias.trim();
    if (
      trimmedAlias.length === 0 ||
      baseUrl.trim().length === 0 ||
      modelId.trim().length === 0 ||
      apiKey.trim().length === 0
    ) {
      setError(t("subagent.error.required"));
      return;
    }
    if (!ALIAS_PATTERN.test(trimmedAlias)) {
      setError(t("subagent.error.aliasInvalid"));
      return;
    }
    const contextSize = Number(maxContextSize);
    if (!Number.isInteger(contextSize) || contextSize <= 0) {
      setError(t("subagent.error.maxContext"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const config = await bridge.addCustomProvider({
        alias: trimmedAlias,
        providerType,
        baseUrl: baseUrl.trim(),
        modelId: modelId.trim(),
        maxContextSize: contextSize,
        ...(displayName.trim().length > 0 ? { displayName: displayName.trim() } : {}),
        apiKey: apiKey.trim(),
      });
      onAdded(config, trimmedAlias);
    } catch (submitError) {
      setError(t("subagent.error.addFailed", { error: errorMessage(submitError) }));
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-border/50 p-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground">{t("subagent.form.alias")}</Label>
          <Input
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            placeholder={t("subagent.form.aliasPlaceholder")}
            className="h-7 text-xs font-mono"
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">{t("subagent.form.providerType")}</Label>
          <div className="flex gap-1">
            {PROVIDER_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setProviderType(type)}
                className={cn(
                  "flex-1 h-7 text-xs rounded border flex items-center justify-center cursor-pointer",
                  providerType === type ? "border-blue-500 bg-blue-500/10 text-blue-500" : "border-border",
                )}
              >
                {type}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground">{t("subagent.form.baseUrl")}</Label>
        <Input
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder={t("subagent.form.baseUrlPlaceholder")}
          className="h-7 text-xs font-mono"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground">{t("subagent.form.modelId")}</Label>
          <Input
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            placeholder={t("subagent.form.modelIdPlaceholder")}
            className="h-7 text-xs font-mono"
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">{t("subagent.form.maxContextSize")}</Label>
          <Input
            value={maxContextSize}
            onChange={(event) => setMaxContextSize(event.target.value)}
            inputMode="numeric"
            className="h-7 text-xs font-mono"
          />
        </div>
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground">{t("subagent.form.displayName")}</Label>
        <Input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          className="h-7 text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground">{t("subagent.form.apiKey")}</Label>
        <Input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          autoComplete="off"
          className="h-7 text-xs font-mono"
        />
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          {t("subagent.form.securityNote")}
        </p>
      </div>

      {error !== null && <p className="text-[10px] text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onCancel} disabled={submitting}>
          {t("common.cancel")}
        </Button>
        <Button
          size="sm"
          className="h-6 text-xs"
          onClick={() => {
            void handleSubmit();
          }}
          disabled={submitting}
        >
          {submitting ? t("subagent.form.submitting") : t("subagent.form.submit")}
        </Button>
      </div>
    </div>
  );
}
