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
    /^(?:把)?(?:中间|概览)(?:栏|列|面板|区域)?(?:收起来|收起|关掉|隐藏)$/.test(t) ||
    /^(?:收起|关掉|隐藏)(?:一下)?(?:中间|概览)(?:栏|列|面板|区域)?$/.test(t)
  ) {
    return { kind: 'collapse-mid' };
  }

  if (
    /^(展开概览|打开中间栏|打开概览|展开中间|展开中间栏|显示概览|恢复概览|打开中间)$/.test(t) ||
    /^(?:把)?(?:中间|概览)(?:栏|列|面板|区域)?(?:展开|展开来|打开|显示出来)$/.test(t) ||
    /^(?:展开|打开|显示|恢复)(?:一下)?(?:中间|概览)(?:栏|列|面板|区域)?$/.test(t)
  ) {
    return { kind: 'expand-mid' };
  }

  return null;
}
