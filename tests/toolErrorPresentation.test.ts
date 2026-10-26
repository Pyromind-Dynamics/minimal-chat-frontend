import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getObservationDisplayText,
  getToolErrorPresentation,
  getUserInputInterruption,
} from '../src/toolErrorPresentation.ts';

test('structured tool errors display the specific output, code, and suggestion', () => {
  const presentation = getToolErrorPresentation({
    is_error: true,
    error_code: 'sample_selection_limit',
    error_message: 'details fallback',
    suggestion: 'Reduce sample_paths or increase n.',
    to_llm_content: [
      { type: 'text', text: '[An error occurred during execution.]\n' },
      {
        type: 'text',
        text: 'sample_paths contains 4 entries, but n allows at most 3.',
      },
    ],
  });

  assert.deepEqual(presentation, {
    message: 'sample_paths contains 4 entries, but n allows at most 3.',
    errorCode: 'sample_selection_limit',
    suggestion: 'Reduce sample_paths or increase n.',
  });
});

test('details message is used when the only output is the generic header', () => {
  assert.equal(getObservationDisplayText({
    is_error: true,
    error_code: 'sample_selection_limit',
    error_message: 'Choose no more than n paths.',
    content: [{ type: 'text', text: '[An error occurred during execution.]' }],
  }), 'Choose no more than n paths.');
});

test('legacy generic-only failures explain that the reason was not retained', () => {
  assert.equal(getObservationDisplayText({
    is_error: true,
    error_code: 'tool_execution_failed',
    to_llm_content: [
      { type: 'text', text: '[An error occurred during execution.]\n' },
    ],
  }), '工具执行失败（未保存具体原因）');
});

test('successful observations retain their text', () => {
  assert.equal(getObservationDisplayText({
    is_error: false,
    to_llm_content: [{ type: 'text', text: 'workflow valid' }],
  }), 'workflow valid');
});

test('confirmed user-input resolutions display cancellation or interruption', () => {
  assert.deepEqual(getUserInputInterruption('ask_user', {
    is_error: true, user_input: { status: 'cancelled' },
  }), { label: '已取消', message: '用户已取消本次提问。' });
  assert.deepEqual(getUserInputInterruption('ask_user', {
    is_error: true, user_input: { status: 'interrupted' },
  }), { label: '已中断', message: '本次提问已中断，可发送新消息继续。' });
});

test('abort text alone and other tool failures are not treated as cancelled input', () => {
  assert.equal(getUserInputInterruption('ask_user', {
    is_error: true, to_llm_content: [{ type: 'text', text: 'This operation was aborted' }],
  }), null);
  assert.equal(getUserInputInterruption('terminal', {
    is_error: true, user_input: { status: 'cancelled' },
  }), null);
});
