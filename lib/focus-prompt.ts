import { ApiError } from './api';

export type FocusKind = 'pdf' | 'text' | 'finding' | 'metric';
export type FocusItem = { kind: FocusKind; text: string; page?: number; title?: string };

export const FOCUS_MAX_ITEMS = 8;
export const FOCUS_QUOTE_MAX = 600;
export const QUESTION_MAX = 2000;
const KINDS = new Set<FocusKind>(['pdf', 'text', 'finding', 'metric']);

function clipQuote(text: string, max = FOCUS_QUOTE_MAX) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Validate client focus array; truncate oversize quotes instead of 400. */
export function parseFocus(raw: unknown): FocusItem[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ApiError(400, 'focus 必须为数组');
  if (raw.length > FOCUS_MAX_ITEMS) throw new ApiError(400, `focus 最多 ${FOCUS_MAX_ITEMS} 项`);
  const out: FocusItem[] = [];
  for (const [i, item] of raw.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ApiError(400, `focus[${i}] 格式错误`);
    const row = item as Record<string, unknown>;
    const kind = row.kind;
    if (typeof kind !== 'string' || !KINDS.has(kind as FocusKind)) throw new ApiError(400, `focus[${i}].kind 无效`);
    if (typeof row.text !== 'string' || !row.text.trim()) throw new ApiError(400, `focus[${i}].text 不能为空`);
    const text = clipQuote(row.text, FOCUS_QUOTE_MAX);
    if (text.length < 2) throw new ApiError(400, `focus[${i}].text 过短`);
    const next: FocusItem = { kind: kind as FocusKind, text };
    if (row.page !== undefined) {
      if (typeof row.page !== 'number' || !Number.isInteger(row.page) || row.page < 1 || row.page > 10_000) {
        throw new ApiError(400, `focus[${i}].page 无效`);
      }
      next.page = row.page;
    }
    if (row.title !== undefined) {
      if (typeof row.title !== 'string') throw new ApiError(400, `focus[${i}].title 无效`);
      const title = clipQuote(row.title, 80);
      if (title) next.title = title;
    }
    out.push(next);
  }
  return out;
}

function quoteList(items: string[]) {
  return items.map(q => `“${q}”`).join('、');
}

function labelOf(item: FocusItem) {
  if (item.title) return `${item.title}：${item.text}`;
  return item.text;
}

/** Build the model-facing user turn with Chinese frames. */
export function assembleFocusPrompt(question: string, focus: FocusItem[]) {
  const typed = question.trim();
  const pdf = focus.filter(f => f.kind === 'pdf' || f.kind === 'text').map(f => f.text);
  const brief = focus.filter(f => f.kind === 'finding' || f.kind === 'metric').map(labelOf);
  const frames: string[] = [];
  if (pdf.length) frames.push(`用户在财报pdf中圈定并关注的信息有${quoteList(pdf)}。`);
  if (brief.length) frames.push(`用户从概览中关注的要点有${quoteList(brief)}。`);
  if (!frames.length) return typed;
  const head = frames.join('');
  if (typed && typed !== '怎么看待这些数据') return `${head}${typed}`;
  return `${head}怎么看待这些数据`;
}

/** Visible chat bubble text — never mutate the typed question with attach notices. */
export function displayFocusPrompt(question: string, focus: FocusItem[]) {
  return question.trim() || (focus.length ? '怎么看待这些数据' : '');
}

/** Quiet badge copy for user-selected clips only (not auto page soft-merge). */
export function focusAttachNote(focus: FocusItem[]) {
  if (!focus.length) return '';
  const pdf = focus.filter(f => f.kind === 'pdf' || f.kind === 'text').length;
  const brief = focus.filter(f => f.kind === 'finding' || f.kind === 'metric').length;
  const bits = [
    pdf ? `${pdf} 段原文` : '',
    brief ? `${brief} 条概览` : '',
  ].filter(Boolean);
  return `已带上 ${bits.join(' + ') || `${focus.length} 项关注`}`;
}

/** Short block for structuredContext so RAG treats focus as evidence. */
export function focusContextBlock(focus: FocusItem[]) {
  if (!focus.length) return '';
  return [
    '本轮附带的阅读摘录（优先参考，仍须与库内原文核对）：',
    ...focus.map((f, i) => {
      const where = f.kind === 'pdf' || f.kind === 'text'
        ? (f.page ? `财报原文第${f.page}页` : '财报原文')
        : (f.kind === 'finding' ? '概览·关键发现' : '概览·核心指标');
      return `${i + 1}. [${where}] ${labelOf(f)}`;
    }),
  ].join('\n');
}
