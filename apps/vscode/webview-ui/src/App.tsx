// node/vscode_extension/webview-ui/src/App.tsx
import { useEffect, useState, useCallback } from "react";
import { Header } from "./components/Header";
import { ChatArea } from "./components/ChatArea";
import { InputArea } from "./components/inputarea/InputArea";
import { MCPServersModal } from "./components/MCPServersModal";
import { AccountsModal } from "./components/AccountsModal";
import { WorkDirModal } from "./components/WorkDirModal";
import { ConfigErrorScreen } from "./components/ConfigErrorScreen";
import { LoginScreen } from "./components/LoginScreen";
import { Toaster, toast } from "./components/ui/sonner";
import { useChatStore, useSettingsStore } from "./stores";
import { bridge, Events } from "./services";
import { useAppInit, resolveAppView } from "./hooks/useAppInit";
import { MODE_ORDER } from "./components/YoloModeButton";
import { isPreflightError } from "shared/errors";
import type { UIStreamEvent, StreamError, ExtensionConfig, PermissionMode } from "shared/types";
import "./styles/index.css";

function MainContent({ onAuthAction }: { onAuthAction: () => void }) {
  const processEvent = useChatStore((s) => s.processEvent);
  const startNewConversation = useChatStore((s) => s.startNewConversation);
  const sessionId = useChatStore((s) => s.sessionId);
  const setMCPServers = useSettingsStore((s) => s.setMCPServers);
  const setExtensionConfig = useSettingsStore((s) => s.setExtensionConfig);
  const enableNewConversationShortcut = useSettingsStore((s) => s.extensionConfig.enableNewConversationShortcut);

  useEffect(() => {
    return bridge.on(Events.StreamEvent, (event: UIStreamEvent) => {
      // 只有当前已有 session 时才过滤，确保 session_start 能正常处理
      if (sessionId && "_sessionId" in event && event._sessionId && event._sessionId !== sessionId) {
        console.log("Ignored stream event from another session:", event._sessionId);
        return;
      }
      processEvent(event);
      if (event.type === "error") {
        const streamError = event as StreamError;
        if (isPreflightError(streamError.code || "UNKNOWN")) {
          toast.error(streamError.message);
        }
      }
    });
  }, [processEvent, sessionId]);

  useEffect(() => {
    const unsubs = [
      bridge.on(Events.MCPServersChanged, setMCPServers),
      bridge.on(Events.ExtensionConfigChanged, ({ config }: { config: ExtensionConfig }) => setExtensionConfig(config)),
      bridge.on(Events.FocusInput, () => document.querySelector<HTMLTextAreaElement>("textarea")?.focus()),
      // Live title refreshes for the attached session (LLM-generated title
      // after the first turn, renames from any view's session list).
      bridge.on(Events.SessionMetaUpdated, (data: { sessionId: string; title?: string }) => {
        const title = data.title?.trim();
        if (!title) return;
        const state = useChatStore.getState();
        if (state.sessionId === data.sessionId) state.setSessionTitle(title);
      }),
      bridge.on(Events.NewConversation, () => {
        void startNewConversation().catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : String(error));
        });
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [setMCPServers, setExtensionConfig, startNewConversation]);

  useEffect(() => {
    if (!enableNewConversationShortcut) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        void startNewConversation().catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : String(error));
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enableNewConversationShortcut, startNewConversation]);

  // Shift+Tab cycles the permission mode (Claude Code style). The listener
  // lives on this webview's window, so the shortcut only exists inside the
  // plugin — VS Code and other editors never see it. Open dialogs keep
  // Shift+Tab for focus navigation; the button label (not a toast) is the
  // feedback.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.('[role="dialog"]')) return;
      e.preventDefault();
      const { permissionMode, selectPermissionMode } = useSettingsStore.getState();
      const current = MODE_ORDER.indexOf(permissionMode);
      const next: PermissionMode = MODE_ORDER[(current + 1) % MODE_ORDER.length];
      selectPermissionMode(next);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Re-attach only when the extension host still holds a live session, which
  // means this webview was reloaded in place (a recreation gets a fresh random
  // webviewId and the host never pushes the current transcript — without
  // re-attaching, the running conversation vanished until the next status
  // event trickled in). A fresh extension host (VS Code start, window reload)
  // has no live session, so the plugin opens on the home page instead of
  // resurrecting the last conversation every time. The history-loading cover
  // hides the interim state; a mid-turn session restores into streaming.
  useEffect(() => {
    if (useChatStore.getState().sessionId !== null) return;
    let cancelled = false;
    bridge
      .getLiveSession()
      .then(({ sessionId: liveId }) => {
        if (cancelled || liveId === null) return;
        useChatStore.getState().setHistoryLoading(true);
        return bridge
          .loadSessionHistory(liveId)
          .then((events) => {
            if (cancelled) return;
            return useChatStore.getState().loadSession(liveId, events);
          })
          .finally(() => {
            if (!cancelled) useChatStore.getState().setHistoryLoading(false);
          });
      })
      .catch(() => {
        // Unresumable or bridge not ready — stay on the home page.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <div className="flex-1 min-h-0 relative group/chat">
        <ChatArea />
      </div>
      <div className="shrink-0 max-h-[80vh] flex flex-col min-h-0">
        <InputArea onAuthAction={onAuthAction} />
      </div>
      <MCPServersModal />
      <AccountsModal onAuthAction={onAuthAction} />
      <WorkDirModal />
    </>
  );
}

export default function App() {
  const { status, errorMessage, modelsCount, refresh } = useAppInit();
  const [skippedLogin, setSkippedLogin] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  const handleLoginSuccess = useCallback(() => {
    setShowLogin(false);
    setSkippedLogin(false);
    refresh();
  }, [refresh]);

  const handleSkip = useCallback(() => {
    setShowLogin(false);
    setSkippedLogin(true);
  }, []);

  const handleShowLogin = useCallback(() => {
    setSkippedLogin(false);
    setShowLogin(true);
  }, []);

  const handleAuthAction = useCallback(() => {
    setSkippedLogin(false);
    setShowLogin(false);
    refresh();
  }, [refresh]);

  const resolution = resolveAppView({ status, modelsCount, skippedLogin, showLogin });

  // 登录界面：未登录且未跳过，或用户从其他界面主动选择登录
  if (resolution.view === "login") {
    return (
      <div className="flex flex-col h-screen text-foreground overflow-hidden">
        <Header />
        <LoginScreen onLoginSuccess={handleLoginSuccess} onSkip={handleSkip} />
        <Toaster position="top-center" />
      </div>
    );
  }

  // 错误与设置状态界面；no-models 必须保留回到登录界面的入口
  if (resolution.view === "status") {
    return (
      <div className="flex flex-col h-screen text-foreground overflow-hidden">
        <Header />
        <ConfigErrorScreen
          type={resolution.status}
          errorMessage={errorMessage}
          onRefresh={refresh}
          onBackToLogin={resolution.canGoToLogin ? handleShowLogin : undefined}
        />
        <Toaster position="top-center" />
      </div>
    );
  }

  // 正常状态
  return (
    <div className="flex flex-col h-screen text-foreground overflow-hidden">
      <Header />
      <MainContent onAuthAction={handleAuthAction} />
      <Toaster position="top-center" />
    </div>
  );
}
