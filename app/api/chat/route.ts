import { getDb } from '@/lib/db';
import { requireAppUser } from '@/lib/auth';

type Chunk = { page: number; content: string };
const encoder = new TextEncoder();

function score(query: string, content: string) {
  const terms = [...new Set(query.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').match(/[\u4e00-\u9fa5]{2,}|[A-Za-z0-9]+/g) ?? [])];
  return terms.reduce((sum, term) => sum + (content.includes(term) ? Math.min(3, content.split(term).length - 1) : 0), 0);
}

async function optionalGenerate(question: string, evidence: Chunk[], structuredContext = '') {
  const baseUrl = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL;
  const maxTokens = Number(process.env.LLM_MAX_TOKENS ?? 1600);
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 60_000);
  if (!baseUrl || !model || (!evidence.length && !structuredContext)) return { answer: null, status: 'not-attempted' as const };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    console.info('[chat] LLM request', { model, evidenceCount: evidence.length, hasStructuredContext: Boolean(structuredContext), maxTokens, timeoutMs });
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(process.env.LLM_API_KEY ? { authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}) },
      body: JSON.stringify({ model, temperature: 0, max_tokens: maxTokens, messages: [
        { role: 'system', content: '你是严谨的财报助手。只能依据给定结构化上下文和财报原文回答；无法确认时明确说明。原文结论标注【第x页】；同行名单必须说明仅限当前覆盖范围。不提供投资建议。' },
        { role: 'user', content: `问题：${question}\n\n结构化上下文：\n${structuredContext || '无'}\n\n财报原文证据：\n${evidence.map((item) => `【第${item.page}页】${item.content}`).join('\n\n') || '无'}` },
      ] }),
    });
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const answer = response.ok ? payload.choices?.[0]?.message?.content?.trim() ?? null : null;
    if (!answer) console.warn('[chat] LLM returned no usable answer', { status: response.status, model });
    return { answer, status: answer ? 'success' as const : 'failed' as const };
  } catch (error) {
    console.warn('[chat] LLM request failed', { message: String(error), model, baseUrl });
    return { answer: null, status: 'failed' as const };
  } finally { clearTimeout(timer); }
}

function llmMessages(question: string, evidence: Chunk[], structuredContext: string) {
  return [
    { role: 'system', content: '你是严谨的财报助手。只能依据给定结构化上下文和财报原文回答；无法确认时明确说明。原文结论标注【第x页】；同行名单必须说明仅限当前覆盖范围。不提供投资建议。' },
    { role: 'user', content: `问题：${question}\n\n结构化上下文：\n${structuredContext || '无'}\n\n财报原文证据：\n${evidence.map((item) => `【第${item.page}页】${item.content}`).join('\n\n') || '无'}` },
  ];
}

function sse(content: string) {
  return encoder.encode(`data: ${JSON.stringify({ content })}\n\n`);
}

function streamFallback(answer: string) {
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(sse(answer)); controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); } }), {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' },
  });
}

async function streamGenerate(question: string, evidence: Chunk[], structuredContext: string, fallback: string) {
  const baseUrl = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL;
  const maxTokens = Number(process.env.LLM_MAX_TOKENS ?? 1600);
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 60_000);
  if (!baseUrl || !model) return streamFallback(fallback);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    console.info('[chat] LLM stream request', { model, evidenceCount: evidence.length, maxTokens, timeoutMs });
    const upstream = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(process.env.LLM_API_KEY ? { authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}) },
      body: JSON.stringify({ model, temperature: 0, max_tokens: maxTokens, stream: true, messages: llmMessages(question, evidence, structuredContext) }),
    });
    if (!upstream.ok || !upstream.body) {
      console.warn('[chat] LLM stream unavailable', { status: upstream.status, model });
      clearTimeout(timer);
      return streamFallback(fallback);
    }
    const body = new ReadableStream<Uint8Array>({
      async start(output) {
        const reader = upstream.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let emitted = false;
        try {
          while (true) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
            const events = buffer.split('\n\n');
            buffer = events.pop() ?? '';
            for (const event of events) {
              const raw = event.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
              if (!raw || raw === '[DONE]') continue;
              try {
                const payload = JSON.parse(raw) as { choices?: Array<{ delta?: { content?: string } }> };
                const content = payload.choices?.[0]?.delta?.content;
                if (content) { emitted = true; output.enqueue(sse(content)); }
              } catch { /* ignore malformed upstream SSE event */ }
            }
            if (done) break;
          }
          if (!emitted) output.enqueue(sse(fallback));
          output.enqueue(encoder.encode('data: [DONE]\n\n'));
          output.close();
        } catch (error) {
          console.warn('[chat] LLM stream failed', { message: String(error), model });
          if (!emitted) output.enqueue(sse(fallback));
          output.enqueue(encoder.encode('data: [DONE]\n\n'));
          output.close();
        } finally { clearTimeout(timer); }
      },
      cancel() { controller.abort(); clearTimeout(timer); },
    });
    return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' } });
  } catch (error) {
    clearTimeout(timer);
    console.warn('[chat] LLM stream setup failed', { message: String(error), model });
    return streamFallback(fallback);
  }
}

export async function POST(request: Request) {
  const denied = requireAppUser(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({})) as { reportId?: string; question?: string; stream?: boolean };
  if (!body.reportId || !body.question?.trim()) return Response.json({ error: '缺少 reportId 或 question' }, { status: 400 });
  const db = getDb();
  const [report] = await db<Array<{ code: string; company_name: string; industry: string }>>`
    SELECT a.code, a.company_name, c.industry FROM announcements a JOIN companies c ON c.code=a.code WHERE a.id=${body.reportId}
  `;
  if (!report) return Response.json({ error: '报告不存在，请传入页面返回的真实 reportId' }, { status: 404 });
  const metrics = await db<Array<{ metric: string; value: number; unit: string; source_page: number | null; source_label: string | null }>>`
    SELECT metric, value, unit, source_page, source_label FROM financial_metrics WHERE announcement_id=${body.reportId}
  `;
  const chunks = await db<Chunk[]>`SELECT page, content FROM report_chunks WHERE announcement_id=${body.reportId} ORDER BY page LIMIT 120`;
  // All matched page chunks are passed to the model. A report is capped at 120 pages during parsing.
  const evidence = chunks.map((item) => ({ ...item, score: score(body.question!, item.content) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.page - b.page);
  const peerIntent = /竞品|同行|同业|对标|可比公司/.test(body.question);
  const peers = peerIntent ? await db<Array<{ code: string; name: string }>>`
    SELECT code, name FROM companies WHERE industry=${report.industry} AND code<>${report.code} AND enabled=true ORDER BY rank LIMIT 12
  ` : [];
  const metricContext = metrics.length ? metrics.map((metric) => `${metric.metric}=${metric.value}${metric.unit}${metric.source_page ? `（第${metric.source_page}页）` : ''}`).join('；') : '当前无已入库核心指标。';
  const structuredContext = `当前公司：${report.company_name}（${report.code}）；行业：${report.industry}；本报告已入库指标：${metricContext}。${peers.length ? `当前绿色通道内同业覆盖公司：${peers.map((peer) => `${peer.name}（${peer.code}）`).join('、')}。` : '当前绿色通道内没有可确认的同业覆盖公司。'}`;
  const fallbackPeerAnswer = peers.length ? `按当前绿色通道覆盖范围，${report.company_name}所属“${report.industry}”的可比公司包括：${peers.map((peer) => `${peer.name}（${peer.code}）`).join('、')}。这是覆盖名单中的同行，不代表完整行业竞品或投资推荐。` : null;
  const fallback = fallbackPeerAnswer ?? (evidence.length
    ? `以下是与问题最相关的财报原文证据；当前未配置模型归纳服务，因此不对原文作额外推断。\n${evidence.map((item) => `【第${item.page}页】${item.content.slice(0, 420)}`).join('\n\n')}`
    : '当前报告中未检索到足以回答该问题的原文证据。你可以询问已入库核心指标，或打开原始 PDF 核验。');
  if (body.stream) return streamGenerate(body.question, evidence, structuredContext, fallback);
  const generated = await optionalGenerate(body.question, evidence, structuredContext);
  const answer = generated.answer ?? fallback;
  return Response.json({ answer, mode: generated.answer ? 'llm-rag' : peers.length ? 'structured-peer-query' : 'evidence-retrieval', modelStatus: generated.status, metrics, evidence: evidence.map(({ page, content }) => ({ page, content: content.slice(0, 420) })), peers }, { headers: { 'cache-control': 'no-store' } });
}
