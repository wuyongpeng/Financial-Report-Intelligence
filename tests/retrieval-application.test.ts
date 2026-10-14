import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../lib/api';
import { retrieveContext } from '../modules/retrieval/application/retrieve-context';
import { KeywordPassageRetriever } from '../modules/retrieval/application/keyword-passage-retriever';
import { planQuestion } from '../modules/retrieval/application/question-planner';
import type { RetrievalRepository } from '../modules/retrieval/domain/retrieval-repository';
import type {
  RetrievalChunk,
  RetrievalMetric,
  RetrievalReport,
  WatchedCompany,
} from '../modules/retrieval/domain/retrieval';

class FakeRetrievalRepository implements RetrievalRepository {
  report: RetrievalReport | null = {
    id: 'current', code: '000333', companyName: '美的集团', industry: '家电', reportType: 'annual',
    title: '美的集团2025年年度报告', publishedAt: '2026-03-01T00:00:00.000Z',
  };
  metrics: RetrievalMetric[] = [
    { reportId: 'current', metric: 'revenue', value: 100, unit: '元', period: 'wrong', sourcePage: 8, sourceLabel: '营业收入' },
  ];
  watched: WatchedCompany[] = [
    { code: '000333', companyName: '美的集团' },
    { code: '000651', companyName: '格力电器' },
  ];
  history: RetrievalReport[] = [];
  namedPeers: RetrievalReport[] = [];
  industryPeers: RetrievalReport[] = [];
  chunks: RetrievalChunk[] = [
    { reportId: 'current', page: 8, content: '营业收入为100元。' },
    { reportId: 'current', page: 9, content: '管理层讨论与分析：营业收入变化主要来自产品结构调整。' },
  ];
  calls: string[] = [];

  async findReport() { this.calls.push('report'); return this.report; }
  async findMetrics(ids: string[]) { this.calls.push(`metrics:${ids.join(',')}`); return this.metrics.filter(metric => ids.includes(metric.reportId)); }
  async listWatchedCompanies() { this.calls.push('watched'); return this.watched; }
  async findCompanyHistory() { this.calls.push('history'); return this.history; }
  async findNamedPeerReports() { this.calls.push('named-peers'); return this.namedPeers; }
  async findIndustryPeerReports() { this.calls.push('industry-peers'); return this.industryPeers; }
  async findChunks(ids: string[]) { this.calls.push(`chunks:${ids.join(',')}`); return this.chunks.filter(chunk => ids.includes(chunk.reportId)); }
}

test('QuestionPlanner produces an explicit, testable retrieval plan', () => {
  const plan = planQuestion({
    question: '和格力相比，今年营业收入怎么样？',
    history: [],
    watched: [
      { code: '000333', companyName: '美的集团' },
      { code: '000651', companyName: '格力电器' },
    ],
    currentCode: '000333',
  });
  assert.deepEqual(plan.metricNames, ['revenue']);
  assert.equal(plan.needsHistory, true);
  assert.equal(plan.needsPeers, true);
  assert.deepEqual(plan.namedPeerCodes, ['000651']);
  assert.equal(plan.wantsStructuredValue, false);

  const direct = planQuestion({ question: '营业收入数值是多少？', history: [], watched: [], currentCode: '000333' });
  assert.equal(direct.wantsStructuredValue, true);
  assert.equal(direct.needsPeers, false);
  assert.equal(direct.outOfScope, false);

  const page = planQuestion({ question: '第 25 页讲了什么？', history: [], watched: [], currentCode: '000333' });
  assert.equal(page.explicitPage, 25);
  const blocked = planQuestion({ question: '预测明天股价', history: [], watched: [], currentCode: '000333' });
  assert.equal(blocked.outOfScope, true);
});

test('KeywordPassageRetriever keeps current metric-page ranking and excerpt behavior', () => {
  const retriever = new KeywordPassageRetriever();
  const ranked = retriever.retrieve({
    query: '营业收入为什么变化',
    chunks: [
      { reportId: 'r', page: 8, content: '营业收入100元。' },
      { reportId: 'r', page: 9, content: '管理层讨论与分析：营业收入变化主要来自结构调整。' },
    ],
    metricPages: [8],
    limit: 2,
  });
  assert.equal(ranked[0].page, 8);
  const long = `${'无关内容'.repeat(600)}营业收入变动原因是产品结构调整。${'尾部'.repeat(600)}`;
  assert.match(retriever.excerpt('营业收入变动原因', long, 160), /营业收入/);
});

test('retrieveContext routes structured values without model-dependent behavior', async () => {
  const repository = new FakeRetrievalRepository();
  let observed = false;
  const context = await retrieveContext({
    reportId: 'current',
    question: '营业收入数值是多少？',
    history: [],
    repository,
    passageRetriever: new KeywordPassageRetriever(),
    observeTarget: async () => { observed = true; },
  });
  assert.equal(observed, true);
  assert.equal(context.mode, 'structured-query');
  assert.match(context.directAnswer ?? '', /美的集团 2025FY 营业收入：100元/);
  assert.equal(context.metrics[0].period, '2025FY');
  assert.deepEqual(context.evidence.map(item => item.id), ['E1', 'E2', 'E3']);
  assert.deepEqual(repository.calls, ['report', 'metrics:current', 'watched', 'metrics:', 'chunks:current']);
});

test('retrieveContext loads history and named/industry peers according to the plan', async () => {
  const repository = new FakeRetrievalRepository();
  repository.history = [{
    id: 'prior', code: '000333', companyName: '美的集团', industry: '家电', reportType: 'annual',
    title: '美的集团2024年年度报告', publishedAt: '2025-03-01T00:00:00.000Z',
  }];
  repository.namedPeers = [{
    id: 'peer', code: '000651', companyName: '格力电器', industry: '家电', reportType: 'annual',
    title: '格力电器2025年年度报告', publishedAt: '2026-03-01T00:00:00.000Z',
  }];
  repository.metrics.push(
    { reportId: 'prior', metric: 'revenue', value: 80, unit: '元', period: '2024FY', sourcePage: 8, sourceLabel: '营业收入' },
    { reportId: 'peer', metric: 'revenue', value: 90, unit: '元', period: '2025FY', sourcePage: 8, sourceLabel: '营业收入' },
  );
  const context = await retrieveContext({
    reportId: 'current', question: '和格力相比，今年营业收入怎么样？', history: [],
    repository, passageRetriever: new KeywordPassageRetriever(),
  });
  assert.ok(repository.calls.includes('history'));
  assert.ok(repository.calls.includes('named-peers'));
  assert.ok(repository.calls.includes('industry-peers'));
  assert.deepEqual(context.peers, [{ code: '000651', company_name: '格力电器' }]);
  assert.match(context.structuredContext, /同公司跨期 1 份/);
});

test('retrieveContext preserves out-of-scope and insufficient-evidence policies', async () => {
  const repository = new FakeRetrievalRepository();
  const blocked = await retrieveContext({
    reportId: 'current', question: '预测明天股价', history: [], repository,
    passageRetriever: new KeywordPassageRetriever(),
  });
  assert.equal(blocked.mode, 'out-of-scope');
  assert.match(blocked.directAnswer ?? '', /不提供投资建议/);

  const missing = new FakeRetrievalRepository();
  missing.report = null;
  await assert.rejects(
    retrieveContext({ reportId: 'missing', question: '营收多少', history: [], repository: missing, passageRetriever: new KeywordPassageRetriever() }),
    (error: unknown) => error instanceof ApiError && error.status === 404,
  );
});
