import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyQuestionScope,
  hasFinanceSignal,
  isClearOffTopicQuestion,
  isReportEntityQuestion,
  isMetaModelQuestion,
  planQuestion,
} from '../modules/retrieval/application/question-planner';
import { outOfScopeReply } from '../modules/retrieval/application/answer-policy';

test('meta-model phrasings are detected without false-positive on 估值模型 alone when not asking which LLM', () => {
  assert.equal(isMetaModelQuestion('当前用的哪个大语言模型'), true);
  assert.equal(isMetaModelQuestion('你用的什么模型'), true);
  assert.equal(isMetaModelQuestion('是GPT还是Claude'), true);
  assert.equal(isMetaModelQuestion('营业收入是多少'), false);
});

test('weather and chitchat are clear off-topic', () => {
  assert.equal(isClearOffTopicQuestion('北京明天啥天气'), true);
  assert.equal(isClearOffTopicQuestion('今天天气如何'), true);
  assert.equal(isClearOffTopicQuestion('你是谁'), true);
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

  const weather = classifyQuestionScope({
    originalQuestion: '北京明天啥天气',
    retrievalQuestion: '北京明天啥天气',
    metricNames: [],
    explicitPage: null,
  });
  assert.deepEqual(weather, { outOfScope: true, outOfScopeKind: 'off-topic' });

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
    assert.match(outOfScopeReply('off-topic'), /超出当前财报范围/);
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
