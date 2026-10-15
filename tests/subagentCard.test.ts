import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('subagent card expands while running and preserves cancellation semantics', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
  try {
    const { SubAgentBlock } = await server.ssrLoadModule('/src/components/SubAgentBlock.tsx');
    const action = { kind: 'ActionEvent', id: 'child', timestamp: '', category: 'subagent', tool_call: { name: 'search', arguments: {} },
      details: { subagent: { version: 1, role: 'search', task: 'Find evidence', status: 'running' } } };
    const render = (status: string, error?: string) => renderToStaticMarkup(createElement(SubAgentBlock, {
      action, observation: { observation: { operation_status: status, error_code: error } },
    }));
    assert.match(render('running'), /aria-expanded="false"/);
    assert.match(render('running'), /运行中/);
    assert.match(render('failed', 'subagent_interrupted'), /已中断/);
    assert.doesNotMatch(render('failed', 'subagent_stopped'), /运行中/);
    assert.match(render('completed'), /已完成/);
  } finally { await server.close(); }
});
