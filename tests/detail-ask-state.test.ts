import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { canStartHandoffAsk, canApplyHydratedThread, pendingDetailAskQuestion } from '../lib/detail-ask-state';

const ready = { question: '对比京东方A和立讯精密的ROE', sent: false, periodReady: true, memoryLoading: false, memoryReady: true, loading: false, asking: false, busy: false, reportReady: true };
test('first handoff waits for real parsed report/memory and only runs once, preserving full multi-company question', () => {
  assert.ok(canStartHandoffAsk(ready));
  for (const patch of [{ reportReady: false }, { periodReady: false }, { memoryLoading: true }, { memoryReady: false }, { loading: true }, { asking: true }, { busy: true }, { sent: true }]) assert.equal(canStartHandoffAsk({ ...ready, ...patch }), false);
  assert.equal(pendingDetailAskQuestion({ asking: false, preflight: null, handoffPending: true, handoff: ready.question }), ready.question);
  assert.equal(pendingDetailAskQuestion({ asking: true, preflight: ready.question, handoffPending: false, handoff: null }), ready.question);
  assert.equal(pendingDetailAskQuestion({ asking: false, preflight: ready.question, handoffPending: false, handoff: null }), null, 'fast completed/cancelled answers have no leftover pending bubble');
});

test('slow history hydration cannot replace active new answer, cancelled navigation or another report', () => {
  const baseline = { aborted: false, reportId: 'report-a', activeId: 'report-a', requestUnchanged: true, busy: false };
  assert.ok(canApplyHydratedThread(baseline));
  for (const patch of [{ aborted: true }, { activeId: 'report-b' }, { requestUnchanged: false }, { busy: true }]) assert.equal(canApplyHydratedThread({ ...baseline, ...patch }), false);
  assert.ok(canStartHandoffAsk({ ...ready }), 'fresh mount after navigation gets its own question');
});

test('removing q never rehydrates the current thread; actual unfinished history and failures are not globally hidden', () => {
  const source = readFileSync(new URL('../app/company-detail.tsx', import.meta.url), 'utf8');
  const hydrate = source.slice(source.indexOf('const hydrationReportId ='), source.indexOf('  useEffect(() => {\n    const abort = new AbortController();\n    // eslint-disable-next-line react-hooks/set-state-in-effect'));
  assert.ok(hydrate.includes('  }, [selected.id]);'));
  assert.ok(!hydrate.includes('[selected.id, autoAskQuestion]'));
  assert.ok(hydrate.includes('if (!canHydrate()) return;'));
  assert.ok(hydrate.includes('这次回答尚未完成，可重新提问。'), 'real interrupted historical answer remains honest');
  assert.ok(source.includes('pendingDetailAskQuestion({ asking, preflight: preflightQuestion'));
  assert.ok(source.includes('const questionText = autoAskQuestion;'));
  assert.ok(source.includes('void askRef.current(questionText)'));
  assert.ok(source.includes('reportReady: canLoadReportData'));
  assert.ok(source.includes('role="alert"'));
});
