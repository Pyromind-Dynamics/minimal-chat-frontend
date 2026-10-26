import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUserInputAnswers, recommendedUserInputDrafts } from '../src/userInput.ts';

const request = {
  request_id: 'input-1',
  questions: [
    { id: 'format', prompt: '格式', options: [{ id: 'csv', label: 'CSV' }] },
    { id: 'name', prompt: '文件名', options: [] },
  ],
};

test('selects explicitly recommended options across questions without guessing or answering text questions', () => {
  assert.deepEqual(recommendedUserInputDrafts({
    request_id: 'recommendations',
    questions: [
      { id: 'format', prompt: '格式', options: [
        { id: 'csv', label: 'CSV' }, { id: 'pdf', label: 'PDF（推荐）' },
      ] },
      { id: 'scope', prompt: '范围', options: [
        { id: 'summary', label: 'Summary (Recommended)' }, { id: 'full', label: 'Full' },
      ] },
      { id: 'name', prompt: '名称', options: [] },
      { id: 'unmarked', prompt: '没有推荐', options: [{ id: 'first', label: '默认选项' }] },
      { id: 'negative', prompt: '否定推荐', options: [{ id: 'bad', label: '不推荐' }] },
      { id: 'ambiguous', prompt: '多个推荐', options: [
        { id: 'a', label: 'A（推荐）' }, { id: 'b', label: 'B（推荐）' },
      ] },
    ],
  }), {
    format: { kind: 'option', value: 'pdf' },
    scope: { kind: 'option', value: 'summary' },
  });
});

test('requires an explicit answer for every question', () => {
  assert.equal(buildUserInputAnswers(request, {}), null);
  assert.equal(buildUserInputAnswers(request, { format: { kind: 'option', value: 'csv' } }), null);
  assert.equal(buildUserInputAnswers(request, {
    format: { kind: 'option', value: 'csv' }, name: { kind: 'text', value: '  ' },
  }), null);
});

test('submits mixed option and free-text answers without mutually exclusive fields', () => {
  assert.deepEqual(buildUserInputAnswers(request, {
    format: { kind: 'option', value: 'csv' }, name: { kind: 'text', value: ' 中文报表.csv ' },
  }), [{ question_id: 'format', option_id: 'csv' }, { question_id: 'name', text: '中文报表.csv' }]);
});

test('allows custom text on an option question, but rejects an unknown option id', () => {
  assert.deepEqual(buildUserInputAnswers(request, {
    format: { kind: 'text', value: 'parquet' }, name: { kind: 'text', value: 'report' },
  }), [{ question_id: 'format', text: 'parquet' }, { question_id: 'name', text: 'report' }]);
  assert.equal(buildUserInputAnswers(request, {
    format: { kind: 'option', value: 'unknown' }, name: { kind: 'text', value: 'report' },
  }), null);
});
