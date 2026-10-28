import { CN_NUM_CHARS } from './cn-number';

/**
 * A section query is only accepted when it is (almost) exactly a section title —
 * 「第三节」「管理层讨论与分析」「第三节管理层讨论」— never a sentence that merely
 * mentions one (「管理层讨论说了啥」「风险因素有哪些」).
 */
const TITLE =
  '(?:管理层讨论与分析|管理层讨论及分析|管理层讨论|经营情况讨论与分析|经营情况讨论|经营分析|MD&?A|' +
  '风险因素|重大风险提示|重大风险|风险提示|财务报表附注|财务报表|合并报表|公司治理|董事会报告|' +
  '报告摘要|主要会计数据和财务指标|主要会计数据|公司简介|释义|重要提示|重要事项|财务报告|审计报告|' +
  '股份变动及股东情况|股东情况|环境和社会责任|业务概要)';
const ORDINAL = `第[${CN_NUM_CHARS}\\d]{1,4}[章节]`;
const SECTION_TITLE_RE = new RegExp(`^(?:${ORDINAL})?(?:${TITLE})?(?:部分|章节|那一?[章节]|这一?[章节])?$`, 'i');

export function isSectionTitleQuery(q: string): boolean {
  const s = q.trim();
  if (!s || s.length > 24) return false;
  if (!SECTION_TITLE_RE.test(s)) return false;
  // Must contain at least an ordinal or a known title (not just 「部分」).
  return new RegExp(`${ORDINAL}|${TITLE}`, 'i').test(s);
}
