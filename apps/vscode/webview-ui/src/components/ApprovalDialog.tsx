import { useState, useEffect } from "react";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { useApprovalStore } from "@/stores";
import type { ApprovalRequest } from "@/stores";
import { bridge } from "@/services";
import { DisplayBlocks } from "./DisplayBlocks";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ApprovalResponse } from "shared/legacy-sdk";

interface PlanReviewOption {
  label: string;
  description?: string;
}

interface PlanReviewInfo {
  plan: string;
  path?: string;
  options: PlanReviewOption[];
}

export function ApprovalDialog() {
  const pending = useApprovalStore((s) => s.pending);
  const req = pending[0];

  if (!req) return null;
  const planReview = planReviewInfo(req);
  // key={req.id} resets all local state when the next request dequeues.
  return planReview === undefined
    ? <GenericApprovalDialog key={req.id} req={req} />
    : <PlanReviewDialog key={req.id} req={req} info={planReview} />;
}

function GenericApprovalDialog({ req }: { req: ApprovalRequest }) {
  const t = useT();
  const { respondToRequest } = useApprovalStore();
  const [selectedIndex, setSelectedIndex] = useState(1);
  const [expanded, setExpanded] = useState(false);

  // Auto-expand if there's a diff block (code change)
  useEffect(() => {
    const hasDiff = req.display?.some((b) => b.type === "diff") ?? false;
    setExpanded(hasDiff);
  }, [req.id]);

  const hasDisplay = req.display && req.display.length > 0;

  const handleResponse = async (response: ApprovalResponse) => {
    await respondToRequest(req.id, response);
  };

  const options = [
    { key: "approve", label: t("approval.yes"), index: 1 },
    { key: "approve_for_session", label: t("approval.yesForSession"), index: 2 },
    { key: "reject", label: t("approval.no"), index: 3 },
  ] as const;

  return (
    <div className={cn("mb-0.5 border border-blue-200 dark:border-blue-800 rounded-lg overflow-hidden bg-background flex flex-col shrink")}>
      <div className="p-2 space-y-2 flex-1 min-h-0 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between shrink-0">
          <div className="text-xs font-semibold text-foreground">{t("approval.allowThis", { action: req.action.toLowerCase() })}</div>
          {hasDisplay && (
            <button onClick={() => setExpanded(!expanded)} className="p-1 hover:bg-muted rounded transition-colors">
              {expanded ? <IconChevronDown className="size-4 text-muted-foreground" /> : <IconChevronUp className="size-4 text-muted-foreground" />}
            </button>
          )}
        </div>

        <div className="text-xs text-foreground/90 break-all leading-relaxed bg-muted/30 py-2 px-2 rounded shrink-0 max-h-20 overflow-y-auto font-mono">{req.description}</div>

        {hasDisplay && (
          <div className={cn("overflow-y-auto", expanded ? "flex-1 min-h-0" : "max-h-24")}>
            <DisplayBlocks blocks={req.display} maxHeight={expanded ? "max-h-none" : "max-h-20"} />
          </div>
        )}

        <div className="text-xs text-muted-foreground shrink-0">{req.sender}</div>

        <div className="space-y-1.5 pt-1 shrink-0">
          {options.map((opt) => (
            <button
              key={opt.key}
              onClick={() => {
                void handleResponse(opt.key);
              }}
              onMouseEnter={() => setSelectedIndex(opt.index)}
              className={cn(
                "w-full text-left px-2 py-1 rounded-md text-xs transition-colors",
                "border border-border cursor-pointer",
                selectedIndex === opt.index ? "bg-blue-500 text-white border-blue-500" : "bg-background hover:bg-muted/50",
              )}
            >
              <span className={cn("mr-2", selectedIndex === opt.index ? "text-blue-200" : "text-muted-foreground")}>{opt.index}</span>
              <span className="font-medium">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PlanReviewDialog({ req, info }: { req: ApprovalRequest; info: PlanReviewInfo }) {
  const t = useT();
  const { respondToRequest } = useApprovalStore();
  const [expanded, setExpanded] = useState(true);
  const [planContent, setPlanContent] = useState<string | null>(info.path === undefined ? info.plan : null);
  const [planError, setPlanError] = useState<string | null>(null);
  // True once the plan file was successfully opened in a VSCode editor tab —
  // the inline preview then collapses to a note (the editor is the review
  // surface); on failure the inline preview stays as the fallback.
  const [openedInEditor, setOpenedInEditor] = useState(false);
  const [selectedOption, setSelectedOption] = useState(0);
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState("");

  // Open the plan in the editor as soon as the review is raised, so the user
  // reads the real file in VSCode before confirming execution in the dialog.
  // Plan files live outside the workspace, so this goes through the dedicated
  // openPlanFile bridge (openFile only allows workspace files and fails
  // silently). key={req.id} on this component makes the effect fire once per
  // request.
  useEffect(() => {
    if (info.path === undefined) return;
    let cancelled = false;
    bridge.openPlanFile(info.path).then(
      ({ ok }) => {
        if (!cancelled) setOpenedInEditor(ok);
      },
      () => {
        if (!cancelled) setOpenedInEditor(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [info.path]);

  // Read the plan file fresh on open — the user may have edited it since the
  // request was raised. Fall back to the snapshot carried by the request.
  useEffect(() => {
    if (info.path === undefined) return;
    let cancelled = false;
    bridge.readPlanFile(info.path).then(
      (content) => {
        if (!cancelled) setPlanContent(content);
      },
      (error: unknown) => {
        if (cancelled) return;
        setPlanError(error instanceof Error ? error.message : String(error));
        setPlanContent(info.plan);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [info.path, info.plan]);

  const selected = info.options[selectedOption];

  const execute = async () => {
    await respondToRequest(
      req.id,
      selected === undefined ? "approve" : { decision: "approve", selectedLabel: selected.label },
    );
  };

  const submitRevision = async () => {
    const text = feedback.trim();
    if (text.length === 0) return;
    await respondToRequest(req.id, { decision: "reject", selectedLabel: "Revise", feedback: text });
  };

  return (
    <div className={cn("mb-0.5 border border-blue-200 dark:border-blue-800 rounded-lg overflow-hidden bg-background flex flex-col shrink")}>
      <div className="p-2 space-y-2 flex-1 min-h-0 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between shrink-0">
          <div className="text-xs font-semibold text-foreground">{t("approval.executeThisPlan")}</div>
          <button onClick={() => setExpanded(!expanded)} className="p-1 hover:bg-muted rounded transition-colors">
            {expanded ? <IconChevronDown className="size-4 text-muted-foreground" /> : <IconChevronUp className="size-4 text-muted-foreground" />}
          </button>
        </div>

        <div className={cn("overflow-y-auto rounded bg-muted/30 py-2 px-2", expanded ? "flex-1 min-h-0" : "max-h-24 shrink-0")}>
          {openedInEditor && info.path !== undefined ? (
            <div className="text-xs text-muted-foreground flex items-center justify-between gap-2">
              <span>{t("approval.planOpenedInEditor")}</span>
              <button
                onClick={() => {
                  const planPath = info.path;
                  if (planPath !== undefined) void bridge.openPlanFile(planPath).catch(() => undefined);
                }}
                className="text-blue-500 hover:underline shrink-0 cursor-pointer"
              >
                {t("approval.reopenPlan")}
              </button>
            </div>
          ) : (
            <>
              {planError !== null && (
                <div className="text-xs text-red-600 dark:text-red-400 mb-1 break-all">
                  {t("approval.failedToLoad", { path: info.path ?? "", error: planError })}
                </div>
              )}
              {planContent === null ? (
                <div className="text-xs text-muted-foreground">{t("approval.loadingPlan")}</div>
              ) : (
                <div className="text-xs text-foreground/90 whitespace-pre-wrap break-words leading-relaxed">{planContent}</div>
              )}
            </>
          )}
        </div>

        {info.path !== undefined && (
          <div className="text-[10px] text-muted-foreground shrink-0 truncate">{info.path}</div>
        )}

        {info.options.length > 0 && (
          <div className="space-y-1 shrink-0">
            {info.options.map((option, idx) => (
              <button
                key={option.label}
                onClick={() => setSelectedOption(idx)}
                className={cn(
                  "w-full text-left px-2 py-1 rounded-md text-xs transition-colors",
                  "border border-border cursor-pointer",
                  selectedOption === idx ? "bg-blue-500 text-white border-blue-500" : "bg-background hover:bg-muted/50",
                )}
              >
                <span className={cn("mr-2", selectedOption === idx ? "text-blue-200" : "text-muted-foreground")}>
                  {selectedOption === idx ? "●" : "○"}
                </span>
                <span className="font-medium">{option.label}</span>
                {option.description !== undefined && option.description.length > 0 && (
                  <span className={cn("ml-2", selectedOption === idx ? "text-blue-200" : "text-muted-foreground")}>- {option.description}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {revising ? (
          <div className="space-y-1.5 pt-1 shrink-0">
            <textarea
              autoFocus
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setRevising(false);
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submitRevision();
              }}
              placeholder={t("approval.revisePlaceholder")}
              rows={3}
              className="w-full px-2 py-1 rounded-md text-xs border border-border bg-background outline-none focus:border-blue-500 resize-none"
            />
            <div className="flex gap-1.5">
              <button
                onClick={() => {
                  void submitRevision();
                }}
                disabled={feedback.trim().length === 0}
                className="px-2 py-1 rounded-md text-xs bg-blue-500 text-white disabled:opacity-50 cursor-pointer"
              >
                {t("approval.sendFeedback")}
              </button>
              <button
                onClick={() => setRevising(false)}
                className="px-2 py-1 rounded-md text-xs border border-border bg-background hover:bg-muted/50 cursor-pointer"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5 pt-1 shrink-0">
            <button
              onClick={() => {
                void execute();
              }}
              className="w-full text-left px-2 py-1 rounded-md text-xs transition-colors border cursor-pointer bg-blue-500 text-white border-blue-500"
            >
              <span className="mr-2 text-blue-200">1</span>
              <span className="font-medium">{t("approval.execute")}</span>
            </button>
            <button
              onClick={() => setRevising(true)}
              className="w-full text-left px-2 py-1 rounded-md text-xs transition-colors border border-border cursor-pointer bg-background hover:bg-muted/50"
            >
              <span className="mr-2 text-muted-foreground">2</span>
              <span className="font-medium">{t("approval.revise")}</span>
            </button>
            <button
              onClick={() => {
                void respondToRequest(req.id, "reject");
              }}
              className="w-full text-left px-2 py-1 rounded-md text-xs transition-colors border border-border cursor-pointer bg-background hover:bg-muted/50"
            >
              <span className="mr-2 text-muted-foreground">3</span>
              <span className="font-medium">{t("approval.reject")}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function planReviewInfo(req: ApprovalRequest): PlanReviewInfo | undefined {
  const block = req.display.find((b) => b.type === "plan_review") as unknown as Record<string, unknown> | undefined;
  if (block === undefined) {
    // Hosts without the structured block only identify plan reviews by tool.
    return req.sender === "ExitPlanMode" ? { plan: req.description, options: [] } : undefined;
  }
  const plan = typeof block["plan"] === "string" ? block["plan"] : req.description;
  const path = typeof block["path"] === "string" ? block["path"] : undefined;
  return { plan, ...(path === undefined ? {} : { path }), options: planReviewOptions(block["options"]) };
}

function planReviewOptions(value: unknown): PlanReviewOption[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is PlanReviewOption =>
      typeof item === "object" && item !== null && typeof (item as { label?: unknown }).label === "string",
  );
}
