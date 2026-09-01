import { describe, expect, it } from "vitest";

import { getForkTurnIndex, getUserTurnInfo } from "../shared/fork-turn-index";

interface TestMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp: number;
  readonly forkable?: boolean;
  readonly steps?: readonly {
    readonly n: number;
    readonly items: readonly { readonly type: string; readonly content?: string }[];
  }[];
}

function message(
  role: TestMessage["role"],
  options: Partial<TestMessage> = {},
): TestMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content: "",
    timestamp: 1,
    ...options,
  };
}

describe("fork turn index", () => {
  it("counts a steer embedded in the current assistant response", () => {
    const messages = [
      message("user"),
      message("assistant", {
        steps: [{ n: 1, items: [{ type: "steer", content: "also fix tests" }] }],
      }),
    ];

    expect(getForkTurnIndex(messages, 1)).toBe(1);
  });

  it("carries prior steer turns into later assistant responses", () => {
    const messages = [
      message("user"),
      message("assistant", {
        steps: [{ n: 1, items: [{ type: "steer", content: "also fix tests" }] }],
      }),
      message("user"),
      message("assistant"),
    ];

    expect(getForkTurnIndex(messages, 3)).toBe(2);
  });

  it("does not count or offer forks for host-only command output", () => {
    const messages = [
      message("user", { content: "/compact", forkable: false }),
      message("assistant", { content: "The context has been compacted.", forkable: false }),
      message("user"),
      message("assistant"),
    ];

    expect(getForkTurnIndex(messages, 1)).toBeUndefined();
    expect(getForkTurnIndex(messages, 3)).toBe(0);
  });
});

describe("user turn info", () => {
  it("maps each user bubble to the turn it opens and totals all turns", () => {
    const messages = [
      message("user"),
      message("assistant"),
      message("user"),
      message("assistant"),
    ];

    const info = getUserTurnInfo(messages);
    expect(info.indexes).toEqual([0, undefined, 1, undefined]);
    expect(info.total).toBe(2);
  });

  it("counts steers between turns like the fork mapping does", () => {
    const messages = [
      message("user"),
      message("assistant", {
        steps: [{ n: 1, items: [{ type: "steer", content: "also fix tests" }] }],
      }),
      message("user"),
      message("assistant"),
    ];

    const info = getUserTurnInfo(messages);
    expect(info.indexes).toEqual([0, undefined, 2, undefined]);
    expect(info.total).toBe(3);
    // Deleting the second user message must undo turns 2..2 → count 1.
    expect(info.total - info.indexes[2]!).toBe(1);
    // Deleting the first user message undoes everything → count 3.
    expect(info.total - info.indexes[0]!).toBe(3);
  });

  it("skips host-only command messages", () => {
    const messages = [
      message("user", { content: "/compact", forkable: false }),
      message("assistant", { content: "The context has been compacted.", forkable: false }),
      message("user"),
      message("assistant"),
    ];

    const info = getUserTurnInfo(messages);
    expect(info.indexes).toEqual([undefined, undefined, 0, undefined]);
    expect(info.total).toBe(1);
  });
});
