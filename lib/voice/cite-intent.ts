import { normalizeVoiceText } from './text-normalize';

/** 「出处在哪 / 去证据页」. */
export function isVoiceCiteIntent(text: string): boolean {
  const t = normalizeVoiceText(text);
  if (!t) return false;
  if (
    /^(出处在哪|出处在哪里|去证据页|看看出处|跳到出处|看出处|打开出处|去看出处|出处页|证据在哪|证据在哪里|带我看出处|去看证据|看证据页)$/.test(
      t,
    )
  ) {
    return true;
  }
  // Soft form: whole utterance is just a verb + 出处/证据页 (+ optional 刚才/上一条 …).
  if (
    /^(?:带我)?(?:去|看|看看|跳到|跳转到|打开)?(?:一下)?(?:刚才|上一条|上条|这条|那条)?(?:那条|那个|这个)?(?:的)?(?:出处|证据页)(?:在哪里?|在哪一页|在哪页|页)?$/.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

export const VOICE_CITE_MISSING_LINE = '刚才那句没有页码出处';
