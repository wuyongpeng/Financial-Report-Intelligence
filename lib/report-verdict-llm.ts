import { parseSse } from './answer';
import type { Citation } from './detail-model';
import { loadRagContext } from './rag';
import { parseReportVerdictJson, unwrapModelJson, VERDICT_JSON_SCHEMA, type ReportVerdict } from './report-verdict';
import { fetchChatCompletionsFrom, isLlmSlotBusyError, withLlmSlot } from './llm-gate';
import { llmConfigured, parseLlmProviders, type LlmProvider } from './llm-providers';
import { formatLlmCallError, formatLlmHttpError } from './llm-error';

export const VERDICT_QUESTION = '本期财报整体怎么看？营业收入、净利润、每股收益、净资产收益率、营业成本、毛利率、经营现金流、资产负债有哪些真正值得关注的同比变化？主营业务在产品、地区或分部上的收入结构有哪些原文明确写出的变化？管理层讨论与分析是否写了净利润变动原因？请结合原文中的具体数字。';

const SYSTEM_PROMPT = `你是「财报智析 Eva」的速判模块。只根据本轮服务端提供的结构化指标、同比计算结果和带编号的财报原文作答。
枚举负责“说什么”，你只负责“怎么说”。必须输出严格符合 JSON Schema 的单个 JSON 对象，不要 Markdown、不要解释、不要额外字段。

规则：
1. verdict.label 只能是 Schema 枚举之一，禁止自造标签。
2. verdict.summary 只写一句整体定性，建议不超过 30 个中文字，不要堆砌营业收入/净利润/EPS/ROE 的具体数字（这些由页面指标卡展示），不要做没有依据的推测。
3. changes 按重要性筛选 1～3 条；证据不足就少写，不要凑数。完全没有可靠变化时返回空数组。
4. changes[].type、changes[].direction 必须使用 Schema 中的中文枚举。direction 只允许：利好、利空、中性、风险。
5. changes[].title 简短，建议 10 个中文字以内，不要写成完整句子。
6. changes[].description 1～2 句，尽量包含原文或结构化数据中已有的数字与同比/环比；不得编造数字或事实。
7. 禁止推断财报未明确支持的因果关系。只有原文明确写了原因，才能使用“由于/主要原因/导致/驱动/受……影响”；否则用“同期出现/与……相关/增长/下降/值得关注”。
8. changes[].sourceRef 与 modules[].sourceRef 必须填写本轮已提供的证据编号（如 E1）。没有可靠证据的条目不要输出。
9. modules 是「深度归因」的落库结论，用来解释营收、利润、异常指标为什么变动，而不是复述指标卡。id 只能是 business、attribution、anomalies、history、peers。每条 conclusion 必须含具体数字，建议不超过 40 字。空话、套话、没有数字的定性一律不要写，宁缺毋滥。
   - business：解释主营/分部收入结构为何变化；仅当原文明确给出业务/产品/地区收入结构或结构变化并带数字。
   - attribution：解释净利润为何变动；仅当原文写了净利润变动的构成或原因并带数字；结构化同比已在上下文中，不要复述指标卡。
   - anomalies：解释异常/大幅波动指标为何出现；仅当原文点名异常并带数字。
   - history：仅当原文给出跨年/跨期趋势数字，且不是简单重复结构化同比。
   - peers：仅当原文给出市场份额或行业地位数字。页面若已有同业样本排名会优先用计算值。
   没有把握的模块不要输出。没有可写的模块时 modules 返回 []。
10. 不要输出投资建议。`;

function verdictUserPrompt(structuredContext: string, passages: Array<{ id: string; companyName: string; period: string; page: number; content: string }>, evidenceIds: string[]) {
  return `请生成当前财报的 AI 速判 JSON。

结构化数据（含已计算同比，不要重新计算核心指标）：
${structuredContext}

本轮财报原文（sourceRef 只能引用这些编号）：
${passages.map((p) => `【${p.id}】${p.companyName} ${p.period} PDF第${p.page}页\n${p.content}`).join('\n\n') || '暂无'}

可用证据编号：${evidenceIds.join('、') || '无'}

请同时给出 verdict、changes（1～3 条，可为空数组）和 modules（0～5 条；这是深度归因，要解释变动原因，没有数字证据的模块不要写）。

JSON Schema：
${JSON.stringify(VERDICT_JSON_SCHEMA)}`;
}

/** Abort this provider if the first stream token (content or reasoning) has not arrived. */
export const VERDICT_TTFT_MS = 30_000;
/** Hard-abort if the answer is still not finished. */
export const VERDICT_HARD_ABORT_MS = 300_000;
export const VERDICT_PROVIDER_TIMEOUT_MS = VERDICT_HARD_ABORT_MS;
export const VERDICT_TOTAL_TIMEOUT_MS = VERDICT_HARD_ABORT_MS;

/** MiniMax returns JSON quickly; GLM-5 often spends the budget on hidden thinking. */
export function orderVerdictProviders(providers: LlmProvider[]): LlmProvider[] {
  const rank = (model: string) => {
    const name = model.toLowerCase();
    if (name.includes('minimax')) return 0;
    if (name.includes('glm-5.2')) return 1;
    if (name.includes('glm-5.1')) return 2;
    return 3;
  };
  return [...providers].sort((a, b) => rank(a.model) - rank(b.model));
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

/** Visible JSON from a chat.completions body. Empty content must not hide a later JSON object. */
export function extractVerdictCompletion(raw: string): { json: string | null; finish?: string } {
  try {
    const payload = JSON.parse(raw) as {
      choices?: Array<{
        finish_reason?: string;
        text?: unknown;
        message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown };
      }>;
    };
    const choice = payload.choices?.[0];
    const message = choice?.message;
    const content = flattenModelText(message?.content ?? choice?.text);
    const reasoning = flattenModelText(message?.reasoning_content ?? message?.reasoning);
    const json = unwrapModelJson(content) ?? unwrapModelJson(reasoning) ?? unwrapModelJson(`${content}\n${reasoning}`);
    return { json, finish: choice?.finish_reason };
  } catch {
    return { json: unwrapModelJson(raw) };
  }
}

export type VerdictStreamState = {
  content: string;
  reasoning: string;
  finish?: string;
  sawToken: boolean;
};

export function emptyVerdictStreamState(): VerdictStreamState {
  return { content: '', reasoning: '', sawToken: false };
}

export function applyVerdictStreamEvent(state: VerdictStreamState, event: string): VerdictStreamState {
  if (!event || event === '[DONE]') return state;
  let payload: {
    choices?: Array<{
      finish_reason?: string;
      delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown };
      message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown };
    }>;
  };
  try {
    payload = JSON.parse(event) as typeof payload;
  } catch {
    return state;
  }
  const choice = payload.choices?.[0];
  if (!choice) return state;
  const next: VerdictStreamState = {
    content: state.content,
    reasoning: state.reasoning,
    finish: choice.finish_reason || state.finish,
    sawToken: state.sawToken,
  };
  const deltaContent = flattenModelText(choice.delta?.content);
  const deltaReasoning = flattenModelText(choice.delta?.reasoning_content ?? choice.delta?.reasoning);
  const messageContent = flattenModelText(choice.message?.content);
  const messageReasoning = flattenModelText(choice.message?.reasoning_content ?? choice.message?.reasoning);
  if (deltaContent) next.content += deltaContent;
  if (deltaReasoning) next.reasoning += deltaReasoning;
  if (messageContent) next.content = messageContent;
  if (messageReasoning) next.reasoning = messageReasoning;
  if (deltaContent || deltaReasoning || messageContent || messageReasoning) next.sawToken = true;
  return next;
}

function streamJson(state: VerdictStreamState) {
  return unwrapModelJson(state.content) ?? unwrapModelJson(state.reasoning) ?? unwrapModelJson(`${state.content}\n${state.reasoning}`);
}

async function readVerdictStream(response: Response, onFirstToken?: () => void): Promise<VerdictStreamState> {
  if (!response.body) return emptyVerdictStreamState();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let state = emptyVerdictStreamState();
  try {
    while (true) {
      const { done, value } = await reader.read();
      const parsed = parseSse(buffer + decoder.decode(value ?? new Uint8Array(), { stream: !done }), done);
      buffer = parsed.rest;
      for (const event of parsed.events) {
        if (event === '[DONE]') return state;
        const next = applyVerdictStreamEvent(state, event);
        if (next.sawToken && !state.sawToken) onFirstToken?.();
        state = next;
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return state;
}

async function consumeVerdictResponse(
  response: Response,
  onFirstToken?: () => void,
  asStream = true,
): Promise<{ json: string | null; finish?: string; sawToken: boolean }> {
  const ctype = response.headers.get('content-type') ?? '';
  const isJson = ctype.includes('application/json');
  const isSse = ctype.includes('text/event-stream') || ctype.includes('text/plain') || (!ctype && Boolean(response.body));
  if (asStream && !isJson && isSse) {
    const state = await readVerdictStream(response, onFirstToken);
    return { json: streamJson(state), finish: state.finish, sawToken: state.sawToken };
  }
  const raw = await response.text();
  const extracted = extractVerdictCompletion(raw);
  if (extracted.json || raw.trim()) onFirstToken?.();
  return { ...extracted, sawToken: Boolean(extracted.json || raw.trim()) };
}

type JsonOk = { ok: true; content: string };
type JsonFail = { ok: false; error: string; retryLater?: boolean };

export type VerdictGenerateOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  acquireTimeoutMs?: number;
};

function providerAbortSignal(user?: AbortSignal) {
  const hard = new AbortController();
  let ttftTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => hard.abort(), VERDICT_TTFT_MS);
  const hardTimer = setTimeout(() => hard.abort(), VERDICT_HARD_ABORT_MS);
  const signal = user ? AbortSignal.any([user, hard.signal]) : hard.signal;
  return {
    signal,
    releaseOnFirstToken() {
      if (!ttftTimer) return;
      clearTimeout(ttftTimer);
      ttftTimer = null;
    },
    dispose() {
      if (ttftTimer) {
        clearTimeout(ttftTimer);
        ttftTimer = null;
      }
      clearTimeout(hardTimer);
    },
  };
}

async function completeFromProvider(
  provider: LlmProvider,
  richBody: Record<string, unknown>,
  plainBody: Record<string, unknown>,
  options: { signal?: AbortSignal },
): Promise<JsonOk | JsonFail> {
  const abort = providerAbortSignal(options.signal);
  const fetchOpts = {
    signal: abort.signal,
    timeoutMs: VERDICT_HARD_ABORT_MS,
    maxAttempts: 2 as const,
    keepAbortAlive: true,
  };
  const open = (body: Record<string, unknown>) => fetchChatCompletionsFrom(provider, { ...body, stream: true }, fetchOpts);
  try {
    let usedStream = true;
    let upstream: Response;
    try {
      upstream = await open(richBody);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      return { ok: false, error: formatLlmCallError(error) };
    }
    if (!upstream.ok) {
      const failed = await upstream.text().catch(() => '');
      console.warn('[verdict] json_object request failed', { provider: provider.id, status: upstream.status, body: failed.slice(0, 400) });
      if (upstream.status >= 400 && upstream.status < 500 && upstream.status !== 429) {
        try {
          upstream = await open(plainBody);
        } catch (error) {
          if (options.signal?.aborted) throw error;
          return { ok: false, error: formatLlmCallError(error) };
        }
        if (!upstream.ok && upstream.status >= 400 && upstream.status < 500 && upstream.status !== 429) {
          const streamFailed = await upstream.text().catch(() => '');
          console.warn('[verdict] stream request failed, retrying without stream', { provider: provider.id, status: upstream.status, body: streamFailed.slice(0, 400) });
          try {
            usedStream = false;
            abort.releaseOnFirstToken();
            upstream = await fetchChatCompletionsFrom(provider, plainBody, fetchOpts);
          } catch (error) {
            if (options.signal?.aborted) throw error;
            return { ok: false, error: formatLlmCallError(error) };
          }
        }
      } else {
        return { ok: false, error: formatLlmHttpError(upstream.status, failed) };
      }
    }
    if (!upstream.ok) {
      const failed = await upstream.text().catch(() => '');
      console.warn('[verdict] model http', { provider: provider.id, status: upstream.status });
      return { ok: false, error: formatLlmHttpError(upstream.status, failed) };
    }
    const extracted = await consumeVerdictResponse(upstream, () => abort.releaseOnFirstToken(), usedStream);
    if (extracted.json) return { ok: true, content: extracted.json };
    console.warn('[verdict] empty model content', { provider: provider.id, finish: extracted.finish, sawToken: extracted.sawToken });
    if (extracted.finish === 'length') return { ok: false, error: '模型输出被截断，已跳过本份。' };
    return { ok: false, error: 'AI 返回空内容，请稍后再试。' };
  } finally {
    abort.dispose();
  }
}

async function completeJson(
  messages: Array<{ role: string; content: string }>,
  evidence: Citation[],
  options: VerdictGenerateOptions = {},
): Promise<VerdictGenerateResult> {
  if (!llmConfigured()) return { ok: false, error: '未配置 AI 接口，本次没有调用模型。' };
  const tokens = Number(process.env.LLM_MAX_TOKENS ?? 6000);
  const maxTokens = Number.isFinite(tokens) ? Math.min(Math.max(tokens, 6000), 8192) : 6000;
  const richBody = {
    temperature: 0,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' as const },
    enable_thinking: false,
    thinking: { type: 'disabled' },
    chat_template_kwargs: { enable_thinking: false },
    messages,
  };
  const plainBody = { temperature: 0, max_tokens: maxTokens, messages };
  const providers = orderVerdictProviders(parseLlmProviders());
  if (!providers.length) return { ok: false, error: '未配置 AI 接口，本次没有调用模型。' };
  try {
    return await withLlmSlot(async () => {
      let lastError = 'AI 返回空内容，请稍后再试。';
      for (const provider of providers) {
        const content = await completeFromProvider(provider, richBody, plainBody, {
          signal: options.signal,
        });
        if (!content.ok) {
          lastError = content.error;
          if (content.retryLater) return content;
          console.warn('[verdict] provider unusable', { provider: provider.id, model: provider.model, error: content.error });
          continue;
        }
        const parsed = parseReportVerdictJson(content.content, evidence);
        if (parsed) return { ok: true, value: parsed };
        lastError = 'AI 返回格式无法解析，请稍后再试。';
        console.warn('[verdict] schema rejected', { provider: provider.id, preview: content.content.slice(0, 240) });
      }
      return { ok: false, error: lastError };
    }, options.signal, options.acquireTimeoutMs);
  } catch (error) {
    if (isLlmSlotBusyError(error)) return { ok: false, error: 'LLM 正被占用，稍后重试。', retryLater: true };
    console.warn('[verdict] model call failed', { message: String(error) });
    return { ok: false, error: formatLlmCallError(error) };
  }
}

export type VerdictGenerateResult =
  | { ok: true; value: ReportVerdict }
  | { ok: false; error: string; retryLater?: boolean };

export async function generateReportVerdict(
  reportId: string,
  options: VerdictGenerateOptions = {},
): Promise<VerdictGenerateResult> {
  if (!llmConfigured()) return { ok: false, error: '未配置 AI 接口，本次没有调用模型。' };
  const context = await loadRagContext(reportId, VERDICT_QUESTION, []);
  if (!context.metrics.length && !context.passages.length) {
    return { ok: false, error: '本期缺少可分析的指标和原文，未调用 AI。' };
  }
  return completeJson([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: verdictUserPrompt(context.structuredContext, context.passages, context.evidence.map((item) => item.id)) },
  ], context.evidence, options);
}
