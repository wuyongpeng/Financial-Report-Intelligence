import { sanitizeModelId } from '@/lib/reader-prefs';
import { readReaderPrefs } from '@/lib/reader-prefs-client';

/** Shared, client-safe semantic response contract. No arbitrary model tools. */
export type FeedbackDraftAction = { type: 'open_feedback'; category: '体验问题' | '功能建议' | '数据不准' | '其它'; draft: string };
export type AssistantTurnFailure = 'not_configured' | 'timeout' | 'upstream' | 'invalid_response' | 'cancelled';
export type AssistantTurn = { kind: 'unavailable'; reason: AssistantTurnFailure } | { kind: 'domain' } | { kind: 'conversation'; answer: string } | { kind: 'feedback'; action: FeedbackDraftAction };
export const FEEDBACK_REVIEW_LINE = '反馈已打开，请确认内容，没问题后再亲自点击发送。';

export function unavailableAssistantTurn(reason: AssistantTurnFailure): Extract<AssistantTurn, { kind: 'unavailable' }> {
  return { kind: 'unavailable', reason };
}
export function assistantTurnFailureMessage(reason: AssistantTurnFailure): string {
  if (reason === 'not_configured') return 'AI对话暂未配置，这次没有执行页面操作。请联系维护者，或从页面反馈入口手动反馈。';
  if (reason === 'timeout') return '这次意图识别超时了，你的话已保留。请重试，或从页面反馈入口手动反馈。';
  if (reason === 'invalid_response') return '这次没能可靠识别你的意图，你的话已保留。请换个说法，或手动打开反馈。';
  if (reason === 'cancelled') return '已停止本次处理。';
  return 'AI对话暂时不可用，你的话已保留。请稍后重试，或从页面反馈入口手动反馈。';
}
export function parseAssistantTurn(value: unknown): AssistantTurn {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailableAssistantTurn('invalid_response');
  const row = value as Record<string, unknown>;
  if (row.kind === 'domain' && Object.keys(row).length === 1) return { kind: 'domain' };
  if (row.kind === 'unavailable' && ['not_configured', 'timeout', 'upstream', 'invalid_response', 'cancelled'].includes(String(row.reason))) return unavailableAssistantTurn(row.reason as AssistantTurnFailure);
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
  return unavailableAssistantTurn('invalid_response');
}

export async function requestAssistantTurn(input: {
  question: string; surface: 'home' | 'report'; history: Array<{ role: 'user' | 'assistant'; content: string }>; context?: string;
}, signal: AbortSignal): Promise<AssistantTurn> {
  try {
    const prefs = readReaderPrefs();
    const modelId = prefs.autoModel ? undefined : sanitizeModelId(prefs.modelId);
    const response = await fetch('/api/assistant/turn', {
      method: 'POST',
      signal,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...input,
        history: prefs.memory ? input.history : [],
        ...(modelId ? { modelId } : {}),
      }),
    });
    if (!response.ok) return unavailableAssistantTurn('upstream');
    const turn = parseAssistantTurn(await response.json());
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    return turn;
  } catch (error) {
    if (signal.aborted) throw error;
    return unavailableAssistantTurn('upstream'); // Never mislabel failed intent recognition as missing financial evidence.
  }
}
