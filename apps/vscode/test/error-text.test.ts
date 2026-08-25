/**
 * Scenario: engine wire errors are localized for display, with quota/balance
 * exhaustion detected from raw provider text even though its wire code is the
 * generic provider.api_error.
 * Run: pnpm exec vitest run --config apps/vscode/vitest.config.ts test/error-text.test.ts
 */
import { describe, expect, it, vi } from "vitest";

// The i18n module pulls in the settings store → chat store → bridge, which
// touches `document` at module scope. Stub the boundaries like the chat-store
// test does.
vi.mock("@/services", () => ({ bridge: {} }));
vi.mock("@/components/ui/sonner", () => ({ toast: {} }));

import { translate, type TranslationKey } from "../webview-ui/src/i18n";
import { localizeErrorMessage } from "../webview-ui/src/lib/error-text";

const zhT = (key: TranslationKey) => translate("zh", key);
const enT = (key: TranslationKey) => translate("en", key);

describe("localizeErrorMessage", () => {
  it("maps quota wording to the dedicated quota message", () => {
    const text = localizeErrorMessage(
      "provider.api_error",
      "You exceeded your current token quota: please check your account balance",
      undefined,
      zhT,
    );
    expect(text).toBe(translate("zh", "error.quotaExhausted"));
  });

  it("detects quota exhaustion from the detail line alone", () => {
    const text = localizeErrorMessage(
      "provider.api_error",
      "Service temporarily unavailable.",
      "Your account is suspended due to insufficient balance, please recharge your account",
      zhT,
    );
    expect(text).toBe(translate("zh", "error.quotaExhausted"));
  });

  it("maps known wire codes to the UI language", () => {
    expect(localizeErrorMessage("provider.rate_limit", "429 too many requests", undefined, zhT)).toBe(
      "请求过于频繁,请稍后重试。",
    );
    expect(localizeErrorMessage("provider.rate_limit", "429 too many requests", undefined, enT)).toBe(
      "Too many requests. Please try again later.",
    );
    expect(localizeErrorMessage("SESSION_BUSY", "busy", undefined, zhT)).toBe("正在发送消息,请稍候。");
  });

  it("passes unknown codes through with the raw message", () => {
    expect(localizeErrorMessage("some.unknown_code", "raw engine text", undefined, zhT)).toBe("raw engine text");
  });
});
