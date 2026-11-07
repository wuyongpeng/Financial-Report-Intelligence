/** Local picture of how this reader asks. Derived from real visits and questions, not a model guess. */

export type ReaderMemoryCompany = { code: string; name: string; count: number };
export type ReaderMemoryTopic = { key: string; label: string; count: number };

export type ReaderMemory = {
  companies: ReaderMemoryCompany[];
  topics: ReaderMemoryTopic[];
};

export const EMPTY_READER_MEMORY: ReaderMemory = { companies: [], topics: [] };

export const READER_MEMORY_KEY = 'eva_reader_memory';

const TOPIC_RULES: Array<{ key: string; label: string; pattern: RegExp }> = [
  { key: 'why', label: '变化原因', pattern: /为什么|为何|原因/ },
  { key: 'compare', label: '对比', pattern: /对比|比较|同比|环比|同行|同业/ },
  { key: 'metric', label: '核心指标', pattern: /营收|营业收入|净利润|ROE|EPS|现金流|毛利|净资产/i },
  { key: 'risk', label: '风险与异常', pattern: /风险|异常|商誉|负债|减值/ },
  { key: 'guide', label: '怎么看财报', pattern: /怎么看|如何看|怎么读|从哪/ },
];

export function applyReaderActivity(
  memory: ReaderMemory,
  input: { question?: string; code?: string; name?: string },
): ReaderMemory {
  const companies = memory.companies.map((item) => ({ ...item }));
  const topics = memory.topics.map((item) => ({ ...item }));
  const code = (input.code ?? '').trim();
  const name = (input.name ?? '').trim();
  if (/^\d{6}$/.test(code) && name) {
    const hit = companies.find((item) => item.code === code);
    if (hit) {
      hit.count += 1;
      hit.name = name;
    } else {
      companies.push({ code, name, count: 1 });
    }
  }
  const question = (input.question ?? '').replace(/\s+/g, '');
  if (question.length >= 2) {
    for (const rule of TOPIC_RULES) {
      if (!rule.pattern.test(question)) continue;
      const hit = topics.find((item) => item.key === rule.key);
      if (hit) hit.count += 1;
      else topics.push({ key: rule.key, label: rule.label, count: 1 });
    }
  }
  companies.sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  return { companies: companies.slice(0, 8), topics };
}

export function describeReaderMemory(memory: ReaderMemory, levelLabel: string): {
  style: string;
  companies: string;
  portrait: string;
  brief: string;
} {
  const topics = [...memory.topics].filter((item) => item.count > 0).sort((a, b) => b.count - a.count).slice(0, 3);
  const companies = memory.companies.slice(0, 3);
  const style = topics.length ? topics.map((item) => item.label).join('、') : '还没有明显的提问偏好';
  const companyText = companies.length
    ? companies.map((item) => `${item.name}（${item.count}）`).join('、')
    : '还没有常看的公司';
  const empty = topics.length === 0 && companies.length === 0;
  const portrait = empty
    ? '还没有形成画像。多问几家公司后，这里会记下你的习惯。'
    : `${levelLabel}读者${companies.length ? `，常看${companies.map((item) => item.name).join('、')}` : ''}${topics.length ? `，提问多集中在${topics.map((item) => item.label).join('、')}` : ''}。`;
  return { style, companies: companyText, portrait, brief: empty ? '' : portrait.slice(0, 180) };
}
