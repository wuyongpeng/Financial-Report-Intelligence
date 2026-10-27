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
  if (t.length <= 12 && /(出处|证据页)/.test(t) && /(哪|去|看|跳|打开|带我)/.test(t)) {
    return true;
  }
  return false;
}

export const VOICE_CITE_MISSING_LINE = '刚才那句没有页码出处';
