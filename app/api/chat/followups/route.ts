import { getDb } from '@/lib/db';
import { fetchChatCompletions } from '@/lib/llm-gate';
import { llmConfigured } from '@/lib/llm-providers';

// Follow-up questions are a navigation aid, never an answer: they must stay short,
// answerable from this single report, and must degrade to a static list when the
// model is unavailable, so the reading flow never depends on the LLM.
const fallbackPool = [
  '本期营业收入是多少？',
  '本期归母净利润是多少？',
  '净利润变化的主要原因是什么？',
  '本期有哪些异常指标？',
  '和同行比处于什么水位？',
  '本期现金流情况如何？',
];

function normalise(question: string) { return question.replace(/\s+/g, '').replace(/[？?]$/, ''); }

function pickFallback(asked: string[]) {
  const seen = new Set(asked.map(normalise));
  return fallbackPool.filter((q) => !seen.has(normalise(q))).slice(0, 3);
}

function parseQuestions(raw: string, asked: string[]) {
  const seen = new Set(asked.map(normalise));
  const out: string[] = [];
  for (const line of raw.split('\n')) {
    const text = line.replace(/^[\s\-*•\d.、)）]+/, '').trim();
    if (text.length < 5 || text.length > 40 || !/[？?]$/.test(text)) continue;
    if (seen.has(normalise(text))) continue;
    seen.add(normalise(text));
    out.push(text);
    if (out.length === 3) break;
  }
  return out;
}

async function generate(prompt: string) {
  if (!llmConfigured()) return null;
  const controller = new AbortController();
  // Follow-ups are secondary content; a short budget keeps them from blocking the reader.
  const timer = setTimeout(() => controller.abort(), Number(process.env.LLM_FOLLOWUP_TIMEOUT_MS ?? 15_000));
  try {
    const response = await fetchChatCompletions(
      {
        temperature: 0.3,
        max_tokens: 200,
        messages: [
          { role: 'system', content: '你为财报阅读者生成追问建议。只输出3行，每行一个不超过24个汉字的中文问题，必须以问号结尾，不要编号、不要解释、不要投资建议。问题必须能依据同一份财报（已入库指标或原文）继续回答，且不得重复用户已问过的问题。' },
          { role: 'user', content: prompt },
        ],
      },
      { signal: controller.signal, timeoutMs: Number(process.env.LLM_FOLLOWUP_TIMEOUT_MS ?? 15_000) },
    );
    if (!response.ok) return null;
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return payload.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (error) {
    console.warn('[chat] follow-up generation failed', { message: String(error) });
    return null;
  } finally { clearTimeout(timer); }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { reportId?: string; question?: string; answer?: string; asked?: string[] };
  if (!body.reportId || !body.question?.trim()) return Response.json({ error: '缺少 reportId 或 question' }, { status: 400 });
  const asked = [body.question, ...(body.asked ?? [])].filter((q): q is string => Boolean(q));
  const db = getDb();
  const [report] = await db<Array<{ code: string; company_name: string; industry: string }>>`
    SELECT a.code, a.company_name, c.industry FROM announcements a JOIN companies c ON c.code=a.code WHERE a.id=${body.reportId}
  `;
  if (!report) return Response.json({ error: '报告不存在' }, { status: 404 });
  const metrics = await db<Array<{ metric: string; value: number; unit: string }>>`
    SELECT metric, value, unit FROM financial_metrics WHERE announcement_id=${body.reportId}
  `;
  const coverage = metrics.length ? metrics.map((m) => `${m.metric}=${m.value}${m.unit}`).join('；') : '暂无已入库指标';
  const prompt = `公司：${report.company_name}（${report.code}）；行业：${report.industry}\n本报告已入库指标：${coverage}\n用户刚问：${body.question}\n助手的回答（可能被截断）：${(body.answer ?? '').slice(0, 900) || '无'}\n用户此前已问过：${asked.slice(1).join(' / ') || '无'}\n请给出3个与上面问题相关、可继续深入的追问。`;
  const raw = await generate(prompt);
  const questions = raw ? parseQuestions(raw, asked) : [];
  const result = questions.length ? questions : pickFallback(asked);
  return Response.json({ questions: result, mode: questions.length ? 'llm' : 'fallback' }, { headers: { 'cache-control': 'no-store' } });
}
