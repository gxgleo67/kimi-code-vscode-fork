import { ApprovalDialog } from "./ApprovalDialog";
import { QuestionDialog } from "./QuestionDialog";

/** Hosts the floating request surfaces (approvals, questions) above the
 *  composer. The status pill row (queue/changes/bash/agents/todos) lives in
 *  StatusPills. */
export function BottomToolbar() {
  return (
    <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
      <ApprovalDialog />
      <QuestionDialog />
    </div>
  );
}
