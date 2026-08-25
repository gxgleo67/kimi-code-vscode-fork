import { IconAlertCircle } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { localizeErrorMessage } from "@/lib/error-text";
import type { InlineError as InlineErrorType } from "../stores/chat.store";

interface InlineErrorProps {
  error: InlineErrorType;
}

export function InlineError({ error }: InlineErrorProps) {
  const t = useT();

  // 如果 detail 和 message 不同，则显示详细错误信息
  const showDetail = error.detail && error.detail !== error.message;
  const displayMessage = localizeErrorMessage(error.code, error.message, error.detail, t);

  // 刻意不提供重试按钮：程序化重发曾把对话记录搞乱（思考记录丢失、消息对
  // 被交换），超时或报错后由用户在输入框手动重新输入指令。
  return (
    <div className={cn("flex flex-col gap-1 px-3 py-2 mt-2 rounded-md", "bg-red-50 dark:bg-red-950/30", "border border-red-200 dark:border-red-900/50")}>
      <div className="flex items-center gap-2">
        <IconAlertCircle className="size-4 text-red-500 shrink-0" />
        <span className="text-xs text-red-600 dark:text-red-400 flex-1">{displayMessage}</span>
      </div>
      {showDetail && <div className="text-[10px] text-red-500/70 dark:text-red-400/70 pl-6 font-mono break-all">{error.detail}</div>}
      <div className="text-[10px] text-red-500/70 dark:text-red-400/70 pl-6">{t("error.retypeHint")}</div>
    </div>
  );
}
