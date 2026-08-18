import { useState, useEffect, useMemo } from "react";
import { bridge } from "@/services";
import { useT, type TranslateParams, type TranslationKey } from "@/i18n";

export interface WelcomeHint {
  title: string;
  description: string;
  slashCommand?: string;
  component?: React.ReactNode;
}

type TFunc = (key: TranslationKey, params?: TranslateParams) => string;

function ShortcutRow({ kbd, children }: { kbd: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-3">
      <kbd className="kbd shrink-0">{kbd}</kbd>
      <span className="text-right">{children}</span>
    </div>
  );
}

function ShortcutGuide() {
  const t = useT();
  return (
    <div className="text-left text-xs mt-2 space-y-5 w-full max-w-96">
      <div>
        <div className="font-medium text-foreground mb-1.5">{t("welcome.commands")}</div>
        <div className="text-muted-foreground space-y-1">
          <ShortcutRow kbd="/">{t("welcome.viewAllCommands")}</ShortcutRow>
          <ShortcutRow kbd="/init">{t("welcome.initDesc")}</ShortcutRow>
          <ShortcutRow kbd="/compact">{t("welcome.compactDesc")}</ShortcutRow>
        </div>
      </div>
      <div>
        <div className="font-medium text-foreground mb-1.5">{t("welcome.tips")}</div>
        <div className="text-muted-foreground space-y-1">
          <ShortcutRow kbd="↑">{t("welcome.browseHistory")}</ShortcutRow>
          <ShortcutRow kbd="@">{t("welcome.addFiles")}</ShortcutRow>
          <ShortcutRow kbd="Alt+K">{t("welcome.altK")}</ShortcutRow>
        </div>
      </div>
      <div>
        <div className="font-medium text-foreground mb-1.5">{t("welcome.proTips")}</div>
        <div className="text-muted-foreground space-y-1">
          <div>{t("welcome.proYolo")}</div>
          <div>{t("welcome.proAgentsMd")}</div>
          <div>{t("welcome.proThinking")}</div>
        </div>
      </div>
    </div>
  );
}

function getHints(t: TFunc): { firstTime: WelcomeHint; agentMd: WelcomeHint; pool: WelcomeHint[] } {
  const firstTime: WelcomeHint = {
    title: t("welcome.quickStart"),
    description: "",
    component: <ShortcutGuide />,
  };
  const agentMd: WelcomeHint = {
    title: t("welcome.mapCodebase.title"),
    description: t("welcome.mapCodebase.desc"),
    slashCommand: "/init",
  };
  const pool: WelcomeHint[] = [
    firstTime,
    agentMd,
    {
      title: t("welcome.refCode.title"),
      description: t("welcome.refCode.desc"),
    },
    {
      title: t("welcome.seeWhatICanDo.title"),
      description: t("welcome.seeWhatICanDo.desc"),
    },
    {
      title: t("welcome.deeperAnalysis.title"),
      description: t("welcome.deeperAnalysis.desc"),
    },
    {
      title: t("welcome.moreThanCode.title"),
      description: t("welcome.moreThanCode.desc"),
    },
    {
      title: t("welcome.addMoreTools.title"),
      description: t("welcome.addMoreTools.desc"),
    },
    {
      title: t("welcome.fewerInterruptions.title"),
      description: t("welcome.fewerInterruptions.desc"),
    },
    {
      title: t("welcome.longContext.title"),
      description: t("welcome.longContext.desc"),
      slashCommand: "/compact",
    },
  ];
  return { firstTime, agentMd, pool };
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function withProbability(p: number): boolean {
  return Math.random() < p;
}

export function useWelcomeHint(): WelcomeHint {
  const t = useT();
  const [hasAgentMd, setHasAgentMd] = useState<boolean | null>(null);
  const [hasHistory, setHasHistory] = useState<boolean | null>(null);

  useEffect(() => {
    bridge
      .checkFileExists("AGENT.md")
      .then(setHasAgentMd)
      .catch(() => setHasAgentMd(false));
    bridge
      .getKimiSessions()
      .then((s) => setHasHistory(s.length > 0))
      .catch(() => setHasHistory(false));
  }, []);

  return useMemo(() => {
    const hints = getHints(t);
    // First time user: show shortcut guide
    if (hasHistory === false) {
      return hints.firstTime;
    }
    // 30% chance to show AGENT.md hint if missing
    if (hasAgentMd === false && withProbability(0.3)) {
      return hints.agentMd;
    }
    return pickRandom(hints.pool);
  }, [t, hasAgentMd, hasHistory]);
}
