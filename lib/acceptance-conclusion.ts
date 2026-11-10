import { ApiError } from './api';
import { ACCEPTANCE_STATUS_LABEL, acceptanceStatus } from './acceptance-tests';
import { getDb } from './db';
import { formatLlmCallError, formatLlmHttpError } from './llm-error';
import { fetchChatCompletions, withLlmSlot } from './llm-gate';
import { llmConfigured } from './llm-providers';
import { extractCompletionText } from './admin-summarize';

export type ConclusionItem = {
  groupName: string;
  title: string;
  status: string;
  note: string;
};

const CONCLUSION_SYSTEM_PROMPT = `你是验收负责人。根据一轮测试的逐条结果，写测试结论。
只输出结论文本，不要标题，不要 Markdown，不要 JSON。
必须写清：这一轮整体是否通过、未通过和阻塞分别卡在哪、还有多少未测。
只根据给出的结果和记录写，不要编造没有记录的现象。全文不超过 220 字。`;

export function buildAcceptanceConclusionPrompt(items: ConclusionItem[]) {
  const lines = items.map((item, index) => {
    const status = acceptanceStatus(item.status);
    const label = status ? ACCEPTANCE_STATUS_LABEL[status] : '未测';
    const note = item.note.trim() || '无';
    return `${index + 1}. [${label}] ${item.groupName} / ${item.title}\n记录：${note}`;
  });
  return `共 ${items.length} 条。\n${lines.join('\n')}`;
}

export function cleanAcceptanceConclusion(raw: string) {
  const text = raw
    .replace(/^```(?:markdown|text)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return text.slice(0, 4000);
}

export async function summarizeAcceptanceRun(runId: number) {
  if (!llmConfigured()) throw new ApiError(503, 'LLM 未配置');
  const db = getDb();
  const items = await db<{ group_name: string; title: string; status: string; note: string }[]>`
    SELECT group_name, title, status, note
    FROM acceptance_run_items
    WHERE run_id = ${runId}
    ORDER BY sort, id
  `;
  if (!items.length) throw new ApiError(404, '测试记录不存在');
  const userPrompt = buildAcceptanceConclusionPrompt(items.map((item) => ({
    groupName: item.group_name,
    title: item.title,
    status: item.status,
    note: item.note,
  })));
  const timeoutMs = Number(process.env.LLM_ADMIN_SUMMARIZE_TIMEOUT_MS ?? 90_000);
  let conclusion = '';
  try {
    conclusion = await withLlmSlot(async () => {
      const response = await fetchChatCompletions(
        {
          temperature: 0.2,
          max_tokens: 800,
          messages: [
            { role: 'system', content: CONCLUSION_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
        },
        { timeoutMs },
      );
      const raw = await response.text();
      if (!response.ok) throw new Error(formatLlmHttpError(response.status, raw));
      return cleanAcceptanceConclusion(extractCompletionText(raw));
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, formatLlmCallError(error) || '归纳失败');
  }
  if (!conclusion) throw new ApiError(400, '模型没有给出结论');
  await db`UPDATE acceptance_runs SET conclusion = ${conclusion} WHERE id = ${runId}`;
  return conclusion;
}
