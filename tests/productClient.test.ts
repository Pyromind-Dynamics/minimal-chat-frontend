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
    assert.deepEqual(Object.keys(client).sort(), ['command', 'create', 'eventsUrl', 'inputMedia', 'list', 'listProjects', 'observationReport', 'observations', 'project', 'retryArtifactDelivery', 'snapshot', 'trainingSeries']);
    const requests: URL[] = [];
    const originalFetch = globalThis.fetch;
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true, value: {getItem: () => null, setItem: () => undefined},
    });
    try {
      const retryRequests: RequestInit[] = [];
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input), 'http://localhost');
        requests.push(url);
        if (url.pathname.endsWith('/retry-artifact-delivery') && init) retryRequests.push(init);
        return Response.json({});
      };
      await client.list({});
      await client.project('project/id', {});
      await client.observations('project/id', {});
      await client.observationReport('project/id', {
        project_node_id: 'stage/id', analysis_job_id: 'job/id', report_version_id: 'version/id',
      }, {});
      await client.retryArtifactDelivery('project/id', 'stage/id', {});
      assert.deepEqual(requests.map(url => url.pathname), [`${ECHOMIND_CONVERSATIONS_PATH}/summaries`, `${PROJECTS_PATH}/project%2Fid`, `${PROJECTS_PATH}/project%2Fid/observations/overview`, `${PROJECTS_PATH}/project%2Fid/observations/report-details`, `${PROJECTS_PATH}/project%2Fid/observations/retry-artifact-delivery`]);
      assert.equal(retryRequests[0].method, 'POST');
      assert.equal(retryRequests[0].body, JSON.stringify({ project_node_id: 'stage/id' }));
      assert.deepEqual(Object.fromEntries(requests[3].searchParams), {
        project_node_id: 'stage/id', analysis_job_id: 'job/id', report_version_id: 'version/id',
      });
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
