import { normalizeVoiceText } from './text-normalize';
import { EVA_INTRO_LINE, isProductIdentityQuestion } from '@/lib/product-identity';

/** @deprecated prefer EVA_INTRO_LINE — kept for existing test imports */
export const VOICE_CAPABILITY_LINES = [EVA_INTRO_LINE] as const;

/** 「你是谁 / 你能干什么」— fixed line, no model. */
export function isVoiceCapabilityIntent(text: string): boolean {
  const t = normalizeVoiceText(text);
  if (!t) return false;
  return isProductIdentityQuestion(t)
    || /^(你能干什么|你能干啥|你能干嘛|你能做什么|你能做啥|你有什么功能|你会做什么|你会做啥|你会干啥|你会啥|你可以做什么|介绍一下你自己|你是谁)$/.test(t);
}

export function voiceCapabilitySpeech(): string {
  return EVA_INTRO_LINE;
}
