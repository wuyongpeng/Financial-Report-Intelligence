export type VoiceNavIntent =
  | { kind: 'next' }
  | { kind: 'prev' }
  | { kind: 'goto'; page: number }
  | { kind: 'home' }
  | null;

export type VoicePageNavDirection = 'next' | 'prev';

/** How long after a next/prev 「继续 / 再翻」 still repeats that direction. */
export const VOICE_PAGE_CONTINUE_WINDOW_MS = 12_000;

const HOME_CONFIRM_LINES = [
  '好，回首页',
  '好，去首页找下一家',
  '嗯，回首页',
] as const;

/** Normalize ASR / typed text for matching. */
function normalize(text: string): string {
  return text
    .replace(/\s+/g, '')
    .replace(/[。！？.!?,，、；;：:""''「」『』（）()【】\[\]…—～~]/g, '')
    .trim();
}

/**
 * Go-home / switch-company intents — leave the current report detail for the
 * product home/search so the user can ask about another company.
 * Distinct from farewell (退下/再见), which ends the voice session entirely.
 */
export function isVoiceHomeIntent(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;

  // Never steal explicit voice-session stop commands — those belong to farewell.
  if (/(停止|退出|关掉|关闭|结束)(实时)?(语音|对话|会话)/.test(t)) return false;
  if (/^(结束语音|退出语音|关掉语音|关闭语音|停止语音)$/.test(t)) return false;
  // Pure farewell dismissals stay farewell, not home.
  if (/^(退下吧?|你退下吧?|先退下吧?|再见|拜拜|拜了)$/.test(t)) return false;

  // —— Home / main page ——
  if (
    /^(回|回到|去|打开|返回|跳到|跳转到)?(首页|主页|主界面|主屏)$/.test(t) ||
    /^(回|回到|去|打开|返回)(到)?(首页|主页)$/.test(t) ||
    /^(请)?(帮我)?(回|回到|去|打开|返回)(一下)?(首页|主页)$/.test(t)
  ) {
    return true;
  }
  if (/(回|回到|去|打开|返回|跳到).{0,4}(首页|主页)/.test(t) && t.length <= 16) return true;

  // —— Switch company / another report ——
  if (
    /^(换一家|换个公司|换一家公司|换个股票|换只股票|换一个|换一家看看|换个标的|换个标的看看)$/.test(t) ||
    /^(我想问别的|我想问另一家|问另一家|问别的|问别的公司|看看别的|看看别的公司|看别的公司|搜别的|搜其他公司|搜索其他公司|搜索别的公司)$/.test(t) ||
    /^(打开搜索|去搜索|重新搜索|再搜一次|重新找|换个公司问问)$/.test(t)
  ) {
    return true;
  }
  // Soft variants with light filler / length cap.
  if (
    t.length <= 18 &&
    /(换一家|换个公司|换一家公司|换个股票|换个标的|问别的|问另一家|看看别的|别的公司|其他公司|打开搜索|重新搜索)/.test(t)
  ) {
    return true;
  }

  // —— Leave this company / detail (not farewell) ——
  if (
    /^(退出这个公司|离开这个公司|离开详情|退出详情|不想看这个了|不看这个了|先不看这个了|换掉这个|不要这个了)$/.test(t) ||
    (t.length <= 14 && /(退出|离开).{0,4}(这个)?(公司|详情|财报)/.test(t))
  ) {
    return true;
  }

  return false;
}

/** Next-page phrases — short / exact so财报 questions are not stolen. */
function isNextPageIntent(t: string): boolean {
  if (
    /^(下一页|下页|往后翻|向后翻|翻下一页|往下翻一页|向下翻一页|往下翻|向下翻|翻下去|翻后面|再下一页|往后翻一页|向后翻一页|再往下翻|往下翻页|向下翻页|翻到下一页)$/.test(
      t,
    )
  ) {
    return true;
  }
  // Soft filler: 「请帮我往下翻」「再下一页吧」— length-capped.
  if (t.length <= 12 && /^(请)?(帮我)?(再)?(往下|向下|往后|向后)翻(一页|下页|下去|后面|页)?(吧)?$/.test(t)) {
    return true;
  }
  if (t.length <= 10 && /^(请)?(帮我)?(再)?下一页(吧)?$/.test(t)) return true;
  return false;
}

/** Prev-page phrases — mirror of next, length-capped soft forms. */
function isPrevPageIntent(t: string): boolean {
  if (
    /^(上一页|上页|往前翻|向前翻|翻上一页|往上翻一页|向上翻一页|往上翻|向上翻|翻上去|翻前面|再上一页|往前翻一页|向前翻一页|再往上翻|往上翻页|向上翻页|翻到上一页)$/.test(
      t,
    )
  ) {
    return true;
  }
  if (t.length <= 12 && /^(请)?(帮我)?(再)?(往上|向上|往前|向前)翻(一页|上页|上去|前面|页)?(吧)?$/.test(t)) {
    return true;
  }
  if (t.length <= 10 && /^(请)?(帮我)?(再)?上一页(吧)?$/.test(t)) return true;
  return false;
}

/** Local PDF navigation + home/switch from ASR text — no LLM. */
export function parseVoiceNavIntent(text: string): VoiceNavIntent {
  const t = normalize(text);
  if (!t) return null;
  if (isNextPageIntent(t)) return { kind: 'next' };
  if (isPrevPageIntent(t)) return { kind: 'prev' };
  const m = t.match(/^(?:请?)?(?:跳转到?|跳到|翻到|打开|去)?第?(\d{1,4})页$/);
  if (m) {
    const page = Number(m[1]);
    if (Number.isInteger(page) && page >= 1 && page <= 10_000) return { kind: 'goto', page };
  }
  if (isVoiceHomeIntent(text)) return { kind: 'home' };
  return null;
}

/**
 * Short-lived 「继续 / 再翻」 after a successful next/prev.
 * Directional forms (再往下 / 再往上) map directly; bare 继续 needs a recent last.
 * Window: {@link VOICE_PAGE_CONTINUE_WINDOW_MS} (12s). goto does not seed last.
 */
export function parseVoicePageContinue(
  text: string,
  last: { kind: VoicePageNavDirection; at: number } | null,
  now = Date.now(),
): { kind: 'next' } | { kind: 'prev' } | null {
  const t = normalize(text);
  if (!t) return null;

  // Explicit direction — no last required (still navigation-only short phrases).
  if (
    /^(再往下|再往下翻|再往下翻一页|继续往下|继续往下翻|继续往下翻一页|接着往下|接着往下翻)$/.test(t)
  ) {
    return { kind: 'next' };
  }
  if (
    /^(再往上|再往上翻|再往上翻一页|继续往上|继续往上翻|继续往上翻一页|接着往上|接着往上翻)$/.test(t)
  ) {
    return { kind: 'prev' };
  }

  // Bare continue / 再翻 — only within the window after a next/prev.
  if (!/^(继续|再翻|再翻一页|继续翻|接着翻|继续翻页|再翻页|继续翻一页|接着翻一页)$/.test(t)) {
    return null;
  }
  if (!last) return null;
  if (now - last.at > VOICE_PAGE_CONTINUE_WINDOW_MS) return null;
  return { kind: last.kind };
}

/** Short confirm before leaving detail for home. */
export function pickVoiceHomeLine(seed = Date.now()): string {
  return HOME_CONFIRM_LINES[Math.abs(seed) % HOME_CONFIRM_LINES.length]!;
}

export { HOME_CONFIRM_LINES };
