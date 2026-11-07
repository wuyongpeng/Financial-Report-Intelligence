import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { requestFeedbackDraft, subscribeFeedbackDraft, publishFeedbackState, subscribeFeedbackState, isFeedbackDrawerOpen, preserveFeedbackDraft } from '../lib/feedback-draft-client';
import type { FeedbackDraftAction } from '../lib/assistant-turn';

function fakeWindow(t: TestContext) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const host = Object.assign(new EventTarget(), { location: { pathname: '/000001' } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: host });
  t.after(() => { publishFeedbackState(false); if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); });
  return host;
}
const action: FeedbackDraftAction = { type: 'open_feedback', category: '数据不准', draft: '我怀疑这处数据显示可能不一致，希望核实。' };

test('voice draft opens locally without sending and suspends voice until drawer closes', (t) => {
  fakeWindow(t);
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not submit'); });
  let received = '';
  const states: boolean[] = [];
  const unstate = subscribeFeedbackState(open => states.push(open));
  const unsub = subscribeFeedbackDraft(request => { received = request.action.draft; request.accepted = true; publishFeedbackState(true); });
  assert.equal(requestFeedbackDraft(action, () => true), true);
  assert.equal(received, action.draft);
  assert.equal(isFeedbackDrawerOpen(), true);
  publishFeedbackState(false);
  assert.equal(isFeedbackDrawerOpen(), false);
  assert.deepEqual(states, [true, false]);
  assert.equal(fetch.mock.callCount(), 0);
  unsub(); unstate();
});

test('obsolete turns, changed routes and listener cleanup cannot open drawers', (t) => {
  const host = fakeWindow(t);
  let count = 0;
  const unsub = subscribeFeedbackDraft(request => { count++; request.accepted = true; });
  assert.equal(requestFeedbackDraft(action, () => false), false);
  let checks = 0;
  assert.equal(requestFeedbackDraft(action, () => ++checks === 1), false, 'ownership is checked again by receiver');
  host.location.pathname = '/600519';
  assert.equal(requestFeedbackDraft(action, () => true), false);
  host.location.pathname = '/000001';
  unsub();
  assert.equal(requestFeedbackDraft(action, () => true), false);
  assert.equal(count, 0);
});

test('existing drafts, hand-edited text and intentionally cleared text are never overwritten', () => {
  assert.deepEqual(preserveFeedbackDraft({ text: '', edited: false }, action.draft), { text: action.draft, preserved: false });
  for (const current of [{ text: '我自己写的说明', edited: true }, { text: '先前未提交草稿', edited: false }, { text: '', edited: true }]) {
    assert.deepEqual(preserveFeedbackDraft(current, action.draft), { text: current.text, preserved: true });
  }
});

test('existing form is reused; AI subscription never calls the human submit path', () => {
  const source = readFileSync(new URL('../app/home-overflow-menu.tsx', import.meta.url), 'utf8');
  const subscriber = source.slice(source.indexOf('const unsubscribe = subscribeFeedbackDraft'), source.indexOf('async function submitFeedback'));
  assert.ok(subscriber.includes('preserveFeedbackDraft(draftRef.current'));
  assert.ok(!subscriber.includes('submitFeedback') && !subscriber.includes('fetch('));
  assert.ok(source.includes('id="hom-feedback-message"'));
  assert.ok(source.includes('edited: true'));
  assert.ok(source.includes('已有未提交内容，已保留原稿'));
  assert.ok(source.includes('onClick={() => void submitFeedback()}'));
});
