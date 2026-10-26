/** Strip citation marks and markdown noise before TTS. */
export function speakableText(raw: string): string {
  return raw
    .replace(/【(?:E\d+|第\s*\d+\s*页)】/g, '')
    .replace(/\[P\d+\]/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
