interface ForkTurnItem {
  readonly type: string;
}

interface ForkTurnMessage {
  readonly role: "user" | "assistant";
  readonly forkable?: boolean;
  readonly steps?: readonly {
    readonly items: readonly ForkTurnItem[];
  }[];
}

/** Return the core's zero-based user-visible turn index for an assistant bubble. */
export function getForkTurnIndex(
  messages: readonly ForkTurnMessage[],
  messageIndex: number,
): number | undefined {
  return getForkTurnIndexes(messages)[messageIndex];
}

/**
 * One-pass variant of {@link getForkTurnIndex}: the turn index for every
 * message, in array order. Mapping over a long transcript with the
 * per-message variant rescans the prefix each time (O(n²)); this is O(n).
 */
export function getForkTurnIndexes(
  messages: readonly ForkTurnMessage[],
): (number | undefined)[] {
  let visibleTurns = 0;
  return messages.map((message) => {
    if (message.role === "user") {
      if (message.forkable !== false) {
        visibleTurns += 1;
      }
      return undefined;
    }
    if (message.role === "assistant") {
      visibleTurns += countSteers(message);
      if (message.forkable === false) return undefined;
      return visibleTurns - 1;
    }
    return undefined;
  });
}

function countSteers(message: ForkTurnMessage): number {
  return (
    message.steps?.reduce(
      (count, step) => count + step.items.filter((item) => item.type === "steer").length,
      0,
    ) ?? 0
  );
}
