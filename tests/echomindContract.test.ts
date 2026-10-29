import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ECHOMIND_CONVERSATIONS_PATH,
  PROJECTS_PATH,
  buildEchoMindConversationBody,
  buildCreateProjectBody,
  echomindConversationPath,
  echomindConversationMessagesPath,
  echomindProjectRequestPath,
  echomindProjectNodeRunPath,
} from '../src/echomindContract.ts';

test('EchoMind endpoints stay separate from the Workbench conversation API', () => {
  assert.equal(
    ECHOMIND_CONVERSATIONS_PATH,
    '/api/echomind/conversations',
  );
  assert.equal(
    echomindConversationPath('conversation-1'),
    '/api/echomind/conversations/conversation-1',
  );
  assert.equal(
    echomindConversationMessagesPath('conversation-1'),
    '/api/echomind/conversations/conversation-1/messages',
  );
  assert.equal(
    echomindProjectRequestPath('conversation-1'),
    '/api/echomind/conversations/conversation-1/project-request',
  );
  assert.equal(
    echomindProjectNodeRunPath('project-1', 'dataset'),
    '/api/echomind/projects/project-1/nodes/dataset/run',
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
  });
  assert.equal('project_id' in body, false);
  assert.equal('scenario_id' in body, false);
});

test('Project creation requires explicit confirmation', () => {
  assert.equal(PROJECTS_PATH, '/api/echomind/projects');
  assert.deepEqual(buildCreateProjectBody('echomind-conversation'), {
    conversation_id: 'echomind-conversation',
    confirmed: true,
  });
});
