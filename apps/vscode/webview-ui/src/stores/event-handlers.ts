import { bridge } from "@/services";
import { useApprovalStore } from "./approval.store";
import { useSettingsStore } from "./settings.store";
import { isPreflightError, isUserInterrupt } from "shared/errors";
import type { ChatMessage, UIStep, UIStepItem, ChatState, TokenUsage } from "./chat.store";
import type { ContentPart, ToolCall, ToolResult, TurnBegin, SubagentEvent, SubagentSpawned, ApprovalRequestPayload, DiffBlock, RunResult, QuestionRequest } from "shared/legacy-sdk";
import type { UIStreamEvent, StreamError } from "shared/types";

type EventHandler = (draft: ChatState, payload: any) => void;

function createEmptyTokenUsage(): TokenUsage {
  return { input_other: 0, output: 0, input_cache_read: 0, input_cache_creation: 0 };
}

function addTokenUsage(target: TokenUsage, source: TokenUsage): void {
  target.input_other += source.input_other || 0;
  target.output += source.output || 0;
  target.input_cache_read += source.input_cache_read || 0;
  target.input_cache_creation += source.input_cache_creation || 0;
}

function extractDiffPaths(display?: { type: string; path?: string }[]): string[] {
  if (!display) {
    return [];
  }
  return display.filter((block): block is DiffBlock => block.type === "diff" && typeof block.path === "string").map((block) => block.path);
}

function getLastAssistant(draft: ChatState): ChatMessage | undefined {
  const last = draft.messages.at(-1);
  return last?.role === "assistant" ? last : undefined;
}

function hasContent(message: ChatMessage): boolean {
  if (typeof message.content === "string" && message.content.trim()) {
    return true;
  }
  if (Array.isArray(message.content) && message.content.length > 0) {
    return true;
  }

  return message.steps?.some((s) => s.items.length > 0) ?? false;
}

function findToolUseItem(steps: UIStep[], toolId: string): (UIStepItem & { type: "tool_use" }) | null {
  for (const step of steps) {
    for (const item of step.items) {
      if (item.type === "tool_use") {
        if (item.id === toolId) {
          return item;
        }

        if (item.subagent_steps) {
          const found = findToolUseItem(item.subagent_steps, toolId);
          if (found) {
            return found;
          }
        }
      }
    }
  }

  return null;
}

function resolveSubagentTarget(
  steps: UIStep[],
  payload: SubagentEvent,
): { steps: UIStep[]; event: { type: string; payload: any }; toolItem: UIStepItem & { type: "tool_use" } } | null {
  const { parent_tool_call_id, event } = payload;

  // Nested SubagentEvent
  if (event.type === "SubagentEvent") {
    return resolveSubagentTarget(steps, event.payload as SubagentEvent);
  }

  const toolItem = findToolUseItem(steps, parent_tool_call_id);
  if (!toolItem) {
    return null;
  }

  if (!toolItem.subagent_steps) {
    toolItem.subagent_steps = [];
  }

  return { steps: toolItem.subagent_steps, event, toolItem };
}

/** Tag the Agent/AgentSwarm card with the spawned child's bound model alias. */
function applySubagentSpawned(steps: UIStep[], payload: SubagentSpawned): void {
  if (payload.model === undefined) return;
  const item = findToolUseItem(steps, payload.tool_call_id);
  if (item) {
    item.subagentModel = payload.model;
  }
}

function finishAllTextItems(steps: UIStep[]): void {
  for (const step of steps) {
    for (const item of step.items) {
      if (item.type === "text" || item.type === "thinking") {
        item.finished = true;
      }
      if (item.type === "tool_use" && item.subagent_steps) {
        finishAllTextItems(item.subagent_steps);
      }
    }
  }
}

function applyEventToSteps(steps: UIStep[], event: { type: string; payload: any }, onText?: (text: string) => void): void {
  const currentStep = steps.at(-1);

  const appendOrCreate = (type: "text" | "thinking", content: string): void => {
    if (!currentStep) {
      return;
    }
    const last = currentStep.items.at(-1);

    if (last?.type === type) {
      (last as { content: string }).content += content;
    } else {
      currentStep.items.push({ type, content });
    }
  };

  const findLastToolUse = (): (UIStepItem & { type: "tool_use" }) | null => {
    for (let i = steps.length - 1; i >= 0; i--) {
      const items = steps[i].items;

      for (let j = items.length - 1; j >= 0; j--) {
        if (items[j].type === "tool_use") {
          return items[j] as UIStepItem & { type: "tool_use" };
        }
      }
    }

    return null;
  };

  const updateToolResult = (toolCallId: string, returnValue: ToolResult["return_value"]): boolean => {
    for (const step of steps) {
      for (const item of step.items) {
        if (item.type === "tool_use") {
          if (item.id === toolCallId) {
            item.result = returnValue;
            return true;
          }

          if (item.subagent_steps && applyToolResult(item.subagent_steps, toolCallId, returnValue)) {
            return true;
          }
        }
      }
    }

    return false;
  };

  const applyToolResult = (subSteps: UIStep[], toolCallId: string, returnValue: ToolResult["return_value"]): boolean => {
    for (const step of subSteps) {
      for (const item of step.items) {
        if (item.type === "tool_use") {
          if (item.id === toolCallId) {
            item.result = returnValue;
            return true;
          }

          if (item.subagent_steps && applyToolResult(item.subagent_steps, toolCallId, returnValue)) {
            return true;
          }
        }
      }
    }

    return false;
  };

  switch (event.type) {
    case "StepBegin":
      finishAllTextItems(steps);
      steps.push({ n: event.payload.n, items: [] });
      break;

    case "ContentPart": {
      const part = event.payload as ContentPart;

      if (part.type === "text" && part.text) {
        appendOrCreate("text", part.text);
        onText?.(part.text);
      } else if (part.type === "think" && part.think) {
        appendOrCreate("thinking", part.think);
      }

      break;
    }

    case "ToolCall": {
      if (!currentStep) {
        break;
      }
      finishAllTextItems(steps);
      const call = event.payload as ToolCall;

      currentStep.items.push({
        type: "tool_use",
        id: call.id,
        call: {
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments ?? null,
        },
      });

      break;
    }

    case "ToolCallPart": {
      const { arguments_part, tool_call_id } = event.payload;
      if (!arguments_part) {
        break;
      }
      const tool = typeof tool_call_id === "string"
        ? findToolUseItem(steps, tool_call_id)
        : findLastToolUse();

      if (tool) {
        tool.call.arguments = (tool.call.arguments || "") + arguments_part;
      }

      break;
    }

    case "ToolResult": {
      const result = event.payload as ToolResult;
      updateToolResult(result.tool_call_id, result.return_value);

      const paths = extractDiffPaths(result.return_value.display);
      if (paths.length > 0) {
        void bridge.trackFiles(paths);
      }

      break;
    }

    case "SubagentSpawned": {
      applySubagentSpawned(steps, event.payload as SubagentSpawned);
      break;
    }
  }
}

function isTaskToolResult(steps: UIStep[] | undefined, toolCallId: string): boolean {
  if (!steps) {
    return false;
  }
  const toolItem = findToolUseItem(steps, toolCallId);
  return toolItem?.call.name === "Task" || toolItem?.call.name === "Agent";
}

function handlePreflightError(draft: ChatState, _code: string, _message: string): void {
  // Pre-flight: 删除未发送成功的消息，恢复输入
  addTokenUsage(draft.tokenUsage, draft.activeTokenUsage);
  draft.activeTokenUsage = createEmptyTokenUsage();
  draft.isStreaming = false;
  draft.isCompacting = false;
  draft.stopping = false;
  useApprovalStore.getState().clearRequests();

  // 删除空的 assistant 消息
  const lastAssistant = getLastAssistant(draft);
  if (lastAssistant && !hasContent(lastAssistant)) {
    draft.messages.pop();
  }

  // 删除对应的 user 消息
  const lastUser = draft.messages.at(-1);
  if (lastUser?.role === "user") {
    const userContent = lastUser.content;
    draft.messages.pop();
    // 触发回滚（通过 pendingInput 保存）
    draft.pendingInput = { content: userContent, model: "" };
  }
}

function handleRuntimeError(draft: ChatState, code: string, message: string, detail?: string): void {
  // Runtime: 保留现场，添加内嵌错误
  addTokenUsage(draft.tokenUsage, draft.activeTokenUsage);
  draft.activeTokenUsage = createEmptyTokenUsage();
  draft.isStreaming = false;
  draft.isCompacting = false;
  draft.stopping = false;
  useApprovalStore.getState().clearRequests();

  const lastAssistant = getLastAssistant(draft);
  if (lastAssistant) {
    // 如果完全没有内容，添加一个空的 step 以便显示错误
    if (!lastAssistant.steps) {
      lastAssistant.steps = [];
    }
    finishAllTextItems(lastAssistant.steps);
    // 设置内嵌错误，保留服务器原始错误信息
    lastAssistant.inlineError = { code, message, detail };
  }
}

const eventHandlers: Record<string, EventHandler> = {
  // UI 事件 (Bridge 层)
  session_start: (draft, payload: { sessionId: string; model?: string }) => {
    if (payload.sessionId) {
      draft.sessionId = payload.sessionId;
    }
  },

  stream_complete: (draft, _payload: { result: RunResult }) => {
    addTokenUsage(draft.tokenUsage, draft.activeTokenUsage);
    draft.activeTokenUsage = createEmptyTokenUsage();
    draft.isStreaming = false;
    draft.isCompacting = false;
    draft.stopping = false;
    draft.pendingInput = null;
    useApprovalStore.getState().clearRequests();
    const lastAssistant = getLastAssistant(draft);
    if (lastAssistant?.steps) {
      finishAllTextItems(lastAssistant.steps);
    }
  },

  error: (draft, payload: StreamError) => {
    const code = payload.code || "UNKNOWN";
    const phase = payload.phase || (isPreflightError(code) ? "preflight" : "runtime");

    if (code === "UNKNOWN_EVENT_TYPE") {
      return;
    } // 忽略未知事件类型错误，通常是版本不匹配导致

    if (phase === "preflight") {
      if (draft.handshakeReceived) {
        // A preflight-coded failure arriving after the engine accepted the
        // message is really a mid-turn failure: keep the exchange on screen
        // with an inline error instead of deleting it and rolling the text
        // back into the composer.
        handleRuntimeError(draft, code, payload.message, payload.detail);
      } else {
        handlePreflightError(draft, code, payload.message);
      }
    } else {
      if (isUserInterrupt(code)) {
        addTokenUsage(draft.tokenUsage, draft.activeTokenUsage);
        draft.activeTokenUsage = createEmptyTokenUsage();
        draft.isStreaming = false;
        draft.isCompacting = false;
        draft.stopping = false;
        useApprovalStore.getState().clearRequests();
        const lastAssistant = getLastAssistant(draft);
        if (lastAssistant?.steps) {
          finishAllTextItems(lastAssistant.steps);
        }
      } else {
        handleRuntimeError(draft, code, payload.message, payload.detail);
      }
    }
  },

  // Wire 事件
  TurnBegin: (draft, payload: TurnBegin & { forkable?: boolean }) => {
    draft.tokenUsage = createEmptyTokenUsage();
    draft.activeTokenUsage = createEmptyTokenUsage();

    // History replay carries the original record time; live turns fall back
    // to now.
    const timestamp = payload.time ?? Date.now();

    draft.messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content: payload.user_input,
      timestamp,
      forkable: payload.forkable,
    });

    draft.messages.push({
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      timestamp,
      steps: [],
      forkable: payload.forkable,
    });

    draft.isStreaming = true;
    // The engine has accepted the message: clear any stop-in-progress state
    // and never roll the sent content back into the composer.
    draft.stopping = false;
    draft.pendingInput = null;
  },

  CompactionBegin: (draft) => {
    draft.isCompacting = true;

    const last = getLastAssistant(draft);
    const trigger = draft.pendingCompactTrigger ?? "auto";
    const preTokens = draft.lastStatus?.context_tokens ?? undefined;
    draft.pendingCompactTrigger = null;

    if (last) {
      if (!last.steps) {
        last.steps = [];
      }

      if (last.steps.length === 0) {
        last.steps.push({ n: 0, items: [] });
      }

      finishAllTextItems(last.steps);
      last.steps.at(-1)!.items.push({
        type: "compaction",
        trigger,
        ...(preTokens === undefined ? {} : { preTokens }),
      });
    }
  },

  CompactionEnd: (draft) => {
    draft.isCompacting = false;
  },

  StepBegin: (draft, payload) => {
    if (draft.lastStatus?.retrying) {
      draft.lastStatus.retrying = null;
    }
    const last = getLastAssistant(draft);

    if (last) {
      if (!last.steps) {
        last.steps = [];
      }

      applyEventToSteps(last.steps, { type: "StepBegin", payload });

      // Tag the newly created step with current plan mode state
      // Note: only top-level steps get tagged. Subagent steps go through
      // SubagentEvent -> applyEventToSteps and won't inherit main agent's planMode.
      const newStep = last.steps.at(-1);
      if (newStep && draft.planMode) {
        newStep.planMode = true;
      }
    }
  },

  StepInterrupted: (draft) => {
    addTokenUsage(draft.tokenUsage, draft.activeTokenUsage);
    draft.activeTokenUsage = createEmptyTokenUsage();

    draft.isStreaming = false;
    draft.stopping = false;
    useApprovalStore.getState().clearRequests();
    const lastAssistant = getLastAssistant(draft);
    if (lastAssistant?.steps) {
      finishAllTextItems(lastAssistant.steps);
    }
  },

  ContentPart: (draft, payload: ContentPart) => {
    // Late deltas after a stop request mean the engine is still running —
    // reflect that instead of leaving the UI stuck in a half-stopped state.
    if (draft.stopping) {
      draft.isStreaming = true;
      draft.stopping = false;
    }

    const last = getLastAssistant(draft);
    if (!last?.steps) {
      return;
    }

    applyEventToSteps(last.steps, { type: "ContentPart", payload }, (text) => {
      if (typeof last.content === "string") {
        last.content += text;
      }
    });
  },

  ToolCall: (draft, payload: ToolCall) => {
    const last = getLastAssistant(draft);
    if (!last?.steps) {
      return;
    }
    applyEventToSteps(last.steps, { type: "ToolCall", payload });
  },

  ToolCallPart: (draft, payload) => {
    const last = getLastAssistant(draft);
    if (!last?.steps) {
      return;
    }
    applyEventToSteps(last.steps, { type: "ToolCallPart", payload });
  },

  ToolResult: (draft, payload: ToolResult) => {
    const last = getLastAssistant(draft);
    if (!last?.steps) {
      return;
    }

    if (isTaskToolResult(last.steps, payload.tool_call_id)) {
      addTokenUsage(draft.tokenUsage, draft.activeTokenUsage);
      draft.activeTokenUsage = createEmptyTokenUsage();
    }

    applyEventToSteps(last.steps, { type: "ToolResult", payload });
  },

  SubagentEvent: (draft, payload: SubagentEvent) => {
    const last = getLastAssistant(draft);
    if (!last?.steps) {
      return;
    }

    const target = resolveSubagentTarget(last.steps, payload);
    if (!target) {
      return;
    }

    if (target.event.type === "StatusUpdate") {
      const { token_usage } = target.event.payload;

      if (token_usage) {
        addTokenUsage(draft.activeTokenUsage, {
          input_other: token_usage.input_other || 0,
          output: token_usage.output || 0,
          input_cache_read: token_usage.input_cache_read || 0,
          input_cache_creation: token_usage.input_cache_creation || 0,
        });
      }

      return;
    }

    if (target.steps.length === 0) {
      target.steps.push({ n: 1, items: [] });
    }

    // Nested Subagent Task End: accumulate token usage
    if (target.event.type === "ToolResult") {
      const toolResultPayload = target.event.payload as ToolResult;
      if (isTaskToolResult(target.steps, toolResultPayload.tool_call_id)) {
        addTokenUsage(draft.tokenUsage, draft.activeTokenUsage);
        draft.activeTokenUsage = createEmptyTokenUsage();
      }
    }

    applyEventToSteps(target.steps, target.event);
  },

  SubagentSpawned: (draft, payload: SubagentSpawned) => {
    const last = getLastAssistant(draft);
    if (!last?.steps) {
      return;
    }
    applySubagentSpawned(last.steps, payload);
  },

  ApprovalRequest: (_, payload: ApprovalRequestPayload) => {
    useApprovalStore.getState().addRequest({
      id: payload.id,
      tool_call_id: payload.tool_call_id,
      sender: payload.sender,
      action: payload.action,
      description: payload.description,
      display: payload.display ?? [],
    });
  },

  QuestionRequest: (draft, payload: QuestionRequest) => {
    draft.pendingQuestion = payload;
  },

  StatusUpdate: (draft, payload) => {
    const { context_usage, context_tokens, max_context_tokens, token_usage, plan_mode, swarm_mode, goal, model, thinking_effort, permission, retrying, turn_active } = payload;

    // Attach-time engine truth: a view created mid-turn (panel re-created
    // while a task runs) starts with isStreaming=false and would let a send
    // race the busy engine. Only repair in the busy direction — an accepted
    // send's TurnBegin re-asserts isStreaming on its own.
    if (turn_active === true) {
      draft.isStreaming = true;
    }

    if (typeof model === "string" && model.length > 0) {
      const settings = useSettingsStore.getState();
      // A composer model pick reaches the engine session only when the next
      // prompt is sent; until then status announcements still carry the
      // session's previous model and must not snap the picker back (this was
      // the "plan mode switches the model" bug).
      if (settings.pendingModelSync === null || settings.pendingModelSync === model) {
        if (settings.pendingModelSync === model) {
          useSettingsStore.setState({ pendingModelSync: null });
        }
        settings.setCurrentModel(model);
      }
    }
    if (typeof thinking_effort === "string" && thinking_effort.length > 0) {
      const settings = useSettingsStore.getState();
      if (settings.pendingEffortSync === null || settings.pendingEffortSync === thinking_effort) {
        if (settings.pendingEffortSync === thinking_effort) {
          useSettingsStore.setState({ pendingEffortSync: null });
        }
        settings.setThinkingEffort(thinking_effort);
      }
    }
    if (permission === "manual" || permission === "yolo" || permission === "auto") {
      useSettingsStore.getState().setPermissionMode(permission);
    }

    if (plan_mode !== undefined && plan_mode !== null) {
      draft.planMode = plan_mode;
    }

    if (swarm_mode !== undefined && swarm_mode !== null) {
      draft.swarmMode = swarm_mode;
    }

    if (goal !== undefined) {
      draft.goal = goal;
      // A live goal means the one-shot arm (if any) has been consumed.
      if (goal !== null) draft.goalArmed = false;
    }

    if (token_usage) {
      addTokenUsage(draft.activeTokenUsage, {
        input_other: token_usage.input_other || 0,
        output: token_usage.output || 0,
        input_cache_read: token_usage.input_cache_read || 0,
        input_cache_creation: token_usage.input_cache_creation || 0,
      });
    }

    draft.lastStatus = {
      context_usage: context_usage ?? draft.lastStatus?.context_usage,
      context_tokens: context_tokens ?? draft.lastStatus?.context_tokens,
      max_context_tokens: max_context_tokens ?? draft.lastStatus?.max_context_tokens,
      token_usage,
      retrying: retrying ?? draft.lastStatus?.retrying,
    };

    const last = getLastAssistant(draft);

    if (last) {
      last.status = draft.lastStatus;
    }
  },

  SteerInput: (draft, payload: { user_input: string | ContentPart[] }) => {
    const last = getLastAssistant(draft);
    if (!last?.steps) return;

    const currentStep = last.steps.at(-1);
    if (!currentStep) return;

    finishAllTextItems(last.steps);
    currentStep.items.push({ type: "steer", content: payload.user_input });
  },
};

export function processEvent(draft: ChatState, event: UIStreamEvent): void {
  const handler = eventHandlers[event.type];

  if (handler) {
    const payload = "payload" in event ? event.payload : event;
    handler(draft, payload);
  }
}
