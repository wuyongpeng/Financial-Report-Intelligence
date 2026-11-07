import { isMeaningfulBargePartial } from './timing';

export type HomeVoiceTurn = { controller: AbortController; signal: AbortSignal };

/** One owner for every homepage reply; cancellation fences late fetch/TTS/finally. */
export class HomeVoiceTurns {
  current: HomeVoiceTurn | null = null;
  begin(): HomeVoiceTurn {
    this.cancel();
    const controller = new AbortController();
    this.current = { controller, signal: controller.signal };
    return this.current;
  }
  owns(turn: HomeVoiceTurn | null): boolean {
    return turn === null ? this.current === null : this.current === turn && !turn.signal.aborted;
  }
  cancel(turn = this.current) {
    turn?.controller.abort();
    if (this.current === turn) this.current = null;
  }
}

export function assertHomeVoiceTurn(turn: HomeVoiceTurn | null) {
  if (turn?.signal.aborted) throw new DOMException('Superseded homepage voice turn', 'AbortError');
}

const compact = (text: string) => text.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
/** AEC is primary; also reject filler and verbatim TTS fragments, but keep dialog replies. */
export function acceptsHomeBargeSpeech(raw: string, spoken: string, replies: readonly string[] = []): boolean {
  const text = compact(raw);
  if (!text || /^(?:嗯+|啊+|呃+|额+|哦+|噢+|唔+)$/.test(text)) return false;
  if (replies.some((reply) => compact(reply) === text)) return true;
  if (!isMeaningfulBargePartial(text)) return false;
  return !(text.length >= 2 && compact(spoken).includes(text));
}
