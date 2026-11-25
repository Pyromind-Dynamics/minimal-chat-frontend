import assert from 'node:assert/strict';
import test from 'node:test';
import { latestActivityAt, newestActivityFirst, projectsByConversationActivity, resolveEchoMindSelection } from '../src/echomindNavigation.ts';
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

test('navigation sorts by latest activity, falling back to creation for older records', () => {
  const active = { created_at: '2026-11-08T23:00:00Z', updated_at: '2026-11-09T21:00:00-05:00' };
  const newerCreation = { created_at: '2026-11-10T01:00:00Z', updated_at: 'invalid' };
  const unknown = { created_at: null, updated_at: null };
  assert.deepEqual([unknown, newerCreation, active].sort(newestActivityFirst), [active, newerCreation, unknown]);
  assert.equal(latestActivityAt(active.updated_at, newerCreation.created_at), active.updated_at);
});

test('projects use their bound conversation activity before falling back to project dates', () => {
  const otherProject = { ...project, project_id: 'project-2', conversation_id: 'other-chat', updated_at: '2026-11-12T00:00:00Z' };
  const fallbackProject = { ...project, project_id: 'project-3', conversation_id: 'missing' };
  const conversations = [
    { conversation_id: project.conversation_id, updated_at: '2026-11-11T00:00:00Z' },
    { conversation_id: otherProject.conversation_id, updated_at: '2026-11-08T00:00:00Z' },
  ];
  const rows = projectsByConversationActivity([otherProject, fallbackProject, project], conversations);
  assert.deepEqual(rows.map(row => [row.project.project_id, row.updated_at]), [
    ['project-1', conversations[0].updated_at],
    ['project-3', fallbackProject.updated_at],
    ['project-2', conversations[1].updated_at],
  ]);
});
