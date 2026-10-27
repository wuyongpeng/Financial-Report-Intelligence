import { normalizeVoiceText } from './text-normalize';

export type VoiceLayoutIntent =
  | { kind: 'collapse-mid' }
  | { kind: 'expand-mid' }
  | null;

/**
 * Mid-column only. 「只要原文和问答」= collapse overview (middle), keep PDF + chat.
 */
export function parseVoiceLayoutIntent(text: string): VoiceLayoutIntent {
  const t = normalizeVoiceText(text);
  if (!t) return null;

  if (
    /^(收起中间|收起概览|收起中间栏|关掉概览|隐藏概览|只要原文和问答|只要原文和追问|只要来源和问答|只要PDF和问答)$/.test(
      t,
    ) ||
    (t.length <= 14 && /收起.{0,4}(中间|概览)/.test(t))
  ) {
    return { kind: 'collapse-mid' };
  }

  if (
    /^(展开概览|打开中间栏|打开概览|展开中间|展开中间栏|显示概览|恢复概览|打开中间)$/.test(t) ||
    (t.length <= 14 && /(展开|打开|显示|恢复).{0,4}(中间|概览)/.test(t))
  ) {
    return { kind: 'expand-mid' };
  }

  return null;
}
