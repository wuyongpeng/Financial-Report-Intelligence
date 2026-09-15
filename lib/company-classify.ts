/**
 * Assign 一级(sector) / 二级(industry) when a company joins the monitor pool.
 * Prefer public industry labels + name hints; LLM is last-resort only.
 */
import type { IndustryGroup } from '@/lib/crawl-display';
import { INDUSTRY_CHIPS, mapIndustryGroup } from '@/lib/crawl-display';

export type ClassifiedTags = {
  sector: IndustryGroup;
  industry: string;
  source: 'name' | 'market' | 'llm' | 'fallback';
};

const NAME_HINTS: Array<{ test: RegExp; sector: IndustryGroup; industry: string }> = [
  { test: /银行/, sector: '金融', industry: '银行' },
  { test: /保险|人寿|太保|人保/, sector: '金融', industry: '保险' },
  { test: /证券|券商/, sector: '金融', industry: '券商' },
  { test: /茅台|五粮液|泸州老窖|汾酒|洋河|白酒/, sector: '消费', industry: '白酒' },
  { test: /啤酒/, sector: '消费', industry: '啤酒' },
  { test: /电器|家电|智家/, sector: '消费', industry: '家电' },
  { test: /牧原|温氏|牧|禽|渔/, sector: '消费', industry: '农林牧渔' },
  { test: /芯片|半导体|微电子|集成电路|燧原|沐曦|寒武|海光|龙芯/, sector: '科技', industry: 'AI芯片' },
  { test: /光伏|硅料|硅片/, sector: '新能源', industry: '光伏' },
  { test: /锂电|电池/, sector: '新能源', industry: '锂电' },
  { test: /新能源车|比亚迪/, sector: '新能源', industry: '新能源车' },
  { test: /制药|医药|生物|疫苗|中药|CXO|康德/, sector: '医药', industry: '医药' },
  { test: /煤炭|煤业/, sector: '周期', industry: '煤炭' },
  { test: /石油|石化/, sector: '周期', industry: '石油石化' },
  { test: /港口|港务|上港|机场|高速|航运|铁路/, sector: '周期', industry: '交通运输' },
  { test: /军工|兵器|航空发动机/, sector: '制造军工', industry: '军工' },
];

type Mapped = { sector: IndustryGroup; industry: string };

function mapped(sector: IndustryGroup, industry: string): Mapped {
  return { sector, industry };
}

/** Map 东财/申万/证监会行业文本到产品用的一级+二级. */
export function classifyFromIndustryText(raw: string, name = ''): Mapped | null {
  const text = `${raw}${name}`.replace(/\s+/g, '');
  if (!text) return null;

  if (/银行/.test(text)) return mapped('金融', '银行');
  if (/保险/.test(text)) return mapped('金融', '保险');
  if (/证券|券商/.test(text)) return mapped('金融', '券商');
  if (/多元金融|非银/.test(text)) return mapped('金融', '非银金融');

  if (/白酒/.test(text)) return mapped('消费', '白酒');
  if (/乳制品|乳品/.test(text)) return mapped('消费', '乳制品');
  if (/调味/.test(text)) return mapped('消费', '调味品');
  if (/啤酒/.test(text)) return mapped('消费', '啤酒');
  if (/家用电器|白色家电|黑色家电|小家电|家电/.test(text)) return mapped('消费', '家电');
  if (/免税/.test(text)) return mapped('消费', '免税');
  if (/农林牧渔|养殖|饲料|农产品/.test(text)) return mapped('消费', '农林牧渔');
  if (/食品饮料/.test(text)) return mapped('消费', '食品饮料');
  if (/商贸零售|零售/.test(text)) return mapped('消费', '商贸零售');
  if (/社会服务|酒店|旅游/.test(text)) return mapped('消费', '社会服务');
  if (/传媒/.test(text)) return mapped('消费', '传媒');

  if (/半导体|集成电路/.test(text)) return mapped('科技', '半导体');
  if (/消费电子/.test(text)) return mapped('科技', '消费电子');
  if (/光模块|光通信/.test(text)) return mapped('科技', '光通信');
  if (/面板|显示器件/.test(text)) return mapped('科技', '面板');
  if (/存储/.test(text)) return mapped('科技', '存储');
  if (/计算机设备|计算机应用|软件|计算机/.test(text)) return mapped('科技', '计算机');
  if (/通信/.test(text)) return mapped('科技', '通信设备');
  if (/电子/.test(text)) return mapped('科技', '电子');

  if (/电池|锂电/.test(text)) return mapped('新能源', '锂电');
  if (/光伏|太阳能/.test(text)) return mapped('新能源', '光伏');
  if (/储能/.test(text)) return mapped('新能源', '储能');
  if (/新能源车|汽车零部件/.test(name) && /汽车|新能源/.test(text)) return mapped('新能源', '新能源车');
  if (/电力设备|风电/.test(text)) return mapped('新能源', '电力设备');

  if (/创新药|化学制药/.test(text)) return mapped('医药', '创新药');
  if (/医疗器械/.test(text)) return mapped('医药', '医疗器械');
  if (/CXO|服务/.test(text) && /医药|生物/.test(text)) return mapped('医药', 'CXO');
  if (/中药/.test(text)) return mapped('医药', '中药');
  if (/医疗服务/.test(text)) return mapped('医药', '医疗服务');
  if (/疫苗/.test(text)) return mapped('医药', '疫苗');
  if (/医药|生物/.test(text)) return mapped('医药', '医药');

  if (/国防军工|军工|航空装备|兵器/.test(text)) return mapped('制造军工', '军工');
  if (/轨交|铁路设备/.test(text)) return mapped('制造军工', '轨交装备');
  if (/工控|机器人/.test(text)) return mapped('制造军工', '工控机器人');

  if (/煤炭/.test(text)) return mapped('周期', '煤炭');
  if (/石油|石化/.test(text)) return mapped('周期', '石油石化');
  if (/有色|金属/.test(text)) return mapped('周期', '有色');
  if (/化工/.test(text)) return mapped('周期', '化工');
  if (/钢铁/.test(text)) return mapped('周期', '钢铁');
  if (/汽车/.test(text)) return mapped('周期', '汽车');
  if (/机械/.test(text)) return mapped('周期', '工程机械');
  if (/运输|物流|港口|机场|航运|公路/.test(text)) return mapped('周期', '交通运输');
  if (/建筑/.test(text)) return mapped('周期', '建筑');
  if (/房地产/.test(text)) return mapped('周期', '房地产');
  if (/公用|电力/.test(text)) return mapped('周期', '公用事业');

  return null;
}

export function classifyFromName(name: string): Mapped | null {
  const compact = name.replace(/\s+/g, '');
  for (const hint of NAME_HINTS) {
    if (hint.test.test(compact)) return mapped(hint.sector, hint.industry);
  }
  return null;
}

export function classifyFromSignals(opts: {
  name: string;
  marketIndustry?: string | null;
}): ClassifiedTags {
  const fromMarket = opts.marketIndustry
    ? classifyFromIndustryText(opts.marketIndustry, opts.name)
    : null;
  if (fromMarket) {
    // Name can refine 计算机 → AI芯片 for known design houses.
    const fromName = classifyFromName(opts.name);
    if (fromName && fromMarket.sector === '科技' && fromName.industry === 'AI芯片') {
      return { ...fromName, source: 'market' };
    }
    return { ...fromMarket, source: 'market' };
  }
  const fromName = classifyFromName(opts.name);
  if (fromName) return { ...fromName, source: 'name' };
  return { sector: '其他', industry: '待分类', source: 'fallback' };
}

function exchangePrefix(code: string, exchange: 'SSE' | 'SZSE' | 'BSE'): 'SH' | 'SZ' {
  if (exchange === 'SSE' || code.startsWith('6') || code.startsWith('9')) return 'SH';
  return 'SZ';
}

function secid(code: string, exchange: 'SSE' | 'SZSE' | 'BSE'): string {
  const market = exchangePrefix(code, exchange) === 'SH' ? '1' : '0';
  return `${market}.${code}`;
}

function pickIndustryField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, '').trim();
  if (!text || text === '-' || text === '--' || text === '其他') return null;
  return text;
}

async function lookupEastMoneyF10(code: string, exchange: 'SSE' | 'SZSE' | 'BSE'): Promise<string | null> {
  const symbol = `${exchangePrefix(code, exchange)}${code}`;
  const url = `https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/CompanySurveyAjax?code=${symbol}`;
  const res = await fetch(url, {
    headers: { 'user-agent': 'FinanceReportIntelligence/1.0', referer: 'https://emweb.securities.eastmoney.com/' },
    signal: AbortSignal.timeout(6_000),
  });
  if (!res.ok) return null;
  const json = await res.json() as {
    jbzl?: { sshy?: string; sszjhhy?: string; industry?: string };
  };
  return pickIndustryField(json.jbzl?.sshy)
    ?? pickIndustryField(json.jbzl?.sszjhhy)
    ?? pickIndustryField(json.jbzl?.industry);
}

async function lookupEastMoneyQuote(code: string, exchange: 'SSE' | 'SZSE' | 'BSE'): Promise<string | null> {
  const url = `https://push2.eastmoney.com/api/qt/stock/get?fltt=2&invt=2&secid=${secid(code, exchange)}&fields=f57,f58,f127,f128`;
  const res = await fetch(url, {
    headers: { 'user-agent': 'FinanceReportIntelligence/1.0' },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) return null;
  const json = await res.json() as { data?: { f127?: string; f128?: string } };
  return pickIndustryField(json.data?.f127) ?? pickIndustryField(json.data?.f128);
}

export async function lookupMarketIndustry(
  code: string,
  exchange: 'SSE' | 'SZSE' | 'BSE',
): Promise<string | null> {
  try {
    const f10 = await lookupEastMoneyF10(code, exchange);
    if (f10) return f10;
  } catch {
    /* fall through */
  }
  try {
    return await lookupEastMoneyQuote(code, exchange);
  } catch {
    return null;
  }
}

async function classifyWithLlm(code: string, name: string): Promise<Mapped | null> {
  const baseUrl = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL;
  if (!baseUrl || !model) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.LLM_CLASSIFY_TIMEOUT_MS ?? 8_000));
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(process.env.LLM_API_KEY ? { authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 80,
        messages: [
          {
            role: 'system',
            content: '你为A股公司打行业标签。只输出JSON：{"sector":"科技|消费|新能源|医药|金融|周期|制造军工","industry":"不超过6个字的二级行业"}。不要解释。',
          },
          { role: 'user', content: `${name}（${code}）` },
        ],
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = payload.choices?.[0]?.message?.content?.trim() ?? '';
    const jsonText = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonText) return null;
    const parsed = JSON.parse(jsonText) as { sector?: string; industry?: string };
    const sector = parsed.sector && (INDUSTRY_CHIPS as string[]).includes(parsed.sector)
      ? parsed.sector as IndustryGroup
      : null;
    const industry = String(parsed.industry ?? '').replace(/\s+/g, '').slice(0, 8);
    if (!sector || !industry) return null;
    return { sector, industry };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function classifyCompany(opts: {
  code: string;
  name: string;
  exchange: 'SSE' | 'SZSE' | 'BSE';
}): Promise<ClassifiedTags> {
  const marketIndustry = await lookupMarketIndustry(opts.code, opts.exchange);
  const signals = classifyFromSignals({ name: opts.name, marketIndustry });
  if (signals.source !== 'fallback') return signals;

  const llm = await classifyWithLlm(opts.code, opts.name);
  if (llm) return { ...llm, source: 'llm' };

  const derived = mapIndustryGroup(opts.name);
  if (derived !== '其他') return { sector: derived, industry: derived, source: 'name' };
  return signals;
}
