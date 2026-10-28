/**
 * Server-side home ask: inject roster snapshot into LLM context.
 * Client should try answerHomeRosterLocally first; this is the fallback.
 */
import { fetchChatCompletionsFrom } from './llm-gate';
import { llmConfigured, parseLlmProviders } from './llm-providers';
import { orderVerdictProviders } from './report-verdict-llm';
import {
  extractOpenCodeFromAnswer,
  homeAskSystemPrompt,
  homeAskUserPrompt,
  type HomeRosterAnswer,
} from './home-roster-answer';
import type { HomeRosterRow } from './home-roster-snapshot';

const HOME_ASK_TIMEOUT_MS = Number(process.env.LLM_HOME_ASK_TIMEOUT_MS ?? 12_000);

function clipAnswer(text: string, max = 280) {
  const t = text.replace(/\s+/g, ' ').trim();
  const chars = [...t];
  return chars.length <= max ? t : `${chars.slice(0, max - 1).join('')}…`;
}

async function generateHomeAskLlm(prompt: string): Promise<string | null> {
  if (!llmConfigured()) return null;
  const providers = orderVerdictProviders(parseLlmProviders()).slice(0, 2);
  const body = {
    temperature: 0.3,
    max_tokens: 220,
    enable_thinking: false,
    thinking: { type: 'disabled' },
    chat_template_kwargs: { enable_thinking: false },
    messages: [
      { role: 'system', content: homeAskSystemPrompt() },
      { role: 'user', content: prompt },
    ],
  };
  for (const provider of providers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HOME_ASK_TIMEOUT_MS);
    try {
      const response = await fetchChatCompletionsFrom(provider, body, {
        signal: controller.signal,
        timeoutMs: HOME_ASK_TIMEOUT_MS,
        maxAttempts: 1,
      });
      if (!response.ok) continue;
      const json = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content?.trim();
      if (content) return clipAnswer(content);
    } catch (error) {
      console.warn('[home-ask] generation failed', { provider: provider.id, message: String(error) });
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

export async function generateHomeAskAnswer(input: {
  question: string;
  rosterSnapshot: string;
  rows: HomeRosterRow[];
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<HomeRosterAnswer> {
  const prompt = homeAskUserPrompt({
    question: input.question,
    rosterSnapshot: input.rosterSnapshot,
    history: input.history,
  });
  const llm = await generateHomeAskLlm(prompt);
  if (llm) {
    const openCode = extractOpenCodeFromAnswer(llm, input.rows);
    return { answer: llm, openCode, mode: 'llm' };
  }
  // Offline / LLM down: factual fallback from snapshot header + row count
  const n = input.rows.length;
  const sample = input.rows.slice(0, 8).map((r) => `${r.name}（${r.code}）`).join('、');
  return {
    answer: n
      ? `当前首页清单有 ${n} 家${sample ? `，例如 ${sample}` : ''}。点名公司我可以帮你打开；细问某家财报请先进入详情。`
      : '当前首页清单为空。稍后再问，或调整筛选。',
    mode: 'local',
  };
}
