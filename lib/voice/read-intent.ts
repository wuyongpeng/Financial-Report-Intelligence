import { normalizeVoiceText } from './text-normalize';

export type VoiceReadIntent =
  | { kind: 'section'; query: string }
  | { kind: 'page-head' }
  | null;

/**
 * Continuous section read / page-head read.
 * 「朗读第三节」「读一下管理层讨论」「从管理层讨论开始读」「读一下这页开头」
 */
export function parseVoiceReadIntent(text: string): VoiceReadIntent {
  const t = normalizeVoiceText(text);
  if (!t) return null;

  if (/^(读一下这页开头|朗读这页开头|读本页开头|读一下本页开头|读这页开头|朗读本页标题|读一下本页标题)$/.test(t)) {
    return { kind: 'page-head' };
  }

  // 「朗读/读一下/从…开始读」+ section cue
  const m =
    t.match(/^(?:请)?(?:帮我)?(?:朗读|读一下|读读|读一读|开始读|给我读)(.+?)(?:吧|啊)?$/) ||
    t.match(/^(?:请)?(?:帮我)?从(.+?)开始(?:读|朗读)(?:吧|啊)?$/) ||
    t.match(/^(?:请)?(?:帮我)?(?:朗读|读一下)(.+)$/);
  if (!m) return null;
  let q = (m[1] ?? '').replace(/^(一下|一下下)/, '');
  q = q.replace(/(开始读|开始朗读|给我听|听听)$/g, '');
  if (!q || q.length > 28) return null;

  const sectionLike =
    /^第[一二三四五六七八九十百零〇两\d]+[章节]/.test(q) ||
    /(管理层讨论|经营情况讨论|经营分析|MD&?A|风险因素|重大风险|财务报表附注|财务报表|合并报表|公司治理|报告摘要|主要会计数据)/i.test(
      q,
    );
  if (!sectionLike) return null;
  if (/(多少|怎么|为何|为什么|是否|同比|环比)/.test(q)) return null;
  return { kind: 'section', query: q };
}
