import { randomUUID } from "node:crypto";

import type {
  ApprovalRequest,
  ApprovalResponse as CoreApprovalResponse,
  QuestionRequest,
  QuestionResult,
  ToolInputDisplay,
} from "@moonshot-ai/kimi-code-sdk";

import type { ApprovalResponse, DisplayBlock, QuestionRequest as LegacyQuestionRequest } from "../../shared/legacy-sdk";
import { describeToolDisplay, toLegacyDisplay } from "./tool-display";

export type ReverseRpcEvent =
  | { type: "ApprovalRequest"; payload: ReturnType<typeof approvalPayload> }
  | { type: "QuestionRequest"; payload: LegacyQuestionRequest };

export class ReverseRpcController {
  private readonly approvals = new Map<string, (response: CoreApprovalResponse) => void>();
  private readonly questions = new Map<string, (result: QuestionResult) => void>();

  constructor(private readonly emit: (event: ReverseRpcEvent) => void) {}

  requestApproval(request: ApprovalRequest): Promise<CoreApprovalResponse> {
    const id = randomUUID();
    return new Promise((resolve) => {
      this.approvals.set(id, resolve);
      this.emit({ type: "ApprovalRequest", payload: approvalPayload(id, request) });
    });
  }

  requestQuestion(request: QuestionRequest): Promise<QuestionResult> {
    const id = randomUUID();
    return new Promise((resolve) => {
      this.questions.set(id, resolve);
      this.emit({
        type: "QuestionRequest",
        payload: {
          id,
          tool_call_id: request.toolCallId ?? "",
          questions: request.questions.map((question) => ({
            question: question.question,
            header: question.header,
            options: question.options.map((option) => ({
              label: option.label,
              description: option.description,
            })),
            multi_select: question.multiSelect,
          })),
        },
      });
    });
  }

  respondApproval(id: string, response: ApprovalResponse): boolean {
    const resolve = this.approvals.get(id);
    if (!resolve) return false;
    this.approvals.delete(id);
    const decision = typeof response === "string" ? response : response.decision;
    const extras = typeof response === "string" ? {} : approvalExtras(response);
    if (decision === "approve_for_session") {
      resolve({ decision: "approved", scope: "session", ...extras });
    } else if (decision === "approve") {
      resolve({ decision: "approved", ...extras });
    } else {
      resolve({ decision: "rejected", ...extras });
    }
    return true;
  }

  respondQuestion(id: string, answers: Record<string, string>): boolean {
    const resolve = this.questions.get(id);
    if (!resolve) return false;
    this.questions.delete(id);
    resolve({ answers });
    return true;
  }

  cancelAll(reason: string): void {
    for (const resolve of this.approvals.values()) {
      resolve({ decision: "cancelled", feedback: reason });
    }
    for (const resolve of this.questions.values()) {
      resolve(null);
    }
    this.approvals.clear();
    this.questions.clear();
  }
}

function approvalPayload(id: string, request: ApprovalRequest) {
  return {
    id,
    tool_call_id: request.toolCallId,
    sender: request.toolName,
    action: request.action,
    description: describeToolDisplay(request.display),
    display: approvalDisplayBlocks(request.display),
  };
}

/**
 * Plan reviews keep their structured payload (full plan text, plan file path,
 * approach options) so the Webview can render a review dialog instead of a
 * generic brief block. Everything else reuses the legacy display mapping.
 */
function approvalDisplayBlocks(display: ToolInputDisplay): DisplayBlock[] {
  if (display.kind !== "plan_review") return toLegacyDisplay(display);
  return [{
    type: "plan_review",
    plan: display.plan,
    ...(display.path === undefined ? {} : { path: display.path }),
    ...(display.options === undefined ? {} : { options: display.options }),
  }];
}

function approvalExtras(response: Exclude<ApprovalResponse, string>): Pick<CoreApprovalResponse, "feedback" | "selectedLabel"> {
  return {
    ...(response.feedback === undefined ? {} : { feedback: response.feedback }),
    ...(response.selectedLabel === undefined ? {} : { selectedLabel: response.selectedLabel }),
  };
}
