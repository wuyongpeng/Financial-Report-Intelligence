import { formatTokenUsage } from './model-usage';

export type AuditTraceInput = {
  eventType: string;
  eventLabel: string;
  createdAt: string;
  company: string;
  ip: string | null;
  ownerKey: string | null;
  path: string | null;
  referer: string | null;
  userAgent: string | null;
  acceptLanguage: string | null;
  reportId: string | null;
  conversationId: string | null;
  requestId: string | null;
  prompt: string | null;
  reply: string | null;
  detail: Record<string, unknown>;
  durationMs: number | null;
};

export type AuditTraceRow = { label: string; value: string };

const SHOWN_DETAIL_KEYS = new Set([
  'period',
  'reportType',
  'usage',
  'errorStack',
  'stack',
  'stackTrace',
  'durationMs',
  'answerStatus',
  'mode',
  'warnings',
  'browser',
  'rewrite',
  'spoken',
  'focusCount',
  'streamed',
  'replay',
  'vote',
  'tags',
  'note',
  'assembled',
]);

export function formatAuditDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  const seconds = ms / 1000;
  return `${seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1)} 秒`;
}

export function readErrorStack(detail: Record<string, unknown>): string {
  for (const key of ['errorStack', 'stack', 'stackTrace']) {
    const value = detail[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '—';
}

function textOrDash(value: string | null | undefined): string {
  const text = value?.trim();
  return text ? text : '—';
}

function extraDetail(detail: Record<string, unknown>): string {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (SHOWN_DETAIL_KEYS.has(key)) continue;
    rest[key] = value;
  }
  return Object.keys(rest).length ? JSON.stringify(rest, null, 2) : '';
}

function durationOf(input: AuditTraceInput): number | null {
  if (input.durationMs != null && Number.isFinite(input.durationMs)) return input.durationMs;
  const fromDetail = input.detail.durationMs;
  return typeof fromDetail === 'number' && Number.isFinite(fromDetail) ? fromDetail : null;
}

/** Rows for the audit detail table, in the order a bug report should read. */
export function auditTraceRows(input: AuditTraceInput): AuditTraceRow[] {
  const rows: AuditTraceRow[] = [
    { label: 'Trace ID', value: textOrDash(input.requestId) },
    { label: '时间', value: textOrDash(input.createdAt) },
    { label: '类型', value: textOrDash(input.eventLabel || input.eventType) },
    { label: '公司', value: textOrDash(input.company) },
    { label: 'IP', value: textOrDash(input.ip) },
    { label: '用户', value: textOrDash(input.ownerKey) },
    { label: '路径', value: textOrDash(input.path) },
    { label: '来源', value: textOrDash(input.referer) },
    { label: '浏览器', value: textOrDash(input.userAgent) },
    { label: '语言', value: textOrDash(input.acceptLanguage) },
    { label: '会话 ID', value: textOrDash(input.conversationId) },
    { label: '报告 ID', value: textOrDash(input.reportId) },
    { label: '用户 Prompt', value: textOrDash(input.prompt) },
    { label: 'AI 回复', value: textOrDash(input.reply) },
    { label: '消耗 Token', value: formatTokenUsage(input.detail.usage) },
    { label: '耗时', value: formatAuditDuration(durationOf(input)) },
    { label: '报错 Stack Trace', value: readErrorStack(input.detail) },
  ];
  const extra = extraDetail(input.detail);
  if (extra) rows.push({ label: '其它', value: extra });
  return rows;
}

/** One block of text for a bug ticket: Trace ID, IP, prompt, reply, and the rest. */
export function auditTraceText(input: AuditTraceInput): string {
  return auditTraceRows(input).map((row) => (
    row.value.includes('\n') ? `${row.label}:\n${row.value}` : `${row.label}: ${row.value}`
  )).join('\n');
}
