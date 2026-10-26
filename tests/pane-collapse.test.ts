import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paneCollapseGate } from '../lib/pane-collapse';

test('none collapsed: all can collapse', () => {
  const g = paneCollapseGate({ source: false, middle: false, chat: false });
  assert.equal(g.count, 0);
  assert.equal(g.canCollapseSource, true);
  assert.equal(g.canCollapseMiddle, true);
  assert.equal(g.canCollapseChat, true);
});

test('one collapsed: remaining can still collapse', () => {
  const g = paneCollapseGate({ source: true, middle: false, chat: false });
  assert.equal(g.count, 1);
  assert.equal(g.canCollapseSource, true);
  assert.equal(g.canCollapseMiddle, true);
  assert.equal(g.canCollapseChat, true);
});

test('two collapsed: last expanded cannot collapse', () => {
  const g = paneCollapseGate({ source: true, middle: true, chat: false });
  assert.equal(g.count, 2);
  assert.equal(g.canCollapseSource, true);
  assert.equal(g.canCollapseMiddle, true);
  assert.equal(g.canCollapseChat, false);
});

test('middle+chat collapsed locks source', () => {
  const g = paneCollapseGate({ source: false, middle: true, chat: true });
  assert.equal(g.count, 2);
  assert.equal(g.canCollapseSource, false);
  assert.equal(g.canCollapseMiddle, true);
  assert.equal(g.canCollapseChat, true);
});

test('source+chat collapsed locks middle', () => {
  const g = paneCollapseGate({ source: true, middle: false, chat: true });
  assert.equal(g.count, 2);
  assert.equal(g.canCollapseSource, true);
  assert.equal(g.canCollapseMiddle, false);
  assert.equal(g.canCollapseChat, true);
});
