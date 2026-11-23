import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluationSummaryMetrics } from '../src/evaluationSummary.ts';
import { visibleDatasetDistributions } from '../src/datasetPresentation.ts';

test('baseline rates use evaluated-case counts and keep errors separate', () => {
  const rows = evaluationSummaryMetrics({ total: 100, passed: 30, failed: 70, pass_rate: .3, api_or_evaluation_errors: 2, mean_latency_seconds: .5 }).summary;
  assert.equal(rows.find(row => row.key === 'pass_rate')?.value, .3);
  assert.equal(rows.find(row => row.key === 'failure_rate')?.value, .7);
  assert.equal(rows.find(row => row.key === 'pass_rate')?.detail, '30 / 100');
  assert.equal(rows.find(row => row.key === 'api_or_evaluation_errors')?.value, 2);
  assert.equal(rows.find(row => row.key === 'mean_latency_seconds')?.unit, 'seconds');
});

test('missing or invalid counts do not become a fabricated failure rate', () => {
  assert.equal(evaluationSummaryMetrics({ total: 0, passed: 0, failed: 0, pass_rate: 0 }).summary.some(row => row.unit === 'ratio'), false);
  assert.equal(evaluationSummaryMetrics({ pass_rate: .8 }).summary.find(row => row.key === 'failure_rate'), undefined);
  assert.equal(evaluationSummaryMetrics({ total: 2, passed: 4, failed: -1, mean_latency_seconds: NaN }).summary.length, 1);
});

test('optional report rubrics are dynamic, and classification scores keep their units', () => {
  const rows = evaluationSummaryMetrics({ rubric_metrics: { custom_task: { pass_rate: .6, classification: { accuracy: .65, macro_f1: .55 } }, result_correct: { classification: { macro_f1: 0 } }, unrelated: null } }).additional;
  assert.equal(rows.find(row => row.key === 'custom_task.pass_rate')?.value, .6);
  assert.equal(rows.find(row => row.key === 'custom_task.accuracy')?.unit, 'ratio');
  assert.equal(rows.find(row => row.key === 'custom_task.macro_f1')?.unit, 'number');
  assert.equal(rows.find(row => row.key === 'result_correct.macro_f1')?.value, 0);
});

test('only a split duplicating the total is hidden across dataset scenarios', () => {
  assert.deepEqual(visibleDatasetDistributions({ split: { train: 3 }, label: { pass: 1, defect: 2 } }, 3).map(([name]) => name), ['label']);
  assert.deepEqual(visibleDatasetDistributions({ split: { train: 8, test: 2 }, language: { en: 7, zh: 3 } }, 10).map(([name]) => name), ['split', 'language']);
  assert.equal(visibleDatasetDistributions({ split: { train: 3 } }, null).length, 1);
  assert.equal(visibleDatasetDistributions({ split: { train: 3 } }, 5).length, 1);
  assert.deepEqual(visibleDatasetDistributions({ category: { a: 1, b: 2 }, task: { transcription: 3 }, label: { positive: 3 } }, 3).map(([name]) => name), ['label']);
});
