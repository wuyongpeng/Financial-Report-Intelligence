/**
 * Conversational context surfaces for Eva.
 *
 * Voice mic/float may stay active across routes, but *message history* must not
 * cross: home chitchat never seeds a report thread, and a report thread never
 * becomes home context. Each reportId keeps its own conversation; a home→detail
 * ask handoff (`?q=`) starts a fresh report thread so the new utterance is first.
 */

export type ChatSurfaceKind = 'home' | 'detail';

const HANDOFF_KEY = 'eva:chat-home-ask-handoff';

type HandoffPayload = { q: string; at: number };

/** Home is about to open a company with an ask — mark one-shot isolation handoff. */
export function markHomeAskHandoff(question: string): void {
  if (typeof window === 'undefined') return;
  const q = question.trim();
  if (!q) return;
  const payload: HandoffPayload = { q, at: Date.now() };
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(payload));
  } catch {
    /* private mode / quota — URL `q` alone still triggers fresh thread */
  }
}

/**
 * Whether this detail open should start a fresh report conversation.
 * True when `q` is present (home deep-link) and/or a handoff marker exists.
 * Consumes the marker so a refresh mid-thread does not keep resetting.
 */
export function consumeHomeAskHandoff(autoAskQuestion?: string | null): boolean {
  const fromUrl = Boolean(autoAskQuestion?.trim());
  if (typeof window === 'undefined') return fromUrl;
  let marked = false;
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    sessionStorage.removeItem(HANDOFF_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as HandoffPayload;
      marked = Boolean(parsed?.q?.trim()) && typeof parsed.at === 'number' && Date.now() - parsed.at < 120_000;
    }
  } catch {
    marked = false;
  }
  return fromUrl || marked;
}

export function clearHomeAskHandoff(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(HANDOFF_KEY);
  } catch {
    /* ignore */
  }
}

/** Ephemeral home-only turns (not persisted). Never read from company-detail. */
let homeTurns: Array<{ role: 'user' | 'assistant'; content: string }> = [];

export function getHomeChatTurns(): Array<{ role: 'user' | 'assistant'; content: string }> {
  return homeTurns.map((t) => ({ ...t }));
}

export function appendHomeChatTurn(role: 'user' | 'assistant', content: string): void {
  const text = content.trim();
  if (!text) return;
  homeTurns = [...homeTurns, { role, content: text }].slice(-20);
}

export function clearHomeChatTurns(): void {
  homeTurns = [];
}
