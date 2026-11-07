import assert from 'node:assert/strict';
import test from 'node:test';
import { parseChatRequest } from '../contracts/chat';
import { ApiError } from '../lib/api';
import { modelMessages } from '../lib/answer';
import { selectPinnedProviders, type LlmProvider } from '../lib/llm-providers';
import {
  normalizeReaderPrefs,
  readingLevelInstruction,
  snapSpeechRate,
} from '../lib/reader-prefs';

const providers: LlmProvider[] = [
  { id: 'primary', baseUrl: 'http://llm.test/v1', model: 'glm-a' },
  { id: 'thudm/glm-5.2', baseUrl: 'http://llm.test/v1', model: 'thudm/glm-5.2' },
];

test('reader prefs default to beginner, auto, no welcome, and memory on', () => {
  assert.deepEqual(normalizeReaderPrefs(null), {
    readingLevel: 'beginner',
    modelId: 'auto',
    welcome: false,
    speechRate: 1,
    memory: true,
  });
  assert.equal(normalizeReaderPrefs({ welcome: true, memory: false, readingLevel: 'professional', modelId: 'thudm/glm-5.2' }).welcome, true);
  assert.equal(normalizeReaderPrefs({ memory: false }).memory, false);
  assert.equal(normalizeReaderPrefs({ modelId: 'not a model' }).modelId, 'auto');
  assert.equal(snapSpeechRate(1.2), 1.15);
});

test('reading levels change the prompt without dropping the citation rule', () => {
  assert.match(readingLevelInstruction('beginner', false), /术语/);
  assert.match(readingLevelInstruction('professional', false), /证据编号/);
  assert.match(readingLevelInstruction('beginner', true), /半句/);
  const context = {
    question: 'ROE 是多少',
    structuredContext: '无',
    passages: [],
    evidence: [],
    industry: '银行',
    softScopeHint: false,
    directAnswer: undefined,
    mode: 'evidence-retrieval',
    metrics: [],
    peers: [],
    fallback: '原文',
  };
  const beginner = modelMessages(context, [], { readingLevel: 'beginner' });
  const professional = modelMessages(context, [], { readingLevel: 'professional' });
  const untouched = modelMessages(context, []);
  assert.match(beginner[0].content, /解读档位：入门/);
  assert.match(beginner[0].content, /二级Skill·银行/);
  assert.match(professional[0].content, /解读档位：专业/);
  assert.doesNotMatch(professional[0].content, /二级Skill/);
  assert.doesNotMatch(untouched[0].content, /解读档位/);
});

test('a pinned model is used alone; an unknown id keeps failover', () => {
  assert.deepEqual(selectPinnedProviders(providers, 'thudm/glm-5.2')?.map((item) => item.id), ['thudm/glm-5.2']);
  assert.equal(selectPinnedProviders(providers, 'auto'), null);
  assert.equal(selectPinnedProviders(providers, 'missing'), null);
});

test('chat accepts a reading level and rejects an unknown one', () => {
  const parsed = parseChatRequest({
    reportId: 'report-1',
    question: '营业收入是多少',
    readingLevel: 'intermediate',
    modelId: 'thudm/glm-5.2',
  });
  assert.equal(parsed.readingLevel, 'intermediate');
  assert.equal(parsed.modelId, 'thudm/glm-5.2');
  assert.equal(parseChatRequest({ reportId: 'report-1', question: '营业收入是多少', modelId: 'auto' }).modelId, undefined);
  assert.throws(
    () => parseChatRequest({ reportId: 'report-1', question: '营业收入是多少', readingLevel: 'expert' }),
    (error: unknown) => error instanceof ApiError && error.status === 400,
  );
});
