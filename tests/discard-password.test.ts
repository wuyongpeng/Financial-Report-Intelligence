import assert from 'node:assert/strict';
import test from 'node:test';
import { DISCARD_CONFIRM_PASSWORD, matchesDiscardPassword } from '../lib/discard-password';

test('discard password is EVA and matches only exact value', () => {
  assert.equal(DISCARD_CONFIRM_PASSWORD, 'EVA');
  assert.equal(matchesDiscardPassword('EVA'), true);
  assert.equal(matchesDiscardPassword('eva'), false);
  assert.equal(matchesDiscardPassword('Eva'), false);
  assert.equal(matchesDiscardPassword('EVA '), false);
  assert.equal(matchesDiscardPassword(''), false);
  assert.equal(matchesDiscardPassword(null), false);
  assert.equal(matchesDiscardPassword(undefined), false);
  assert.equal(matchesDiscardPassword(123), false);
});
