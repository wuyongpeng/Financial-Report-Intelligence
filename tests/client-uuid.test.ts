import assert from 'node:assert/strict';
import test from 'node:test';
import { clientUuid, fallbackUuid } from '../lib/client-uuid';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('fallbackUuid produces a v4 UUID the chat API will accept', () => {
  const bytes = Uint8Array.from({ length: 16 }, (_, i) => i);
  const id = fallbackUuid(bytes);
  assert.match(id, UUID_RE);
  assert.equal(id[14], '4');
  assert.match(id[19], /[89ab]/);
});

test('clientUuid always returns an RFC UUID', () => {
  assert.match(clientUuid(), UUID_RE);
  assert.match(clientUuid(), UUID_RE);
});
