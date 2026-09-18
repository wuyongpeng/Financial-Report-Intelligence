const GENERIC_FOLLOWUPS = [
  '本期营业收入是多少？',
  '本期归母净利润是多少？',
  '净利润变化的主要原因是什么？',
  '本期有哪些异常指标？',
  '和同行比处于什么水位？',
  '本期现金流情况如何？',
  '本期营业收入同比怎么变化？',
  '归母净利润变化的主要原因是什么？',
  '和上年同期比，哪些指标最值得关注？',
  '同行公司在同一报告期表现如何？',
  '请给出支持上述结论的原文页码。',
];

const TOPIC_HINTS: Array<[RegExp, string]> = [
  [/毛利率|毛利/, '毛利率'],
  [/经营现金流|现金流/, '经营现金流'],
  [/归母净利润|净利润|净利/, '净利润'],
  [/海外|外销|出口/, '海外业务'],
  [/营业收入|营收/, '营业收入'],
  [/收入/, '收入'],
  [/净资产收益率|ROE/i, 'ROE'],
  [/每股收益|EPS/i, '每股收益'],
  [/资产负债|负债率/, '资产负债'],
  [/营业成本|成本/, '营业成本'],
  [/研发/, '研发投入'],
  [/存货/, '存货'],
  [/应收账款|应收/, '应收账款'],
  [/分部|产品结构|主营/, '主营结构'],
];

export function normaliseFollowup(question: string) {
  return question.replace(/\s+/g, '').replace(/[？?！!。.]/g, '');
}

function flattenModelText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flattenModelText).join('');
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    if (typeof item.text === 'string') return item.text;
    if (typeof item.content === 'string') return item.content;
  }
  return '';
}

function stripThink(text: string) {
  return text.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '\n').replace(/<think\b[\s\S]*$/i, '\n');
}

/** Visible model text. Empty content must not hide reasoning that already lists questions. */
export function extractFollowupText(raw: string): string {
  try {
    const payload = JSON.parse(raw) as {
      choices?: Array<{
        text?: unknown;
        message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown };
      }>;
    };
    const choice = payload.choices?.[0];
    const message = choice?.message;
    const content = flattenModelText(message?.content ?? choice?.text);
    const reasoning = flattenModelText(message?.reasoning_content ?? message?.reasoning);
    return stripThink([content, reasoning].filter(Boolean).join('\n'));
  } catch {
    return stripThink(raw);
  }
}

export function isGenericFollowup(question: string) {
  const key = normaliseFollowup(question);
  return GENERIC_FOLLOWUPS.some((item) => normaliseFollowup(item) === key);
}

function asQuestion(line: string) {
  const text = line.replace(/^[\s\-*•·\d.、)）]+/, '').replace(/["“”]/g, '').trim();
  if (!text) return '';
  const withMark = /[？?]$/.test(text) ? text.replace(/[?]$/, '？') : (
    /吗|什么|为何|为什么|怎么|如何|多少|哪些|哪项|是否|几何/.test(text) ? `${text}？` : ''
  );
  if (!withMark) return '';
  if (withMark.length < 6 || withMark.length > 40) return '';
  if (isGenericFollowup(withMark)) return '';
  return withMark;
}

/** Keep 3 distinct, previously-unasked questions. Drop canned 营业收入/净利润套话. */
export function parseFollowupQuestions(raw: string, asked: string[]) {
  const seen = new Set(asked.map(normaliseFollowup).filter(Boolean));
  const out: string[] = [];
  for (const line of extractFollowupText(raw).split(/\n+/)) {
    const question = asQuestion(line);
    if (!question) continue;
    const key = normaliseFollowup(question);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(question);
    if (out.length === 3) break;
  }
  return out;
}

export function topicFromQuestion(question: string) {
  const text = question.replace(/\s+/g, ' ').trim();
  for (const [pattern, topic] of TOPIC_HINTS) {
    if (pattern.test(text)) return topic;
  }
  const clipped = text
    .replace(/[？?！!]/g, '')
    .replace(/^(请|帮我|想问|请问|麻烦)/, '')
    .trim();
  return clipped.slice(0, 14) || '本期业绩';
}

/** Last-resort questions still keyed to this turn, never the global canned list. */
export function contextualFollowups(question: string, answer: string, asked: string[]) {
  const topic = topicFromQuestion(question);
  const hasNumber = /\d/.test(answer);
  const candidates = [
    `${topic}变化的主要原因是什么？`,
    `和上年同期比，${topic}差多少？`,
    `原文如何解释${topic}？`,
    `${topic}在产品或地区上有何差异？`,
    hasNumber ? `上述数字的统计口径是什么？` : `有哪些风险可能影响${topic}？`,
  ];
  const seen = new Set(asked.map(normaliseFollowup).filter(Boolean));
  const out: string[] = [];
  for (const item of candidates) {
    const key = normaliseFollowup(item);
    if (seen.has(key) || isGenericFollowup(item)) continue;
    seen.add(key);
    out.push(item);
    if (out.length === 3) break;
  }
  return out;
}

export function mergeFollowups(generated: string[], fallback: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...generated, ...fallback]) {
    const question = asQuestion(item) || (/[？?]$/.test(item.trim()) ? item.trim() : '');
    if (!question || isGenericFollowup(question)) continue;
    const key = normaliseFollowup(question);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(question);
    if (out.length === 3) break;
  }
  return out;
}
