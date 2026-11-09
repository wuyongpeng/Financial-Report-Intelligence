import assert from 'node:assert/strict';
import test from 'node:test';
import { citeTipShift } from '../lib/cite-tip';

test('a tip that fits the chat pane stays put', () => {
  assert.equal(citeTipShift({ left: 40, width: 180 }, { left: 0, right: 320 }), 0);
});

test('a tip past the right edge shifts left and keeps an 8px inset', () => {
  const shift = citeTipShift({ left: 200, width: 240 }, { left: 0, right: 300 });
  assert.equal(shift, -148);
  assert.equal(200 + shift + 240, 300 - 8);
});

test('a tip wider than the pane stays inside the left edge', () => {
  const shift = citeTipShift({ left: 10, width: 400 }, { left: 0, right: 300 });
  assert.equal(10 + shift, 8);
});
