/** A whitespace final must not erase the last real ASR hypothesis. */
export function finalAsrTranscript(final: string, partial: string): string {
  return final.trim() || partial.trim();
}
