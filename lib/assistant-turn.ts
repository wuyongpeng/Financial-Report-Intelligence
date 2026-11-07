/** Shared, client-safe semantic response contract. No arbitrary model tools. */
export type FeedbackDraftAction = { type: 'open_feedback'; category: '体验问题' | '功能建议' | '数据不准' | '其它'; draft: string };
export type AssistantTurn = { kind: 'domain' } | { kind: 'conversation'; answer: string } | { kind: 'feedback'; action: FeedbackDraftAction };
export const FEEDBACK_REVIEW_LINE = '反馈已打开，请确认内容，没问题后再亲自点击发送。';

export function parseAssistantTurn(value: unknown): AssistantTurn {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'domain' };
  const row = value as Record<string, unknown>;
  if (row.kind === 'conversation' && typeof row.answer === 'string' && row.answer.trim() && row.answer.length <= 240 && !row.action && !/[\p{N}<>]|【E/u.test(row.answer)) {
    return { kind: 'conversation', answer: row.answer.trim() };
  }
  if (row.kind === 'feedback' && row.action && typeof row.action === 'object' && !Array.isArray(row.action)) {
    const action = row.action as Record<string, unknown>;
    if (action.type === 'open_feedback' && ['体验问题', '功能建议', '数据不准', '其它'].includes(String(action.category))
      && typeof action.draft === 'string' && action.draft.trim() && action.draft.length <= 600
      && Object.keys(action).every(key => ['type', 'category', 'draft'].includes(key))) {
      return { kind: 'feedback', action: { type: 'open_feedback', category: action.category as FeedbackDraftAction['category'], draft: action.draft.trim() } };
    }
  }
  return { kind: 'domain' };
}

export async function requestAssistantTurn(input: {
  question: string; surface: 'home' | 'report'; history: Array<{ role: 'user' | 'assistant'; content: string }>; context?: string;
}, signal: AbortSignal): Promise<AssistantTurn> {
  try {
    const response = await fetch('/api/assistant/turn', { method: 'POST', signal, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    if (!response.ok) return { kind: 'domain' };
    const turn = parseAssistantTurn(await response.json());
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    return turn;
  } catch (error) {
    if (signal.aborted) throw error;
    return { kind: 'domain' }; // Fail closed into existing evidence/selection routing.
  }
}
