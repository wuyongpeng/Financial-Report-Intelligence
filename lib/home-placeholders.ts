/**
 * Homepage search placeholders: 15 scene-covering questions,
 * shuffled per visit, filled from live coverage so new companies appear.
 */

export type PlaceholderSeed = {
  code: string;
  name: string;
  industryGroup?: string | null;
  reportPeriod?: string | null;
  recentPeriods?: string[];
  hasReadableMetrics?: boolean;
};

export const PLACEHOLDER_SCENE_IDS = [
  'growth-slow',
  'profit-yoy',
  'gross-margin',
  'rev-vs-profit',
  'compare-roe',
  'cashflow',
  'eps',
  'leverage',
  'profit-why',
  'peer-level',
  'rev-driver',
  'expense',
  'anomaly',
  'earnings-quality',
  'worth-watch',
] as const;

export type PlaceholderSceneId = (typeof PLACEHOLDER_SCENE_IDS)[number];

/** Used before coverage loads, and when the pool is empty. Mix industries; do not lead with 茅台. */
export const FALLBACK_PLACEHOLDER_SEEDS: PlaceholderSeed[] = [
  { code: '600036', name: '招商银行', industryGroup: '金融', reportPeriod: '2026H1' },
  { code: '300750', name: '宁德时代', industryGroup: '新能源', reportPeriod: '2026H1' },
  { code: '601138', name: '工业富联', industryGroup: '科技', reportPeriod: '2026H1' },
  { code: '000858', name: '五粮液', industryGroup: '消费', reportPeriod: '2026H1' },
  { code: '601318', name: '中国平安', industryGroup: '金融', reportPeriod: '2026H1' },
  { code: '000333', name: '美的集团', industryGroup: '消费', reportPeriod: '2026H1' },
  { code: '002594', name: '比亚迪', industryGroup: '新能源', reportPeriod: '2026H1' },
  { code: '002415', name: '海康威视', industryGroup: '科技', reportPeriod: '2026H1' },
  { code: '600276', name: '恒瑞医药', industryGroup: '医药', reportPeriod: '2026H1' },
  { code: '600519', name: '贵州茅台', industryGroup: '消费', reportPeriod: '2026H1' },
  { code: '601012', name: '隆基绿能', industryGroup: '新能源', reportPeriod: '2026H1' },
  { code: '000001', name: '平安银行', industryGroup: '金融', reportPeriod: '2026H1' },
  { code: '600900', name: '长江电力', industryGroup: '周期', reportPeriod: '2026H1' },
  { code: '002475', name: '立讯精密', industryGroup: '科技', reportPeriod: '2026H1' },
  { code: '600309', name: '万华化学', industryGroup: '周期', reportPeriod: '2026H1' },
];

export function shortCompanyName(name: string): string {
  const trimmed = name.replace(/\s+/g, '').trim();
  const stripped = trimmed
    .replace(/（.*?）|\(.*?\)/g, '')
    .replace(/股份有限公司|有限责任公司|有限公司/g, '')
    .replace(/集团股份$/, '集团')
    .trim();
  return stripped || trimmed || name;
}

/** Compact period for ask copy: 2026H1 → 2026半年报 */
export function periodAskLabel(token?: string | null): string {
  if (!token) return '';
  return token
    .replace(/FY$/i, '年报')
    .replace(/H1$/i, '半年报')
    .replace(/Q1$/i, '一季报')
    .replace(/Q2$/i, '二季报')
    .replace(/Q3$/i, '三季报');
}

export function shuffleInPlace<T>(items: T[], random: () => number = Math.random): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const current = items[i]!;
    items[i] = items[j]!;
    items[j] = current;
  }
  return items;
}

function pickPeriod(seed: PlaceholderSeed): string {
  const token = seed.reportPeriod || seed.recentPeriods?.find(Boolean) || '';
  return periodAskLabel(token);
}

function withPeriod(name: string, period: string, rest: string, fallback: string) {
  return period ? `${name}${period}${rest}` : `${name}${fallback}`;
}

function buildScene(id: PlaceholderSceneId, company: PlaceholderSeed, peer?: PlaceholderSeed | null): string {
  const name = shortCompanyName(company.name);
  const period = pickPeriod(company);
  const other = peer && peer.code !== company.code ? shortCompanyName(peer.name) : '';
  switch (id) {
    case 'growth-slow':
      return withPeriod(name, period, '增长是否缓慢？', '最新一期增长是否缓慢？');
    case 'profit-yoy':
      return `${name}净利润同比怎么样？`;
    case 'gross-margin':
      return `${name}毛利率最近怎么变？`;
    case 'rev-vs-profit':
      return `${name}营收和净利谁更快？`;
    case 'compare-roe':
      return other ? `对比${name}和${other}的ROE` : `${name}的ROE和同行比如何？`;
    case 'cashflow':
      return `${name}经营现金流是否健康？`;
    case 'eps':
      return withPeriod(name, period, '每股收益怎么样？', '每股收益最近怎么样？');
    case 'leverage':
      return `${name}资产负债率高不高？`;
    case 'profit-why':
      return `${name}净利润变动的主要原因？`;
    case 'peer-level':
      return `${name}盈利能力和同行比如何？`;
    case 'rev-driver':
      return withPeriod(name, period, '营收增长靠什么？', '营收增长主要靠什么？');
    case 'expense':
      return `${name}费用有没有侵蚀利润？`;
    case 'anomaly':
      return `${name}本期有哪些异常指标？`;
    case 'earnings-quality':
      return `${name}盈利质量怎么样？`;
    case 'worth-watch':
      return `${name}最新一期值不值得关注？`;
  }
}

function preferReadable(seeds: PlaceholderSeed[]): PlaceholderSeed[] {
  const ready = seeds.filter((s) => s.hasReadableMetrics);
  const rest = seeds.filter((s) => !s.hasReadableMetrics);
  return ready.length ? [...ready, ...rest] : seeds;
}

function pickPeer(company: PlaceholderSeed, pool: PlaceholderSeed[], offset: number): PlaceholderSeed | null {
  const others = pool.filter((s) => s.code !== company.code);
  if (!others.length) return null;
  const sameIndustry = others.filter((s) => s.industryGroup && s.industryGroup === company.industryGroup);
  const candidates = sameIndustry.length ? sameIndustry : others;
  return candidates[offset % candidates.length] ?? candidates[0] ?? null;
}

/** Round-robin across industry buckets so 15 questions are not one sector. */
function diversifyCompanies(seeds: PlaceholderSeed[], random: () => number): PlaceholderSeed[] {
  const byGroup = new Map<string, PlaceholderSeed[]>();
  for (const seed of seeds) {
    const key = seed.industryGroup || seed.code;
    const list = byGroup.get(key) ?? [];
    list.push(seed);
    byGroup.set(key, list);
  }
  for (const list of byGroup.values()) shuffleInPlace(list, random);
  const groups = shuffleInPlace([...byGroup.values()], random);
  const out: PlaceholderSeed[] = [];
  const seen = new Set<string>();
  let added = true;
  while (added) {
    added = false;
    for (const group of groups) {
      const next = group.shift();
      if (!next || seen.has(next.code)) continue;
      seen.add(next.code);
      out.push(next);
      added = true;
    }
  }
  return out;
}

export function buildHomePlaceholders(
  companies: PlaceholderSeed[],
  options: { count?: number; random?: () => number } = {},
): string[] {
  const count = options.count ?? 15;
  const random = options.random ?? Math.random;
  const live = companies.filter((c) => c.name && c.code);
  const pool = preferReadable(live.length ? live : FALLBACK_PLACEHOLDER_SEEDS);
  const unique = new Map<string, PlaceholderSeed>();
  for (const seed of pool) unique.set(seed.code, { ...seed, name: shortCompanyName(seed.name) });
  const roster = diversifyCompanies([...unique.values()], random);
  if (!roster.length) return [...DEFAULT_HOME_PLACEHOLDERS].slice(0, count);

  const scenes = shuffleInPlace([...PLACEHOLDER_SCENE_IDS], random);
  const questions: string[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (questions.length < count && guard < count * 8) {
    const scene = scenes[guard % scenes.length]!;
    const company = roster[guard % roster.length]!;
    const peer = scene === 'compare-roe' ? pickPeer(company, roster, guard) : null;
    const text = buildScene(scene, company, peer);
    guard += 1;
    if (seen.has(text)) continue;
    seen.add(text);
    questions.push(text);
  }
  while (questions.length < count) {
    const fallback = DEFAULT_HOME_PLACEHOLDERS[questions.length % DEFAULT_HOME_PLACEHOLDERS.length]!;
    if (!seen.has(fallback)) {
      seen.add(fallback);
      questions.push(fallback);
    } else {
      questions.push(`${fallback.replace(/？$/, '')}怎么看？`);
    }
  }
  return questions.slice(0, count);
}

/** Stable first-paint copy (SSR/hydration). Client shuffles after mount. */
export const DEFAULT_HOME_PLACEHOLDERS: string[] = PLACEHOLDER_SCENE_IDS.map((scene, index) => {
  const company = FALLBACK_PLACEHOLDER_SEEDS[index % FALLBACK_PLACEHOLDER_SEEDS.length]!;
  const peer = pickPeer(company, FALLBACK_PLACEHOLDER_SEEDS, index + 1);
  return buildScene(scene, company, peer);
});
