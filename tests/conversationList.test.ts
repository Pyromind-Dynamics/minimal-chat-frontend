import assert from 'node:assert/strict';
import test from 'node:test';

import { formatConversationUpdatedAt, sortConversations } from '../src/conversationList.ts';
import type { ConversationSnapshot } from '../src/types.ts';

test('activity order survives opening an old conversation and changes on new activity', () => {
  const old = { conversation_id: 'old', through_seq: 100, updated_at: '2026-09-15T08:00:00Z' } as ConversationSnapshot;
  const recent = { conversation_id: 'recent', through_seq: 2, updated_at: '2026-09-15T17:00:00+08:00' } as ConversationSnapshot;
  const input = [old, recent];
  assert.deepEqual(sortConversations(input), [recent, old]);
  assert.deepEqual(input, [old, recent]);
  const active = { ...old, updated_at: '2026-09-15T10:00:00Z' };
  assert.deepEqual(sortConversations([recent, active]), [active, recent]);
});

test('legacy conversations without a timestamp sort last and display a placeholder', () => {
  const legacy = { conversation_id: 'legacy' } as ConversationSnapshot;
  const recent = { ...legacy, conversation_id: 'recent', updated_at: '2026-09-15T09:00:00Z' };
  assert.deepEqual(sortConversations([legacy, recent]), [recent, legacy]);
  assert.equal(formatConversationUpdatedAt(undefined), '—');
  assert.equal(formatConversationUpdatedAt('invalid'), '—');
  assert.match(formatConversationUpdatedAt(recent.updated_at), /2026/);
});
