import assert from 'node:assert/strict';
import test from 'node:test';
import { parseChatRequest } from '../contracts/chat';
import { ApiError } from '../lib/api';
import { modelMessages } from '../lib/answer';
import { selectPinnedProviders, type LlmProvider } from '../lib/llm-providers';
import { addManualMemory, applyMemoryPatch, explicitMemoryText, memoryPrompt, parseMemoryPatch, rememberExplicit, selectMemories } from '../lib/reader-memory';
import { MEMORY_REFLECT_PROMPT } from '../lib/reader-memory-reflect';
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
    autoModel: true,
    modelId: 'auto',
    welcome: false,
    speechRate: 1,
    memory: true,
  });
  assert.equal(normalizeReaderPrefs({ modelId: 'thudm/glm-5.2' }).autoModel, false);
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

test('reader memory stores durable facts, not a log of each question', () => {
  const asked = rememberExplicit({ notes: [] }, '营收为什么下降', '2026-01-01T00:00:00.000Z');
  assert.deepEqual(asked.notes, []);
  const saved = rememberExplicit(asked, '记住我以后要简短回答', '2026-01-02T00:00:00.000Z');
  assert.equal(saved.notes.length, 1);
  assert.equal(saved.notes[0]?.source, 'saved');
  assert.match(saved.notes[0]?.text ?? '', /简短/);
  const manual = addManualMemory(saved, '长期看贵州茅台', '2026-01-03T00:00:00.000Z');
  const inferred = applyMemoryPatch(manual, { action: 'save', text: '回答时先说变化原因' }, '2026-01-04T00:00:00.000Z');
  const replaced = applyMemoryPatch(inferred, { action: 'save', text: '回答时先说现金流', replaces: inferred.notes[0]?.id }, '2026-01-05T00:00:00.000Z');
  assert.equal(replaced.notes.filter((note) => note.text.includes('变化原因')).length, 0);
  assert.ok(replaced.notes.some((note) => note.text === '回答时先说现金流'));
  assert.equal(explicitMemoryText('营收为什么下降'), null);
  assert.equal(explicitMemoryText('我主要关注经营现金流'), '经营现金流');
  assert.equal(explicitMemoryText('我主要关注这期扣非为什么下降'), null);
  assert.equal(explicitMemoryText('回答简短一点'), '简短一点');
  assert.equal(explicitMemoryText('以后默认用亿元'), '用亿元');
  assert.equal(parseMemoryPatch({ action: 'save', text: '营收为什么下降？' }), null);
  assert.deepEqual(parseMemoryPatch({ action: 'none' }), { action: 'none' });
  const visible = selectMemories(replaced, '贵州茅台的现金流怎么样');
  assert.ok(visible.some((note) => note.text === '长期看贵州茅台'));
  assert.ok(visible.every((note) => note.source === 'saved'));
  assert.ok(visible.every((note) => !note.text.includes('现金流')));
  assert.match(memoryPrompt(replaced, '今天天气怎么样'), /简短/);
  assert.doesNotMatch(memoryPrompt(replaced, '今天天气怎么样'), /现金流/);
  assert.equal(memoryPrompt({ notes: [] }), '');
  assert.match(MEMORY_REFLECT_PROMPT, /不是聊天日志/);
  assert.match(MEMORY_REFLECT_PROMPT, /单次财报问题/);
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
