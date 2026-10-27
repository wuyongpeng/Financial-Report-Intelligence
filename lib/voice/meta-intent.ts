import { normalizeVoiceText } from './text-normalize';

export const VOICE_CAPABILITY_LINES = [
  '我能对照官方财报原文回答，并标出页码出处，方便你点回去核对。',
  '也可以语音翻页、跳章节、缩放 PDF，还能按章节连续朗读。',
  '说「出处在哪」就能跳到上一条答案的证据页。',
] as const;

/** 「你能干什么」— fixed lines, no model. */
export function isVoiceCapabilityIntent(text: string): boolean {
  const t = normalizeVoiceText(text);
  if (!t) return false;
  return /^(你能干什么|你有什么功能|你会做什么|你可以做什么|你能干嘛|介绍一下你自己|你是谁|你能做什么)$/.test(
    t,
  );
}

export function voiceCapabilitySpeech(): string {
  return VOICE_CAPABILITY_LINES.join('');
}
