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
  assert.equal(blocked.outOfScopeKind, 'investment');

  const meta = planQuestion({ question: '当前用的哪个大语言模型', history: [], watched: [], currentCode: '000333' });
  assert.equal(meta.outOfScope, true);
  assert.equal(meta.outOfScopeKind, 'meta-model');
  assert.equal(meta.needsHistory, false);
  assert.equal(meta.needsPeers, false);

  const weather = planQuestion({ question: '北京明天啥天气', history: [], watched: [], currentCode: '000333' });
  assert.equal(weather.outOfScope, false);
  assert.equal(weather.softScopeHint, true);

  const followup = planQuestion({
    question: '为什么是空的',
    history: [{ role: 'user', content: '这一页的长期应付职工薪酬为什么是空的' }],
    watched: [],
    currentCode: '000333',
  });
  assert.equal(followup.outOfScope, false);
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
  repository.metrics = [
    { reportId: 'current', metric: 'revenue', value: 100, unit: '元', period: '2025FY', sourcePage: 8, sourceLabel: '营业收入' },
    { reportId: 'current', metric: 'eps', value: 0.7, unit: '元/股', period: '2025FY', sourcePage: 30, sourceLabel: '每股收益' },
    { reportId: 'current', metric: 'net_profit', value: 10, unit: '元', period: '2025FY', sourcePage: 2, sourceLabel: '归母净利润' },
    { reportId: 'current', metric: 'roe', value: 12, unit: '%', period: '2025FY', sourcePage: 2, sourceLabel: 'ROE' },
  ];
  const blocked = await retrieveContext({
    reportId: 'current', question: '预测明天股价', history: [], repository,
    passageRetriever: new KeywordPassageRetriever(),
  });
  assert.equal(blocked.mode, 'out-of-scope');
  assert.match(blocked.directAnswer ?? '', /不提供投资建议/);
  assert.doesNotMatch(blocked.directAnswer ?? '', /尚未完成 AI 归纳|每股收益|ROE|营业收入/);
  assert.equal(blocked.fallback, blocked.directAnswer);
  assert.deepEqual(blocked.metrics, []);

  const meta = await retrieveContext({
    reportId: 'current', question: '当前用的哪个大语言模型', history: [], repository,
    passageRetriever: new KeywordPassageRetriever(),
  });
  assert.equal(meta.mode, 'out-of-scope');
  assert.match(meta.directAnswer ?? '', /财报智析 Eva/);
  assert.doesNotMatch(meta.directAnswer ?? '', /尚未完成 AI 归纳|每股收益|ROE|归母净利润|营业收入/);
  assert.equal(meta.fallback, meta.directAnswer);

  const weather = await retrieveContext({
    reportId: 'current', question: '北京明天啥天气', history: [], repository,
    passageRetriever: new KeywordPassageRetriever(),
  });
  assert.equal(weather.softScopeHint, true);
  assert.notEqual(weather.mode, 'out-of-scope');
  assert.equal(weather.directAnswer, undefined);
  assert.doesNotMatch(weather.fallback ?? '', /请换一个关于本期业绩/);

  const unitFollow = await retrieveContext({
    reportId: 'current',
    question: '单位是多少',
    history: [
      { role: 'user', content: '星宇股份的劳务支出费用是多少' },
      { role: 'assistant', content: '劳务外包支出见附注。' },
    ],
    repository,
    passageRetriever: new KeywordPassageRetriever(),
  });
  assert.equal(unitFollow.softScopeHint, false);
  assert.notEqual(unitFollow.mode, 'out-of-scope');
  assert.match(unitFollow.retrievalQuestion, /劳务支出/);

  const missing = new FakeRetrievalRepository();
  missing.report = null;
  await assert.rejects(
    retrieveContext({ reportId: 'missing', question: '营收多少', history: [], repository: missing, passageRetriever: new KeywordPassageRetriever() }),
    (error: unknown) => error instanceof ApiError && error.status === 404,
  );
});

test('营收是多少 scopes to current-report revenue only — no peer/KPI dump', async () => {
  const repository = new FakeRetrievalRepository();
  repository.metrics = [
    { reportId: 'current', metric: 'revenue', value: 90703260964.48, unit: '元', period: '2026H1', sourcePage: 2, sourceLabel: '营业收入' },
    { reportId: 'current', metric: 'net_profit', value: 44516880421.86, unit: '元', period: '2026H1', sourcePage: 2, sourceLabel: '归母净利润' },
    { reportId: 'current', metric: 'operating_cash_flow', value: 70690750119.06, unit: '元', period: '2026H1', sourcePage: 3, sourceLabel: '经营现金流净额' },
    { reportId: 'current', metric: 'total_assets', value: 309050784569.31, unit: '元', period: '2026H1', sourcePage: 4, sourceLabel: '资产总计' },
  ];
  repository.industryPeers = [{
    id: 'peer-fen', code: '600809', companyName: '山西汾酒', industry: '家电', reportType: 'semi',
    title: '山西汾酒2026年半年度报告', publishedAt: '2026-08-01T00:00:00.000Z',
  }];
  repository.metrics.push(
    { reportId: 'peer-fen', metric: 'revenue', value: 21044387808.34, unit: '元', period: '2026H1', sourcePage: 2, sourceLabel: '营业收入' },
    { reportId: 'peer-fen', metric: 'net_profit', value: 6439313574.11, unit: '元', period: '2026H1', sourcePage: 2, sourceLabel: '归母净利润' },
  );
  repository.report = {
    id: 'current', code: '600519', companyName: '贵州茅台', industry: '家电', reportType: 'semi',
    title: '贵州茅台2026年半年度报告', publishedAt: '2026-08-01T00:00:00.000Z',
  };
  repository.chunks = [
    { reportId: 'current', page: 2, content: '营业收入 90,703,260,964.48元。归母净利润 44,516,880,421.86元。' },
  ];

  const plan = planQuestion({ question: '营收是多少？', history: [], watched: repository.watched, currentCode: '600519' });
  assert.deepEqual(plan.metricNames, ['revenue']);
  assert.equal(plan.wantsStructuredValue, true);
  assert.equal(plan.needsPeers, false);
  assert.equal(plan.needsHistory, false);

  const context = await retrieveContext({
    reportId: 'current',
    question: '营收是多少？',
    history: [],
    repository,
    passageRetriever: new KeywordPassageRetriever(),
  });
  assert.equal(context.mode, 'structured-query');
  assert.match(context.directAnswer ?? '', /贵州茅台 2026H1 营业收入：90703260964\.48元【E1】/);
  assert.doesNotMatch(context.directAnswer ?? '', /归母净利润|经营现金流|资产总计|山西汾酒|五粮液/);
  assert.equal(context.peers.length, 0);
  assert.ok(context.evidence.some(e => e.page === 2 && /营业收入/.test(e.quote ?? '')));
  // Fallback must stay scoped if AI path later fails validation.
  assert.doesNotMatch(context.fallback, /山西汾酒|归母净利润：/);
});

test('茅台学院是什么意思 retrieves page text — no KPI dump lead-in', async () => {
  const repository = new FakeRetrievalRepository();
  repository.report = {
    id: 'current', code: '600519', companyName: '贵州茅台', industry: '白酒', reportType: 'annual',
    title: '贵州茅台2025年年度报告', publishedAt: '2026-03-01T00:00:00.000Z',
  };
  repository.metrics = [
    { reportId: 'current', metric: 'revenue', value: 90703260964.48, unit: '元', period: '2025FY', sourcePage: 2, sourceLabel: '营业收入' },
    { reportId: 'current', metric: 'net_profit', value: 44516, unit: '元', period: '2025FY', sourcePage: 2, sourceLabel: '归母净利润' },
    { reportId: 'current', metric: 'eps', value: 50, unit: '元/股', period: '2025FY', sourcePage: 30, sourceLabel: '每股收益' },
    { reportId: 'current', metric: 'roe', value: 30, unit: '%', period: '2025FY', sourcePage: 2, sourceLabel: 'ROE' },
  ];
  repository.chunks = [
    { reportId: 'current', page: 2, content: '营业收入907亿元，归母净利润445亿元，ROE 30%。' },
    { reportId: 'current', page: 88, content: '茅台学院是公司参与举办的应用型本科院校，培养酿酒与营销人才，本期捐赠支出见附注。' },
    { reportId: 'current', page: 89, content: '与茅台学院相关的产学研合作持续推进。' },
  ];

  const plan = planQuestion({ question: '茅台学院是什么意思', history: [], watched: [], currentCode: '600519' });
  assert.deepEqual(plan.metricNames, []);
  assert.equal(plan.wantsStructuredValue, false);
  assert.equal(plan.outOfScope, false);

  const context = await retrieveContext({
    reportId: 'current',
    question: '茅台学院是什么意思',
    history: [],
    repository,
    passageRetriever: new KeywordPassageRetriever(),
  });
  assert.equal(context.mode, 'evidence-retrieval');
  assert.equal(context.directAnswer, undefined);
  assert.ok(context.passages.some(p => /茅台学院/.test(p.content) || /茅台学院/.test(p.quote)));
  assert.ok(context.passages.some(p => p.page === 88 || p.page === 89));
  // Must not lead with overview KPIs in fallback / structured dump for this ask.
  assert.doesNotMatch(context.fallback, /贵州茅台 2025FY 营业收入/);
  assert.doesNotMatch(context.structuredContext, /贵州茅台 2025FY 营业收入：907/);
  assert.match(context.fallback, /茅台学院/);
});

test('soft-merged page text must not be used as the planner question', () => {
  // Documents the chat-route contract: assembleFocusPrompt is for display/LLM framing only.
  const polluted = '用户在财报pdf中圈定并关注的信息有“营业收入归母净利润经营现金流净额资产总计山西汾酒五粮液同比”。营收是多少？';
  const pollutedPlan = planQuestion({ question: polluted, history: [], watched: [
    { code: '600519', companyName: '贵州茅台' },
    { code: '600809', companyName: '山西汾酒' },
  ], currentCode: '600519' });
  assert.ok(pollutedPlan.metricNames.length > 1 || pollutedPlan.needsPeers || pollutedPlan.needsHistory,
    'polluted assembly would over-fetch — chat must plan on the typed question only');
  const clean = planQuestion({ question: '营收是多少？', history: [], watched: pollutedPlan.namedPeerCodes.length ? [] : [
    { code: '600519', companyName: '贵州茅台' },
    { code: '600809', companyName: '山西汾酒' },
  ], currentCode: '600519' });
  assert.deepEqual(clean.metricNames, ['revenue']);
  assert.equal(clean.needsPeers, false);
});
