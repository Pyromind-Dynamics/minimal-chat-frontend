import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('assistant Markdown supports GFM blocks and safe external links', async () => {
  const server = await createServer({
    server: { middlewareMode: true, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom',
  });
  try {
    const { MessageBubble } = await server.ssrLoadModule('/src/components/MessageBubble.tsx');
    const text = [
      '## Heading',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| alpha | 1 |',
      '',
      '- [x] done',
      '- [ ] todo',
      '',
      '> quoted',
      '',
      '[link](https://example.com) and `inline`',
    ].join('\n');
    const markup = renderToStaticMarkup(createElement(MessageBubble, {
      event: {
        source: 'agent',
        llm_message: { content: [{ type: 'text', text }] },
      },
    }));

    assert.ok(markup.includes('<h2'), 'heading should render as h2');
    assert.ok(markup.includes('<table'), 'GFM table should render');
    assert.ok(markup.includes('<th'), 'table header cell should render');
    assert.ok(markup.includes('<td'), 'table body cell should render');
    assert.ok(markup.includes('type="checkbox"'), 'task list checkbox should render');
    assert.ok(markup.includes('<blockquote'), 'blockquote should render');
    assert.ok(markup.includes('href="https://example.com"'));
    assert.ok(markup.includes('target="_blank"'));
    assert.ok(markup.includes('rel="noreferrer noopener"'));
    assert.ok(markup.includes('<code>inline</code>'));
  } finally {
    await server.close();
  }
});
