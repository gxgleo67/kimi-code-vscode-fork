import { useState } from "react";
import { IconDots, IconPaperclip } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { YoloModeButton } from "./YoloModeButton";
import { ModeButtons } from "./ModeButtons";
import { SubagentModelDialog } from "./SubagentModelDialog";
import { useSettingsStore } from "@/stores";
import { useT } from "@/i18n";

interface ComposerOverflowMenuProps {
  disabled?: boolean;
  onAddFiles: () => void;
}

/**
 * Extreme-narrow fallback for the composer's left control cluster. When even
 * icon-only buttons no longer fit, the paperclip / permission / mode /
 * subagent controls collapse into a single "⋯" button. The popover re-renders
 * the SAME components at full label width, so no behavior is duplicated —
 * it just parks the controls behind one trigger instead of stretching them.
 */
export function ComposerOverflowMenu({ disabled, onAddFiles }: ComposerOverflowMenuProps) {
  const t = useT();
  const permissionMode = useSettingsStore((s) => s.permissionMode);
  const selectPermissionMode = useSettingsStore((s) => s.selectPermissionMode);

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-xs" className="text-muted-foreground">
              <IconDots className="size-3.5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("input.more")}</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-auto max-w-[calc(100vw-1rem)] p-2" align="start" side="top">
        <div className="flex flex-col gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 justify-start gap-1.5 px-2"
            onClick={onAddFiles}
          >
            <IconPaperclip className="size-3.5" />
            <span>{t("input.addFilesOrMedia")}</span>
          </Button>
          <div className="flex items-center gap-1.5">
            <YoloModeButton mode={permissionMode} disabled={disabled} onSelect={selectPermissionMode} />
            <ModeButtons />
            <SubagentModelDialog disabled={disabled} />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
