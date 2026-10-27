import { normalizeVoiceText } from './text-normalize';

export type VoiceTtsControlIntent =
  | { kind: 'pause' }
  | { kind: 'resume' }
  | null;

/**
 * Pause / resume TTS. 「接着念」 is TTS-only (does not steal bare page-nav 「继续」).
 * Bare 「继续」 stays with page-continue when last nav is fresh.
 */
export function parseVoiceTtsControlIntent(text: string): VoiceTtsControlIntent {
  const t = normalizeVoiceText(text);
  if (!t) return null;

  if (
    /^(先别念了|别念了|不要念了|暂停朗读|停一下|先停下|先别说了|别说了|暂停一下|先别读了|别读了)$/.test(
      t,
    )
  ) {
    return { kind: 'pause' };
  }

  // Explicit resume-speak phrases — never page-nav.
  if (/^(接着念|继续念|接着说|继续说|接着读|继续读|接着朗读|继续朗读)$/.test(t)) {
    return { kind: 'resume' };
  }

  return null;
}
