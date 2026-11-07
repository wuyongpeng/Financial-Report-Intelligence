import { normalizeVoiceTextRaw } from './text-normalize';

/** Only a new real user submission may auto-expand; history/status/assistant never do. */
export function shouldExpandHomeVoicePanel(role: 'user' | 'assistant', content: string, active: boolean): boolean {
  if (!active || role !== 'user') return false;
  const text = normalizeVoiceTextRaw(content);
  if (!text) return false;
  return !/^(?:嗯+|啊+|呃+|额+|哦+|噢+|喔+|唉+|哎+|唔+|诶+|哈哈+|嘿嘿+|呵呵+)(?:啊|呀)?$/u.test(text);
}
