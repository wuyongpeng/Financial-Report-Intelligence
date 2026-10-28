/**
 * Shared product self-intro — voice TTS and typed hard replies stay in sync.
 * Keep short: one warm spoken sentence naming Eva.
 */
export const EVA_PRODUCT_NAME = '财报智析·Eva';

/** 「你是谁 / 你能干什么」— one liner for chat bubble + TTS. */
export const EVA_INTRO_LINE =
  '我是 Eva，你的财报智能分析助手。';

const IDENTITY_RE =
  /^(?:你是谁|你叫什么|自我介绍|介绍一下你自己|你是什么助手|你能干什么|你有什么功能|你会做什么|你可以做什么|你能干嘛|你能做什么)[\s?？!！.。]*$/;

/** Exact identity / capability asks (typed or spoken). */
export function isProductIdentityQuestion(question: string): boolean {
  const q = question.replace(/\s+/g, '').trim();
  if (!q) return false;
  return IDENTITY_RE.test(q) || /你是谁|你叫什么|自我介绍|你是什么助手/.test(q.trim());
}
