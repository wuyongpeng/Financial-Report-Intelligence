import { normalizeVoiceText } from './text-normalize';

export type VoiceZoomIntent =
  | { kind: 'in' }
  | { kind: 'out' }
  | { kind: 'fit' }
  | { kind: 'actual' }
  | null;

export const VOICE_PDF_ZOOM_DEFAULT = 1;
export const VOICE_PDF_ZOOM_MIN = 0.6;
export const VOICE_PDF_ZOOM_MAX = 2;
export const VOICE_PDF_ZOOM_STEP = 1.15;

/** 「放大一点 / 缩小 / 适合宽度」. */
export function parseVoiceZoomIntent(text: string): VoiceZoomIntent {
  const t = normalizeVoiceText(text);
  if (!t) return null;
  if (
    /^(放大一点|放大些|放大点|放大|再放大|再大一点|大一点|放大一下|请放大|帮我放大)$/.test(t)
  ) {
    return { kind: 'in' };
  }
  if (
    /^(缩小一点|缩小些|缩小点|缩小|再缩小|再小一点|小一点|缩小一下|请缩小|帮我缩小)$/.test(t)
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

export function nextPdfZoom(current: number, intent: Exclude<VoiceZoomIntent, null>): number {
  const cur = Number.isFinite(current) && current > 0 ? current : VOICE_PDF_ZOOM_DEFAULT;
  if (intent.kind === 'fit' || intent.kind === 'actual') return VOICE_PDF_ZOOM_DEFAULT;
  if (intent.kind === 'in') {
    return Math.min(VOICE_PDF_ZOOM_MAX, Math.round(cur * VOICE_PDF_ZOOM_STEP * 100) / 100);
  }
  return Math.max(VOICE_PDF_ZOOM_MIN, Math.round((cur / VOICE_PDF_ZOOM_STEP) * 100) / 100);
}
