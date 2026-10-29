import { isVoiceCapabilityIntent } from './meta-intent';
import { isVoiceHowToAskIntent } from './how-to-ask-intent';
import { parseVoiceTtsControlIntent } from './tts-control-intent';
import { parseVoiceStyleIntent, type VoiceAnswerStyle } from './style-intent';
import { parseVoiceLayoutIntent } from './layout-intent';
import { parseVoiceZoomIntent, type VoiceZoomIntent } from './zoom-intent';
import { isVoiceCiteIntent } from './cite-intent';
import { parseVoiceReadIntent } from './read-intent';
import { parseVoiceTocIntent } from './toc-intent';
import {
  parseVoiceNavIntent,
  parseVoicePageContinue,
  type VoicePageNavDirection,
} from './nav-intent';
import { isVoiceFarewell } from './farewell-intent';
import { normalizeVoiceText } from './text-normalize';

/** Where the utterance came from. Both go through the SAME parser and handlers. */
export type LocalCommandSource = 'voice' | 'typed';

export type PageNavCommand =
  | { kind: 'next' }
  | { kind: 'prev' }
  | { kind: 'last' }
  | { kind: 'goto'; page: number };

/**
 * Every local (no-LLM) command in the voice pack. One union, one parser:
 * typed chat input and ASR transcripts both resolve here.
 */
export type LocalCommand =
  | { kind: 'capability' }
  | { kind: 'how-to-ask' }
  | { kind: 'tts-pause' }
  | { kind: 'tts-resume' }
  | { kind: 'style'; style: VoiceAnswerStyle }
  | { kind: 'layout'; layout: 'collapse-mid' | 'expand-mid' }
  | { kind: 'zoom'; zoom: Exclude<VoiceZoomIntent, null> }
  | { kind: 'cite' }
  | { kind: 'read-page-head' }
  | { kind: 'read-section'; query: string }
  | { kind: 'toc-open' }
  | { kind: 'toc-jump'; query: string }
  | { kind: 'page-nav'; nav: PageNavCommand; via: 'direct' | 'continue' }
  /** Bare 「继续」 while TTS is paused (no fresh page-nav window). */
  | { kind: 'tts-resume-bare' }
  | { kind: 'home' }
  | { kind: 'farewell' };

export type LocalCommandContext = {
  lastPageNav: { kind: VoicePageNavDirection; at: number } | null;
  now?: number;
  /** True when TTS is currently paused (lets bare 「继续」 resume reading). */
  ttsPaused?: boolean;
};

/**
 * Single shared parser. Order is the contract (first match wins) and matches the
 * former voice-only pipeline: pack commands → page nav → 继续 → home → farewell.
 * Everything is whole-utterance anchored so real finance questions fall through (null → AI).
 */
export function parseLocalCommand(text: string, ctx: LocalCommandContext): LocalCommand | null {
  if (!text || !text.trim()) return null;

  if (isVoiceCapabilityIntent(text)) return { kind: 'capability' };

  if (isVoiceHowToAskIntent(text)) return { kind: 'how-to-ask' };

  const tts = parseVoiceTtsControlIntent(text);
  if (tts) return { kind: tts.kind === 'pause' ? 'tts-pause' : 'tts-resume' };

  const style = parseVoiceStyleIntent(text);
  if (style) return { kind: 'style', style: style.kind };

  const layout = parseVoiceLayoutIntent(text);
  if (layout) return { kind: 'layout', layout: layout.kind };

  const zoom = parseVoiceZoomIntent(text);
  if (zoom) return { kind: 'zoom', zoom };

  if (isVoiceCiteIntent(text)) return { kind: 'cite' };

  const read = parseVoiceReadIntent(text);
  if (read?.kind === 'page-head') return { kind: 'read-page-head' };
  if (read?.kind === 'section') return { kind: 'read-section', query: read.query };

  const toc = parseVoiceTocIntent(text);
  if (toc?.kind === 'open-toc') return { kind: 'toc-open' };
  if (toc?.kind === 'jump-section') return { kind: 'toc-jump', query: toc.query };

  const nav = parseVoiceNavIntent(text);
  if (nav && nav.kind !== 'home') return { kind: 'page-nav', nav, via: 'direct' };

  const cont = parseVoicePageContinue(text, ctx.lastPageNav, ctx.now);
  if (cont) return { kind: 'page-nav', nav: cont, via: 'continue' };

  if (ctx.ttsPaused && normalizeVoiceText(text) === '继续') return { kind: 'tts-resume-bare' };

  if (nav?.kind === 'home') return { kind: 'home' };
  if (isVoiceFarewell(text)) return { kind: 'farewell' };
  return null;
}
