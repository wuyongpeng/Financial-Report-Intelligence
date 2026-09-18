import { getDb } from '@/lib/db';
import { contextualFollowups, mergeFollowups, parseFollowupQuestions } from '@/lib/chat-followups';
import { fetchChatCompletionsFrom } from '@/lib/llm-gate';
import { llmConfigured, parseLlmProviders } from '@/lib/llm-providers';
import { orderVerdictProviders } from '@/lib/report-verdict-llm';

const FOLLOWUP_TIMEOUT_MS = Number(process.env.LLM_FOLLOWUP_TIMEOUT_MS ?? 12_000);

function followupPrompt(input: {
  company: string;
  code: string;
  industry: string;
  coverage: string;
  question: string;
  answer: string;
  asked: string[];
}) {
  return `公司：${input.company}（${input.code}）；行业：${input.industry}
本报告已入库指标：${input.coverage}
用户刚问：${input.question}
助手的回答（可能被截断）：${input.answer.slice(0, 900) || '无'}
用户此前已问过：${input.asked.slice(1).join(' / ') || '无'}

请围绕「用户刚问」和「助手回答」里出现的具体指标、业务或原因，给出 3 个下一步追问。
要求：每行一个中文问题，以问号结尾，不超过 24 个汉字；三个问题角度不同（原因/对比/原文证据或结构）；禁止重复已问过的问题；禁止输出「本期营业收入是多少」「本期归母净利润是多少」这类与本轮无关的套话。`;
}

async function generate(prompt: string, asked: string[]) {
  if (!llmConfigured()) return null;
  const providers = orderVerdictProviders(parseLlmProviders()).slice(0, 2);
  const body = {
    temperature: 0.4,
    max_tokens: 220,
    enable_thinking: false,
    thinking: { type: 'disabled' },
    chat_template_kwargs: { enable_thinking: false },
    messages: [
      { role: 'system', content: '你为财报阅读者生成个性化追问。只输出 3 行问题，不要编号、不要解释、不要投资建议。问题必须能依据同一份已入库财报继续回答。' },
      { role: 'user', content: prompt },
    ],
  };
  let best: string[] = [];
  for (const provider of providers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FOLLOWUP_TIMEOUT_MS);
    try {
      const response = await fetchChatCompletionsFrom(provider, body, {
        signal: controller.signal,
        timeoutMs: FOLLOWUP_TIMEOUT_MS,
        maxAttempts: 1,
      });
      if (!response.ok) {
        await response.text().catch(() => '');
        continue;
      }
      const parsed = parseFollowupQuestions(await response.text(), asked);
      if (parsed.length > best.length) best = parsed;
      if (best.length >= 3) return best;
    } catch (error) {
      console.warn('[chat] follow-up generation failed', { provider: provider.id, message: String(error) });
    } finally {
      clearTimeout(timer);
    }
  }
  return best.length ? best : null;
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
  const generated = await generate(followupPrompt({
    company: report.company_name,
    code: report.code,
    industry: report.industry,
    coverage,
    question: body.question,
    answer: body.answer ?? '',
    asked,
  }), asked);
  const questions = mergeFollowups(generated ?? [], contextualFollowups(body.question, body.answer ?? '', asked));
  return Response.json(
    { questions, mode: generated?.length ? 'llm' : 'contextual' },
    { headers: { 'cache-control': 'no-store' } },
  );
}
