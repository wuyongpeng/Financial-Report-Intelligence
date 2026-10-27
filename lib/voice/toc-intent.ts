import { normalizeVoiceText } from './text-normalize';

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
  if (!q || q.length > 24) return null;

  // Must look like a section / known chapter cue — not a finance question.
  const sectionLike =
    /^第[一二三四五六七八九十百零〇两\d]+[章节]/.test(q) ||
    /(管理层讨论|经营情况讨论|经营分析|MD&?A|风险因素|重大风险|财务报表附注|财务报表|合并报表|公司治理|报告摘要|主要会计数据|目录)/i.test(
      q,
    );
  if (!sectionLike) return null;
  // Reject question-shaped utterances.
  if (/(多少|怎么|为何|为什么|是否|有没有|同比|环比|是多少)/.test(q)) return null;
  return { kind: 'jump-section', query: q };
}
