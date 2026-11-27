import { useState } from 'react';
import { projectExecutionQueue } from '../preparation';
import type { ConversationSnapshot } from '../types';

export function ProjectExecutionQueue({ snapshot }: { snapshot: ConversationSnapshot }) {
  const tasks = projectExecutionQueue(snapshot);
  const [copyResult, setCopyResult] = useState<{ id: string; ok: boolean }>();

  async function copyTaskId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopyResult({ id, ok: true });
    } catch {
      setCopyResult({ id, ok: false });
    }
  }

  return <section className="project-execution-queue" aria-label="任务执行队列">
    <header>
      <h2>任务执行队列</h2>
      <span role="status">{tasks.length ? `${tasks.length} 项排队中` : '暂无排队任务'}</span>
    </header>
    {tasks.length > 0 && <ul>
      {tasks.map(task => <li key={task.id}>
        <span className="project-queued-task-name" title={task.name}>{task.name}</span>
        <button type="button" aria-label={`复制任务 ID：${task.name}`} onClick={() => { void copyTaskId(task.id); }}>
          {copyResult?.id === task.id && copyResult?.ok ? '已复制' : '复制 ID'}
        </button>
      </li>)}
    </ul>}
    <span className="sr-only" role="status">
      {tasks.some(task => task.id === copyResult?.id) && copyResult?.ok ? '任务 ID 已复制' : ''}
    </span>
    {copyResult && !copyResult.ok && tasks.some(task => task.id === copyResult.id) &&
      <p className="project-queue-copy-error" role="alert">复制失败，请检查浏览器剪贴板权限后重试。</p>}
  </section>;
}
