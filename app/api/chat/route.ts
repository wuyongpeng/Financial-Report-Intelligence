import { randomUUID } from 'node:crypto';
import { ensureConversationOwner } from '@/lib/auth';
import { apiError, ApiError, readObject, requiredText, uuid } from '@/lib/api';
import { beginTurn, finishTurn, type AnswerResult, type MemoryMessage } from '@/lib/conversations';
import { loadRagContext } from '@/lib/rag';
import { generateAnswer } from '@/lib/answer';
import { assembleFocusPrompt, focusContextBlock, parseFocus, QUESTION_MAX } from '@/lib/focus-prompt';

export const dynamic = 'force-dynamic';
const encoder = new TextEncoder();

export async function POST(request: Request) {
  let lease: { owner: string; conversationId: string; requestId: string } | undefined;
  try {
    const body = await readObject(request);
    const reportId = requiredText(body.reportId, 'reportId');
    const typed = requiredText(body.question, 'question', QUESTION_MAX);
    const focus = parseFocus(body.focus ?? body.pendingItems);
    const question = assembleFocusPrompt(typed, focus);
    if (question.length > 12_000) throw new ApiError(413, '关注内容过长，请减少摘录后再试');
    if (body.stream !== undefined && typeof body.stream !== 'boolean') throw new ApiError(400, 'stream 必须为布尔值');
    if (body.summary !== undefined && typeof body.summary !== 'boolean') throw new ApiError(400, 'summary 必须为布尔值');
    const requestId = body.requestId === undefined ? randomUUID() : uuid(body.requestId, 'requestId');
    const conversationId = body.conversationId === undefined ? undefined : uuid(body.conversationId, 'conversationId');
    let history: MemoryMessage[] = [], replay: AnswerResult | null = null;
    let setCookie: string | undefined;
    if (conversationId) {
      const guest = ensureConversationOwner(request);
      setCookie = guest.setCookie;
      const turn = await beginTurn(guest.owner, conversationId, reportId, requestId, question);
      history = turn.history; replay = turn.replay;
      if (!replay) lease = { owner: guest.owner, conversationId, requestId };
    }
    const context = replay ? null : await loadRagContext(reportId, question, history, body.summary === true);
    if (context && focus.length) {
      const block = focusContextBlock(focus);
      if (block) context.structuredContext = `${block}\n\n${context.structuredContext}`;
    }
    const persist = async (result: AnswerResult) => {
      if (lease) await finishTurn(lease.owner, lease.conversationId, lease.requestId, result);
    };
    if (!body.stream) {
      const result = replay ?? await generateAnswer(context!, history, request.signal);
      await persist(result);
      const headers = new Headers({ 'cache-control': 'no-store' });
      if (setCookie) headers.append('set-cookie', setCookie);
      return Response.json({ ...result, requestId, conversationId, metrics: context?.metrics, peers: context?.peers }, { headers });
    }
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    request.signal.addEventListener('abort', onAbort, { once: true });
    if (request.signal.aborted) abort.abort();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(output) {
        const emit = (value: unknown) => { if (!cancelled) output.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`)); };
        try {
          emit({ requestId, conversationId, status: 'retrieving', evidence: context?.evidence ?? replay?.evidence ?? [] });
          let emitted = false;
          const result = replay ?? await generateAnswer(context!, history, abort.signal, event => {
            if (event.content) emitted = true;
            emit(event);
          });
          await persist(result);
          if (!emitted) emit({ content: result.answer });
          // Final result replaces provisional deltas if validation required a fallback.
          emit({ result, evidence: result.evidence, status: result.status });
          if (!cancelled) { output.enqueue(encoder.encode('data: [DONE]\n\n')); output.close(); }
        } catch {
          await persist({ answer: '回答未能保存，请重试。', status: 'failed', mode: 'error', evidence: [], durationMs: 0 }).catch(() => undefined);
          emit({ error: '回答未能完成或保存，请重试。', status: 'failed' });
          if (!cancelled) { output.enqueue(encoder.encode('data: [DONE]\n\n')); output.close(); }
        } finally { request.signal.removeEventListener('abort', onAbort); }
      },
      cancel() { cancelled = true; abort.abort(); },
    });
    const streamHeaders = new Headers({ 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' });
    if (setCookie) streamHeaders.append('set-cookie', setCookie);
    return new Response(stream, { headers: streamHeaders });
  } catch (error) {
    if (lease) await finishTurn(lease.owner, lease.conversationId, lease.requestId, { answer: '', evidence: [], status: 'failed', mode: 'error', durationMs: 0 }).catch(() => undefined);
    return apiError(error);
  }
}
