import { useEffect, useMemo, useState } from "react";
import ScrollToBottom, { useScrollToBottom, useSticky } from "react-scroll-to-bottom";
import { IconArrowDown } from "@tabler/icons-react";
import { ChatMessage } from "./ChatMessage";
import { WelcomeScreen } from "./WelcomeScreen";
import { useChatStore } from "@/stores";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { getForkTurnIndexes } from "shared/fork-turn-index";

// Long histories mount in windows: rendering every message (with markdown) at
// once is the other half of the open-a-long-conversation stall.
const INITIAL_VISIBLE_MESSAGES = 80;
const LOAD_EARLIER_STEP = 100;

function ScrollButton() {
  const scrollToBottom = useScrollToBottom();
  const [sticky] = useSticky();

  if (sticky) return null;

  return (
    <button
      onClick={() => scrollToBottom()}
      className={cn("absolute bottom-4 right-4 p-2 rounded-full z-10", "bg-blue-400 text-white shadow-lg", "hover:bg-blue-600 transition-all")}
    >
      <IconArrowDown className="size-4" />
    </button>
  );
}

function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const sessionId = useChatStore((s) => s.sessionId);
  const t = useT();
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_MESSAGES);
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_MESSAGES);
  }, [sessionId]);
  // Precompute all turn indexes in one O(n) pass instead of an O(n) rescan per message.
  const turnIndexes = useMemo(() => getForkTurnIndexes(messages), [messages]);

  // The window anchors to the tail so live-streaming messages stay in view.
  const start = Math.max(0, messages.length - visibleCount);
  const visible = messages.slice(start);

  return (
    <>
      <div className="">
        {start > 0 && (
          <button
            onClick={() => setVisibleCount((count) => count + LOAD_EARLIER_STEP)}
            className="w-full py-1.5 mb-1 text-center text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            {t("chat.showEarlier", { count: start })}
          </button>
        )}
        {visible.map((message, idx) => (
          <ChatMessage
            key={message.id}
            message={message}
            turnIndex={turnIndexes[start + idx]}
            isStreaming={isStreaming && start + idx === messages.length - 1 && message.role === "assistant"}
          />
        ))}
      </div>
      <ScrollButton />
    </>
  );
}

export function ChatArea() {
  const messageCount = useChatStore((s) => s.messages.length);

  if (messageCount === 0) {
    return (
      <div className="h-full flex items-center justify-center relative">
        <WelcomeScreen />
      </div>
    );
  }

  return (
    <div className="h-full relative">
      <ScrollToBottom className="h-full" scrollViewClassName="h-full overflow-y-auto overflow-x-hidden" followButtonClassName="hidden" initialScrollBehavior="auto">
        <MessageList />
      </ScrollToBottom>
    </div>
  );
}
