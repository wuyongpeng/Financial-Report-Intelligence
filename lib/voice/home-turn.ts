import { isMeaningfulBargePartial } from './timing';

export type HomeVoiceTurn = { controller: AbortController; signal: AbortSignal; userRecorded: boolean; hasReply: boolean };

/** One owner for every homepage reply; cancellation fences late fetch/TTS/finally. */
export class HomeVoiceTurns {
  current: HomeVoiceTurn | null = null;
  begin(): HomeVoiceTurn {
    this.cancel();
    const controller = new AbortController();
    this.current = { controller, signal: controller.signal, userRecorded: false, hasReply: false };
    return this.current;
  }
  owns(turn: HomeVoiceTurn | null): boolean {
    return turn === null ? this.current === null : this.current === turn && !turn.signal.aborted;
  }
  /** Commit accepted ASR before routing; repeated route entry must not duplicate it. */
  recordUser(turn: HomeVoiceTurn | null, text: string, append: (text: string) => void): boolean {
    if (!turn || !this.owns(turn) || turn.userRecorded || !text.trim()) return false;
    turn.userRecorded = true;
    append(text.trim());
    return true;
  }
  recordReply() { if (this.current) this.current.hasReply = true; }
  needsReceipt(turn: HomeVoiceTurn | null): boolean { return Boolean(turn && this.owns(turn) && !turn.hasReply); }
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

export const HOME_UNMATCHED_RECEIPT = '你的话我收到了，但还没匹配到公司或明确请求。可以补充公司名、六位代码，或换个说法。';
export const HOME_VOICE_FAILURE_RECEIPT = '这次处理失败了，你的话已保留，请稍后重试。';
