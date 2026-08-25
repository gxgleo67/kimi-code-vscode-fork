import type { TranslationKey } from "@/i18n/en";

type Translate = (key: TranslationKey) => string;

// Quota/balance-exhausted wording, mirroring the engine's own knowledge
// (kosong's kimi-errors.ts). The engine reports it as the generic
// `provider.api_error` code, so the only reliable signal is the message text.
const QUOTA_EXHAUSTED_PATTERNS = [
  /exceeded your current (?:token )?quota/i,
  /check your account balance/i,
  /insufficient balance/i,
  /recharge your account|please recharge/i,
  /account (?:is )?in arrears/i,
  /insufficient_quota/i,
  /exceeded_current_quota_error/i,
] as const;

// Engine wire error code → i18n key. Mirrors the English templates in
// shared/errors.ts (ERROR_MESSAGES) so the inline error card and toasts
// follow the UI language instead of always showing the host's English text.
const CODE_TO_KEY: Record<string, TranslationKey> = {
  CLI_NOT_FOUND: "error.code.CLI_NOT_FOUND",
  SPAWN_FAILED: "error.code.SPAWN_FAILED",
  ALREADY_STARTED: "error.code.ALREADY_STARTED",
  STDIN_NOT_WRITABLE: "error.code.STDIN_NOT_WRITABLE",
  HANDSHAKE_TIMEOUT: "error.code.HANDSHAKE_TIMEOUT",
  PROCESS_CRASHED: "error.code.PROCESS_CRASHED",
  LLM_NOT_SET: "error.code.LLM_NOT_SET",
  LLM_NOT_SUPPORTED: "error.code.LLM_NOT_SUPPORTED",
  INVALID_STATE: "error.code.INVALID_STATE",
  CHAT_PROVIDER_ERROR: "error.code.CHAT_PROVIDER_ERROR",
  SESSION_BUSY: "error.code.SESSION_BUSY",
  SESSION_CLOSED: "error.code.SESSION_CLOSED",
  TURN_INTERRUPTED: "error.code.TURN_INTERRUPTED",
  INVALID_JSON: "error.code.INVALID_JSON",
  INVALID_REQUEST: "error.code.INVALID_REQUEST",
  INVALID_PARAMS: "error.code.INVALID_PARAMS",
  INTERNAL_ERROR: "error.code.INTERNAL_ERROR",
  internal: "error.code.INTERNAL_ERROR",
  "config.invalid": "error.code.config.invalid",
  "model.not_configured": "error.code.model.not_configured",
  "auth.login_required": "error.code.LLM_NOT_SET",
  "session.not_found": "error.code.session.not_found",
  "session.state_not_found": "error.code.session.state_not_found",
  "session.state_invalid": "error.code.session.state_invalid",
  "session.init_failed": "error.code.session.init_failed",
  "session.closed": "error.code.SESSION_CLOSED",
  "session.fork_active_turn": "error.code.session.fork_active_turn",
  "turn.agent_busy": "error.code.SESSION_BUSY",
  "provider.api_error": "error.code.CHAT_PROVIDER_ERROR",
  "provider.rate_limit": "error.code.provider.rate_limit",
  "provider.auth_error": "error.code.provider.auth_error",
  "provider.connection_error": "error.code.provider.connection_error",
  "provider.filtered": "error.code.provider.filtered",
  "request.prompt_input_empty": "error.code.request.prompt_input_empty",
};

/**
 * Localize an engine error for display. Quota/balance exhaustion is detected
 * from the raw text first (its wire code is the generic `provider.api_error`),
 * then the wire code, and finally the raw message passes through unchanged so
 * no diagnostic information is lost.
 */
export function localizeErrorMessage(code: string, message: string, detail: string | undefined, t: Translate): string {
  const haystack = detail === undefined ? message : `${message}\n${detail}`;
  if (QUOTA_EXHAUSTED_PATTERNS.some((pattern) => pattern.test(haystack))) {
    return t("error.quotaExhausted");
  }
  const key = CODE_TO_KEY[code];
  if (key !== undefined) {
    return t(key);
  }
  return message;
}
