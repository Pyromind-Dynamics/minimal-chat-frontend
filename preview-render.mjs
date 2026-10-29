import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const sample = readFileSync(new URL('./src/preview.tsx', import.meta.url), 'utf8')
  .match(/const sample = `([\s\S]*?)`;/)[1]
  .replace(/\\`/g, '`');

const server = await createServer({
  server: { middlewareMode: true, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
});

try {
  const { MarkdownContent } = await server.ssrLoadModule('/src/components/MarkdownContent.tsx');
  const markup = renderToStaticMarkup(
    createElement(
      'div',
      { className: 'flex justify-start' },
      createElement(
        'div',
        {
          className:
            'max-w-[80%] rounded-xl rounded-bl-sm bg-gray-100 px-4 py-2.5 text-sm whitespace-pre-wrap text-gray-900',
        },
        createElement(MarkdownContent, {
          imageClassName: 'max-h-72 max-w-full rounded-lg object-contain',
        }, sample),
      ),
    ),
  );

  const cssFile = readdirSync(new URL('./dist/assets/', import.meta.url))
    .find((name) => name.endsWith('.css'));
  const css = readFileSync(new URL(`./dist/assets/${cssFile}`, import.meta.url), 'utf8');

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Markdown static preview</title>
    <style>${css}</style>
  </head>
  <body>
    <div class="min-h-screen bg-white p-6">
      <div class="mx-auto flex max-w-3xl flex-col gap-3">
        <div class="flex justify-end">
          <div class="max-w-[80%] rounded-xl rounded-br-sm bg-blue-600 px-4 py-2.5 text-sm whitespace-pre-wrap text-white">用 **Markdown** 展示一下结构化结果</div>
        </div>
        ${markup}
      </div>
    </div>
  </body>
</html>`;

  writeFileSync(new URL('./dist/preview-static.html', import.meta.url), html);
  console.log('wrote dist/preview-static.html');
} finally {
  await server.close();
}
