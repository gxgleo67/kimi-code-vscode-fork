/**
 * Remembers the live session id across webview recreations. VS Code gives a
 * freshly (re)created webview a new random webviewId and the host never pushes
 * the current transcript, so without this the running conversation vanished
 * from the UI on every reload. localStorage survives webview reloads (the
 * favorite-models hook relies on the same guarantee).
 */
const STORAGE_KEY = "kimi.currentSessionId";

export function readCurrentSessionId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeCurrentSessionId(sessionId: string | null): void {
  try {
    if (sessionId === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, sessionId);
    }
  } catch {
    // Storage unavailable (private mode etc.) — restore simply never kicks in.
  }
}
