import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import type { ModelEvaluationRecord } from '../src/echomindOperations.ts';

function candidate(overrides: Partial<ModelEvaluationRecord> = {}): ModelEvaluationRecord {
  return {
    candidate_id: 'candidate-a', project_id: 'project-a', run_id: 'run-a', release_id: 'release-a',
    round_no: 1, execution_mode: 'published', source_batch_id: 'batch-a',
    model_uri: '/workspace/models/checkpoint-15', deployment_model_uri: '/workspace/models/merged-a',
    training_base_uri: '/workspace/models/base', report_uri: '/workspace/reports/report.json',
    report_html_uri: '/workspace/reports/evaluation_report.html', evaluation_dataset_uri: '/workspace/holdout.jsonl',
    created_at: '2026-11-17T06:34:02Z', report_status: 'ready', evaluation_status: 'validated',
    metrics: {pass_rate: 0.8, mean_latency_seconds: 0.6}, dataset_sha256: 'a'.repeat(64),
    evaluation_config_sha256: 'b'.repeat(64), comparison_group: 'verified-group',
    rubrics: [{name: 'label_accuracy', criterion: '分类与确认标签一致', weight: 4, required: true}],
    pass_threshold: 0.7, issues: [], ...overrides,
  };
}

test('Project model operations preserve evaluation and manual deployment boundaries', async t => {
  const server = await createServer({
    define: {'window.location.host': JSON.stringify('localhost:5173')},
    server: {middlewareMode: true, ws: false}, optimizeDeps: {noDiscovery: true, include: []}, appType: 'custom',
  });
  try {
    const {comparable, rankCandidates, deployable} = await server.ssrLoadModule('/src/echomindOperations.ts');

    await t.test('comparison needs the same Project and verified evaluation fingerprints', () => {
      const original = candidate();
      assert.equal(comparable(original, candidate({candidate_id: 'candidate-b'})), true);
      for (const changes of [
        {comparison_group: 'different-group'}, {comparison_group: null},
        {dataset_sha256: null}, {evaluation_config_sha256: null},
        {project_id: 'project-b'}, {evaluation_status: 'invalid'}, {report_status: 'pending' as const},
      ]) {
        assert.equal(comparable(original, candidate(changes)), false);
      }
    });

    await t.test('ranking is limited to one verified group and does not fabricate missing metrics', () => {
      const slow = candidate({candidate_id: 'slow', metrics: {pass_rate: 0.9, mean_latency_seconds: 0.9}});
      const fast = candidate({candidate_id: 'fast', metrics: {pass_rate: 0.7, mean_latency_seconds: 0.1}});
      const excluded = [
        candidate({candidate_id: 'other-data', comparison_group: 'other-group', metrics: {pass_rate: 1}}),
        candidate({candidate_id: 'no-fingerprint', dataset_sha256: null}),
        candidate({candidate_id: 'invalid', evaluation_status: 'invalid'}),
        candidate({candidate_id: 'no-score', metrics: {}}),
        candidate({candidate_id: 'infinite', metrics: {pass_rate: Infinity}}),
      ];
      const records = [fast, ...excluded, slow];
      const order = records.map(item => item.candidate_id);
      assert.deepEqual(rankCandidates(records, 'verified-group', 'pass_rate').map(item => item.candidate_id), ['slow', 'fast']);
      assert.deepEqual(rankCandidates(records, 'verified-group', 'mean_latency_seconds', true).map(item => item.candidate_id), ['fast', 'slow']);
      assert.deepEqual(rankCandidates(records, '', 'pass_rate'), []);
      assert.deepEqual(rankCandidates(records, 'verified-group', 'fail_recall'), []);
      assert.deepEqual(records.map(item => item.candidate_id), order);
    });

    await t.test('only validated production evaluations with a complete deployable model can be selected', () => {
      assert.equal(deployable(candidate()), true);
      for (const changes of [
        {execution_mode: 'debug' as const}, {evaluation_status: 'invalid'}, {evaluation_status: 'valid'},
        {evaluation_status: null}, {report_status: 'pending' as const}, {report_status: 'invalid' as const},
        {deployment_model_uri: null}, {deployment_model_uri: '   '},
      ]) assert.equal(deployable(candidate(changes)), false);
    });

    await t.test('report card shows actual rules and distinguishes sample threshold from deployment policy', async () => {
      const {ModelReportCard} = await server.ssrLoadModule('/src/components/ProjectModelOperations.tsx');
      const render = (record: ModelEvaluationRecord) => renderToStaticMarkup(createElement(ModelReportCard, {
        candidate: record, selected: false, current: false, busy: false,
        onSelect() {}, onRead() {}, onRun() {}, onDeploy() {},
      }));
      const html = render(candidate());
      assert.match(html, /分类与确认标签一致/);
      assert.match(html, /权重 4/);
      assert.match(html, /必须通过/);
      assert.match(html, /样本通过阈值：0\.7/);
      assert.match(html, /不代表模型上线标准/);
      assert.doesNotMatch(html, /<button[^>]* disabled=""[^>]*>部署到 Inference/);
      assert.match(render(candidate({execution_mode: 'debug'})), /<button[^>]* disabled=""[^>]*>部署到 Inference/);
      assert.match(render(candidate({report_status: 'invalid'})), /<button[^>]* disabled=""[^>]*>部署到 Inference/);
    });

    await t.test('case details preserve the reference and failed rubric without interpreting model output as HTML', async () => {
      const {EvaluationCaseCard} = await server.ssrLoadModule('/src/components/ProjectReportViewer.tsx');
      const html = renderToStaticMarkup(createElement(EvaluationCaseCard, {
        item: {
          id: 'avi-case-2', status: 'failed', overall_score: 0.4,
          reference: {label: 'fail'}, prediction: '<script>wrong()</script>',
          input: {prompt: '检查图片'}, media: [{caption: '/workspace/example.png'}], error: null,
          rubric_items: [{name: 'label', criterion: '标签一致', passed: false, score: 0, failure_reason: '预测与确认标签不同'}],
        },
        renderMedia() { return null; },
      }));
      assert.match(html, /确认标签 \/ GT/);
      assert.match(html, /fail/);
      assert.match(html, /预测与确认标签不同/);
      assert.match(html, /&lt;script&gt;wrong\(\)&lt;\/script&gt;/);
      assert.doesNotMatch(html, /<script>/);
    });
  } finally {
    await server.close();
  }
});
