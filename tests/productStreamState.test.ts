import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyProductSequence,
  deriveDisplayConnectionState,
} from '../src/productStreamState.ts';

test('connection display distinguishes creation and SSE reconnection', () => {
  assert.equal(deriveDisplayConnectionState({
    conversationId: null,
    isCreating: false,
    connectionState: 'closed',
    hasConnected: false,
  }), 'idle');
  assert.equal(deriveDisplayConnectionState({
    conversationId: null,
    isCreating: true,
    connectionState: 'closed',
    hasConnected: false,
  }), 'creating');
  assert.equal(deriveDisplayConnectionState({
    conversationId: 'conversation-1',
    isCreating: false,
    connectionState: 'closed',
    hasConnected: false,
  }), 'connecting');
  assert.equal(deriveDisplayConnectionState({
    conversationId: 'conversation-1',
    isCreating: false,
    connectionState: 'open',
    hasConnected: true,
  }), 'connected');
  assert.equal(deriveDisplayConnectionState({
    conversationId: 'conversation-1',
    isCreating: false,
    connectionState: 'closed',
    hasConnected: true,
  }), 'reconnecting');
});

test('SSE reconnect ignores replayed events and accepts the next event', () => {
  assert.equal(classifyProductSequence(8, 7), 'ignore');
  assert.equal(classifyProductSequence(8, 8), 'ignore');
  assert.equal(classifyProductSequence(8, 9), 'next');
});

test('SSE sequence gaps require snapshot reconciliation', () => {
  assert.equal(classifyProductSequence(8, 10), 'gap');
  assert.equal(classifyProductSequence(10, 10), 'ignore');
  assert.equal(classifyProductSequence(10, 11), 'next');
});
