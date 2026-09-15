/**
 * Market nicknames and shortened 交易所简称 stems.
 * Used by home search / card filter — deterministic, not AI.
 */

/** Popular spoken aliases → official A-share 简称 (as in ashare-universe). Longer keys win. */
export const WELL_KNOWN_ALIASES: Record<string, string> = {
  招行: '招商银行',
  工行: '工商银行',
  建行: '建设银行',
  中行: '中国银行',
  农行: '农业银行',
  交行: '交通银行',
  邮储: '邮储银行',
  浦发: '浦发银行',
  兴业: '兴业银行',
  民生: '民生银行',
  平安银行: '平安银行',
  平安: '中国平安',
  国寿: '中国人寿',
  太保: '中国太保',
  人保: '中国人保',
  茅台: '贵州茅台',
  洋河: '洋河股份',
  美的: '美的集团',
  海尔: '海尔智家',
  格力: '格力电器',
  伊利: '伊利股份',
  海天: '海天味业',
  农夫: '农夫山泉',
  宁德: '宁德时代',
  中芯: '中芯国际',
  海康: '海康威视',
  立讯: '立讯精密',
  寒武: '寒武纪',
  沐曦: '沐曦股份',
  燧原: '燧原科技',
  富士康: '工业富联',
  韦尔: '韦尔股份',
  澜起: '澜起科技',
  隆基: '隆基绿能',
  通威: '通威股份',
  亿纬: '亿纬锂能',
  恒瑞: '恒瑞医药',
  药明: '药明康德',
  迈瑞: '迈瑞医疗',
  三一: '三一重工',
  神华: '中国神华',
  紫金: '紫金矿业',
  万华: '万华化学',
  牧原: '牧原股份',
  温氏: '温氏股份',
  上港: '上港集团',
};

const ALIAS_KEYS = Object.keys(WELL_KNOWN_ALIASES).sort((a, b) => b.length - a.length);

const SUFFIX_PASSES = [
  /(?:股份有限公司|有限责任公司|有限公司)$/,
  /(?:股份|集团|控股|有限)$/,
  /(?:科技|电子|制药|医药|国际|投资|能源|智能|信息|通信|光电|生物|材料|实业|发展|制造|电器)$/,
];

/** Official 简称 plus progressively stripped stems, e.g. 美的集团 → 美的. */
export function nameVariants(name: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const next = value.replace(/\s+/g, '').trim();
    if (next.length >= 2 && !seen.has(next)) {
      seen.add(next);
      out.push(next);
    }
  };
  add(name);
  add(name.replace(/-U$|-W$/i, ''));
  let cur = name.replace(/\s+/g, '').replace(/-U$|-W$/i, '').trim();
  for (const re of SUFFIX_PASSES) {
    const next = cur.replace(re, '');
    if (next !== cur) {
      add(next);
      cur = next;
    }
  }
  return out;
}

/** First well-known alias appearing in free text → official 简称. */
export function officialNameFromAlias(text: string): string | null {
  const compact = text.replace(/\s+/g, '');
  if (!compact) return null;
  for (const alias of ALIAS_KEYS) {
    if (compact.includes(alias)) return WELL_KNOWN_ALIASES[alias];
  }
  return null;
}

export function officialNameForToken(token: string): string | null {
  const t = token.replace(/\s+/g, '').trim();
  if (!t) return null;
  return WELL_KNOWN_ALIASES[t] ?? null;
}
