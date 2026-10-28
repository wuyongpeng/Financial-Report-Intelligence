import { normalizeVoiceText } from './text-normalize';

export type VoiceZoomIntent =
  | { kind: 'in' }
  | { kind: 'out' }
  | { kind: 'fit' }
  | { kind: 'actual' }
  | null;

/** Five discrete zoom levels: −2 … +2 around fit-width default. */
export const VOICE_PDF_ZOOM_LEVELS = [0.76, 0.88, 1, 1.12, 1.24] as const;
export const VOICE_PDF_ZOOM_DEFAULT = 1;
export const VOICE_PDF_ZOOM_MIN = VOICE_PDF_ZOOM_LEVELS[0];
export const VOICE_PDF_ZOOM_MAX = VOICE_PDF_ZOOM_LEVELS[VOICE_PDF_ZOOM_LEVELS.length - 1];

/** 「放大一点 / 缩小 / 适合宽度」——适合宽度与实际大小都回到默认档. */
export function parseVoiceZoomIntent(text: string): VoiceZoomIntent {
  const t = normalizeVoiceText(text);
  if (!t) return null;
  if (
    /^(放大一点|放大些|放大点|放大|再放大|再大一点|大一点|放大一下|放大一些|再放大一点|再放大一些|请放大|帮我放大)$/.test(t)
  ) {
    return { kind: 'in' };
  }
  if (
    /^(缩小一点|缩小些|缩小点|缩小|再缩小|再小一点|小一点|缩小一下|缩小一些|再缩小一点|再缩小一些|请缩小|帮我缩小)$/.test(t)
  ) {
    return { kind: 'out' };
  }
  if (
    /^(适合宽度|适应宽度|适应页面|适合页面|铺满宽度|按宽度显示|宽度适应)$/.test(t)
  ) {
    return { kind: 'fit' };
  }
  if (/^(实际大小|原始大小|百分百|百分之百|还原缩放|恢复缩放)$/.test(t)) {
    return { kind: 'actual' };
  }
  return null;
}

function nearestZoomIndex(current: number): number {
  const cur = Number.isFinite(current) && current > 0 ? current : VOICE_PDF_ZOOM_DEFAULT;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < VOICE_PDF_ZOOM_LEVELS.length; i++) {
    const d = Math.abs(VOICE_PDF_ZOOM_LEVELS[i] - cur);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Snap any value onto the discrete ladder, then step ±1 or reset to default. */
export function nextPdfZoom(current: number, intent: Exclude<VoiceZoomIntent, null>): number {
  if (intent.kind === 'fit' || intent.kind === 'actual') return VOICE_PDF_ZOOM_DEFAULT;
  const idx = nearestZoomIndex(current);
  if (intent.kind === 'in') {
    return VOICE_PDF_ZOOM_LEVELS[Math.min(VOICE_PDF_ZOOM_LEVELS.length - 1, idx + 1)];
  }
  return VOICE_PDF_ZOOM_LEVELS[Math.max(0, idx - 1)];
}
