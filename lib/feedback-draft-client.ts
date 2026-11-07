import { parseAssistantTurn, type FeedbackDraftAction } from './assistant-turn';
const DRAFT_EVENT = 'eva:feedback-draft';
const STATE_EVENT = 'eva:feedback-state';
let drawerOpen = false;
export const isFeedbackDrawerOpen = () => drawerOpen;
export type FeedbackDraftRequest = { action: FeedbackDraftAction; pathname: string; isCurrent: () => boolean; accepted?: boolean };

/** Local UI event only: no POST, no sending, and no model-selected URL or tool. */
export function requestFeedbackDraft(action: FeedbackDraftAction, isCurrent: () => boolean): boolean {
  if (typeof window === 'undefined' || !isCurrent()) return false;
  const checked = parseAssistantTurn({ kind: 'feedback', action });
  if (checked.kind !== 'feedback') return false;
  const detail: FeedbackDraftRequest = { action: checked.action, pathname: window.location.pathname, isCurrent };
  window.dispatchEvent(new CustomEvent(DRAFT_EVENT, { detail }));
  return detail.accepted === true;
}
export function subscribeFeedbackDraft(handler: (request: FeedbackDraftRequest) => void) {
  const pathname = window.location.pathname;
  const listener = (event: Event) => {
    const request = (event as CustomEvent<FeedbackDraftRequest>).detail;
    if (request?.pathname !== pathname || window.location.pathname !== pathname || typeof request.isCurrent !== 'function' || !request.isCurrent()) return;
    const checked = parseAssistantTurn({ kind: 'feedback', action: request.action });
    if (checked.kind !== 'feedback') return;
    request.action = checked.action;
    handler(request);
  };
  window.addEventListener(DRAFT_EVENT, listener);
  return () => window.removeEventListener(DRAFT_EVENT, listener);
}
export function publishFeedbackState(open: boolean) {
  drawerOpen = open;
  window.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: open }));
}
export function subscribeFeedbackState(handler: (open: boolean) => void) {
  const listener = (event: Event) => handler((event as CustomEvent<boolean>).detail === true);
  window.addEventListener(STATE_EVENT, listener);
  return () => window.removeEventListener(STATE_EVENT, listener);
}
export function preserveFeedbackDraft(current: { text: string; edited: boolean }, incoming: string) {
  const preserved = current.edited || Boolean(current.text.trim());
  return { text: preserved ? current.text : incoming, preserved };
}
