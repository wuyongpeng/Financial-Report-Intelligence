/**
 * Compact middle-pane overview for chat/voice prompts.
 * Mirrors what the user sees (四核心 · 指标联动 · 深度归因要点), not PDF RAG alone.
 */
import {
  attributionConclusion,
  format,
  labels,
  metricNames,
  priorYear,
  profitBridge,
  resolveMetricPrior,
  value,
  type Metric,
  type MetricName,
  type Report,
} from './detail-model';
import { resolveYoy } from './crawl-display';
import {
  buildMetricRelationships,
  METRIC_REL_EMPTY,
  RELATION_DATA_LABEL,
  RELATION_TAKE_LABEL,
  type MetricRelationshipsResult,
} from './metric-relationships';
import type { ReportVerdict } from './report-verdict';
import type {
  RetrievalMetric,
  RetrievalReport,
} from '@/modules/retrieval/domain/retrieval';

export type OverviewCite = {
  page: number;
  quote: string;
  metric?: string;
};

export type OverviewCiteTag = (cite: OverviewCite) => string;

const MAX_CHARS = 2200;
const MAX_ATTRIBUTION_MODULES = 3;
const MAX_MODULE_CHARS = 120;

function clip(text: string, max: number) {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

/** Map retrieval rows into the detail-model Report shape used by overview builders. */
export function reportFromRetrieval(
  report: RetrievalReport,
  metrics: RetrievalMetric[],
): Report {
  const rows: Metric[] = metrics
    .filter((m) => m.reportId === report.id)
    .map((m) => ({
      metric: m.metric as MetricName,
      value: m.value,
      unit: m.unit,
      source_page: m.sourcePage,
      source_label: m.sourceLabel,
      confidence: 1,
      verified: 0,
      period: m.period,
      prior_value: m.priorValue ?? null,
      yoy_pct: m.yoyPct ?? null,
    }));
  return {
    id: report.id,
    code: report.code,
    company_name: report.companyName,
    title: report.title,
    report_type: report.reportType,
    published_at: report.publishedAt,
    parsed_at: null,
    industry: report.industry || '待分类',
    status: 'online',
    metrics: rows,
  };
}

function tagFor(
  citeTag: OverviewCiteTag | undefined,
  page: number | null | undefined,
  quote: string,
  metric?: string,
) {
  if (page == null || !citeTag) return '';
  return citeTag({ page, quote, metric }) || '';
}

function formatFourCore(
  report: Report,
  previous: Report | null | undefined,
  citeTag?: OverviewCiteTag,
): string[] {
  const lines: string[] = [];
  const baselinePeriod = previous
    ? (previous.metrics[0]?.period || previous.title)
    : '上年同期（披露列）';
  for (const name of metricNames) {
    const current = value(report, name);
    if (current === undefined) continue;
    const row = report.metrics.find((m) => m.metric === name);
    const crossPrior = value(previous ?? undefined, name);
    const yoy = resolveYoy(current, {
      disclosedPrior: row?.prior_value,
      disclosedYoyPct: row?.yoy_pct,
      crossReportPrior: crossPrior,
    });
    const priorVal = resolveMetricPrior(current, {
      disclosedPrior: row?.prior_value,
      disclosedYoyPct: row?.yoy_pct,
      crossReportPrior: crossPrior,
    });
    const cite = tagFor(
      citeTag,
      row?.source_page,
      row?.source_label ?? labels[name],
      name,
    );
    const yoyBit = yoy ? `，同比 ${yoy.label}` : '';
    const priorBit = priorVal !== undefined
      ? `；对比期 ${baselinePeriod} ${format(priorVal, name)}`
      : '';
    lines.push(`- ${labels[name]}：${format(current, name)}${yoyBit}${priorBit}${cite}`);
  }
  return lines;
}

function formatMetricLinkage(
  result: MetricRelationshipsResult,
  citeTag?: OverviewCiteTag,
): string[] {
  if (result.status === 'insufficient') {
    return [`（${METRIC_REL_EMPTY.insufficient}）`];
  }
  if (result.status === 'checked_none') {
    return [`（${METRIC_REL_EMPTY.checked_none}）`];
  }
  return result.cards.map((card) => {
    const data = card.numbers.length
      ? card.numbers.map((n) => {
        const cite = card.cites.find((c) => c.metric === n.metric && c.page === n.page)
          ?? card.cites.find((c) => c.page === n.page)
          ?? (n.page != null ? { page: n.page, quote: n.label, metric: n.metric } : null);
        const tag = cite
          ? tagFor(citeTag, cite.page, cite.quote, cite.metric)
          : '';
        return `${n.label} ${n.valueText}${tag}`;
      }).join(' · ')
      : card.facts.join(' ');
    return `- ${card.title}｜${RELATION_DATA_LABEL} ${data}｜${RELATION_TAKE_LABEL} ${card.howToRead}`;
  });
}

function formatDepthAttribution(
  report: Report,
  previous: Report | null | undefined,
  verdict: Pick<ReportVerdict, 'verdict' | 'modules'> | null | undefined,
): string[] {
  const lines: string[] = [];
  if (verdict?.verdict?.label) {
    lines.push(`- 速览：${verdict.verdict.label}。${clip(verdict.verdict.summary || '', 160)}`);
  }
  const revenue = value(report, 'revenue');
  const profit = value(report, 'net_profit');
  const pr = value(previous ?? undefined, 'revenue');
  const pp = value(previous ?? undefined, 'net_profit');
  if (
    revenue !== undefined && profit !== undefined
    && pr !== undefined && pp !== undefined
  ) {
    const bridge = profitBridge(revenue, profit, pr, pp);
    if (bridge) lines.push(`- 利润桥：${attributionConclusion(bridge)}`);
  }
  const modules = (verdict?.modules ?? [])
    .filter((m) => m.conclusion?.trim())
    .slice(0, MAX_ATTRIBUTION_MODULES);
  for (const mod of modules) {
    const title = mod.title || mod.id;
    lines.push(`- ${title}：${clip(mod.conclusion.trim(), MAX_MODULE_CHARS)}`);
  }
  return lines;
}

/**
 * Build the compact「页面概览快照」block shown in structuredContext.
 * citeTag should return 【E#】 when the page is registered as evidence.
 */
export function formatOverviewSnapshot(input: {
  report: Report;
  previous?: Report | null;
  verdict?: Pick<ReportVerdict, 'verdict' | 'modules'> | null;
  citeTag?: OverviewCiteTag;
  relationships?: MetricRelationshipsResult;
}): string {
  const previous = input.previous ?? null;
  const relationships = input.relationships
    ?? buildMetricRelationships(input.report, {
      previous,
      preferDisclosedYoy: true,
    });
  const sections: string[] = [
    '页面概览快照（与中间栏用户所见一致；问「指标联动 / 盖栏 / 概览 / 这些数据」时优先依据本节，勿只搜 PDF 原文；不下投资建议）：',
  ];

  const core = formatFourCore(input.report, previous, input.citeTag);
  if (core.length) {
    sections.push('【四核心】');
    sections.push(...core);
  }

  sections.push('【指标联动】');
  sections.push(...formatMetricLinkage(relationships, input.citeTag));

  const depth = formatDepthAttribution(input.report, previous, input.verdict);
  if (depth.length) {
    sections.push('【深度归因要点】');
    sections.push(...depth);
  }

  return clip(sections.join('\n'), MAX_CHARS);
}

/** Pick prior-year comparable report from a same-company history list. */
export function pickOverviewBaseline(current: Report, history: Report[]): Report | null {
  return priorYear(history.concat(current), current) ?? null;
}
