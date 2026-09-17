import type { Citation } from './detail-model';

export const VERDICT_LABELS = [
  '稳健增长',
  '增长加速',
  '盈利改善',
  '业绩承压',
  '增收不增利',
  '盈利能力下降',
  '经营分化',
  '表现平稳',
] as const;

export const CHANGE_TYPES = ['收入', '盈利', '成本费用', '现金流', '资产负债', '其他'] as const;
export const CHANGE_DIRECTIONS = ['利好', '利空', '中性', '风险'] as const;
export const MODULE_IDS = ['business', 'attribution', 'anomalies', 'history', 'peers'] as const;

export type VerdictLabel = (typeof VERDICT_LABELS)[number];
export type ChangeType = (typeof CHANGE_TYPES)[number];
export type ChangeDirection = (typeof CHANGE_DIRECTIONS)[number];
export type ModuleId = (typeof MODULE_IDS)[number];
export type VerdictTone = 'up' | 'mid' | 'down';

export type VerdictChange = {
  type: ChangeType;
  direction: ChangeDirection;
  title: string;
  description: string;
  sourceRef: Citation[];
};

export type ModuleConclusion = {
  id: ModuleId;
  conclusion: string;
  sourceRef: Citation[];
};

export type ReportVerdict = {
  verdict: { label: VerdictLabel; summary: string };
  changes: VerdictChange[];
  modules: ModuleConclusion[];
};

const LABEL_SET = new Set<string>(VERDICT_LABELS);
const TYPE_SET = new Set<string>(CHANGE_TYPES);
const DIRECTION_SET = new Set<string>(CHANGE_DIRECTIONS);
const MODULE_SET = new Set<string>(MODULE_IDS);

export const VERDICT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'changes', 'modules'],
  properties: {
    verdict: {
      type: 'object',
      additionalProperties: false,
      required: ['label', 'summary'],
      properties: {
        label: { type: 'string', enum: [...VERDICT_LABELS] },
        summary: { type: 'string' },
      },
    },
    changes: {
      type: 'array',
      minItems: 0,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'direction', 'title', 'description', 'sourceRef'],
        properties: {
          type: { type: 'string', enum: [...CHANGE_TYPES] },
          direction: { type: 'string', enum: [...CHANGE_DIRECTIONS] },
          title: { type: 'string' },
          description: { type: 'string' },
          sourceRef: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    },
    modules: {
      type: 'array',
      minItems: 0,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'conclusion', 'sourceRef'],
        properties: {
          id: { type: 'string', enum: [...MODULE_IDS] },
          conclusion: { type: 'string' },
          sourceRef: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    },
  },
} as const;

export function verdictTone(label: VerdictLabel): VerdictTone {
  if (label === '稳健增长' || label === '增长加速' || label === '盈利改善') return 'up';
  if (label === '表现平稳' || label === '经营分化') return 'mid';
  return 'down';
}

export function changeTone(direction: ChangeDirection): 'up' | 'down' | 'warn' | 'mid' {
  if (direction === '利好') return 'up';
  if (direction === '利空') return 'down';
  if (direction === '风险') return 'warn';
  return 'mid';
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function evidenceId(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id.trim();
  return '';
}

function resolveSourceRef(raw: unknown, evidence: Citation[]) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const item of raw) {
    const id = evidenceId(item);
    if (!id || seen.has(id)) continue;
    const hit = evidence.find((entry) => entry.id === id);
    if (!hit) continue;
    seen.add(id);
    out.push(hit);
  }
  return out;
}

function parseChange(raw: unknown, evidence: Citation[]): VerdictChange | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const type = asText(row.type);
  const direction = asText(row.direction);
  const title = asText(row.title);
  const description = asText(row.description);
  if (!TYPE_SET.has(type) || !DIRECTION_SET.has(direction) || !title || !description) return null;
  const sourceRef = resolveSourceRef(row.sourceRef, evidence);
  if (!sourceRef.length) return null;
  return {
    type: type as ChangeType,
    direction: direction as ChangeDirection,
    title,
    description,
    sourceRef,
  };
}

function hasConcreteNumber(text: string) {
  return /\d/.test(text);
}

function parseModule(raw: unknown, evidence: Citation[], seen: Set<string>): ModuleConclusion | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = asText(row.id);
  const conclusion = asText(row.conclusion);
  if (!MODULE_SET.has(id) || seen.has(id) || !conclusion || !hasConcreteNumber(conclusion)) return null;
  const sourceRef = resolveSourceRef(row.sourceRef, evidence);
  if (!sourceRef.length) return null;
  seen.add(id);
  return { id: id as ModuleId, conclusion, sourceRef };
}

/** Strict object validation. Invalid verdict fields fail the whole payload; invalid changes/modules are dropped. */
export function parseReportVerdict(raw: unknown, evidence: Citation[]): ReportVerdict | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const payload = raw as Record<string, unknown>;
  const verdictRaw = payload.verdict;
  if (!verdictRaw || typeof verdictRaw !== 'object' || Array.isArray(verdictRaw)) return null;
  const verdict = verdictRaw as Record<string, unknown>;
  const label = asText(verdict.label);
  const summary = asText(verdict.summary);
  if (!LABEL_SET.has(label) || !summary) return null;
  const rows = Array.isArray(payload.changes) ? payload.changes : [];
  const changes: VerdictChange[] = [];
  for (const row of rows) {
    const parsed = parseChange(row, evidence);
    if (parsed) changes.push(parsed);
    if (changes.length === 3) break;
  }
  const moduleRows = Array.isArray(payload.modules) ? payload.modules : [];
  const modules: ModuleConclusion[] = [];
  const seen = new Set<string>();
  for (const row of moduleRows) {
    const parsed = parseModule(row, evidence, seen);
    if (parsed) modules.push(parsed);
  }
  return { verdict: { label: label as VerdictLabel, summary }, changes, modules };
}

/** Parse model output as JSON only. No fence stripping or free-text repair. */
export function parseReportVerdictJson(text: string, evidence: Citation[]): ReportVerdict | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return parseReportVerdict(JSON.parse(trimmed) as unknown, evidence);
  } catch {
    return null;
  }
}

function hydrateSourceRef(raw: unknown, evidence: Citation[]): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const item = raw as Record<string, unknown>;
  const refs = Array.isArray(item.sourceRef) ? item.sourceRef : [];
  const ids = refs.map((ref, index) => {
    if (typeof ref === 'string') return ref.trim();
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return '';
    const citation = ref as Record<string, unknown>;
    const page = typeof citation.page === 'number' ? citation.page : Number(citation.page);
    if (!Number.isFinite(page)) return '';
    const id = asText(citation.id) || `src-${evidence.length}-${index}`;
    evidence.push({
      id,
      reportId: asText(citation.reportId) || undefined,
      companyName: asText(citation.companyName) || undefined,
      period: asText(citation.period) || undefined,
      page,
      quote: asText(citation.quote),
      code: asText(citation.code) || undefined,
    });
    return id;
  });
  return { ...item, sourceRef: ids };
}

/** Accept either model-style sourceRef ids or hydrated citation objects from the API. */
export function acceptVerdictPayload(raw: unknown): ReportVerdict | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const payload = raw as Record<string, unknown>;
  const evidence: Citation[] = [];
  const changes = (Array.isArray(payload.changes) ? payload.changes : []).map((row) => hydrateSourceRef(row, evidence));
  const modules = (Array.isArray(payload.modules) ? payload.modules : []).map((row) => hydrateSourceRef(row, evidence));
  return parseReportVerdict({ verdict: payload.verdict, changes, modules }, evidence);
}

export function followupFromTitle(title: string) {
  const text = title.trim();
  if (!text) return '';
  if (/现金流/.test(text) && /承压|下降|下滑|减少|恶化/.test(text)) return '经营现金流为什么下降？';
  if (/下降|下滑|减少|恶化|收窄/.test(text)) return `${text}的主要原因是什么？`;
  return `${text}的主要原因是什么？`;
}

export function followupQuestions(changes: Array<{ title: string }>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const change of changes) {
    const question = followupFromTitle(change.title);
    if (!question || seen.has(question)) continue;
    seen.add(question);
    out.push(question);
    if (out.length === 3) break;
  }
  return out;
}

export function followupFromModule(id: ModuleId) {
  if (id === 'business') return '本期主营业务构成有哪些变化？请引用原文。';
  if (id === 'attribution') return '归母净利润变化的主要原因是什么？请引用原文。';
  if (id === 'anomalies') return '本期哪些指标波动最大？原因是什么？';
  if (id === 'history') return '近几期营收和净利怎么走？';
  if (id === 'peers') return '和已覆盖同行比，我们处在什么位置？';
  return '';
}

/** Prefer change-specific questions; fill remaining slots from modules that actually have conclusions. */
export function targetedFollowups(changes: Array<{ title: string }>, modules: Array<{ id: ModuleId }> = []) {
  const out = followupQuestions(changes);
  const seen = new Set(out);
  for (const module of modules) {
    if (out.length >= 3) break;
    const question = followupFromModule(module.id);
    if (!question || seen.has(question)) continue;
    seen.add(question);
    out.push(question);
  }
  return out;
}
