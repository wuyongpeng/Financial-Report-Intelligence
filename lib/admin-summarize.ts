import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getDb } from './db';
import { ensureBackendSchema } from './backend-schema';
import { fetchChatCompletions, withLlmSlot } from './llm-gate';
import { llmConfigured } from './llm-providers';
import { formatLlmCallError, formatLlmHttpError } from './llm-error';
import { unwrapModelJson } from './report-verdict';
import { formatSurveyBasicLine, formatSurveyDeepLine } from './survey';

export type AdminSummarizeScope = 'survey' | 'feedback' | 'audit';

export type SummarizeTheme = {
  title: string;
  count: number;
};

export type AdminSummaryRecord = {
  scope: AdminSummarizeScope;
  basedOnCount: number;
  fingerprint: string;
  generatedAt: string;
  themes: SummarizeTheme[];
};

type StoreFile = Partial<Record<AdminSummarizeScope, AdminSummaryRecord>>;

type NumberedItem = {
  id: number;
  text: string;
};

const MAX_ITEMS = 200;
const MAX_ITEM_CHARS = 480;
const MAX_THEMES = 8;
const MIN_THEMES = 1;

const SCOPES = new Set<AdminSummarizeScope>(['survey', 'feedback', 'audit']);

export function isAdminSummarizeScope(value: unknown): value is AdminSummarizeScope {
  return typeof value === 'string' && SCOPES.has(value as AdminSummarizeScope);
}

/** Shared JSON shape; scope-specific focus is appended in the user prompt. */
export const ADMIN_SUMMARIZE_SYSTEM_PROMPT = `你是产品运营助手，负责把运营数据归纳成主题。
只输出一个 JSON 对象，不要 Markdown、不要解释、不要额外字段。

输出格式：
{"themes":[{"title":"主题短名","ids":[1,2]}]}

规则：
1. title 只起主题名，中文，建议不超过 20 字；不要完整句子，不要「用户认为」「很多人说」等套话。
2. ids 是归入该主题的条目编号（可重叠；一条可进多个主题）。
3. 主题 3～8 个（条目很少时可更少），按覆盖条数降序。
4. 禁止输出总条数、时间、百分比、总结段落。
5. 不要编造输入中不存在的内容。`;

function storePath() {
  return resolve(process.env.RUNTIME_DIR ?? resolve(/* turbopackIgnore: true */ process.cwd(), '.data'), 'admin-summaries.json');
}

function readStore(): StoreFile {
  try {
    const parsed = JSON.parse(readFileSync(storePath(), 'utf8')) as StoreFile;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(next: StoreFile) {
  const target = storePath();
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  renameSync(temporary, target);
}

export function loadAdminSummary(scope: AdminSummarizeScope): AdminSummaryRecord | null {
  const item = readStore()[scope];
  if (!item || item.scope !== scope) return null;
  if (!Array.isArray(item.themes) || typeof item.fingerprint !== 'string') return null;
  if (!Number.isFinite(item.basedOnCount) || typeof item.generatedAt !== 'string') return null;
  return {
    scope,
    basedOnCount: Math.max(0, Math.trunc(item.basedOnCount)),
    fingerprint: item.fingerprint,
    generatedAt: item.generatedAt,
    themes: item.themes
      .filter((t): t is SummarizeTheme => Boolean(t && typeof t.title === 'string' && Number.isFinite(t.count)))
      .map((t) => ({ title: t.title.trim(), count: Math.max(0, Math.trunc(t.count)) }))
      .filter((t) => t.title),
  };
}

export function saveAdminSummary(record: AdminSummaryRecord) {
  const store = readStore();
  store[record.scope] = record;
  writeStore(store);
}

export function fingerprintItems(items: NumberedItem[]) {
  const hash = createHash('sha256');
  hash.update(String(items.length));
  for (const item of items) {
    hash.update(`\n${item.id}\t${item.text}`);
  }
  return hash.digest('hex').slice(0, 24);
}

function clip(text: string, max = MAX_ITEM_CHARS) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

export async function loadSurveyItemsForSummarize(): Promise<NumberedItem[]> {
  await ensureBackendSchema();
  const db = getDb();
  const rows = await db<Array<{
    id: number;
    nickname: string | null;
    basic: Record<string, unknown> | null;
    deep: Record<string, unknown> | null;
  }>>`
    SELECT id, nickname, basic, deep
    FROM survey_responses
    ORDER BY created_at DESC
    LIMIT ${MAX_ITEMS}
  `;
  return rows.map((row) => {
    const basic = formatSurveyBasicLine(row.basic ?? undefined);
    const deep = formatSurveyDeepLine(row.deep);
    const bits = [
      row.nickname?.trim() ? `昵称:${row.nickname.trim()}` : null,
      basic || null,
      deep || null,
    ].filter(Boolean);
    return {
      id: row.id,
      text: clip(bits.join('；') || '(空反馈)'),
    };
  });
}

export async function loadFeedbackItemsForSummarize(): Promise<NumberedItem[]> {
  await ensureBackendSchema();
  const db = getDb();
  const rows = await db<Array<{
    id: number;
    category: string | null;
    message: string;
  }>>`
    SELECT id, category, message
    FROM user_feedback
    ORDER BY id DESC
    LIMIT ${MAX_ITEMS}
  `;
  return rows.map((row) => ({
    id: row.id,
    text: clip(`[${row.category?.trim() || '其它'}] ${row.message || ''}`.trim() || '(空反馈)'),
  }));
}

const EVENT_LABEL: Record<string, string> = {
  visit: '访问',
  ask: '提问',
  answer_feedback: '反馈',
};

export async function loadAuditItemsForSummarize(): Promise<NumberedItem[]> {
  await ensureBackendSchema();
  const db = getDb();
  const rows = await db<Array<{
    id: number;
    event_type: string;
    company_code: string | null;
    path: string | null;
    question: string | null;
    detail: Record<string, unknown> | null;
  }>>`
    SELECT id, event_type, company_code, path, question, detail
    FROM client_audit_events
    ORDER BY id DESC
    LIMIT ${MAX_ITEMS}
  `;
  return rows.map((row) => {
    const detail = row.detail && typeof row.detail === 'object' ? row.detail : {};
    const bits: string[] = [
      `类型:${EVENT_LABEL[row.event_type] ?? row.event_type}`,
    ];
    if (row.company_code?.trim()) bits.push(`公司:${row.company_code.trim()}`);
    if (row.path?.trim()) bits.push(`路径:${row.path.trim()}`);
    if (row.question?.trim()) bits.push(`问题:${row.question.trim()}`);
    if (typeof detail.vote === 'string') bits.push(`评价:${detail.vote}`);
    if (Array.isArray(detail.tags) && detail.tags.length) {
      bits.push(`标签:${detail.tags.filter((t) => typeof t === 'string').join(',')}`);
    }
    if (typeof detail.note === 'string' && detail.note.trim()) bits.push(`备注:${detail.note.trim()}`);
    if (typeof detail.period === 'string' && detail.period.trim()) bits.push(`期:${detail.period.trim()}`);
    return {
      id: Number(row.id),
      text: clip(bits.join('；') || '(空记录)'),
    };
  });
}

export async function loadItemsForScope(scope: AdminSummarizeScope): Promise<NumberedItem[]> {
  if (scope === 'survey') return loadSurveyItemsForSummarize();
  if (scope === 'feedback') return loadFeedbackItemsForSummarize();
  return loadAuditItemsForSummarize();
}

function scopeFocus(scope: AdminSummarizeScope) {
  if (scope === 'survey') {
    return '侧重：体验痛点、功能期望、印象与建议等调研主题。';
  }
  if (scope === 'feedback') {
    return '侧重：产品问题、功能建议、数据不准等反馈主题。';
  }
  return '侧重：用户常问什么问题、常访问哪些公司/页面、常见评价或反馈标签。公司代码可保留在主题名里（如「常看贵州茅台/600519」）。';
}

export function buildSummarizeUserPrompt(scope: AdminSummarizeScope, items: NumberedItem[]) {
  const kind = scope === 'survey'
    ? '用户调研问卷结果'
    : scope === 'feedback'
      ? '产品内零散反馈'
      : '访问审计日志（访问/提问/反馈）';
  const lines = items.map((item, index) => `#${index + 1} (id=${item.id})\n${item.text}`);
  return `请归纳以下 ${items.length} 条${kind}。${scopeFocus(scope)}
条目编号为 #1…#${items.length}；ids 请填这些编号数字（1 起步，不是数据库 id）。

${lines.join('\n\n')}`;
}

function flattenModelText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flattenModelText).join('');
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    if (typeof item.text === 'string') return item.text;
    if (typeof item.content === 'string') return item.content;
  }
  return '';
}

export function extractCompletionText(raw: string): string {
  try {
    const payload = JSON.parse(raw) as {
      choices?: Array<{
        text?: unknown;
        message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown };
      }>;
    };
    const choice = payload.choices?.[0];
    const message = choice?.message;
    const content = flattenModelText(message?.content ?? choice?.text);
    const reasoning = flattenModelText(message?.reasoning_content ?? message?.reasoning);
    return `${content}\n${reasoning}`.trim();
  } catch {
    return raw.trim();
  }
}

/** Parse model themes; map 1-based indexes to counts. Stable against junk output. */
export function parseSummarizeThemes(rawText: string, itemCount: number): SummarizeTheme[] {
  const jsonText = unwrapModelJson(rawText);
  if (!jsonText) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const themesRaw = (parsed as { themes?: unknown }).themes;
  if (!Array.isArray(themesRaw)) return [];

  const out: SummarizeTheme[] = [];
  for (const row of themesRaw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const title = String((row as { title?: unknown }).title ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
    if (!title) continue;

    const idsRaw = (row as { ids?: unknown; count?: unknown }).ids;
    let count = 0;
    if (Array.isArray(idsRaw)) {
      const seen = new Set<number>();
      for (const value of idsRaw) {
        const n = typeof value === 'number' ? value : Number(String(value).replace(/^#/, ''));
        if (!Number.isFinite(n)) continue;
        const idx = Math.trunc(n);
        if (idx < 1 || idx > itemCount || seen.has(idx)) continue;
        seen.add(idx);
      }
      count = seen.size;
    } else {
      const fallback = Number((row as { count?: unknown }).count);
      if (Number.isFinite(fallback) && fallback > 0) count = Math.min(itemCount, Math.trunc(fallback));
    }
    if (count <= 0) continue;
    out.push({ title, count });
    if (out.length >= MAX_THEMES) break;
  }

  out.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, 'zh'));
  return out.slice(0, MAX_THEMES);
}

export function formatSummaryStamp(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

export async function runAdminSummarize(scope: AdminSummarizeScope): Promise<AdminSummaryRecord> {
  if (!llmConfigured()) throw new Error('LLM 未配置');
  const items = await loadItemsForScope(scope);
  if (!items.length) {
    throw new Error(
      scope === 'survey' ? '暂无调研结果可归纳'
        : scope === 'feedback' ? '暂无反馈可归纳'
          : '暂无审计记录可归纳',
    );
  }

  const fingerprint = fingerprintItems(items);
  const userPrompt = buildSummarizeUserPrompt(scope, items);
  const timeoutMs = Number(process.env.LLM_ADMIN_SUMMARIZE_TIMEOUT_MS ?? 90_000);

  const themes = await withLlmSlot(async () => {
    const response = await fetchChatCompletions(
      {
        temperature: 0.2,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: ADMIN_SUMMARIZE_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      },
      { timeoutMs },
    );
    const raw = await response.text();
    if (!response.ok) throw new Error(formatLlmHttpError(response.status, raw));
    const text = extractCompletionText(raw);
    const parsed = parseSummarizeThemes(text, items.length);
    if (parsed.length < MIN_THEMES) throw new Error('模型输出无法解析为主题');
    return parsed;
  });

  const record: AdminSummaryRecord = {
    scope,
    basedOnCount: items.length,
    fingerprint,
    generatedAt: new Date().toISOString(),
    themes,
  };
  saveAdminSummary(record);
  return record;
}

export async function getAdminSummarizeStatus(scope: AdminSummarizeScope) {
  const items = await loadItemsForScope(scope);
  const fingerprint = fingerprintItems(items);
  const summary = loadAdminSummary(scope);
  const hasNewData = Boolean(
    summary
    && (summary.basedOnCount !== items.length || summary.fingerprint !== fingerprint),
  );
  return {
    summary,
    currentCount: items.length,
    currentFingerprint: fingerprint,
    hasNewData,
  };
}

export function summarizeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return formatLlmCallError(error);
}
