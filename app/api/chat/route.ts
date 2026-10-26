import { ensureConversationOwner } from '@/lib/auth';
import { apiError, ApiError, readObject } from '@/lib/api';
import {
  CHAT_STREAM_DONE,
  encodeChatStreamEvent,
  parseChatRequest,
  type ChatResponse,
  type ChatStreamEvent,
} from '@/contracts/chat';
import { beginTurn, finishTurn, type AnswerResult, type MemoryMessage } from '@/lib/conversations';
import { loadRagContext } from '@/lib/rag';
import { generateAnswer } from '@/lib/answer';
import { assembleFocusPrompt, focusContextBlock } from '@/lib/focus-prompt';
import { recordClientAudit } from '@/lib/client-audit';

export const dynamic = 'force-dynamic';
const encoder = new TextEncoder();

export async function POST(request: Request) {
  let lease: { owner: string; conversationId: string; requestId: string } | undefined;
  try {
    const input = parseChatRequest(await readObject(request));
    const { reportId, focus, requestId, conversationId } = input;
    // Typed question drives retrieval planning (metrics / peers / history).
    // Focus clips stay in structuredContext only — never rewrite the planner query,
    // or soft-merged PDF page text will match 利润/资产/现金流 and dump every KPI + peers.
    const question = input.question.trim();
    const assembled = assembleFocusPrompt(question, focus);
    if (assembled.length > 12_000) throw new ApiError(413, '关注内容过长，请减少摘录后再试');
    let history: MemoryMessage[] = [], replay: AnswerResult | null = null;
    let setCookie: string | undefined;
    if (conversationId) {
      const guest = ensureConversationOwner(request);
      setCookie = guest.setCookie;
      const turn = await beginTurn(guest.owner, conversationId, reportId, requestId, question);
      history = turn.history; replay = turn.replay;
      if (!replay) lease = { owner: guest.owner, conversationId, requestId };
      void recordClientAudit({
        eventType: 'ask',
        ownerKey: guest.owner,
        reportId,
        conversationId,
        requestId,
        question: input.question,
        path: '/api/chat',
        detail: {
          rewrite: input.rewrite ?? null,
          spoken: Boolean(input.spoken),
          focusCount: focus.length,
          streamed: Boolean(input.stream),
          replay: Boolean(replay),
        },
      }, request);
    }
    const context = replay ? null : await loadRagContext(reportId, question, history, input.summary);
    if (context && focus.length) {
      const block = focusContextBlock(focus);
      if (block) context.structuredContext = `${block}\n\n${context.structuredContext}`;
    }
    const persist = async (result: AnswerResult) => {
      if (lease) await finishTurn(lease.owner, lease.conversationId, lease.requestId, result);
    };
    const answerOpts = { rewrite: input.rewrite, spoken: Boolean(input.spoken) };
    if (!input.stream) {
      const result = replay ?? await generateAnswer(context!, history, request.signal, undefined, answerOpts);
      await persist(result);
      const headers = new Headers({ 'cache-control': 'no-store' });
      if (setCookie) headers.append('set-cookie', setCookie);
      const body = { ...result, requestId, conversationId, metrics: context?.metrics, peers: context?.peers } satisfies ChatResponse;
      return Response.json(body, { headers });
    }
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    request.signal.addEventListener('abort', onAbort, { once: true });
    if (request.signal.aborted) abort.abort();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(output) {
        const emit = (value: ChatStreamEvent) => { if (!cancelled) output.enqueue(encoder.encode(encodeChatStreamEvent(value))); };
        try {
          emit({ requestId, conversationId, status: 'retrieving', evidence: context?.evidence ?? replay?.evidence ?? [] });
          let emitted = false;
          const result = replay ?? await generateAnswer(context!, history, abort.signal, event => {
            if (event.content) emitted = true;
            if (event.content) emit({ content: event.content });
            else if (event.status === 'reasoning') emit({ status: 'reasoning' });
          }, answerOpts);
          await persist(result);
          if (!emitted) emit({ content: result.answer });
          // Final result replaces provisional deltas if validation required a fallback.
          emit({ result, evidence: result.evidence, status: result.status });
          if (!cancelled) { output.enqueue(encoder.encode(CHAT_STREAM_DONE)); output.close(); }
        } catch {
          await persist({ answer: '回答未能保存，请重试。', status: 'failed', mode: 'error', evidence: [], durationMs: 0 }).catch(() => undefined);
          emit({ error: '回答未能完成或保存，请重试。', status: 'failed' });
          if (!cancelled) { output.enqueue(encoder.encode(CHAT_STREAM_DONE)); output.close(); }
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
