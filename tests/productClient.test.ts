import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { ECHOMIND_CONVERSATIONS_PATH, PROJECTS_PATH } from '../src/echomindContract.ts';

test('workbench client exposes conversation, project, publication, and graph-run operations', async t => {
  const server = await createServer({define: {'window.location.host': JSON.stringify('localhost:5173')},
    server: {middlewareMode: true, ws: false}, optimizeDeps: {noDiscovery: true, include: []}, appType: 'custom'});
  try {
    const {createProductClient} = await server.ssrLoadModule('/src/productClient.ts');
    const client = createProductClient(ECHOMIND_CONVERSATIONS_PATH);
    assert.deepEqual(Object.keys(client).sort(), [
      'adoptDebugExecution',
      'adoptRuntimeImplementation',
      'advanceGraphRun',
      'analysisReportUrl',
      'applyConsolidation',
      'applyRuntimeContract',
      'cancelGraphRun',
      'command',
      'compileConsolidation',
      'compilePublication',
      'consolidationJobs',
      'controlConsolidationJob',
      'create',
      'deleteConversation',
      'eventsUrl',
      'generateConsolidation',
      'getGraphRepairProposal',
      'getGraphRun',
      'getProject',
      'getPublication',
      'inputHtml',
      'inputMedia',
      'list',
      'listDebugExecutionCandidates',
      'listGraphRuns',
      'listProjects',
      'observationAnalysisReport',
      'observationReport',
      'observations',
      'pauseGraphRun',
      'prepareConsolidation',
      'previewDebugExecutionAdoption',
      'project',
      'publicationPreflight',
      'publishProject',
      'reopenProject',
      'requestGraphRepair',
      'resumeGraphRun',
      'retryArtifactDelivery',
      'retryGraphRun',
      'reviewConsolidation',
      'runtimeContractDraft',
      'snapshot',
      'startDebugGraphRun',
      'startGraphRepairDebug',
      'startGraphRun',
      'trainingSeries',
    ]);
    assert.equal(PROJECTS_PATH, '/api/echomind/projects');
    const stream = new URL(client.eventsUrl('chat', 7), 'http://localhost');
    assert.equal(stream.pathname, `${ECHOMIND_CONVERSATIONS_PATH}/chat/events`);
    assert.equal(stream.searchParams.get('afterSeq'), '7');

    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {getItem: () => null, setItem: () => {}},
    });
    t.after(() => {
      if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    });
    const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({}));
    await client.list({});
    await client.project('project/id', {});
    await client.observations('project/id', {});
    await client.observationReport('project/id', {
      project_node_id: 'stage/id', analysis_job_id: 'job/id', report_version_id: 'version/id',
    }, {});
    await client.retryArtifactDelivery('project/id', 'stage/id', {});
    await client.inputHtml('chat/id', 'review/id', {});
    await client.observationAnalysisReport('project/id', 'stage/id', 'report/id', {});
    await client.deleteConversation('chat/id', {});
    assert.deepEqual(fetch.mock.calls.map(call => new URL(String(call.arguments[0]), 'http://localhost').pathname), [
      `${ECHOMIND_CONVERSATIONS_PATH}/summaries`, `${PROJECTS_PATH}/project%2Fid`,
      `${PROJECTS_PATH}/project%2Fid/observations/overview`,
      `${PROJECTS_PATH}/project%2Fid/observations/report-details`,
      `${PROJECTS_PATH}/project%2Fid/observations/retry-artifact-delivery`,
      `${ECHOMIND_CONVERSATIONS_PATH}/chat%2Fid/pending-inputs/review%2Fid/html`,
      `${PROJECTS_PATH}/project%2Fid/observations/analysis-report`,
      `${ECHOMIND_CONVERSATIONS_PATH}/chat%2Fid`,
    ]);
    assert.deepEqual(Object.fromEntries(new URL(fetch.mock.calls[3].arguments[0], 'http://localhost').searchParams), {
      project_node_id: 'stage/id', analysis_job_id: 'job/id', report_version_id: 'version/id',
    });
    assert.equal(fetch.mock.calls[4].arguments[1].method, 'POST');
    assert.equal(fetch.mock.calls[4].arguments[1].body, JSON.stringify({project_node_id: 'stage/id'}));
    assert.equal(fetch.mock.calls[6].arguments[0], client.analysisReportUrl('project/id', 'stage/id', 'report/id'));
    assert.equal(fetch.mock.calls[7].arguments[1].method, 'DELETE');
    assert.deepEqual(Object.fromEntries(new URL(fetch.mock.calls[6].arguments[0], 'http://localhost').searchParams), {
      project_node_id: 'stage/id', report_version_id: 'report/id',
    });
    fetch.mock.resetCalls();
    const reviewed = {expected_contract_sha256: 'sha256:reviewed', validation_project_id: 'recipe'};
    await client.startDebugGraphRun('original', 'round-1', {data: '/workspace/data'}, reviewed, {});
    await client.publishProject('original', {}, reviewed);
    await client.requestGraphRepair('original', 'failed-run', {});
    await client.getGraphRepairProposal('original', 'failed-run', {});
    await client.startGraphRepairDebug('original', 'failed-run', 'sha256:proposal', {});
    const preview = {
      source: { source_project_id: 'validation', source_project_name: '验证', run_id: 'passed-run', release_id: 'debug-release', release_digest: 'sha256:debug', finished_at: null },
      changes: [{node_id: 'eval', changed_fields: ['config.evaluator_runtime']}],
      content_sha256: 'sha256:preview',
    };
    await client.previewDebugExecutionAdoption('original', preview.source.source_project_id, preview.source.run_id, {});
    await client.adoptDebugExecution('original', preview, {});
    const previewUrl = new URL(fetch.mock.calls.at(-2)!.arguments[0], 'http://localhost');
    assert.equal(previewUrl.searchParams.get('source_project_id'), 'validation');
    assert.equal(previewUrl.searchParams.get('run_id'), 'passed-run');
    const taskIds = {dataset: '1086', train: '1102', eval: '1107'};
    await client.reviewConsolidation('original', taskIds, {}, true);
    await client.prepareConsolidation('original', taskIds, {}, '保留固定验证集');
    await client.compileConsolidation('original', {dataset: ' 1086 ', train: '', eval: '1107'}, {});
    await client.compileConsolidation('original', taskIds, {}, ' public_data/execution-recipes/pcb.json ');
    await client.generateConsolidation('original', {dataset: ' 1086 ', train: '', eval: '1107'}, {});
    await client.generateConsolidation('original', taskIds, {}, 'failed-command');
    await client.applyConsolidation('original', taskIds, 'sha256:reviewed-plan', {});
    const evidenceUrl = new URL(fetch.mock.calls.at(-7)!.arguments[0], 'http://localhost');
    assert.deepEqual(Object.fromEntries(evidenceUrl.searchParams), {
      dataset_task_id: '1086', train_task_id: '1102', eval_task_id: '1107',
      script_only: 'true',
    });
    const requests = fetch.mock.calls.map(({arguments: [url, init]}) => ({
      path: new URL(url, 'http://localhost').pathname,
      method: init.method,
      body: init.body ? JSON.parse(init.body) : undefined,
    }));
    assert.deepEqual(requests, [{
      path: `${PROJECTS_PATH}/original/graph-runs/debug`,
      method: 'POST',
      body: {request_id: 'round-1', inputs: {data: '/workspace/data'}, ...reviewed},
    }, {
      path: `${PROJECTS_PATH}/original/publish`,
      method: 'POST',
      body: {publication_mode: 'production', ...reviewed},
    }, {
      path: `${PROJECTS_PATH}/original/graph-runs/failed-run/repair`,
      method: 'POST',
      body: undefined,
    }, {
      path: `${PROJECTS_PATH}/original/graph-runs/failed-run/repair/proposal`,
      method: undefined,
      body: undefined,
    }, {
      path: `${PROJECTS_PATH}/original/graph-runs/failed-run/repair/debug`,
      method: 'POST',
      body: {expected_proposal_sha256: 'sha256:proposal'},
    }, {
      path: `${PROJECTS_PATH}/original/runtime-contract/debug-adoption`,
      method: undefined,
      body: undefined,
    }, {
      path: `${PROJECTS_PATH}/original/runtime-contract/debug-adoption`,
      method: 'POST',
      body: {source_project_id: 'validation', run_id: 'passed-run', expected_preview_sha256: 'sha256:preview'},
    }, {
      path: `${PROJECTS_PATH}/original/runtime-contract/consolidation`,
      method: undefined,
      body: undefined,
    }, {
      path: `${PROJECTS_PATH}/original/runtime-contract/consolidation`,
      method: 'POST',
      body: {task_ids: taskIds, review_note: '保留固定验证集'},
    }, {
      path: `${PROJECTS_PATH}/original/runtime-contract/consolidation/compile`,
      method: 'POST',
      body: {task_ids: {dataset: '1086', eval: '1107'}},
    }, {
      path: `${PROJECTS_PATH}/original/runtime-contract/consolidation/compile`,
      method: 'POST',
      body: {task_ids: taskIds, recipe_path: 'public_data/execution-recipes/pcb.json'},
    }, {
      path: `${PROJECTS_PATH}/original/runtime-contract/consolidation/generate`,
      method: 'POST',
      body: {task_ids: {dataset: '1086', eval: '1107'}},
    }, {
      path: `${PROJECTS_PATH}/original/runtime-contract/consolidation/generate`,
      method: 'POST',
      body: {task_ids: taskIds, retry_command_id: 'failed-command'},
    }, {
      path: `${PROJECTS_PATH}/original/runtime-contract/consolidation/apply`,
      method: 'POST',
      body: {task_ids: taskIds, proposal_sha256: 'sha256:reviewed-plan'},
    }]);
    fetch.mock.resetCalls();
    await client.consolidationJobs('original', {});
    await client.controlConsolidationJob('original', {job_id: 'job/one', revision: 3}, 'pause', {});
    const [readJob, pauseJob] = fetch.mock.calls;
    assert.equal(new URL(readJob.arguments[0], 'http://localhost').pathname, `${PROJECTS_PATH}/original/consolidation-jobs`);
    assert.equal(new URL(pauseJob.arguments[0], 'http://localhost').pathname, `${PROJECTS_PATH}/original/consolidation-jobs/job%2Fone/pause`);
    const pause = JSON.parse(pauseJob.arguments[1].body);
    assert.equal(pause.expected_revision, 3);
    assert.ok(pause.command_id);
    fetch.mock.resetCalls();
    await client.generateConsolidation('original', {}, {}, undefined, undefined, true);
    assert.deepEqual(JSON.parse(fetch.mock.calls[0].arguments[1].body), {task_ids: {}, background: true});
  } finally { await server.close(); }
});
