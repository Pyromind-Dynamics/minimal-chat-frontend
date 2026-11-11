import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { ECHOMIND_CONVERSATIONS_PATH, PROJECTS_PATH } from '../src/echomindContract.ts';

test('workbench client exposes only current conversation and project-list operations', async () => {
  const server = await createServer({define: {'window.location.host': JSON.stringify('localhost:5173')},
    server: {middlewareMode: true, ws: false}, optimizeDeps: {noDiscovery: true, include: []}, appType: 'custom'});
  try {
    const {createProductClient} = await server.ssrLoadModule('/src/productClient.ts');
    const client = createProductClient(ECHOMIND_CONVERSATIONS_PATH);
    assert.deepEqual(Object.keys(client).sort(), ['command', 'create', 'eventsUrl', 'inputMedia', 'list', 'listProjects', 'snapshot']);
    assert.equal(PROJECTS_PATH, '/api/echomind/projects');
    const stream = new URL(client.eventsUrl('chat', 7), 'http://localhost');
    assert.equal(stream.pathname, `${ECHOMIND_CONVERSATIONS_PATH}/chat/events`);
    assert.equal(stream.searchParams.get('afterSeq'), '7');
  } finally { await server.close(); }
});
