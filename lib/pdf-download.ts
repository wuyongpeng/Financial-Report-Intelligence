import { canonicalPeriodFromTitle, isFullFinancialReport } from './ingest-period';
import type { Announcement } from './types';

const SSE_WWW = 'https://www.sse.com.cn';
const SSE_STATIC = 'https://static.sse.com.cn';

/** SSE listing gives /disclosure/... paths; the file host is static.sse.com.cn, not www. */
export function rewriteSsePdfUrl(url: string) {
  const trimmed = String(url ?? '').trim();
  if (!trimmed) return trimmed;
  return trimmed
    .replace(/^https?:\/\/www\.sse\.com\.cn(?=\/disclosure\/)/i, SSE_STATIC)
    .replace(/^https?:\/\/sse\.com\.cn(?=\/disclosure\/)/i, SSE_STATIC);
}

export function ssePdfUrlFromPath(path: string) {
  const raw = String(path ?? '').trim();
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) return rewriteSsePdfUrl(raw);
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return `${SSE_STATIC}${withSlash}`;
}

export function pdfUrlCandidates(source: string, url: string) {
  const original = String(url ?? '').trim();
  const urls: string[] = [];
  const push = (value: string) => {
    if (value && !urls.includes(value)) urls.push(value);
  };
  if (source === 'SSE' || /sse\.com\.cn/i.test(original)) {
    push(rewriteSsePdfUrl(original));
    if (original.startsWith(SSE_WWW)) push(original);
  }
  push(original);
  return urls;
}

export function isPdfBytes(bytes: ArrayBuffer | Uint8Array | null | undefined) {
  if (!bytes) return false;
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  if (view.byteLength < 4) return false;
  const head = new TextDecoder('latin1').decode(view.subarray(0, 8));
  return head.startsWith('%PDF');
}

export function looksLikeBlockedPdf(bytes: ArrayBuffer | Uint8Array | null | undefined) {
  if (!bytes) return true;
  if (isPdfBytes(bytes)) return false;
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  const head = new TextDecoder('utf-8', { fatal: false }).decode(view.subarray(0, 400)).toLowerCase();
  return head.includes('<html') || head.includes('denied by bot') || head.includes('var arg1=');
}

export function pickCninfoFallback(
  failed: { code: string; title: string; publishedAt?: unknown; published_at?: unknown },
  candidates: Announcement[],
) {
  const period = canonicalPeriodFromTitle(failed.title, failed.publishedAt ?? failed.published_at);
  if (!period) return null;
  const hits = candidates.filter((item) => {
    if (item.source !== 'CNINFO' || item.code !== failed.code) return false;
    if (!isFullFinancialReport(item.title)) return false;
    return canonicalPeriodFromTitle(item.title, item.publishedAt) === period;
  });
  if (!hits.length) return null;
  const own = hits.filter((item) => !/：/.test(item.title));
  return own[0] ?? hits[0] ?? null;
}
