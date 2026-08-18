import { useCallback, useState } from "react";

const STORAGE_KEY = "kimi-fork-favorite-models";

function readFavorites(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Starred model ids, persisted to localStorage so they survive webview
 *  reloads; the quick switcher pins them on top and the full picker stars
 *  and re-sorts by them. */
export function useFavoriteModels() {
  const [favorites, setFavorites] = useState<string[]>(readFavorites);

  const toggleFavorite = useCallback((modelId: string) => {
    setFavorites((prev) => {
      const next = prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage can be unavailable (e.g. restricted webview) — keep the in-memory value.
      }
      return next;
    });
  }, []);

  return { favorites, toggleFavorite };
}
