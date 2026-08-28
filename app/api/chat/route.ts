import { getDb } from '@/lib/db';

type Chunk = { page: number; content: string };

function score(query: string, content: string) {
  const terms = [...new Set(query.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').match(/[\u4e00-\u9fa5]{2,}|[A-Za-z0-9]+/g) ?? [])];
  return terms.reduce((sum, term) => sum + (content.includes(term) ? Math.min(3, content.split(term).length - 1) : 0), 0);
}

async function optionalGenerate(question: string, evidence: Chunk[]) {
  const baseUrl = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL;
  if (!baseUrl || !model || !evidence.length) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(process.env.LLM_API_KEY ? { authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}) },
      body: JSON.stringify({ model, temperature: 0, max_tokens: 500, messages: [
        { role: 'system', content: '你是严谨的财报助手。只能依据给定证据回答；无法确认时明确说明。每个结论标注【第x页】。不提供投资建议。' },
        { role: 'user', content: `问题：${question}\n\n证据：\n${evidence.map((item) => `【第${item.page}页】${item.content}`).join('\n\n')}` },
      ] }),
    });
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return response.ok ? payload.choices?.[0]?.message?.content?.trim() ?? null : null;
  } catch {
    return null;
  } finally { clearTimeout(timer); }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { reportId?: string; question?: string };
  if (!body.reportId || !body.question?.trim()) return Response.json({ error: '缺少 reportId 或 question' }, { status: 400 });
  const db = getDb();
  const metrics = await db<Array<{ metric: string; value: number; unit: string; source_page: number | null; source_label: string | null }>>`
    SELECT metric, value, unit, source_page, source_label FROM financial_metrics WHERE announcement_id=${body.reportId}
  `;
  const chunks = await db<Chunk[]>`SELECT page, content FROM report_chunks WHERE announcement_id=${body.reportId} ORDER BY page LIMIT 120`;
  const evidence = chunks.map((item) => ({ ...item, score: score(body.question!, item.content) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.page - b.page).slice(0, 3);
  const generated = await optionalGenerate(body.question, evidence);
  const answer = generated ?? (evidence.length
    ? `以下是与问题最相关的财报原文证据；当前未配置模型归纳服务，因此不对原文作额外推断。\n${evidence.map((item) => `【第${item.page}页】${item.content.slice(0, 420)}`).join('\n\n')}`
    : '当前报告中未检索到足以回答该问题的原文证据。你可以询问已入库核心指标，或打开原始 PDF 核验。');
  return Response.json({ answer, mode: generated ? 'llm-rag' : 'evidence-retrieval', metrics, evidence: evidence.map(({ page, content }) => ({ page, content: content.slice(0, 420) })) }, { headers: { 'cache-control': 'no-store' } });
}
