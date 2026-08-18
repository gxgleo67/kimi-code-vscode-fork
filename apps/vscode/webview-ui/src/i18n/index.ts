import { useCallback } from "react";
import { useSettingsStore } from "@/stores";
import { en, type TranslationKey } from "./en";
import { zh } from "./zh";

export type { TranslationKey } from "./en";
export type Language = "en" | "zh";
export type TranslateParams = Record<string, string | number>;

const dictionaries: Record<Language, Record<TranslationKey, string>> = { en, zh };

function format(template: string, params?: TranslateParams): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  );
}

export function translate(language: Language, key: TranslationKey, params?: TranslateParams): string {
  return format(dictionaries[language][key] ?? en[key], params);
}

/**
 * Non-hook translator for non-component code (stores, callbacks, utils).
 * Reads the current language from the settings store at call time.
 */
export function t(key: TranslationKey, params?: TranslateParams): string {
  return translate(useSettingsStore.getState().extensionConfig.language, key, params);
}

/**
 * Hook translator for components. Subscribes to the settings store, so the
 * component re-renders automatically when the language changes.
 */
export function useT() {
  const language = useSettingsStore((s) => s.extensionConfig.language);
  return useCallback(
    (key: TranslationKey, params?: TranslateParams) => translate(language, key, params),
    [language],
  );
}
