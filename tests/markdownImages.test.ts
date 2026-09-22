import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('only assistant text renders Markdown; signed images and legacy images remain usable', async () => {
  const server = await createServer({
    server: { middlewareMode: true, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom',
  });
  try {
    const { MessageBubble } = await server.ssrLoadModule('/src/components/MessageBubble.tsx');
    const { ContentList } = await server.ssrLoadModule('/src/components/ContentList.tsx');
    const url = 'https://storage.test/image.png?credential=a%2Fb&signature=123';
    const text = `Sample image\n\n![sample](${url})\n\n\`\`\`python\nprint("hello")\n\`\`\`\n\n<script>alert(1)</script>`;
    const content = [{ type: 'text', text }, { type: 'image', image_urls: ['data:image/png;base64,YQ=='] }];
    const renderMessage = (source: string) => renderToStaticMarkup(createElement(MessageBubble, {
      event: { source, llm_message: { content } },
    }));
    const assistant = renderMessage('agent');
    assert.ok(assistant.includes('src="https://storage.test/image.png?credential=a%2Fb&amp;signature=123"'));
    assert.ok(assistant.includes('alt="sample"'));
    assert.ok(assistant.includes('loading="lazy"'));
    assert.ok(assistant.includes('<pre'));
    assert.ok(assistant.includes('language-python'));
    assert.ok(assistant.includes('Sample image'));
    assert.ok(!assistant.includes('<script>'));
    assert.ok(assistant.includes('src="data:image/png;base64,YQ=="'));
    const user = renderMessage('user');
    assert.ok(user.includes('![sample]('));
    assert.ok(!user.includes('alt="sample"'));
    const tool = renderToStaticMarkup(createElement(ContentList, { content }));
    assert.ok(tool.includes('![sample]('));
    assert.ok(!tool.includes('alt="sample"'));
  } finally {
    await server.close();
  }
});
