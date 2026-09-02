import { useMemo, useState } from "react";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { useSettingsStore } from "@/stores";
import { bridge } from "@/services";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import type { CustomProviderDetails, KimiConfig, ModelConfig } from "shared/legacy-sdk";

// Mirrors the host-side ALIAS_PATTERN in src/config/custom-providers.ts.
const ALIAS_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const PROVIDER_TYPES = ["openai", "anthropic", "kimi"] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * VS Code–managed custom providers (e.g. DeepSeek): list + add/edit form +
 * delete confirm, shared by the subagent model dialog and the accounts modal.
 * Adding one stores the API key in Secret Storage and writes only an
 * api_key_env_var reference to config.toml; removing one strips both config
 * sections and deletes the key.
 */
export function CustomProviderSection({ title }: { title?: string }) {
  const { models, syncModelsConfig } = useSettingsStore();
  const t = useT();
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CustomProviderDetails | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ModelConfig | null>(null);
  const [deleting, setDeleting] = useState(false);
  const customModels = useMemo(() => models.filter((model) => model.custom === true), [models]);

  const handleAdded = (config: KimiConfig, alias: string) => {
    syncModelsConfig(config);
    setFormOpen(false);
    toast.success(t("subagent.added", { alias }));
  };

  const handleEdited = (config: KimiConfig, alias: string) => {
    syncModelsConfig(config);
    setEditTarget(null);
    toast.success(t("subagent.updated", { alias }));
  };

  const handleEditStart = async (model: ModelConfig) => {
    try {
      const details = await bridge.getCustomProvider(model.provider);
      setFormOpen(false);
      setEditTarget(details);
    } catch (error) {
      toast.error(t("subagent.error.loadFailed", { error: errorMessage(error) }));
    }
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
    <div className="space-y-2">
      <div className="px-1 text-[10px] text-muted-foreground uppercase tracking-wider">
        {title ?? t("subagent.customProviders")}
      </div>
      {customModels.map((model) => (
        <div key={model.id} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/30">
          <span className="flex-1 truncate text-xs">{model.name}</span>
          <span className="text-[10px] text-muted-foreground shrink-0">{model.provider}</span>
          <button
            type="button"
            onClick={() => {
              void handleEditStart(model);
            }}
            title={t("subagent.edit")}
            className="text-muted-foreground hover:text-foreground p-1 cursor-pointer"
          >
            <IconPencil className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => setDeleteTarget(model)}
            className="text-muted-foreground hover:text-destructive p-1 cursor-pointer"
          >
            <IconTrash className="size-3" />
          </button>
        </div>
      ))}
      {!formOpen && editTarget === null && (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <IconPlus className="size-3.5" />
          {t("subagent.addCustomProvider")}
        </button>
      )}
      {formOpen && editTarget === null && (
        <CustomProviderForm onAdded={handleAdded} onCancel={() => setFormOpen(false)} />
      )}
      {editTarget !== null && (
        <CustomProviderForm
          key={editTarget.alias}
          initial={editTarget}
          onAdded={handleEdited}
          onCancel={() => setEditTarget(null)}
        />
      )}

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
    </div>
  );
}

export function CustomProviderForm({
  initial,
  onAdded,
  onCancel,
}: {
  /** When set, the form edits that provider: the alias is locked and the API
   *  key may be left empty to keep the stored secret. */
  initial?: CustomProviderDetails;
  onAdded: (config: KimiConfig, alias: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const isEdit = initial !== undefined;
  const [alias, setAlias] = useState(initial?.alias ?? "");
  const [providerType, setProviderType] = useState<(typeof PROVIDER_TYPES)[number]>(
    PROVIDER_TYPES.includes(initial?.providerType as (typeof PROVIDER_TYPES)[number])
      ? (initial?.providerType as (typeof PROVIDER_TYPES)[number])
      : "openai",
  );
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [modelId, setModelId] = useState(initial?.modelId ?? "");
  const [maxContextSize, setMaxContextSize] = useState(String(initial?.maxContextSize ?? 131072));
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmedAlias = alias.trim();
    if (
      trimmedAlias.length === 0 ||
      baseUrl.trim().length === 0 ||
      modelId.trim().length === 0 ||
      // Editing keeps the stored secret when the key field is left empty.
      (!isEdit && apiKey.trim().length === 0)
    ) {
      setError(t("subagent.error.required"));
      return;
    }
    if (!isEdit && !ALIAS_PATTERN.test(trimmedAlias)) {
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
      setError(
        isEdit
          ? t("subagent.error.saveFailed", { error: errorMessage(submitError) })
          : t("subagent.error.addFailed", { error: errorMessage(submitError) }),
      );
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
            disabled={isEdit}
            className={cn("h-7 text-xs font-mono", isEdit && "opacity-60")}
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
          {isEdit ? t("subagent.form.apiKeyKeepHint") : t("subagent.form.securityNote")}
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
          {submitting
            ? isEdit
              ? t("subagent.form.saving")
              : t("subagent.form.submitting")
            : isEdit
              ? t("subagent.form.submitEdit")
              : t("subagent.form.submit")}
        </Button>
      </div>
    </div>
  );
}
