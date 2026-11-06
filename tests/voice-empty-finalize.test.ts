import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldQuietEndOnEmptyFinalize } from '@/lib/voice/timing';

describe('shouldQuietEndOnEmptyFinalize', () => {
  it('user-initiated empty stop ends quietly (no idle toast)', () => {
    assert.equal(shouldQuietEndOnEmptyFinalize(true), true);
  });

  it('auto no-speech / endpoint empty still counts toward idle', () => {
    assert.equal(shouldQuietEndOnEmptyFinalize(false), false);
  });
});
