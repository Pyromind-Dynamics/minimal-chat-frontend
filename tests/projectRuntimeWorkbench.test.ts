import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { consolidationArchiveAssets, pendingArtifactVerificationTask, selectProductionRun, type GraphRun, type GraphRunDetail } from '../src/echomindRuntime.ts';

test('recipe briefs retain only safe archive paths and roles', () => {
  assert.deepEqual(consolidationArchiveAssets({
    dataset: [
      {role: 'workflow', path: 'version://r19'},
      {role: 'historical_input', path: '/workspace/datasets/approved text.jsonl'},
      {role: 'invalid_path', path: '/workspace/datasets/../private.json'},
      {role: 'unsafe_role\ntext', path: '/workspace/datasets/invalid.jsonl'},
    ],
    eval: {
      runtime_script: {path: '/workspace/.pyromind-agent/conversation/runtime.py', sha256: 'digest'},
      url: {path: 'https://example.com/resource'},
      query: {path: '/workspace/eval/config.json?signature=invalid'},
    },
  }), [
    {stage: 'dataset', role: 'workflow', path: 'version://r19'},
    {stage: 'dataset', role: 'historical_input', path: '/workspace/datasets/approved text.jsonl'},
    {stage: 'eval', role: 'runtime_script', path: '/workspace/.pyromind-agent/conversation/runtime.py'},
  ]);
});

test('only the current externally waiting stage can advance after a success callback', () => {
  const detail = {
    run: {status: 'waiting_external', current_stage_ids: ['dataset']},
    stage_runs: [{
      run_id: 'old',
      status: 'waiting_external',
      task_runs: [{
        task_run_id: 'old-task',
        status: 'running',
        provider_reported_status: 'succeeded',
        provider_run_id: '1319',
      }],
    }, {
      run_id: 'dataset',
      status: 'waiting_external',
      task_runs: [{
        task_run_id: 'dataset-task',
        status: 'running',
        provider_reported_status: 'running',
        provider_run_id: '1321',
      }],
    }],
    task_runs: [],
  } as GraphRunDetail;
  const task = detail.stage_runs[1].task_runs[0];
  assert.equal(pendingArtifactVerificationTask(detail), undefined);

  task.provider_reported_status = 'succeeded';
  assert.equal(pendingArtifactVerificationTask(detail), task);

  detail.run.status = 'paused';
  assert.equal(pendingArtifactVerificationTask(detail), undefined);
  detail.run.status = 'waiting_external';
  task.status = 'succeeded';
  assert.equal(pendingArtifactVerificationTask(detail), undefined);
});

test('runtime workbench explains runtime binding and derives repeatable run inputs', async () => {
  const server = await createServer({
    define: {'window.location.host': JSON.stringify('localhost:5173')},
    server: {middlewareMode: true, ws: false},
    optimizeDeps: {noDiscovery: true, include: []},
    appType: 'custom',
  });
  try {
    const { ProjectRuntimeWorkbench } = await server.ssrLoadModule('/src/components/ProjectRuntimeWorkbench.tsx');
    const { collectRunInputs, reconcileRunInputs } = await server.ssrLoadModule('/src/echomindRuntime.ts');
    const html = renderToStaticMarkup(createElement(ProjectRuntimeWorkbench, {
      client: {},
      projectId: 'source-project',
      projectName: 'PCB AVI',
      requestOptions: {},
      onClose: () => {},
      onProjectChanged: () => {},
    }));
    assert.match(html, /WorkingGraph · development/);
    assert.match(html, /调试与发布 · PCB AVI/);
    assert.match(html, /Project source-project/);
    const { ExecutionPlanConsolidation, DatasetReplayPolicy } = await server.ssrLoadModule('/src/components/ExecutionPlanConsolidation.tsx');
    const consolidation = renderToStaticMarkup(createElement(ExecutionPlanConsolidation, {
      client: {}, projectId: 'source-project', options: {}, disabled: false,
      onApply: async () => {}, renderDraft: () => null,
    }));
    assert.match(consolidation, /从研发成果生成执行方案/);
    assert.match(consolidation, /生成并验证执行方案/);
    assert.doesNotMatch(consolidation, /使用 Agent 编写的配方|配方路径|复制编写任务/);
    assert.doesNotMatch(consolidation, /读取研发成果/);
    assert.doesNotMatch(consolidation, /图片输入/);
    assert.doesNotMatch(consolidation, /让 Agent 生成执行方案/);
    assert.doesNotMatch(consolidation, /确认采用执行方案/);

    const policy = (replay: Record<string, unknown>) => renderToStaticMarkup(createElement(DatasetReplayPolicy, {replay}));
    const fixed = policy({batch_label_source: 'dataset', fixed_validation_path: '/workspace/train-val.jsonl', source_kinds: ['image_directory', 'record_directory']});
    assert.match(fixed, /由 Dataset 提供/);
    assert.match(fixed, /固定文件 · \/workspace\/train-val.jsonl/);
    assert.match(fixed, /图片目录、批次记录目录/);
    const split = policy({batch_label_source: 'collection', fixed_validation_path: null, source_kinds: ['jsonl', 'jsonl'], val_rows: [1, 2]});
    assert.match(split, /由采集侧提供/);
    assert.match(split, /从当前批次切分/);
    assert.match(split, /JSONL 文件/);
    assert.doesNotMatch(split, /JSONL 文件、JSONL/);
    const legacy = policy({source_kinds: []});
    assert.match(legacy, /未指定/);
    assert.doesNotMatch(legacy, /从当前批次切分/);

    const nodes = [{
      id: 'dataset',
      type: 'dataset',
      title: 'Dataset',
      status: 'idle',
      launch_mode: 'executor',
      executor: 'artifact_replay',
      inputs: {
        source_batch: {
          artifact_type: 'dataset.source',
          schema_ref: 'echomind://schemas/dataset-source/v1',
          required: true,
          binding: {kind: 'run_input', name: 'data'},
        },
      },
      outputs: {},
      config: {resources: [{id: 'data', uri: '/datasets/pcb_avi_eval_3'}]},
      policies: {},
    }, {
      id: 'train',
      type: 'train',
      title: 'Train',
      status: 'idle',
      launch_mode: 'executor',
      executor: 'artifact_replay',
      inputs: {
        base_model: {
          artifact_type: 'model.checkpoint',
          schema_ref: 'echomind://schemas/model/v1',
          required: true,
          binding: {kind: 'run_input', name: 'base_model'},
        },
      },
      outputs: {},
      config: {},
      policies: {},
    }];
    const dataset = nodes[0];
    const platformNodes = [{
      ...dataset,
      config: {
        ...dataset.config,
        runtime_input_defaults: {data: '/workspace/datasets/raw'},
      },
    }, ...nodes.slice(1)];
    assert.equal(collectRunInputs(platformNodes)[0].defaultValue, '/workspace/datasets/raw');
    const inputs = collectRunInputs(nodes);
    assert.deepEqual(inputs, [{
      name: 'data',
      artifactType: 'dataset.source',
      defaultValue: '/datasets/pcb_avi_eval_3',
      usedBy: ['dataset'],
    }, {
      name: 'base_model',
      artifactType: 'model.checkpoint',
      defaultValue: '',
      usedBy: ['train'],
    }]);
    assert.deepEqual(
      reconcileRunInputs(nodes, {
        data: '/workspace/datasets/raw',
        base_model: 'storage://models/base',
      }, true),
      {
        data: '/datasets/pcb_avi_eval_3',
        base_model: '',
      },
    );
  } finally {
    await server.close();
  }
});

test('production flywheel keeps the active release and shows live and final stage states', async () => {
  const server = await createServer({
    define: {'window.location.host': JSON.stringify('localhost:5173')},
    server: {middlewareMode: true, ws: false},
    optimizeDeps: {noDiscovery: true, include: []},
    appType: 'custom',
  });
  try {
    const { ProductionFlywheel } = await server.ssrLoadModule('/src/components/ProductionFlywheel.tsx');
    const prepared = {simulation_id: 'reserved', status: 'pending', manual_start: true,
      auto_start_graph_run: true, requested_samples: 5, completed_samples: 0, graph_run_ids: [], batch_ids: []};
    const { DemoImageCollection } = await server.ssrLoadModule('/src/components/DemoImageCollection.tsx');
    const renderCollection = (simulation: typeof prepared, disabled = false, datasetLabels = false, fixedValidation = false, previous?: {request_id: string; status: string; source: {image_root: string}}) => renderToStaticMarkup(createElement(ProductionFlywheel, {
      simulation, onOpenRun: () => {},
    }, simulation.manual_start && createElement(DemoImageCollection, {
      projectId: 'demo', imageRoot: '/workspace/example', previous, batchSize: simulation.requested_samples,
      disabled, datasetLabels, fixedValidation, requestOptions: {}, onStarted: () => assert.fail('render must not start a simulation'),
    })));
    assert.match(renderCollection(prepared), /等待手动启动/);
    assert.match(renderCollection({...prepared, status: 'feeding', completed_samples: 2}), /已采集 2\/5 条 · 正在采样/);
    assert.match(renderCollection(prepared), /封批后自动进入 Dataset → Train → Eval/);
    const rawBatch = renderCollection(prepared, false, true);
    assert.match(rawBatch, /Dataset 通过平台 DataFlow 预打标/);
    assert.doesNotMatch(rawBatch, /由当前 Inference 预标注/);
    assert.match(renderCollection(prepared, false, true, true), /本批 5 组全部用于训练。训练验证使用固定验证集/);
    const collectedLabels = renderCollection(prepared, false, false, true);
    assert.match(collectedLabels, /当前 Inference 预标注/);
    assert.match(collectedLabels, /本批 5 组全部用于训练。训练验证使用固定验证集/);
    assert.match(renderCollection(prepared), /采集 5 条并运行一轮/);
    assert.match(renderCollection({...prepared, requested_samples: 8}), /采集 8 条并运行一轮/);
    assert.match(renderCollection(prepared), /name="directory"[^>]*value="\/workspace\/example\/images"/);
    assert.match(renderCollection(prepared), /name="first_group"[^>]*value="1"/);
    const failedAttempt = {request_id: 'demo:85cb4dd2-8d39-4827-822c-45a2e6f8e146:5', status: 'failed', source: {image_root: '/workspace/other/raw'}};
    const restored = renderCollection(prepared, false, false, false, failedAttempt);
    assert.match(restored, /name="first_group"[^>]*value="6"/);
    assert.match(restored, /name="directory"[^>]*value="\/workspace\/other\/raw"/);
    assert.match(renderCollection(prepared), /<input(?=[^>]*name="limit")(?=[^>]*readonly)(?=[^>]*value="5")/i);
    assert.match(renderCollection(prepared, true), /<button[^>]*disabled[^>]*>采集 5 条/);
    assert.doesNotMatch(renderCollection({...prepared, manual_start: false}), /并运行一轮/);
    const run = {
      run_id: 'production-run',
      release_id: 'production-release',
      execution_mode: 'published',
      round_no: 3,
      trigger: 'manual',
      inputs: {tracer_batch: {batch_id: 'batch-00000000', resource_id: 'em-test'}},
      status: 'waiting_external',
      current_stage_ids: ['eval-now'],
      promotion_result: {},
    } as GraphRun;
    const recent = {...run, run_id: 'completed-run', status: 'succeeded'};
    const debug = {...run, run_id: 'debug-run', execution_mode: 'debug'};
    const oldRelease = {...run, run_id: 'old-run', release_id: 'old-release'};
    assert.equal(selectProductionRun([debug, recent, oldRelease, run], run.release_id), run);
    assert.equal(selectProductionRun([debug, recent, oldRelease], run.release_id), recent);

    const detail = {
      run,
      stage_runs: [{
        run_id: 'eval-before',
        node_type: 'evaluator',
        status: 'failed',
        attempt: 1,
        error: '以前的失败',
        task_runs: [],
      }, {
        run_id: 'dataset',
        node_type: 'dataset',
        status: 'succeeded',
        attempt: 1,
        task_runs: [{provider_run_id: '1075'}],
      }, {
        run_id: 'eval-now',
        node_type: 'evaluator',
        status: 'waiting_external',
        attempt: 2,
        task_runs: [{
          stage_run_id: 'eval-now',
          provider_run_id: '1078',
          status: 'running',
          provider_reported_status: 'running',
        }],
      }, {
        run_id: 'train',
        node_type: 'train',
        status: 'succeeded',
        attempt: 1,
        task_runs: [{provider_run_id: '1077'}],
      }],
      task_runs: [],
    } as GraphRunDetail;
    const render = () => renderToStaticMarkup(createElement(ProductionFlywheel, {
      run,
      detail,
      simulation: null,
      onOpenRun: () => {},
    }));

    const live = render();
    const cards = live.match(/<li\b[^>]*>[\s\S]*?<\/li>/g) ?? [];
    assert.equal(cards.length, 5);
    assert.match(cards[0], /轨迹采集.*已封批.*batch-00000000/);
    assert.match(cards[1], /Dataset.*成功.*平台任务 1075/);
    assert.match(cards[2], /Train.*成功.*平台任务 1077/);
    assert.match(cards[3], /aria-current="step".*Eval.*平台执行中.*平台任务 1078/);
    assert.match(live, /已完成 2\/3 个执行节点 · Eval 平台执行中 · 平台任务 1078/);
    assert.doesNotMatch(live, /以前的失败/);

    const evaluation = detail.stage_runs[2];
    evaluation.task_runs[0].provider_reported_status = 'succeeded';
    evaluation.message = '需要项目所有者的浏览器会话';
    const verifying = render();
    assert.match(verifying, /Eval.*等待校验产物.*平台任务 1078.*需要项目所有者的浏览器会话/);

    evaluation.status = 'failed';
    evaluation.error = '评测报告缺失';
    run.status = 'paused';
    assert.match(render(), /aria-current="step".*Eval.*失败.*评测报告缺失/);

    evaluation.status = 'succeeded';
    run.current_stage_ids = [];
    run.status = 'succeeded';
    run.outcome = 'baseline_retained';
    run.promotion_result = {reason: 'finalizer_not_configured'};
    const complete = render();
    assert.match(complete, /本轮结果.*已完成.*保留当前线上模型，未配置自动切换/);
    assert.match(complete, /已完成 3\/3 个执行节点 · 执行成功/);
    assert.doesNotMatch(complete, /aria-current="step"/);
    run.inputs.tracer_batch = {};
    assert.match(render(), /轨迹采集.*使用运行输入/);
  } finally {
    await server.close();
  }
});
