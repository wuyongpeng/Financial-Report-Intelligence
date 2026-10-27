/** Normalize ASR / typed text for local voice-intent matching. */
export function normalizeVoiceText(text: string): string {
  return text
    .replace(/\s+/g, '')
    .replace(/[。！？.!?,，、；;：:""''「」『』（）()【】\[\]…—～~]/g, '')
    .trim();
}
