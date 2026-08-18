import { useState } from "react";
import { IconClipboardList, IconPlayerPause, IconPlayerPlay, IconSparkles, IconTarget, IconX } from "@tabler/icons-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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

/** Modes menu (plan / swarm / goal) — one pill whose tags show the active
 *  modes, opening a dropdown of switch rows. Plan/swarm are client toggles;
 *  goal state arrives via StatusUpdate after each control call. */
export function ModeMenu() {
  const t = useT();
  const isStreaming = useChatStore((s) => s.isStreaming);
  const sessionId = useChatStore((s) => s.sessionId);
  const planMode = useChatStore((s) => s.planMode);
  const swarmMode = useChatStore((s) => s.swarmMode);
  const goal = useChatStore((s) => s.goal);
  const goalArmed = useChatStore((s) => s.goalArmed);

  const [open, setOpen] = useState(false);
  const [showPlanModeConfirm, setShowPlanModeConfirm] = useState(false);

  const goalActive = isGoalActive(goal);
  const anyModeActive = planMode || swarmMode || goalActive || goalArmed;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
  };

  const handleTogglePlanMode = () => {
    // Turning OFF during streaming needs confirmation — user may want next turn, not current
    if (planMode && isStreaming) {
      setOpen(false);
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
    if (next) setOpen(false);
  };

  const rowClass = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/50 cursor-pointer";
  const rowIconClass = "size-4 shrink-0 text-muted-foreground";
  // The switch is display-only: the whole row is the click target, so the
  // switch never handles its own pointer events (avoids double-toggling).
  const rowSwitchClass = "pointer-events-none";

  return (
    <>
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex items-center gap-1 h-6 px-1.5 rounded-md transition-all text-xs cursor-pointer",
              anyModeActive
                ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 hover:bg-blue-500/25"
                : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span className="leading-none">{t("modes.label")}</span>
            {planMode && <span className="rounded bg-blue-500/15 px-1 py-px text-[9px] font-medium leading-tight">{t("modes.plan")}</span>}
            {swarmMode && <span className="rounded bg-blue-500/15 px-1 py-px text-[9px] font-medium leading-tight">{t("modes.swarm")}</span>}
            {(goalActive || goalArmed) && <span className="rounded bg-blue-500/15 px-1 py-px text-[9px] font-medium leading-tight">{t("modes.goal")}</span>}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <div role="button" tabIndex={-1} className={rowClass} onClick={handleTogglePlanMode}>
            <IconClipboardList className={rowIconClass} />
            <span className="flex-1 min-w-0">
              <span className="block text-xs leading-tight">{t("modes.plan")}</span>
              <span className="block text-[10px] leading-snug text-muted-foreground">{t("modes.planDesc")}</span>
            </span>
            <Switch size="sm" checked={planMode} tabIndex={-1} className={rowSwitchClass} />
          </div>

          <div role="button" tabIndex={-1} className={rowClass} onClick={handleToggleSwarm}>
            <IconSparkles className={rowIconClass} />
            <span className="flex-1 min-w-0">
              <span className="block text-xs leading-tight">{t("modes.swarm")}</span>
              <span className="block text-[10px] leading-snug text-muted-foreground">{t("modes.swarmDesc")}</span>
            </span>
            <Switch size="sm" checked={swarmMode} tabIndex={-1} className={rowSwitchClass} />
          </div>

          {goalActive ? (
            <div className="rounded-md px-2 py-1.5">
              <div className="flex items-center gap-2">
                <IconTarget className={rowIconClass} />
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-xs leading-tight">{goal.objective}</span>
                  <span className="block text-[10px] leading-snug text-muted-foreground">{t(GOAL_STATUS_KEYS[goal.status])}</span>
                </span>
                <Switch size="sm" checked tabIndex={-1} className={rowSwitchClass} />
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
          ) : (
            <div role="button" tabIndex={-1} className={rowClass} onClick={handleToggleGoalArm}>
              <IconTarget className={rowIconClass} />
              <span className="flex-1 min-w-0">
                <span className="block text-xs leading-tight">{t("modes.goal")}</span>
                <span className="block text-[10px] leading-snug text-muted-foreground">{t("modes.goalDesc")}</span>
              </span>
              <Switch size="sm" checked={goalArmed} tabIndex={-1} className={rowSwitchClass} />
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

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
