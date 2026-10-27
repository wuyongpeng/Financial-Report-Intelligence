import { normalizeVoiceText } from './text-normalize';

export type VoiceAnswerStyle = 'brief' | 'detailed';

export type VoiceStyleIntent = { kind: VoiceAnswerStyle } | null;

/** 「说重点 / 讲细一点」— session flag for subsequent voice answers. */
export function parseVoiceStyleIntent(text: string): VoiceStyleIntent {
  const t = normalizeVoiceText(text);
  if (!t) return null;

  if (
    /^(说重点|讲重点|讲简短点|说简短点|短一点|简短一点|简单一点|说简单点|讲简单点|长话短说|说短一点|答短一点)$/.test(
      t,
    )
  ) {
    return { kind: 'brief' };
  }

  if (
    /^(讲细一点|展开说说|详细一点|说详细点|讲详细点|再详细点|说完整点|展开讲讲|多说一点|讲多一点)$/.test(
      t,
    )
  ) {
    return { kind: 'detailed' };
  }

  return null;
}

export function voiceStyleConfirmLine(style: VoiceAnswerStyle): string {
  return style === 'brief' ? '好，后面我讲重点' : '好，后面我讲细一点';
}
