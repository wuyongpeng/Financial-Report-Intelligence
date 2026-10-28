import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatOverviewSnapshot,
  pickOverviewBaseline,
  reportFromRetrieval,
} from '../lib/overview-snapshot';
import type { MetricName, Report } from '../lib/detail-model';
import type { RetrievalMetric, RetrievalReport } from '../modules/retrieval/domain/retrieval';
import { retrieveContext } from '../modules/retrieval/application/retrieve-context';
import { KeywordPassageRetriever } from '../modules/retrieval/application/keyword-passage-retriever';
import type { RetrievalRepository } from '../modules/retrieval/domain/retrieval-repository';
import type { RetrievalChunk, WatchedCompany } from '../modules/retrieval/domain/retrieval';
import { modelMessages } from '../lib/answer';

function metric(
  name: MetricName,
  value: number,
  page = 6,
  extra: Partial<{ prior_value: number; yoy_pct: number; period: string }> = {},
) {
  return {
    metric: name,
    value,
    unit: name === 'roe' || name === 'eps' ? (name === 'roe' ? '%' : '元') : '元',
    source_page: page,
    source_label: name,
    confidence: 0.9,
    verified: 0,
    period: extra.period ?? '2026FY',
    prior_value: extra.prior_value,
    yoy_pct: extra.yoy_pct,
  };
}

function buildReport(period: string, extra: ReturnType<typeof metric>[] = []): Report {
  return {
    id: period,
    code: '600000',
    company_name: '示例银行',
    title: `${period}年度报告`,
    report_type: 'annual',
    published_at: `${period.slice(0, 4)}-04-01`,
    parsed_at: '2026-01-01',
    industry: '银行',
    status: 'online',
    metrics: extra.map((m) => ({ ...m, period })),
  };
}

test('formatOverviewSnapshot includes 四核心 and 指标联动 with cite tags', () => {
  const current = buildReport('2026FY', [
    metric('revenue', 1.2e10, 5, { prior_value: 1e10, yoy_pct: 20 }),
    metric('net_profit', 8e8, 10, { prior_value: 1e9, yoy_pct: -20 }),
    metric('eps', 0.8, 11, { prior_value: 1.0, yoy_pct: -20 }),
    metric('roe', 9.5, 12, { prior_value: 11, yoy_pct: -1.5 }),
    metric('operating_cash_flow', 4e8, 20),
  ]);
  const previous = buildReport('2025FY', [
    metric('revenue', 1e10, 5),
    metric('net_profit', 1e9, 10),
    metric('operating_cash_flow', 9e8, 20),
  ]);
  let cites = 0;
  const text = formatOverviewSnapshot({
    report: current,
    previous,
    verdict: {
      verdict: { label: '增收不增利', summary: '收入升、利润降，需核对费用与减值。' },
      modules: [
        { id: 'attribution', title: '利润归因', conclusion: '利润下滑主要来自净利率走弱。', sourceRef: [] },
      ],
    },
    citeTag: () => {
      cites += 1;
      return `【E${cites}】`;
    },
  });
  assert.match(text, /页面概览快照/);
  assert.match(text, /【四核心】/);
  assert.match(text, /营业收入/);
  assert.match(text, /【指标联动】/);
  assert.match(text, /数据/);
  assert.match(text, /提示/);
  assert.match(text, /【深度归因要点】/);
  assert.match(text, /增收不增利/);
  assert.match(text, /【E\d+】/);
  assert.ok(cites >= 1);
  assert.ok([...text].length <= 2200);
});

test('reportFromRetrieval + pickOverviewBaseline choose prior year', () => {
  const currentRep: RetrievalReport = {
    id: 'cur', code: '600000', companyName: '示例', industry: '银行',
    reportType: 'annual', title: '2026年年度报告', publishedAt: '2026-04-01T00:00:00.000Z',
  };
  const priorRep: RetrievalReport = {
    id: 'pri', code: '600000', companyName: '示例', industry: '银行',
    reportType: 'annual', title: '2025年年度报告', publishedAt: '2025-04-01T00:00:00.000Z',
  };
  const metrics: RetrievalMetric[] = [
    { reportId: 'cur', metric: 'revenue', value: 100, unit: '元', period: '2026FY', sourcePage: 1, sourceLabel: '营收' },
    { reportId: 'pri', metric: 'revenue', value: 80, unit: '元', period: '2025FY', sourcePage: 1, sourceLabel: '营收' },
  ];
  const cur = reportFromRetrieval(currentRep, metrics);
  const pri = reportFromRetrieval(priorRep, metrics);
  const baseline = pickOverviewBaseline(cur, [pri]);
  assert.equal(baseline?.id, 'pri');
});

class FakeRetrievalRepository implements RetrievalRepository {
  report: RetrievalReport | null = {
    id: 'current', code: '000333', companyName: '美的集团', industry: '家电', reportType: 'annual',
    title: '美的集团2026年年度报告', publishedAt: '2026-03-01T00:00:00.000Z',
  };
  metrics: RetrievalMetric[] = [
    {
      reportId: 'current', metric: 'revenue', value: 1.2e11, unit: '元', period: '2026FY',
      sourcePage: 8, sourceLabel: '营业收入', priorValue: 1e11, yoyPct: 20,
    },
    {
      reportId: 'current', metric: 'net_profit', value: 8e9, unit: '元', period: '2026FY',
      sourcePage: 10, sourceLabel: '归母净利润', priorValue: 1e10, yoyPct: -20,
    },
    {
      reportId: 'current', metric: 'operating_cash_flow', value: 5e9, unit: '元', period: '2026FY',
      sourcePage: 20, sourceLabel: '经营现金流',
    },
    {
      reportId: 'prior', metric: 'revenue', value: 1e11, unit: '元', period: '2025FY',
      sourcePage: 8, sourceLabel: '营业收入',
    },
    {
      reportId: 'prior', metric: 'net_profit', value: 1e10, unit: '元', period: '2025FY',
      sourcePage: 10, sourceLabel: '归母净利润',
    },
  ];
  watched: WatchedCompany[] = [{ code: '000333', companyName: '美的集团' }];
  history: RetrievalReport[] = [{
    id: 'prior', code: '000333', companyName: '美的集团', industry: '家电', reportType: 'annual',
    title: '美的集团2025年年度报告', publishedAt: '2025-03-01T00:00:00.000Z',
  }];
  namedPeers: RetrievalReport[] = [];
  industryPeers: RetrievalReport[] = [];
  chunks: RetrievalChunk[] = [
    { reportId: 'current', page: 8, content: '营业收入1200亿元。' },
  ];
  async findReport() { return this.report; }
  async findMetrics(ids: string[]) { return this.metrics.filter(m => ids.includes(m.reportId)); }
  async listWatchedCompanies() { return this.watched; }
  async findCompanyHistory() { return this.history; }
  async findNamedPeerReports() { return this.namedPeers; }
  async findIndustryPeerReports() { return this.industryPeers; }
  async findChunks(ids: string[]) { return this.chunks.filter(c => ids.includes(c.reportId)); }
}

test('retrieveContext always embeds 指标联动 overview snapshot for normal asks', async () => {
  const repo = new FakeRetrievalRepository();
  const ctx = await retrieveContext({
    reportId: 'current',
    question: '中间盖栏页的指标联动数据是什么意思？',
    history: [],
    repository: repo,
    passageRetriever: new KeywordPassageRetriever(),
    loadOverviewVerdict: async () => ({
      verdict: { label: '增收不增利', summary: '收入升利润降。' },
      changes: [],
      modules: [],
    }),
  });
  assert.match(ctx.structuredContext, /页面概览快照/);
  assert.match(ctx.structuredContext, /【指标联动】/);
  assert.match(ctx.structuredContext, /【四核心】/);
  assert.match(ctx.structuredContext, /营业收入/);
  // Evidence registered from overview cites so model can ground 【E#】.
  assert.ok(ctx.evidence.some(e => e.page === 8 || e.page === 10));

  const messages = modelMessages(ctx, []);
  const user = messages.find(m => m.role === 'user')?.content ?? '';
  const system = messages.find(m => m.role === 'system')?.content ?? '';
  assert.match(user, /页面概览快照/);
  assert.match(user, /指标联动/);
  assert.match(system, /页面概览快照/);
});

test('retrieveContext still embeds overview on bare metric ask (always-on)', async () => {
  const repo = new FakeRetrievalRepository();
  const ctx = await retrieveContext({
    reportId: 'current',
    question: '营业收入多少？',
    history: [],
    repository: repo,
    passageRetriever: new KeywordPassageRetriever(),
  });
  assert.match(ctx.structuredContext, /页面概览快照/);
  assert.match(ctx.structuredContext, /【指标联动】/);
});
