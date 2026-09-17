import type { Report } from './detail-model';

export function isPlaceholderReport(report: { id: string }) {
  return report.id.startsWith('pending:');
}

export function reportIsParsed(report: { parsed_at: string | null; metrics: unknown[] }) {
  return Boolean(report.parsed_at) || (Array.isArray(report.metrics) && report.metrics.length > 0);
}

export function reportNeedsParse(report: Report) {
  if (isPlaceholderReport(report) || reportIsParsed(report)) return false;
  if (report.status === 'auto_skipped') return false;
  return true;
}

/** PDF is not on disk yet — parse-only would no-op. */
export function reportNeedsDownload(report: Report) {
  if (!reportNeedsParse(report)) return false;
  return report.status === 'discovered' || report.status === 'download_failed';
}

export function reportParseInFlight(report: Report) {
  return report.status === 'downloading' || report.status === 'parsing';
}
