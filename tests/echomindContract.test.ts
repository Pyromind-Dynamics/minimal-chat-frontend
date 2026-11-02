import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ECHOMIND_CONVERSATIONS_PATH,
  PROJECTS_PATH,
  buildEchoMindConversationBody,
  echomindConversationPath,
  echomindConversationCommandsPath,
  echomindConversationEventsPath,
  echomindConversationSnapshotPath,
  echomindProjectArtifactPath,
  echomindProjectGraphPath,
  echomindProjectNodeRunPath,
  echomindProjectNodeStartPath,
  echomindProjectPath,
  echomindProjectRunsPath,
  nodeConfigDigest,
} from '../src/echomindContract.ts';

test('EchoMind endpoints stay separate from the Workbench conversation API', () => {
  assert.equal(
    ECHOMIND_CONVERSATIONS_PATH,
    '/api/v2/echomind/conversations',
  );
  assert.equal(
    echomindConversationPath('conversation-1'),
    '/api/v2/echomind/conversations/conversation-1',
  );
  assert.equal(
    echomindConversationSnapshotPath('conversation-1'),
    '/api/v2/echomind/conversations/conversation-1/snapshot',
  );
  assert.equal(
    echomindConversationCommandsPath('conversation-1'),
    '/api/v2/echomind/conversations/conversation-1/commands',
  );
  assert.equal(
    echomindConversationEventsPath('conversation-1'),
    '/api/v2/echomind/conversations/conversation-1/events',
  );
  assert.equal(
    echomindProjectPath('project-1'),
    '/api/echomind/projects/project-1',
  );
  assert.equal(
    echomindProjectNodeRunPath('project-1', 'dataset'),
    '/api/echomind/projects/project-1/nodes/dataset/run',
  );
  assert.equal(
    echomindProjectGraphPath('project-1'),
    '/api/echomind/projects/project-1/graph',
  );
  assert.equal(
    echomindProjectNodeStartPath('project-1', 'dataset'),
    '/api/echomind/projects/project-1/nodes/dataset/start',
  );
  assert.equal(
    echomindProjectRunsPath('project-1'),
    '/api/echomind/projects/project-1/runs',
  );
  assert.equal(
    echomindProjectArtifactPath('project-1', 'artifact-1'),
    '/api/echomind/projects/project-1/artifacts/artifact-1',
  );
});

test('EchoMind conversation creation contains only intent and LLM config', () => {
  const body = buildEchoMindConversationBody({
    llm: { model: 'test-model' },
    initialMessage: '我要做一个 AVI 图片质检流程',
  });

  assert.deepEqual(body, {
    llm: { model: 'test-model' },
    message: '我要做一个 AVI 图片质检流程',
    user_input_enabled: true,
  });
  assert.equal('project_id' in body, false);
  assert.equal('scenario_id' in body, false);
});

test('Project API only exposes persisted project resources', () => {
  assert.equal(PROJECTS_PATH, '/api/echomind/projects');
});

test('node config digest matches node validation identity', async () => {
  const digest = await nodeConfigDigest({
    type: 'train',
    executor: 'contract_probe',
    config: { z: 2, nested: { b: true, a: ['x'] }, a: 1 },
  });
  const reorderedDigest = await nodeConfigDigest({
    type: 'train',
    executor: 'contract_probe',
    config: { a: 1, nested: { a: ['x'], b: true }, z: 2 },
  });
  const changedDigest = await nodeConfigDigest({
    type: 'train',
    executor: 'contract_probe',
    config: { a: 1, nested: { a: ['x'], b: true }, z: 3 },
  });

  assert.match(digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(reorderedDigest, digest);
  assert.notEqual(changedDigest, digest);
});
