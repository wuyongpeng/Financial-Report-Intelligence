/**
 * Server-side home ask: roster Q&A or constrained home chitchat.
 * Client should try answerHomeRosterLocally first for roster; chitchat always hits LLM (or fallback).
 */
import { fetchChatCompletionsFrom } from './llm-gate';
import { llmConfigured, parseLlmProviders, selectPinnedProviders } from './llm-providers';
import { readingLevelInstruction, type ReadingLevel } from './reader-prefs';
import { orderVerdictProviders } from './report-verdict-llm';
import {
  extractOpenCodeFromAnswer,
  homeAskSystemPrompt,
  homeAskUserPrompt,
  type HomeRosterAnswer,
} from './home-roster-answer';
import {
  homeChitchatFallback,
  homeChitchatSystemPrompt,
  homeChitchatUserPrompt,
  sanitizeHomeAssistantText,
} from './home-chitchat';
import type { HomeRosterRow } from './home-roster-snapshot';

const HOME_ASK_TIMEOUT_MS = Number(process.env.LLM_HOME_ASK_TIMEOUT_MS ?? 12_000);

export type HomeAskMode = 'roster' | 'chitchat';

function clipAnswer(text: string, max = 280) {
  const t = text.replace(/\s+/g, ' ').trim();
  const chars = [...t];
  return chars.length <= max ? t : `${chars.slice(0, max - 1).join('')}…`;
}

async function generateHomeAskLlm(opts: {
  system: string;
  prompt: string;
  maxTokens: number;
  clipMax: number;
  modelId?: string;
}): Promise<string | null> {
  if (!llmConfigured()) return null;
  const configured = parseLlmProviders();
  const providers = selectPinnedProviders(configured, opts.modelId) ?? orderVerdictProviders(configured).slice(0, 2);
  const body = {
    temperature: 0.3,
    max_tokens: opts.maxTokens,
    enable_thinking: false,
    thinking: { type: 'disabled' },
    chat_template_kwargs: { enable_thinking: false },
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.prompt },
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
      const content = json.choices?.[0]?.message?.content ?? '';
      const visible = sanitizeHomeAssistantText(content);
      if (visible) return clipAnswer(visible, opts.clipMax);
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
  mode?: HomeAskMode;
  /** Voice reply: one short spoken sentence. Typed home chat may use two. */
  spoken?: boolean;
  modelId?: string;
  readingLevel?: ReadingLevel;
  readerMemory?: string;
}): Promise<HomeRosterAnswer> {
  const mode: HomeAskMode = input.mode === 'chitchat' ? 'chitchat' : 'roster';
  const style = [
    input.readingLevel ? readingLevelInstruction(input.readingLevel, Boolean(input.spoken)) : '',
    input.readerMemory ? `回答前先遵守这些读者记忆，不得据此编造数字：${input.readerMemory}` : '',
  ].filter(Boolean).join('\n');

  if (mode === 'chitchat') {
    const prompt = homeChitchatUserPrompt({
      question: input.question,
      history: input.history,
    });
    const spoken = Boolean(input.spoken);
    const llm = await generateHomeAskLlm({
      system: `${homeChitchatSystemPrompt(spoken)}${style ? `\n${style}` : ''}`,
      prompt,
      maxTokens: 480,
      clipMax: spoken ? 80 : 160,
      modelId: input.modelId,
    });
    if (llm) return { answer: llm, mode: 'llm' };
    return { answer: homeChitchatFallback(), mode: 'local' };
  }

  const prompt = homeAskUserPrompt({
    question: input.question,
    rosterSnapshot: input.rosterSnapshot,
    history: input.history,
  });
  const llm = await generateHomeAskLlm({
    system: `${homeAskSystemPrompt()}${style ? `\n${style}` : ''}`,
    prompt,
    maxTokens: 220,
    clipMax: 280,
    modelId: input.modelId,
  });
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
