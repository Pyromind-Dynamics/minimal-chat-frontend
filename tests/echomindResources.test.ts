import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('resource setup passes an Inference job ID and collection can seal without launching a GraphRun', async t => {
  const server = await createServer({define: {'window.location.host': JSON.stringify('localhost:5173')},
    server: {middlewareMode: true, ws: false}, optimizeDeps: {noDiscovery: true, include: []}, appType: 'custom'});
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true, value: {getItem: () => null, setItem: () => {}},
  });
  t.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });
  try {
    const {applyRuntimeResourceProposal, ensureRuntimeSlot, setTracerAdminKey, startCollectionSimulation, resumeCollectionSimulation, startDemoCollection, collectionSimulationActive, collectionSimulationStatus, isPlatformTracerScript} = await server.ssrLoadModule('/src/echomindResources.ts');
    const projectId = '6742edad-2fd1-419e-9e6c-979847463fe2';
    const scriptPath = `/app/trigger/echomind-project-${projectId}-${'a'.repeat(64)}.sh`;
    assert.equal(isPlatformTracerScript(projectId, scriptPath), true);
    assert.equal(isPlatformTracerScript(projectId.replaceAll('-', ''), scriptPath), true);
    assert.equal(isPlatformTracerScript('701530b0-c590-5ece-bee6-da7b16525265', scriptPath), false);
    assert.equal(isPlatformTracerScript(projectId, '/app/trigger/custom.sh'), false);
    assert.equal(isPlatformTracerScript(projectId, null), false);
    const sealed = {status: 'waiting_batch', auto_start_graph_run: false, completed_rounds: 1, requested_rounds: 1, batch_ids: ['batch-00000001']};
    const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(sealed));
    const tracer = {origin_model: 'model', training_model: 'model', training_batch_size: 10, trajectory_buffer_size: 30,
      time_per_round_seconds: 60, training_rounds: 1, training_save_path: 'storage://traces', execution_mode: 'manual'};
    await ensureRuntimeSlot('project', {serving_inference_id: 'inference-a', tracer}, {});
    await applyRuntimeResourceProposal('project', 'sha256:reviewed', {});
    await setTracerAdminKey('project', 'mock-admin-key', {});
    const source = {train_uri: 'storage://samples.jsonl', val_uri: 'storage://samples.jsonl', image_root: 'storage://images'};
    const result = await startCollectionSimulation('project', 'check-1', source, 10, false, {});
    const roundSource = {...source, val_uri: 'storage://validation.jsonl'};
    await startCollectionSimulation('project', 'check-2', roundSource, 10, true, {});
    const requests = fetch.mock.calls.map(({arguments: [url, init]}) => ({path: new URL(url, 'http://localhost').pathname, body: JSON.parse(init.body)}));
    assert.deepEqual(requests, [{
      path: '/api/echomind/projects/project/runtime-slot/ensure',
      body: {serving_inference_id: 'inference-a', tracer},
    }, {
      path: '/api/echomind/projects/project/runtime-slot/proposal/apply',
      body: {expected_digest: 'sha256:reviewed'},
    }, {
      path: '/api/echomind/projects/project/runtime-slot/tracer-admin',
      body: {admin_key: 'mock-admin-key'},
    }, {
      path: '/api/echomind/projects/project/collection-simulations',
      body: {request_id: 'check-1', source, limit: 10, rounds: 1, splits: ['train'], auto_start_graph_run: false},
    }, {
      path: '/api/echomind/projects/project/collection-simulations',
      body: {request_id: 'check-2', source: roundSource, limit: 10, rounds: 1, splits: ['train', 'val'], auto_start_graph_run: true},
    }]);
    assert.equal(collectionSimulationActive(result), false);
    assert.equal(collectionSimulationStatus(result), '批次已封存');
    assert.equal(collectionSimulationActive({...result, completed_rounds: 0}), true);
    assert.equal(collectionSimulationActive({...result, auto_start_graph_run: true}), true);
    await resumeCollectionSimulation('project', 'existing-simulation', {});
    const [url, init] = fetch.mock.calls.at(-1)!.arguments;
    assert.equal(new URL(url, 'http://localhost').pathname, '/api/echomind/projects/project/collection-simulations/existing-simulation/resume');
    assert.equal(init.method, 'POST');
    assert.equal(init.body, undefined);
    const range = {request_id: 'click-1', image_directory: '/workspace/line/images', offset: 5, limit: 5};
    await startDemoCollection('project', range, {});
    const [demoUrl, demoRequest] = fetch.mock.calls.at(-1)!.arguments;
    assert.equal(new URL(demoUrl, 'http://localhost').pathname, '/api/echomind/projects/project/demo-collection');
    assert.equal(demoRequest.method, 'POST');
    assert.deepEqual(JSON.parse(demoRequest.body), range);
  } finally { await server.close(); }
});
