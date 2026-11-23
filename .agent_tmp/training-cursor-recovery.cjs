const assert = require('node:assert/strict');
const { chromium } = require('/Users/wzijin/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const base = 'http://127.0.0.1:5173';

async function main() {
  const entry = await (await fetch(base + '/src/main.tsx')).text();
  const react = entry.match(/\/node_modules\/\.vite\/deps\/react\.js\?v=[\da-f]+/)[0];
  const reactDom = entry.match(/\/node_modules\/\.vite\/deps\/react-dom_client\.js\?v=[\da-f]+/)[0];
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const failRetry of [false, true]) {
      const page = await browser.newPage();
      const cursors = [];
      let completeRetry;
      const retryGate = new Promise(resolve => { completeRetry = resolve; });
      let retryReceived;
      const retryStarted = new Promise(resolve => { retryReceived = resolve; });
      await page.route('**/src/main.tsx*', route => route.fulfill({
        contentType: 'application/javascript',
        body: `
          import React from '${react}';
          import dom from '${reactDom}';
          import { TrainingMetricPanel } from '/src/components/observations/TrainingMetricPanel.tsx';
          import { createProductClient } from '/src/productClient.ts';
          const client = createProductClient('/api/v2/echomind/conversations');
          const panel = { project_node_id: 'train', training_type: 'SFT',
            metrics: [{ key: 'loss', title: 'loss', axis: 'training_step', axis_key: 'step' }] };
          const bindings = [{ project_node_id: 'train', run_id: 'r22', task_id: 'task', business_status: 'succeeded' }];
          function TestPanel() {
            const [open, setOpen] = React.useState(true);
            return React.createElement(React.Fragment, {},
              React.createElement('button', { onClick: () => setOpen(!open) }, 'Toggle Train'),
              open && React.createElement(TrainingMetricPanel, { client, panel, bindings,
                projectId: 'p', configVersion: 'v1', options: {}, reportedTaskIds: ['task'] }));
          }
          dom.createRoot(document.getElementById('root')).render(React.createElement(TestPanel));
        `,
      }));
      const point = (step, value) => ({ key: 'loss', training_step: step, log_step: step, time: null, unit: '', value, source_point_id: 'r22-' + step, source_run_id: 'source-r22' });
      const body = (cursor, points) => ({
        project_id: 'p', project_node_id: 'train', run_id: 'r22', config_version: 'v1',
        next_cursor: cursor, points, truncated: false, gap: false, observation_status: 'available',
        analysis_status: 'not_requested', observed_at: '2026-11-20T05:30:00Z',
      });
      await page.route('**/observations/series?*', async route => {
        const cursor = new URL(route.request().url()).searchParams.get('cursor');
        cursors.push(cursor);
        if (cursors.length === 1) {
          return route.fulfill({ json: body('old-cursor', [point(1, 0.5), point(2, 0.3)]) });
        }
        if (cursor === 'old-cursor') {
          return route.fulfill({ status: 422, json: { detail: 'Invalid or expired observations cursor' } });
        }
        retryReceived();
        await retryGate;
        return failRetry
          ? route.fulfill({ status: 422, json: { detail: 'Metric key is not configured for this panel' } })
          : route.fulfill({ json: body('new-cursor', [point(1, 0.5), point(2, 0.3), point(3, 0.2)]) });
      });
      try {
        await page.goto(base);
        const initial = page.getByRole('group', { name: 'loss，2 个点，step' });
        await initial.waitFor();
        const toggle = page.getByRole('button', { name: 'Toggle Train', exact: true });
        await toggle.click();
        await initial.waitFor({ state: 'detached' });
        await toggle.click();
        await Promise.race([retryStarted, new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error('Cursor retry did not start immediately')), 3000);
          timer.unref();
        })]);
        assert.deepEqual(cursors, [null, 'old-cursor', null]);
        await initial.waitFor();
        assert.equal(await page.getByRole('alert').count(), 0);
        completeRetry();
        if (failRetry) {
          const alert = page.getByRole('alert');
          await alert.waitFor();
          assert.match(await alert.textContent(), /Metric key is not configured/);
          assert.equal(await initial.count(), 1);
        } else {
          await page.getByRole('group', { name: 'loss，3 个点，step' }).waitFor();
          assert.equal(await page.getByRole('alert').count(), 0);
        }
        assert.equal(cursors.length, 3);
      } finally {
        completeRetry();
        await page.close();
      }
    }
    console.log('Browser regression passed: reopened curve retains cached points, retries once without cursor, then either refreshes or reports the persistent error');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
