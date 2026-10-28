import { normalizeVoiceText } from './text-normalize';
import { isSectionTitleQuery } from './section-query';

export type VoiceTocIntent =
  | { kind: 'open-toc' }
  | { kind: 'jump-section'; query: string }
  | null;

/** 「打开目录 / 跳到管理层讨论」— local rules only. */
export function parseVoiceTocIntent(text: string): VoiceTocIntent {
  const t = normalizeVoiceText(text);
  if (!t) return null;

  if (
    /^(打开|看|显示|展开|去|跳到)?(目录|提纲|大纲|章节目录|提纲导航)$/.test(t) ||
    /^(打开|看|显示|展开)(一下)?(目录|提纲|大纲)$/.test(t) ||
    /^(请)?(帮我)?(打开|看|显示)(一下)?(目录|提纲)$/.test(t)
  ) {
    return { kind: 'open-toc' };
  }

  // Never steal continuous-read commands.
  if (/^(朗读|读一下|读读|读一读|开始读|给我读|从)/.test(t)) return null;

  // 「跳到/打开/去 + 章节名」— length-capped so财报 questions are not stolen.
  const jump = t.match(
    /^(?:请)?(?:帮我)?(?:跳转到?|跳到|打开|去|翻到|看一下|看看)(.+?)(?:那一?[章节页]|这一?[章节]|部分)?$/,
  );
  if (!jump) return null;
  let q = jump[1] ?? '';
  q = q.replace(/^(一下|一下下)/, '');
  if (!q) return null;

  // Must be (almost exactly) a section title — never a sentence that merely mentions one.
  if (!isSectionTitleQuery(q)) return null;
  return { kind: 'jump-section', query: q };
}
