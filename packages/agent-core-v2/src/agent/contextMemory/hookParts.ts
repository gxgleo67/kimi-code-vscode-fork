import type { ContentPart, TextPart } from '#/kosong/contract/message';

export const USER_PROMPT_SUBMIT_HOOK_SOURCE = 'user prompt submit hook';
export const USER_PROMPT_SUBMIT_HOOK_CONTENT_TYPE = 'text/xml';

export interface UserPromptSubmitHookPartMeta {
  readonly contentType: string;
  readonly source: string;
}

export interface UserPromptSubmitHookPart extends TextPart {
  readonly meta: UserPromptSubmitHookPartMeta;
}

export function userPromptSubmitHookPart(text: string): UserPromptSubmitHookPart {
  return {
    type: 'text',
    text,
    meta: {
      contentType: USER_PROMPT_SUBMIT_HOOK_CONTENT_TYPE,
      source: USER_PROMPT_SUBMIT_HOOK_SOURCE,
    },
  };
}

export function isUserPromptSubmitHookPart(part: ContentPart): boolean {
  const meta = (part as { readonly meta?: { readonly source?: unknown } }).meta;
  return part.type === 'text' && meta?.source === USER_PROMPT_SUBMIT_HOOK_SOURCE;
}
