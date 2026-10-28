import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyQuestionScope,
  hasFinanceSignal,
  historyForModel,
  isAnaphoricFollowUp,
  isClearOffTopicQuestion,
  isDisposablePriorQuestion,
  isReportEntityQuestion,
  isMetaModelQuestion,
  planQuestion,
  retrievalQuestion,
} from '../modules/retrieval/application/question-planner';
import { ensureSoftScopeFooter, outOfScopeReply, SOFT_SCOPE_FOOTER } from '../modules/retrieval/application/answer-policy';

test('meta-model phrasings are detected without false-positive on 估值模型 alone when not asking which LLM', () => {
  assert.equal(isMetaModelQuestion('当前用的哪个大语言模型'), true);
  assert.equal(isMetaModelQuestion('你用的什么模型'), true);
  assert.equal(isMetaModelQuestion('是GPT还是Claude'), true);
  assert.equal(isMetaModelQuestion('营业收入是多少'), false);
});

test('weather and chitchat are clear off-topic', () => {
  assert.equal(isClearOffTopicQuestion('北京明天啥天气'), true);
  assert.equal(isClearOffTopicQuestion('今天天气如何'), true);
  assert.equal(isClearOffTopicQuestion('你是谁'), false);
  assert.equal(isClearOffTopicQuestion('长期应付职工薪酬为什么是空的'), false);
});

test('finance signal keeps report questions in scope', () => {
  assert.equal(hasFinanceSignal('长期应付职工薪酬为什么是空的'), true);
  assert.equal(hasFinanceSignal('北京明天啥天气'), false);
});

test('classifyQuestionScope + outOfScopeReply cover meta, weather, and finance control', () => {
  const meta = classifyQuestionScope({
    originalQuestion: '当前用的哪个大语言模型',
    retrievalQuestion: '当前用的哪个大语言模型',
    metricNames: [],
    explicitPage: null,
  });
  assert.deepEqual(meta, { outOfScope: true, outOfScopeKind: 'meta-model' });

  const identity = classifyQuestionScope({
    originalQuestion: '你是谁',
    retrievalQuestion: '你是谁',
    metricNames: [],
    explicitPage: null,
  });
  assert.deepEqual(identity, { outOfScope: true, outOfScopeKind: 'identity' });
  assert.equal(outOfScopeReply('identity'), '我是 Eva，你的财报智能分析助手。');

  const weather = classifyQuestionScope({
    originalQuestion: '北京明天啥天气',
    retrievalQuestion: '北京明天啥天气',
    metricNames: [],
    explicitPage: null,
  });
  assert.equal(weather.outOfScope, false);
  assert.equal(weather.softScopeHint, true);

  const finance = classifyQuestionScope({
    originalQuestion: '营业收入数值是多少？',
    retrievalQuestion: '营业收入数值是多少？',
    metricNames: ['revenue'],
    explicitPage: null,
  });
  assert.equal(finance.outOfScope, false);

  const keys = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_MODELS', 'LLM_PROVIDERS'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.LLM_BASE_URL = 'https://api.example.com/v1';
    process.env.LLM_MODEL = 'thudm/glm-5.2';
    delete process.env.LLM_MODELS;
    delete process.env.LLM_PROVIDERS;
    const reply = outOfScopeReply('meta-model');
    assert.match(reply, /thudm\/glm-5\.2/);
    assert.doesNotMatch(reply, /尚未完成 AI 归纳|每股收益|ROE/);
    assert.equal(outOfScopeReply('off-topic'), SOFT_SCOPE_FOOTER);
    assert.match(ensureSoftScopeFooter('北京明天多云。'), /北京明天多云。[\s\S]*超出当前财报范围/);
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  const inScope = planQuestion({
    question: '营业收入数值是多少？',
    history: [],
    watched: [],
    currentCode: '000333',
  });
  assert.equal(inScope.outOfScope, false);
  assert.equal(inScope.wantsStructuredValue, true);
});

test('茅台学院是什么意思 stays in-scope for page-text retrieval', () => {
  assert.equal(isReportEntityQuestion('茅台学院是什么意思'), true);
  assert.equal(isReportEntityQuestion('北京明天啥天气'), false);
  const plan = planQuestion({ question: '茅台学院是什么意思', history: [], watched: [], currentCode: '600519' });
  assert.equal(plan.outOfScope, false);
  assert.deepEqual(plan.metricNames, []);
  assert.equal(plan.wantsStructuredValue, false);
});

test('这个季度业绩好不好 is self-contained — does not prepend prior meta ask', () => {
  const history = [
    { role: 'user' as const, content: '当前用的哪个大语言模型' },
    { role: 'assistant' as const, content: '我是财报智析 Eva。当前问答使用的模型是 thudm/glm-5.2。' },
  ];
  const q = '分析一下这个季度业绩到底好不好？';
  assert.equal(isAnaphoricFollowUp(q), false);
  assert.equal(retrievalQuestion(q, history), q);
  assert.equal(isDisposablePriorQuestion('当前用的哪个大语言模型'), true);
  const filtered = historyForModel(history);
  assert.equal(filtered.length, 0);
});

test('short anaphoric follow-ups still merge prior finance topic', () => {
  const history = [
    { role: 'user' as const, content: '净利润为什么下降？' },
    { role: 'assistant' as const, content: '需要查看经营原因。' },
  ];
  assert.equal(isAnaphoricFollowUp('具体原因呢？'), true);
  assert.match(retrievalQuestion('具体原因呢？', history), /净利润为什么下降/);
  assert.equal(retrievalQuestion('营业收入是多少？', history), '营业收入是多少？');
});

test('单位是多少 after a report ask is anaphoric in-scope — never hard OOS', () => {
  const history = [
    { role: 'user' as const, content: '星宇股份的劳务支出费用是多少' },
    { role: 'assistant' as const, content: '报告披露劳务外包约若干万元。' },
  ];
  assert.equal(isAnaphoricFollowUp('单位是多少'), true);
  assert.equal(isAnaphoricFollowUp('哪一页'), true);
  assert.equal(isAnaphoricFollowUp('什么意思'), true);
  const merged = retrievalQuestion('单位是多少', history);
  assert.match(merged, /劳务支出费用是多少/);
  assert.match(merged, /当前追问：单位是多少/);
  const plan = planQuestion({
    question: '单位是多少',
    history,
    watched: [],
    currentCode: '601799',
  });
  assert.equal(plan.outOfScope, false);
  assert.equal(Boolean(plan.softScopeHint), false);
  assert.match(plan.retrievalQuestion, /劳务支出/);
});

test('weather is soft-scope — not hard refuse-only', () => {
  const plan = planQuestion({
    question: '北京明天啥天气',
    history: [],
    watched: [],
    currentCode: '000333',
  });
  assert.equal(plan.outOfScope, false);
  assert.equal(plan.softScopeHint, true);
  assert.equal(isClearOffTopicQuestion('北京明天啥天气'), true);
});

test('missing finance lexicon alone does not force soft-scope footer', () => {
  // Not clear off-topic, no metric/page/finance hit — still normal RAG, no footer.
  const unknown = classifyQuestionScope({
    originalQuestion: '尼诺对本公司有何影响',
    retrievalQuestion: '尼诺对本公司有何影响',
    metricNames: [],
    explicitPage: null,
  });
  assert.equal(unknown.outOfScope, false);
  assert.equal(Boolean(unknown.softScopeHint), false);
  assert.equal(isClearOffTopicQuestion('尼诺对本公司有何影响'), false);

  const plan = planQuestion({
    question: '高铁怎么买票',
    history: [],
    watched: [],
    currentCode: '000333',
  });
  assert.equal(plan.outOfScope, false);
  assert.equal(Boolean(plan.softScopeHint), false);
  assert.equal(isClearOffTopicQuestion('高铁怎么买票'), false);
});
