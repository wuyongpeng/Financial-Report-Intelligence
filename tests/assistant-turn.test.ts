import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { parseAssistantTurn, requestAssistantTurn, type AssistantTurn } from '../lib/assistant-turn';
import { assistantTurnSystemPrompt, resolveAssistantTurn } from '../lib/assistant-turn-server';
import { decideDirectAnswer } from '../modules/retrieval/application/answer-policy';
import { planQuestion } from '../modules/retrieval/application/question-planner';

function configureModel(t: TestContext) {
  const keys = ['LLM_BASE_URL', 'LLM_MODEL', 'LLM_MODELS', 'LLM_PROVIDERS'] as const;
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.LLM_BASE_URL = 'http://semantic.test/v1'; process.env.LLM_MODEL = 'semantic-contract';
  delete process.env.LLM_MODELS; delete process.env.LLM_PROVIDERS;
  t.after(() => { for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; } });
}

test('semantic JSON is a strict UI whitelist, never arbitrary navigation or submit tools', () => {
  assert.deepEqual(parseAssistantTurn({ kind: 'conversation', answer: '好的，随时问我。' }), { kind: 'conversation', answer: '好的，随时问我。' });
  for (const value of [null, [], { kind: 'open_url', url: '/000001' }, { kind: 'feedback', action: { type: 'submit_feedback', draft: '我觉得不方便' } },
    { kind: 'feedback', action: { type: 'open_feedback', category: '其它', draft: '我希望更方便', url: 'https://example.test' } },
    { kind: 'conversation', answer: '营收81.24亿元' }, { kind: 'conversation', answer: '不用谢【E1】' }, { kind: 'conversation', answer: '已打开', action: { type: 'open_feedback' } }]) {
    assert.deepEqual(parseAssistantTurn(value), { kind: 'domain' });
  }
});

test('model transport receives recent context for varied intents; fixtures test contract, not live model accuracy', async (t) => {
  configureModel(t);
  const cases: Array<[string, AssistantTurn]> = [
    ['啊，知道了', { kind: 'conversation', answer: '好的，有问题再问我。' }],
    ['这个我明白了', { kind: 'conversation', answer: '嗯，那我们接着看。' }],
    ['谢谢', { kind: 'conversation', answer: '不客气。' }],
    ['你可以怎么帮我', { kind: 'conversation', answer: '我可以帮你理解财报、解释指标和核对原文。' }],
    ['我觉得现在这个排版不好看，怎么办', { kind: 'feedback', action: { type: 'open_feedback', category: '体验问题', draft: '我觉得当前详情页的排版不太好看，希望改善阅读体验。' } }],
    ['一缩放按钮就把正文挡住了', { kind: 'feedback', action: { type: 'open_feedback', category: '体验问题', draft: '我缩放页面后发现按钮挡住正文，希望调整显示。' } }],
    ['希望以后也能看港股报告', { kind: 'feedback', action: { type: 'open_feedback', category: '功能建议', draft: '我希望以后也能查看港股报告。' } }],
    ['没法导出对比结果，想提个建议', { kind: 'feedback', action: { type: 'open_feedback', category: '功能建议', draft: '我希望能导出对比结果。' } }],
    ['这里的数据可能对不上，我想反馈核实', { kind: 'feedback', action: { type: 'open_feedback', category: '数据不准', draft: '我怀疑这里显示的数据可能不一致，希望核实。' } }],
    ['刚才那个数字似乎取错了列，帮我反馈一下', { kind: 'feedback', action: { type: 'open_feedback', category: '数据不准', draft: '我怀疑刚才的数据可能取错了列，希望核实。' } }],
    ['知道了，那营收呢', { kind: 'domain' }],
    ['这个数据怎么算的', { kind: 'domain' }],
    ['这个数据是真的吗', { kind: 'domain' }],
    ['它和刚才的口径是不是不一样', { kind: 'domain' }],
    ['这个数有点奇怪，能核对吗', { kind: 'domain' }],
  ];
  const history = [{ role: 'user' as const, content: '营业收入是多少' }, { role: 'assistant' as const, content: '刚才讨论了营收口径。' }];
  let expected: AssistantTurn = { kind: 'domain' };
  const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  const fetch = t.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ choices: [{ message: { content: JSON.stringify(expected) } }] });
  });
  for (const surface of ['home', 'report'] as const) for (const [question, reply] of cases) {
    expected = reply;
    assert.deepEqual(await resolveAssistantTurn({ question, history, surface }, new AbortController().signal), reply);
    const prompt = JSON.parse(requests.at(-1)!.messages[1].content);
    assert.equal(prompt.current, question);
    assert.deepEqual(prompt.recent, history);
  }
  assert.equal(fetch.mock.callCount(), cases.length * 2, 'one semantic call, no extra answer call for conversation/feedback');
});

test('invalid model JSON, HTTP failure and cancelled requests fail closed to domain', async (t) => {
  configureModel(t);
  const input = { question: '这个是真的吗', surface: 'report' as const, history: [] };
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: { content: 'not json' } }] }));
  assert.deepEqual(await resolveAssistantTurn(input, new AbortController().signal), { kind: 'domain' });
  fetch.mock.mockImplementation(async () => new Response('', { status: 400 }));
  assert.deepEqual(await resolveAssistantTurn(input, new AbortController().signal), { kind: 'domain' });
  const abort = new AbortController(); abort.abort();
  const count = fetch.mock.callCount();
  assert.deepEqual(await resolveAssistantTurn(input, abort.signal), { kind: 'domain' });
  assert.equal(fetch.mock.callCount(), count);
});

test('in-flight semantic inference is aborted upstream, not allowed to return a late action', async (t) => {
  configureModel(t);
  let started = () => {};
  const ready = new Promise<void>(resolve => { started = resolve; });
  let observed: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    observed = init?.signal as AbortSignal;
    started();
    return new Promise<Response>((_resolve, reject) => observed!.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
  });
  const controller = new AbortController();
  const pending = resolveAssistantTurn({ question: '我希望更方便', history: [], surface: 'report' }, controller.signal);
  await ready;
  controller.abort();
  assert.deepEqual(await pending, { kind: 'domain' });
  assert.equal(observed?.aborted, true);
});

test('a late classified feedback response cannot escape client cancellation', async (t) => {
  const abort = new AbortController();
  t.mock.method(globalThis, 'fetch', async () => {
    abort.abort();
    return Response.json({ kind: 'feedback', action: { type: 'open_feedback', category: '数据不准', draft: '我怀疑数据不一致，希望核实。' } });
  });
  await assert.rejects(requestAssistantTurn({ question: '我想反馈', history: [], surface: 'report' }, abort.signal));
});

test('financial evidence gates remain unchanged, including follow-up calculations and authenticity checks', () => {
  for (const question of ['知道了，那营收呢', '这个数据怎么算的', '这个数据是真的吗']) {
    const plan = planQuestion({ question, history: [{ role: 'user', content: '营业收入是多少' }], currentCode: '000001', watched: [] });
    const direct = decideDirectAnswer({ plan, currentReportId: 'report-a', metrics: [], factLines: [], passages: [], calculations: [] });
    assert.match(direct.directAnswer ?? '', /暂无法回答/);
  }
  const prompt = assistantTurnSystemPrompt('report');
  assert.ok(prompt.includes('混合消息只要包含新的财报追问即domain'));
  assert.ok(prompt.includes('模糊质疑也是domain'));
  assert.ok(prompt.includes('不能写成已确认错误'));
  assert.ok(prompt.includes('用户必须亲自确认发送'));
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
test('semantic pass precedes report focus/retrieval; stale same-report completion cannot navigate or speak', () => {
  const detail = source('../app/company-detail.tsx');
  const ask = detail.slice(detail.indexOf('  async function ask('));
  assert.ok(ask.indexOf('await requestAssistantTurn') < ask.indexOf('// Explicit clips'));
  assert.ok(ask.indexOf('await requestAssistantTurn') < ask.indexOf("fetch('/api/chat'"));
  assert.ok(ask.includes('requestRef.current === controller && activeId.current === id'));
  assert.ok(ask.includes('requestFeedbackDraft(turn.action, ownsTurn)'));
  assert.ok(detail.includes('revealVoiceCitation(citeTarget, true)'));
  assert.ok(detail.includes('revealVoiceCitation(voiceJumpHint, true)'));
  assert.ok(detail.includes('if (requestRef.current === controller && voiceSpeakRef.current)'));
  assert.ok(detail.includes('if (requestRef.current !== controller) return;'));
  assert.ok(detail.includes('c.reportId !== activeId.current && !allowCrossReport'));
  assert.ok(detail.includes('voiceGenRef.current += 1;\n      stopVoiceSession();'));
  const home = source('../app/report-home.tsx');
  const submit = home.slice(home.indexOf('  async function submitHomeSearch('));
  assert.ok(submit.indexOf('await requestAssistantTurn') < submit.indexOf('const commitMatchedVoiceSearch'));
  assert.ok(submit.includes('assertHomeVoiceTurn(turn)'));
  assert.ok(home.includes('isFeedbackDrawerOpen()'));
  assert.ok(!detail.includes('voiceCapabilitySpeech()') && !home.includes('homeGreetingNudge()'));
});
