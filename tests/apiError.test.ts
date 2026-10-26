import assert from 'node:assert/strict';
import test from 'node:test';
import { formatApiError } from '../src/apiError.ts';

test('validation errors show the reason without echoing the submitted answer', () => {
  const body = JSON.stringify({ detail: [{ msg: 'Value error, input response exceeds the size limit', input: { text: 'x'.repeat(66000) } }] });
  assert.equal(formatApiError(422, body), 'Request failed: 422 Value error, input response exceeds the size limit');
});

test('product errors keep their code and proxy errors stay bounded', () => {
  assert.equal(formatApiError(409, JSON.stringify({ detail: { code: 'input_pending', message: 'Answer first.' } })), 'Request failed: 409 input_pending: Answer first.');
  assert.equal(formatApiError(503, JSON.stringify({ detail: 'Retry later.' })), 'Request failed: 503 Retry later.');
  assert.ok(formatApiError(502, 'x'.repeat(66000)).length < 1100);
});
