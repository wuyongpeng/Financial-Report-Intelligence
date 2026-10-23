/**
 * Personalized homepage search placeholders, keyed by guest/app conversation owner.
 * Server-only: DB + LLM. Client UI must import from home-prompts-shared.
 */

import { getDb } from './db';
import { ensureBackendSchema } from './backend-schema';
import { fetchChatCompletionsFrom } from './llm-gate';
import { llmConfigured, parseLlmProviders } from './llm-providers';
import { orderVerdictProviders } from './report-verdict-llm';
import { shortCompanyName } from './home-placeholders';
import {
  contextualHomePrompts,
  mergeHomePromptLists,
  parseHomePromptQuestions,
  type HomePromptPeer,
  MAX_PERSONALIZED_HOME_PROMPTS,
} from './home-prompts-shared';

export {
  contextualHomePrompts,
  mergeHomePromptLists,
  parseHomePromptQuestions,
  prependPersonalizedPlaceholders,
  MAX_PERSONALIZED_HOME_PROMPTS,
  type HomePromptPeer,
} from './home-prompts-shared';

const HOME_PROMPT_TIMEOUT_MS = Number(process.env.LLM_HOME_PROMPT_TIMEOUT_MS ?? 10_000);

export type StoredHomePrompts = {
  questions: string[];
  sourceQuestion: string;
  industry: string | null;
  companyCode: string | null;
  updatedAt: string;
};

function homePromptBody(input: {
  question: string;
  companyName?: string;
  companyCode?: string;
  industryGroup?: string | null;
  peers?: HomePromptPeer[];
}) {
  const peerLine = (input.peers ?? [])
    .filter((p) => p.name)
    .slice(0, 6)
    .map((p) => `${shortCompanyName(p.name)}（${p.code}）`)
    .join('、') || '无';
  return `用户主动提问：${input.question}
公司：${input.companyName || '未知'}（${input.companyCode || '—'}）；行业：${input.industryGroup || '未知'}
同行业可参考公司：${peerLine}

请生成 3～4 个适合首页搜索框轮播的中文短问题。
要求：每行一个，以问号结尾，不超过 28 个汉字；要像「公司名+期次/主题」的检索句，不要空泛套话；
可围绕同一主题换同行业其他公司，或对比两家；禁止重复用户原问；不要编号、不要解释、不要投资建议。`;
}

async function generateWithLlm(prompt: string, exclude: string[]) {
  if (!llmConfigured()) return null;
  const providers = orderVerdictProviders(parseLlmProviders()).slice(0, 2);
  const body = {
    temperature: 0.5,
    max_tokens: 260,
    enable_thinking: false,
    thinking: { type: 'disabled' },
    chat_template_kwargs: { enable_thinking: false },
    messages: [
      {
        role: 'system',
        content:
          '你为财报智析首页生成个性化示例问题。只输出 3～4 行中文问题，每行一个，以问号结尾。让用户感到这是根据他刚问过的内容定制的。',
      },
      { role: 'user', content: prompt },
    ],
  };
  let best: string[] = [];
  for (const provider of providers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HOME_PROMPT_TIMEOUT_MS);
    try {
      const response = await fetchChatCompletionsFrom(provider, body, {
        signal: controller.signal,
        timeoutMs: HOME_PROMPT_TIMEOUT_MS,
        maxAttempts: 1,
      });
      if (!response.ok) {
        await response.text().catch(() => '');
        continue;
      }
      const parsed = parseHomePromptQuestions(await response.text(), exclude);
      if (parsed.length > best.length) best = parsed;
      if (best.length >= 3) return best;
    } catch (error) {
      console.warn('[home-prompts] generation failed', { provider: provider.id, message: String(error) });
    } finally {
      clearTimeout(timer);
    }
  }
  return best.length ? best : null;
}

export async function readGuestHomePrompts(ownerKey: string): Promise<StoredHomePrompts | null> {
  await ensureBackendSchema();
  const rows = await getDb()<Array<{
    source_question: string;
    questions: unknown;
    industry: string | null;
    company_code: string | null;
    updated_at: string | Date;
  }>>`
    SELECT source_question, questions, industry, company_code, updated_at
    FROM guest_home_prompts WHERE owner_key=${ownerKey}
  `;
  const row = rows[0];
  if (!row) return null;
  const questions = Array.isArray(row.questions)
    ? row.questions.filter((q): q is string => typeof q === 'string' && Boolean(q.trim()))
    : [];
  if (!questions.length) return null;
  return {
    questions: questions.slice(0, MAX_PERSONALIZED_HOME_PROMPTS),
    sourceQuestion: row.source_question,
    industry: row.industry,
    companyCode: row.company_code,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function upsertGuestHomePrompts(input: {
  ownerKey: string;
  sourceQuestion: string;
  questions: string[];
  industry?: string | null;
  companyCode?: string | null;
}) {
  await ensureBackendSchema();
  const questions = input.questions.slice(0, MAX_PERSONALIZED_HOME_PROMPTS);
  const db = getDb();
  await db`
    INSERT INTO guest_home_prompts(owner_key, source_question, questions, industry, company_code, updated_at)
    VALUES (
      ${input.ownerKey},
      ${input.sourceQuestion},
      ${db.json(questions)},
      ${input.industry ?? null},
      ${input.companyCode ?? null},
      NOW()
    )
    ON CONFLICT (owner_key) DO UPDATE SET
      source_question = EXCLUDED.source_question,
      questions = EXCLUDED.questions,
      industry = EXCLUDED.industry,
      company_code = EXCLUDED.company_code,
      updated_at = NOW()
  `;
  return questions;
}

export async function generateAndStoreHomePrompts(input: {
  ownerKey: string;
  question: string;
  companyName?: string;
  companyCode?: string;
  industryGroup?: string | null;
  peers?: HomePromptPeer[];
}) {
  const exclude = [input.question];
  const generated = await generateWithLlm(homePromptBody(input), exclude);
  const fallback = contextualHomePrompts(input);
  const questions = mergeHomePromptLists(generated ?? [], fallback, exclude);
  if (!questions.length) return { questions: [] as string[], mode: 'empty' as const };
  await upsertGuestHomePrompts({
    ownerKey: input.ownerKey,
    sourceQuestion: input.question,
    questions,
    industry: input.industryGroup ?? null,
    companyCode: input.companyCode ?? null,
  });
  return { questions, mode: generated?.length ? ('llm' as const) : ('contextual' as const) };
}
