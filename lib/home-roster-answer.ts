/**
 * Home roster answers: local deterministic first, LLM with snapshot as fallback.
 * Never invent investment rankings — objective signals only for「值得分析」.
 */
import { EVA_INTRO_LINE, EVA_PRODUCT_NAME } from './product-identity';
import {
  isHomeRosterListQuestion,
  isHomeRosterPresenceQuestion,
  isHomeRosterWorthQuestion,
  parseHomeRosterOpenQuery,
} from './home-roster-intent';
import type { HomeRosterRow } from './home-roster-snapshot';
import { matchByNameOrCode } from './home-search';
import { normalizeVoiceText } from './voice/text-normalize';

export type HomeRosterAnswer = {
  answer: string;
  /** Navigate to this code when user asked to open a company on the list. */
  openCode?: string;
  mode: 'local' | 'llm';
};

const INVEST_REFUSE =
  'Eva 不下投资结论。若问「哪些值得分析」，我只按客观信号说：例如已可读、新期待更新、已收藏、解析中——不排谁更好买。';

function shortList(rows: HomeRosterRow[], limit = 12): string {
  const head = rows.slice(0, limit);
  const body = head.map((r) => `${r.name}（${r.code}）`).join('、');
  if (rows.length <= limit) return body;
  return `${body} 等共 ${rows.length} 家`;
}

function presenceNeedle(text: string): string {
  return normalizeVoiceText(text)
    .replace(/(?:在不在|有没有|在吗|在不在首页|在不在列表|在不在监控池|首页有没有|列表里有没有|监控池有没有)/g, ' ')
    .replace(/首页|主页|监控池|列表|里面|吗|呢|啊|呀|吧|的|公司/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rowsWithFlag(rows: HomeRosterRow[], flag: string) {
  return rows.filter((r) => r.flags.includes(flag));
}

/** matchByNameOrCode returns ListedNameCode; re-resolve full HomeRosterRow. */
function findRosterRow(needle: string, rows: HomeRosterRow[]): HomeRosterRow | null {
  const hit = matchByNameOrCode(needle, rows);
  if (!hit) return null;
  return rows.find((r) => r.code === hit.code) ?? null;
}

/**
 * Fast path: list / presence / objective-worth / open — no LLM.
 * Returns null when the ask should go to /api/home/ask with the snapshot.
 */
export function answerHomeRosterLocally(
  question: string,
  rows: HomeRosterRow[],
): HomeRosterAnswer | null {
  const q = normalizeVoiceText(question);
  if (!q) return null;

  const openQuery = parseHomeRosterOpenQuery(q);
  if (openQuery) {
    const hit = findRosterRow(openQuery, rows);
    if (hit) {
      return {
        answer: `好，打开${hit.name}（${hit.code}）。`,
        openCode: hit.code,
        mode: 'local',
      };
    }
    return {
      answer: `当前首页清单里没有匹配「${openQuery}」的公司。可以说代码，或先问「现在首页有哪些公司」。`,
      mode: 'local',
    };
  }

  if (isHomeRosterListQuestion(q)) {
    if (!rows.length) {
      return {
        answer: '当前首页可见清单是空的。换个行业筛选，或稍后再问监控池收入了哪些公司。',
        mode: 'local',
      };
    }
    return {
      answer: `当前清单里有 ${rows.length} 家：${shortList(rows)}。点名公司名或代码我可以帮你打开。`,
      mode: 'local',
    };
  }

  if (isHomeRosterPresenceQuestion(q)) {
    const needle = presenceNeedle(q);
    if (!needle) {
      return {
        answer: rows.length
          ? `当前清单有 ${rows.length} 家。想查某家在不在，直接说公司名或代码。`
          : '当前清单为空，没法核对在不在。',
        mode: 'local',
      };
    }
    const hit = findRosterRow(needle, rows);
    if (hit) {
      const flags = hit.flags.length ? `，状态：${hit.flags.join('、')}` : '';
      const period = hit.reportPeriod ? `，最近报告期 ${hit.reportPeriod}` : '';
      return {
        answer: `在。${hit.name}（${hit.code}）在当前清单里${period}${flags}。要打开可以说「打开${hit.name}」。`,
        mode: 'local',
      };
    }
    return {
      answer: `当前这份清单里没有「${needle}」。可以说「现在首页有哪些公司」看完整名单，或换关键词再试。`,
      mode: 'local',
    };
  }

  if (/买|卖|加仓|减仓|推荐买|值得买|能买|该买|买哪个|买哪家/.test(q) && isHomeRosterWorthQuestion(q)) {
    return { answer: INVEST_REFUSE, mode: 'local' };
  }

  if (isHomeRosterWorthQuestion(q)) {
    if (!rows.length) {
      return {
        answer: `当前清单为空。${INVEST_REFUSE}`,
        mode: 'local',
      };
    }
    const fresh = rowsWithFlag(rows, '新期待更新');
    const readable = rowsWithFlag(rows, '已可读');
    const starred = rowsWithFlag(rows, '已收藏');
    const parsing = [
      ...rowsWithFlag(rows, '解析中'),
      ...rowsWithFlag(rows, '排队解析'),
    ];
    const bits: string[] = [];
    if (starred.length) bits.push(`已收藏：${shortList(starred, 6)}`);
    if (fresh.length) bits.push(`新期待更新：${shortList(fresh, 6)}`);
    if (parsing.length) bits.push(`解析中/排队：${shortList(parsing, 4)}`);
    if (readable.length) bits.push(`已可读可追问：${shortList(readable, 8)}`);
    if (!bits.length) {
      return {
        answer: `客观上看，当前 ${rows.length} 家里暂无明显「新期待更新 / 已收藏 / 已可读」标签。${INVEST_REFUSE}`,
        mode: 'local',
      };
    }
    return {
      answer: `按客观信号（不是投资推荐）：${bits.join('；')}。${INVEST_REFUSE}`,
      mode: 'local',
    };
  }

  return null;
}

export function homeAskSystemPrompt(): string {
  return [
    `你是${EVA_PRODUCT_NAME}首页助手。身份句：${EVA_INTRO_LINE}`,
    '用户问题关于首页正在展示的公司清单；上下文里有「首页公司清单快照」。',
    '规则：1) 只根据快照与常识回答清单事实；2) 禁止投资建议、买卖、排序谁更好；',
    '3) 「哪些值得分析」只许客观信号（已可读、新期待更新、已收藏、解析中等）；',
    '4) 若用户要打开某家且快照里有，答复里用「打开：公司名（代码）」结尾；',
    '5) 不要编造不在快照里的公司；6) 回答简洁口语，适合语音播报，不超过 120 字。',
  ].join('');
}

export function homeAskUserPrompt(input: {
  question: string;
  rosterSnapshot: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): string {
  const hist = (input.history ?? [])
    .slice(-6)
    .map((t) => `${t.role === 'user' ? '用户' : 'Eva'}：${t.content}`)
    .join('\n');
  return [
    input.rosterSnapshot,
    hist ? `\n【首页近期对话（勿带入财报详情）】\n${hist}` : '',
    `\n用户问：${input.question}`,
  ].filter(Boolean).join('\n');
}

/** Parse optional「打开：贵州茅台（600519）」trailer from LLM text. */
export function extractOpenCodeFromAnswer(
  answer: string,
  rows: HomeRosterRow[],
): string | undefined {
  const m = answer.match(/打开[：:]\s*([^\n（(]{1,20})[（(](\d{6})[）)]/);
  if (m?.[2] && rows.some((r) => r.code === m[2])) return m[2];
  const openQ = parseHomeRosterOpenQuery(answer);
  if (openQ) {
    const hit = findRosterRow(openQ, rows);
    if (hit) return hit.code;
  }
  return undefined;
}
