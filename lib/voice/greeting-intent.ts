/**
 * Home / super-entry voice: clear greetings & filler noise — local, no LLM.
 * Whole-utterance only so 「你好，贵州茅台营收多少」 still searches.
 */

import { normalizeVoiceTextRaw } from './text-normalize';

/**
 * True when the utterance is only a greeting, thanks, or empty filler and must
 * NOT be treated as a company name / super-entry search query.
 */
export function isVoiceGreetingOrNoise(text: string): boolean {
  const t = normalizeVoiceTextRaw(text);
  if (!t) return true;

  // Pure greetings (allow mild repetition from ASR: 你好你好).
  if (/^(?:你好|您好)+(?:啊|呀|哦|哈|呢)?$/i.test(t)) return true;
  if (/^(?:嗨|哈喽|嘿喽|喂)+(?:啊|呀)?$/i.test(t)) return true;
  if (/^(?:hello|hi|hey|hola)+(?:there)?$/i.test(t)) return true;
  if (/^(?:早上好|中午好|下午好|晚上好|早点好)(?:啊|呀)?$/.test(t)) return true;
  if (/^(?:在吗|在不在|你在吗|有人吗|在么)(?:啊|呀)?$/.test(t)) return true;
  if (/^(?:喂你好|嗨你好|你好吗|您好吗)$/.test(t)) return true;

  // Thanks-only (not farewell — those stay in farewell-intent).
  if (/^(?:谢谢|多谢|感谢|谢谢你|谢谢啊|谢谢啦|谢谢了|谢谢哈|谢了)(?:啊|呀|啦|咯)?$/.test(t)) return true;

  // Filler / hesitation only.
  if (/^(?:嗯+|啊+|呃+|额+|哦+|噢+|喔+|唉+|哎+|唔+|诶+)(?:啊|呀)?$/.test(t)) return true;
  if (/^(?:哈哈+|嘿嘿+|呵呵+|嗯嗯+|啊啊+)$/.test(t)) return true;

  // Ultra-short polite with optional particles (length-capped).
  if (t.length <= 8 && /^(?:你好|您好|嗨|喂|在吗|谢谢)(?:啊|呀|哦|哈|呢)*$/.test(t)) return true;

  return false;
}
