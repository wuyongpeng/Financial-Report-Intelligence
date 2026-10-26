import type { Citation } from './detail-model';
import {
  FALLBACK_ATTRIBUTION_MODULES,
  isEmptyAttributionConclusion,
  selectDisplayAttributionModules,
  type AttributionModuleDef,
} from './industry-skills-ui';

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
/** @deprecated Prefer FALLBACK_MODULE_IDS / FALLBACK_ATTRIBUTION_MODULES */
export const MODULE_IDS = ['business', 'attribution', 'anomalies', 'history', 'peers'] as const;
export const FALLBACK_MODULE_IDS = MODULE_IDS;

export type VerdictLabel = (typeof VERDICT_LABELS)[number];
export type ChangeType = (typeof CHANGE_TYPES)[number];
export type ChangeDirection = (typeof CHANGE_DIRECTIONS)[number];
export type FallbackModuleId = (typeof FALLBACK_MODULE_IDS)[number];
/** Fallback five ids, or industry-skill dimension ids (e.g. volume). */
export type ModuleId = string;
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
  /** Present for industry-skill modules so UI can render without reloading the skill. */
  title?: string;
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
const FALLBACK_MODULE_SET = new Set<string>(FALLBACK_MODULE_IDS);
const MAX_MODULES = 8;

export function isFallbackModuleId(id: string): id is FallbackModuleId {
  return FALLBACK_MODULE_SET.has(id);
}

/** Accept industry ids like volume / inventory_capex; reject garbage. */
function isIndustryModuleId(id: string): boolean {
  return /^[a-z][a-z0-9_]{0,40}$/i.test(id) && !FALLBACK_MODULE_SET.has(id);
}

export function buildVerdictJsonSchema(moduleDefs?: AttributionModuleDef[] | null) {
  const industryMode = Boolean(moduleDefs?.length);
  const ids = industryMode ? moduleDefs!.map((m) => m.id) : [...FALLBACK_MODULE_IDS];
  const moduleRequired = industryMode ? (['id', 'title', 'conclusion', 'sourceRef'] as const) : (['id', 'conclusion', 'sourceRef'] as const);
  const moduleProps: Record<string, unknown> = {
    id: { type: 'string', enum: ids },
    conclusion: { type: 'string' },
    sourceRef: {
      type: 'array',
      items: { type: 'string' },
    },
  };
  if (industryMode) {
    moduleProps.title = { type: 'string', enum: moduleDefs!.map((m) => m.title) };
  } else {
    moduleProps.title = { type: 'string' };
  }
  return {
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
        maxItems: MAX_MODULES,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [...moduleRequired],
          properties: moduleProps,
        },
      },
    },
  } as const;
}

/** Default schema (fallback five). Prefer buildVerdictJsonSchema(industryModules) at generation time. */
export const VERDICT_JSON_SCHEMA = buildVerdictJsonSchema(null);

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

function bestEffortEvidence(conclusion: string, evidence: Citation[]): Citation[] {
  if (!evidence.length) return [];
  const digits = conclusion.match(/\d+(?:\.\d+)?%?/g) ?? [];
  for (const dig of digits) {
    const hit = evidence.find((entry) => entry.quote.includes(dig));
    if (hit) return [hit];
  }
  const keywords = ['营收', '收入', '毛利', '存货', '应收', '现金流', '销量', '售价', 'ASP', '费用', '研发', '地区', '产品'];
  for (const key of keywords) {
    if (!conclusion.includes(key)) continue;
    const hit = evidence.find((entry) => entry.quote.includes(key));
    if (hit) return [hit];
  }
  return [evidence[0]];
}

function parseModule(raw: unknown, evidence: Citation[], seen: Set<string>): ModuleConclusion | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = asText(row.id);
  const conclusion = asText(row.conclusion);
  const title = asText(row.title);
  const fallback = isFallbackModuleId(id);
  const industry = Boolean(title) && isIndustryModuleId(id);
  if ((!fallback && !industry) || seen.has(id) || !conclusion || !hasConcreteNumber(conclusion)) return null;
  let sourceRef = resolveSourceRef(row.sourceRef, evidence);
  // Prefer fill over empty UI: keep numeric conclusions even when the model omitted citations.
  if (!sourceRef.length) sourceRef = bestEffortEvidence(conclusion, evidence);
  if (!sourceRef.length) return null;
  seen.add(id);
  const out: ModuleConclusion = { id, conclusion, sourceRef };
  if (title) out.title = title;
  return out;
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
    if (modules.length >= MAX_MODULES) break;
  }
  return { verdict: { label: label as VerdictLabel, summary }, changes, modules };
}

/** Pull a JSON object out of think-tags / fences. Stored payloads still use parseReportVerdictJson. */
export function unwrapModelJson(text: string): string | null {
  const stripped = text
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '\n')
    .replace(/<think\b[^>]*>[\s\S]*$/gi, '\n')
    .trim();
  if (!stripped) return null;
  const unfenced = stripped.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const slices: string[] = [];
  if (unfenced.startsWith('{')) slices.push(unfenced);
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const inner = unfenced.slice(start, end + 1);
    if (inner !== slices[0]) slices.push(inner);
  }
  for (const item of slices) {
    try {
      const parsed = JSON.parse(item) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return item;
    } catch {
      /* next candidate */
    }
  }
  return null;
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


const MODULE_PIVOT_KEYWORDS: Record<string, string[]> = {
  volume: ['销量', '晶圆', '出货', '销售量', '交付'],
  price: ['平均售价', 'ASP', '售价', '单价', '吨价', '均价'],
  structure: ['地区', '产品', '分部', '结构', '占比', '应用', '尺寸', '海外', '内销'],
  gross_margin: ['毛利率', '毛利', '销售费用', '研发费用', '费用率'],
  inventory: ['存货', '跌价', '减值'],
  inventory_capex: ['存货', '跌价', '购建固定资产', '资本开支', '投资活动'],
  revenue_margin: ['营业收入', '营收', '毛利率', '毛利'],
  inventory_receivable: ['存货', '应收', '应收账款', '经营现金流'],
  expenses: ['管理费用', '研发费用', '销售费用', '费用', '经营现金流', '现金流'],
  d5: ['销量', '售价', '新品', '季节', '产品组合', '营收', '营业收入'],
  business: ['营收', '营业收入', '分部', '产品', '地区'],
  attribution: ['净利润', '归母', '净利'],
  anomalies: ['同比', '异常', '大幅'],
  history: ['同比', '营收', '净利润'],
  peers: ['同行', '行业', 'ROE'],
  revenue_profit: ['营业收入', '营收', '净利润', '归母'],
  gross_opex: ['毛利率', '毛利', '销售费用', '管理费用', '研发费用', '费用率'],
  rd_intensity: ['研发费用', '研发', '研发投入'],
  overseas: ['海外', '出口', '国外', '境外', '国际'],
  cash_conversion: ['经营现金流', '现金流', '经营活动'],
  inventory_quality: ['存货', '跌价', '减值'],
  capacity_capex: ['购建固定资产', '资本开支', '投资活动', '产能', '扩产'],
  channel_contract: ['合同负债', '预收', '经销', '渠道'],
  tax_oneoff: ['所得税', '政府补助', '投资收益', '非经常', '营业外'],
  guidance_outlook: ['预计', '展望', '指引', '下半年', '全年'],
};

function contextLinesWithNumbers(structuredContext: string): string[] {
  return structuredContext
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 8 && /\d/.test(line));
}

function pickContextSnippet(structuredContext: string, keywords: string[]): string {
  const lines = contextLinesWithNumbers(structuredContext);
  for (const key of keywords) {
    const hit = lines.find((line) => line.includes(key));
    if (hit) {
      // Drop trailing evidence tags like 【E1】 for cleaner prose.
      return hit.replace(/【E\d+】/g, '').replace(/（来自本份财报同比增减列）/g, '').trim().slice(0, 120);
    }
  }
  return lines[0]?.replace(/【E\d+】/g, '').trim().slice(0, 120) ?? '';
}

function synthesizeModuleConclusion(
  def: AttributionModuleDef,
  structuredContext: string,
): string | null {
  const keywords = MODULE_PIVOT_KEYWORDS[def.id]
    ?? MODULE_PIVOT_KEYWORDS[def.title]
    ?? [def.title, '营收', '营业收入', '毛利率'];
  const snippet = pickContextSnippet(structuredContext, keywords);
  if (!snippet || !hasConcreteNumber(snippet)) return null;
  const disclosed = keywords.some((key) => snippet.includes(key));
  if (disclosed) {
    return `${def.title}：${snippet}`;
  }
  return `未单独披露「${def.title}」明细，改用邻近已披露指标：${snippet}`;
}

/**
 * Fill missing dims from structured metrics across the full priority pool,
 * then keep ~5 display slots: prefer substantive primary; if all primary
 * empty/limited, fall back to filled secondary angles.
 */
export function ensureAttributionModules(
  verdict: ReportVerdict,
  moduleDefs: AttributionModuleDef[],
  opts: { structuredContext: string; evidence: Citation[] },
): ReportVerdict {
  if (!moduleDefs.length) return verdict;
  const byId = new Map(verdict.modules.map((row) => [row.id, row]));
  const filled: ModuleConclusion[] = [];
  for (const def of moduleDefs) {
    const existing = byId.get(def.id);
    if (
      existing?.conclusion
      && hasConcreteNumber(existing.conclusion)
      && !isEmptyAttributionConclusion(existing.conclusion)
    ) {
      filled.push({
        ...existing,
        title: existing.title || def.title,
        sourceRef: existing.sourceRef.length
          ? existing.sourceRef
          : bestEffortEvidence(existing.conclusion, opts.evidence),
      });
      continue;
    }
    const conclusion = synthesizeModuleConclusion(def, opts.structuredContext);
    if (!conclusion) continue;
    filled.push({
      id: def.id,
      title: def.title,
      conclusion,
      sourceRef: bestEffortEvidence(conclusion, opts.evidence),
    });
  }

  const displayDefs = selectDisplayAttributionModules(moduleDefs, filled, { maxDisplay: 5 });
  const byFilled = new Map(filled.map((row) => [row.id, row]));
  const preferred = displayDefs
    .map((def) => byFilled.get(def.id))
    .filter((row): row is ModuleConclusion => Boolean(row));

  if (preferred.length) {
    return { ...verdict, modules: preferred.slice(0, MAX_MODULES) };
  }
  return { ...verdict, modules: filled.slice(0, Math.min(5, MAX_MODULES)) };
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

export function followupFromModule(id: ModuleId, title?: string) {
  if (title) return `本期「${title}」有哪些值得关注的变化？请引用原文。`;
  if (id === 'business') return '本期主营业务构成有哪些变化？请引用原文。';
  if (id === 'attribution') return '归母净利润变化的主要原因是什么？请引用原文。';
  if (id === 'anomalies') return '本期哪些指标波动最大？原因是什么？';
  if (id === 'history') return '近几期营收和净利怎么走？';
  if (id === 'peers') return '和已覆盖同行比，我们处在什么位置？';
  return '';
}

/** Prefer change-specific questions; fill remaining slots from modules that actually have conclusions. */
export function targetedFollowups(
  changes: Array<{ title: string }>,
  modules: Array<{ id: ModuleId; title?: string }> = [],
) {
  const out = followupQuestions(changes);
  const seen = new Set(out);
  for (const item of modules) {
    if (out.length >= 3) break;
    const question = followupFromModule(item.id, item.title);
    if (!question || seen.has(question)) continue;
    seen.add(question);
    out.push(question);
  }
  return out;
}

export { FALLBACK_ATTRIBUTION_MODULES };
