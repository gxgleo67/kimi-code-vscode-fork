/**
 * Scenario: a session or history is exported/stringified for the user through the released VS Code surfaces.
 * Responsibilities: the export markdown topic and body, and the context history text, ignore the UserPromptSubmit hook output folded into the prompt message.
 * Wiring: the pure session-context helpers are used directly; there are no stubs.
 * Run: pnpm exec vitest run --config apps/vscode/vitest.config.ts test/session-context.test.ts
 */

import type { ContentPart, ContextMessage } from "@moonshot-ai/kimi-code-sdk";
import { describe, expect, it } from "vitest";

import {
  buildExportMarkdown,
  stringifyContextHistory,
} from "../src/utils/session-context";

const HOOK_PART = {
  type: "text",
  text: '<hook_result hook_event="UserPromptSubmit">\nhook note\n</hook_result>',
  meta: { contentType: "text/xml", source: "user prompt submit hook" },
} as ContentPart;

function userMessage(content: ContentPart[]): ContextMessage {
  return {
    role: "user",
    content,
    toolCalls: [],
    origin: { kind: "user" },
  } as ContextMessage;
}

function assistantMessage(text: string): ContextMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    toolCalls: [],
  } as ContextMessage;
}

describe("session context export", () => {
  it("keeps the folded hook output out of the export topic, body and history text", () => {
    const history = [
      userMessage([HOOK_PART, { type: "text", text: "Fix the test" }]),
      assistantMessage("Fixed"),
    ];

    const markdown = buildExportMarkdown({
      sessionId: "session-1",
      workDir: "/workspace",
      history,
      tokenCount: 12,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(markdown).toContain("- **Topic**: Fix the test");
    expect(markdown).not.toContain("hook note");

    const contextText = stringifyContextHistory(history);
    expect(contextText).toContain("[USER]\nFix the test");
    expect(contextText).not.toContain("hook note");
  });
});
