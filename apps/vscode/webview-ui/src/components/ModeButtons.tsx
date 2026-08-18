import { useState } from "react";
import { IconClipboardList, IconPlayerPause, IconPlayerPlay, IconSparkles, IconTarget, IconX } from "@tabler/icons-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/sonner";
import { StreamingConfirmDialog } from "./StreamingConfirmDialog";
import { bridge } from "@/services";
import { useChatStore } from "@/stores";
import { useT, type TranslationKey } from "@/i18n";
import { cn } from "@/lib/utils";
import type { GoalStateInfo } from "shared/legacy-sdk";

const GOAL_STATUS_KEYS: Record<GoalStateInfo["status"], TranslationKey> = {
  active: "modes.goalStatus.active",
  paused: "modes.goalStatus.paused",
  blocked: "modes.goalStatus.blocked",
  complete: "modes.goalStatus.complete",
};

/** The engine's goal lifecycle ends at "complete"; from the picker's
 *  perspective that is the same as having no goal — arming a new one is the
 *  only meaningful action left. */
function isGoalActive(goal: GoalStateInfo | null): goal is GoalStateInfo {
  return goal !== null && goal.status !== "complete";
}

function modeButtonClass(active: boolean): string {
  return cn(
    "flex items-center gap-1 h-6 px-1.5 rounded-md transition-all text-xs cursor-pointer",
    active
      ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 hover:bg-blue-500/25"
      : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
  );
}

/** Mode toggles as three sibling buttons — plan / goal / swarm — each with
 *  its description on hover. Plan and swarm flip immediately; the goal
 *  button arms the composer when no goal runs, and opens the goal controls
 *  (pause / resume / cancel) while one is active.
 *
 *  `compact` hides the text labels, leaving icon-only buttons that no longer
 *  deform when the sidebar narrows. */
export function ModeButtons({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const isStreaming = useChatStore((s) => s.isStreaming);
  const sessionId = useChatStore((s) => s.sessionId);
  const planMode = useChatStore((s) => s.planMode);
  const swarmMode = useChatStore((s) => s.swarmMode);
  const goal = useChatStore((s) => s.goal);
  const goalArmed = useChatStore((s) => s.goalArmed);

  const [goalMenuOpen, setGoalMenuOpen] = useState(false);
  const [showPlanModeConfirm, setShowPlanModeConfirm] = useState(false);

  const goalActive = isGoalActive(goal);

  const handleTogglePlanMode = () => {
    // Turning OFF during streaming needs confirmation — user may want next turn, not current
    if (planMode && isStreaming) {
      setShowPlanModeConfirm(true);
      return;
    }
    const newState = !planMode;
    useChatStore.setState({ planMode: newState }); // optimistic
    void bridge.setPlanMode(newState);
  };

  const handleConfirmExitPlanMode = () => {
    useChatStore.setState({ planMode: false });
    void bridge.setPlanMode(false);
    setShowPlanModeConfirm(false);
  };

  const handleToggleSwarm = () => {
    if (sessionId === null) {
      toast.info(t("modes.needSession"));
      return;
    }
    const next = !swarmMode;
    useChatStore.setState({ swarmMode: next }); // optimistic; StatusUpdate confirms
    void bridge.setSwarmMode(next).then(({ ok, swarmMode: actual }) => {
      if (!ok) {
        useChatStore.setState({ swarmMode: actual });
      }
    });
  };

  // Web-composer parity: arming goal mode does not open an inline form — the
  // composer itself becomes the goal input (placeholder switch) and the next
  // send creates the goal from the message text.
  const handleToggleGoalArm = () => {
    const next = !goalArmed;
    useChatStore.setState({ goalArmed: next });
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={handleTogglePlanMode} className={modeButtonClass(planMode)}>
            <IconClipboardList className="size-3.5" />
            {!compact && <span className="leading-none">{t("modes.plan")}</span>}
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("modes.planDesc")}</TooltipContent>
      </Tooltip>

      {goalActive ? (
        <DropdownMenu open={goalMenuOpen} onOpenChange={setGoalMenuOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button type="button" className={modeButtonClass(true)}>
                  <IconTarget className="size-3.5" />
                  {!compact && <span className="leading-none">{t("modes.goal")}</span>}
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{`${goal.objective} · ${t(GOAL_STATUS_KEYS[goal.status])}`}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-64">
            <div className="rounded-md px-2 py-1.5">
              <div className="flex items-center gap-2">
                <IconTarget className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-xs leading-tight">{goal.objective}</span>
                  <span className="block text-[10px] leading-snug text-muted-foreground">{t(GOAL_STATUS_KEYS[goal.status])}</span>
                </span>
              </div>
              <div className="mt-1 flex gap-1 pl-6">
                {goal.status === "active" && (
                  <Button variant="outline" size="xs" onClick={() => void bridge.controlGoal("pause")}>
                    <IconPlayerPause />
                    {t("modes.goalPause")}
                  </Button>
                )}
                {(goal.status === "paused" || goal.status === "blocked") && (
                  <Button variant="outline" size="xs" onClick={() => void bridge.controlGoal("resume")}>
                    <IconPlayerPlay />
                    {t("modes.goalResume")}
                  </Button>
                )}
                <Button variant="outline" size="xs" onClick={() => void bridge.controlGoal("cancel")}>
                  <IconX />
                  {t("modes.goalCancel")}
                </Button>
              </div>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={handleToggleGoalArm} className={modeButtonClass(goalArmed)}>
              <IconTarget className="size-3.5" />
              {!compact && <span className="leading-none">{t("modes.goal")}</span>}
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("modes.goalDesc")}</TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={handleToggleSwarm} className={modeButtonClass(swarmMode)}>
            <IconSparkles className="size-3.5" />
            {!compact && <span className="leading-none">{t("modes.swarm")}</span>}
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("modes.swarmDesc")}</TooltipContent>
      </Tooltip>

      <StreamingConfirmDialog
        open={showPlanModeConfirm}
        onOpenChange={setShowPlanModeConfirm}
        title={t("input.exitPlanMode.title")}
        description={t("input.exitPlanMode.description")}
        confirmLabel={t("input.exitPlanMode.confirm")}
        onConfirm={handleConfirmExitPlanMode}
      />
    </>
  );
}
