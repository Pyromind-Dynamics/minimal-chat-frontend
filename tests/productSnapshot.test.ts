import assert from 'node:assert/strict';
import test from 'node:test';

import { snapshotToChatEvents } from '../src/productSnapshot.ts';
import type { ConversationSnapshot, ObservationEvent } from '../src/types.ts';

test('failed operations copy their top-level error code into the observation', () => {
  const snapshot: ConversationSnapshot = {
    schema_version: 1,
    conversation_id: 'conversation-1',
    through_seq: 2,
    status: 'idle',
    capabilities: {
      resume: true,
      cancel: true,
      permission_reply: true,
      partial_message: true,
      fork: true,
      workflow_rollback: true,
      native_workspace_tools: [],
    },
    timeline: [{
      kind: 'operation',
      item_id: 'call-1',
      started_seq: 1,
      completed_seq: 2,
      name: 'preview_dataset',
      category: 'tool',
      status: 'failed',
      thought: [],
      arguments: {},
      output: [{ type: 'text', text: 'Too many samples.' }],
      details: { retryable: true },
      error_code: 'sample_selection_limit',
    }],
    pending_permissions: [],
    usage: { input_tokens: 0, output_tokens: 0, cached_tokens: 0 },
  };

  const observation = snapshotToChatEvents(snapshot)[1] as ObservationEvent;
  assert.equal(observation.observation.is_error, true);
  assert.equal(observation.observation.error_code, 'sample_selection_limit');
  assert.equal(observation.observation.retryable, true);
});
