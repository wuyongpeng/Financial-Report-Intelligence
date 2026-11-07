import { fetchChatCompletionsFrom, withLlmSlot } from './llm-gate';
import { llmConfigured, parseLlmProviders } from './llm-providers';
import { unwrapModelJson } from './report-verdict';
import { parseMemoryPatch, type MemoryPatch } from './reader-memory';

const NONE: MemoryPatch = { action: 'none' };

export const MEMORY_REFLECT_PROMPT = [
  '你维护一份长期记忆，不是聊天日志。阅读已有记忆和用户这一句话，决定要不要改记忆。',
  '只在这句话暴露出以后还会用到的事实时才记：稳定偏好、称呼、长期关注的公司或主题、明确限制。',
  '单次财报问题、一次提到某家公司、寒暄、追问数字，都输出 {"action":"none"}。page 只说明当前在看哪一家，不能据此写成关注。',
  '新事实和旧记忆冲突时，用 replaces 带上被替换那条的 id，不要并存两条相反内容。',
  '用户明确要忘掉某条时，输出 {"action":"forget","id":"已有id"}。',
  '要记的话，text 是一句不超过40字的事实，不要复述原问题，不要带问号。',
  '只输出一个 JSON：{"action":"none"} 或 {"action":"save","text":"...","replaces":"可选id"} 或 {"action":"forget","id":"..."}。',
].join('\n');

export async function reflectReaderMemoryOnServer(input: {
  question: string;
  notes: Array<{ id: string; text: string }>;
  context?: string;
  signal?: AbortSignal;
}): Promise<MemoryPatch> {
  if (!llmConfigured()) return NONE;
  const provider = parseLlmProviders()[0];
  if (!provider) return NONE;
  const signal = input.signal;
  if (signal?.aborted) return NONE;
  const timeout = AbortSignal.timeout(12_000);
  const cleanup = new AbortController();
  const combined = signal ? AbortSignal.any([signal, timeout, cleanup.signal]) : AbortSignal.any([timeout, cleanup.signal]);
  try {
    return await withLlmSlot(async () => {
      const response = await fetchChatCompletionsFrom(provider, {
        temperature: 0,
        max_tokens: 180,
        stream: false,
        messages: [
          { role: 'system', content: MEMORY_REFLECT_PROMPT },
          { role: 'user', content: JSON.stringify({
            existing: input.notes.slice(0, 12),
            utterance: input.question.slice(0, 400),
            page: input.context ?? '',
          }) },
        ],
      }, { signal: combined, timeoutMs: 12_000, maxAttempts: 1 });
      if (!response.ok) return NONE;
      const payload = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: unknown } }> } | null;
      const raw = payload?.choices?.[0]?.message?.content;
      const content = typeof raw === 'string' ? raw : '';
      const json = unwrapModelJson(content);
      if (!json) return NONE;
      try {
        return parseMemoryPatch(JSON.parse(json)) ?? NONE;
      } catch {
        return NONE;
      }
    }, combined, 12_000, { lane: 'background' });
  } catch {
    return NONE;
  } finally {
    cleanup.abort();
  }
}
