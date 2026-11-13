import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { ECHOMIND_CONVERSATIONS_PATH, PROJECTS_PATH } from '../src/echomindContract.ts';

test('workbench client loads summaries and resolves projects independently', async () => {
  const server = await createServer({define: {'window.location.host': JSON.stringify('localhost:5173')},
    server: {middlewareMode: true, ws: false}, optimizeDeps: {noDiscovery: true, include: []}, appType: 'custom'});
  try {
    const {createProductClient} = await server.ssrLoadModule('/src/productClient.ts');
    const client = createProductClient(ECHOMIND_CONVERSATIONS_PATH);
    assert.deepEqual(Object.keys(client).sort(), ['command', 'create', 'eventsUrl', 'inputMedia', 'list', 'listProjects', 'project', 'snapshot']);
    const requests: string[] = [];
    const originalFetch = globalThis.fetch;
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true, value: {getItem: () => null, setItem: () => undefined},
    });
    try {
      globalThis.fetch = async input => {
        requests.push(new URL(String(input), 'http://localhost').pathname);
        return Response.json({});
      };
      await client.list({});
      await client.project('project/id', {});
      assert.deepEqual(requests, [`${ECHOMIND_CONVERSATIONS_PATH}/summaries`, `${PROJECTS_PATH}/project%2Fid`]);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
    assert.equal(PROJECTS_PATH, '/api/echomind/projects');
    const stream = new URL(client.eventsUrl('chat', 7), 'http://localhost');
    assert.equal(stream.pathname, `${ECHOMIND_CONVERSATIONS_PATH}/chat/events`);
    assert.equal(stream.searchParams.get('afterSeq'), '7');
  } finally { await server.close(); }
});
