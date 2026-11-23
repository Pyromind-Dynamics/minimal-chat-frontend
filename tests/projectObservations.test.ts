import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { startObservationPolling } from '../src/observationsPolling.ts';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
test('polling has one request, respects five seconds, and discards late responses', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let resolve!: (value: string) => void;
  let calls = 0;
  let signal!: AbortSignal;
  const values: string[] = [];
  const poller = startObservationPolling({ read: current => { calls++; signal = current; return new Promise<string>(done => { resolve = done; }); }, onData: value => values.push(value), onError: () => {}, isVisible: () => true });
  try {
    await poller.refresh(); assert.equal(calls, 1);
    resolve('first'); await flush();
    await poller.refresh(); assert.equal(calls, 1);
    t.mock.timers.tick(4_999); await flush(); assert.equal(calls, 1);
    t.mock.timers.tick(1); await flush(); assert.equal(calls, 2);
    poller.stop(); assert.equal(signal.aborted, true);
    resolve('late-project'); await flush(); assert.deepEqual(values, ['first']);
  } finally { poller.stop(); }
});
test('hidden pages abort reads, and 403 stops retries', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let visible = true;
  let calls = 0;
  let errors = 0;
  let signal!: AbortSignal;
  const poller = startObservationPolling({ read: async current => { signal = current; calls++; throw Object.assign(new Error('authorization required'), { status: 403 }); }, onData: () => {}, onError: () => { errors++; }, isVisible: () => visible });
  await flush();
  assert.equal(errors, 1);
  visible = false; poller.visibilityChanged();
  visible = true; poller.visibilityChanged();
  t.mock.timers.tick(600_000); await flush();
  assert.equal(calls, 1); assert.equal(signal.aborted, false);
  poller.stop();
});
test('source failures back off and preserve the caller last value', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let calls = 0; let value = 0;
  const poller = startObservationPolling({ read: async () => { if (++calls > 1) throw new Error('offline'); return 42; }, onData: next => { value = next; }, onError: () => {}, isVisible: () => true });
  try {
    await flush(); t.mock.timers.tick(5_000); await flush();
    assert.equal(value, 42); assert.equal(calls, 2);
    t.mock.timers.tick(9_999); await flush(); assert.equal(calls, 2);
    t.mock.timers.tick(1); await flush(); assert.equal(calls, 3);
  } finally { poller.stop(); }
});
test('observation clients escape scope, use GET, and only configuration writes', async () => {
  const server = await createServer({ define: { 'window.location.host': JSON.stringify('localhost:5173') }, server: { middlewareMode: true, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: () => {} } });
  try {
    const { createProductClient } = await server.ssrLoadModule('/src/productClient.ts');
    const client = createProductClient('/api/v2/echomind/conversations');
    const requests: { url: URL; init: RequestInit }[] = [];
    globalThis.fetch = async (input, init) => { requests.push({ url: new URL(String(input), 'http://localhost'), init: init ?? {} }); return Response.json({}); };
    const controller = new AbortController();
    await client.observations('project/id', {}, controller.signal);
    await client.trainingSeries('project/id', { project_node_id: 'node/a', run_id: 'run/b', keys: ['loss/one'], cursor: 'a+=/' }, {}, controller.signal);
    await client.evaluationHistory('project/id', {}, controller.signal);
    await client.configureObservations('project/id', 'v1', { schema_version: 1, panels: [], orchestrator_source_id: null }, {});
    assert.ok(requests.every(request => request.url.pathname.startsWith('/api/echomind/projects/project%2Fid/observations/')));
    assert.deepEqual(requests.map(request => request.init.method ?? 'GET'), ['GET', 'GET', 'GET', 'PUT']);
    assert.equal(requests[1].url.searchParams.get('run_id'), 'run/b');
    assert.equal(requests[1].url.searchParams.get('keys'), 'loss/one');
    assert.equal(requests[1].url.searchParams.get('cursor'), 'a+=/');
    assert.equal(requests[1].init.signal, controller.signal);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
    await server.close();
  }
});

test('stage events coalesce behind the active read without aborting or starving it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const completions: ((value: number) => void)[] = [];
  const signals: AbortSignal[] = [];
  const values: number[] = [];
  const poller = startObservationPolling({ read: signal => { signals.push(signal); return new Promise<number>(resolve => completions.push(resolve)); }, onData: value => values.push(value), onError: () => {}, isVisible: () => true });
  try {
    for (let i = 0; i < 20; i++) poller.invalidate();
    assert.equal(completions.length, 1);
    assert.equal(signals[0].aborted, false);
    completions[0](1); await flush();
    assert.deepEqual(values, [1]);
    t.mock.timers.tick(0); await flush();
    assert.equal(completions.length, 2);
    completions[1](2); await flush();
    assert.deepEqual(values, [1, 2]);
    t.mock.timers.tick(4_999); await flush();
    assert.equal(completions.length, 2);
  } finally { poller.stop(); }
});


test('five-second polling does not overlap a slow request or accept a sub-five-second delay', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const pending: ((value: number) => void)[] = [];
  const values: number[] = [];
  const poller = startObservationPolling({ delay: 1, read: () => new Promise<number>(resolve => pending.push(resolve)), onData: value => values.push(value), onError: () => {}, isVisible: () => true });
  try {
    t.mock.timers.tick(12_000); await flush(); assert.equal(pending.length, 1);
    pending[0](1); await flush(); t.mock.timers.tick(0); await flush();
    assert.equal(pending.length, 2); assert.deepEqual(values, [1]);
    pending[1](2); await flush(); t.mock.timers.tick(4_999); await flush(); assert.equal(pending.length, 2);
    t.mock.timers.tick(1); await flush(); assert.equal(pending.length, 3);
  } finally { poller.stop(); }
});

test('only running training polls every second, preserving one request and normal error backoff', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let running = true;
  const requests: { resolve: (value: number) => void; reject: (error: Error) => void }[] = [];
  const values: number[] = [];
  const poller = startObservationPolling({
    isVisible: () => true,
    isTrainingRunning: () => running,
    read: () => new Promise<number>((resolve, reject) => requests.push({ resolve, reject })),
    onData: value => values.push(value),
    onError: () => {},
  });
  try {
    requests[0].resolve(1); await flush();
    t.mock.timers.tick(999); await flush();
    assert.equal(requests.length, 1);
    t.mock.timers.tick(1); await flush();
    assert.equal(requests.length, 2);
    t.mock.timers.tick(1_200); await flush();
    await poller.refresh();
    assert.equal(requests.length, 2);
    requests[1].reject(new Error('upstream offline')); await flush();
    t.mock.timers.tick(9_999); await flush();
    assert.equal(requests.length, 2);
    t.mock.timers.tick(1); await flush();
    assert.equal(requests.length, 3);
    requests[2].resolve(3); await flush();
    running = false;
    poller.invalidate();
    assert.equal(requests.length, 4);
    requests[3].resolve(4); await flush();
    t.mock.timers.tick(4_999); await flush();
    assert.equal(requests.length, 4);
    t.mock.timers.tick(1); await flush();
    assert.equal(requests.length, 5);
    assert.deepEqual(values, [1, 3, 4]);
  } finally { poller.stop(); }
});
