import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEchoMindSelection } from '../src/echomindNavigation.ts';
import type { ProjectSummary } from '../src/echomindContract.ts';
import type { ConversationSnapshot } from '../src/types.ts';

const project = {
  project_id: 'project-1',
  name: 'AVI',
  description: 'AVI project',
  skill: 'experiment-planning',
  owner_user_id: '42',
  conversation_id: 'project-chat',
  cluster: 'us-west-1#pre',
  lifecycle: 'development',
  node_count: 4,
  created_at: '2026-11-09T00:00:00Z',
  updated_at: '2026-11-09T01:00:00Z',
} satisfies ProjectSummary;

const conversations = [
  { conversation_id: 'first-chat' },
  { conversation_id: 'project-chat' },
] as ConversationSnapshot[];

test('Project selection restores the bound conversation before plain conversation state', () => {
  assert.deepEqual(
    resolveEchoMindSelection({
      urlProjectId: project.project_id,
      savedConversationId: 'first-chat',
      projects: [project],
      conversations,
    }),
    { project, conversationId: 'project-chat' },
  );
});

test('navigation falls back from Project to URL and saved conversations', () => {
  assert.deepEqual(
    resolveEchoMindSelection({
      urlProjectId: 'missing',
      urlConversationId: 'first-chat',
      savedConversationId: 'project-chat',
      projects: [project],
      conversations,
    }),
    { project: null, conversationId: 'first-chat' },
  );
});
