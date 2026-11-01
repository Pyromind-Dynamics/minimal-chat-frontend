import { executionLabel, type ExperimentExecution } from '../experimentExecutions';
import { useState } from 'react';

export function ExperimentExecutionPanel({ executions, revision, onControl, onResolve, onReadArtifact, busy }: {
  executions: readonly ExperimentExecution[]; revision: number | null;
  onControl?: (runId: string, action: 'cancel' | 'retry_report') => Promise<void>;
  onResolve?: (runId: string, action: 'bind' | 'abandon', taskId?: string) => Promise<void>;
  onReadArtifact?: (runId: string, name: string) => Promise<{content: string}>;
  busy?: boolean;
}) {
  const [preview, setPreview] = useState<{key: string; content: string} | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!executions.length) return null;
  return <section aria-label="实验执行记录" className="mt-5 space-y-3">
    <h3 className="font-semibold">执行记录</h3>
    {executions.map(run => <details key={run.run_id} className="rounded border bg-white p-3">
      <summary className="text-sm font-medium">{run.task_name} · {executionLabel(run.state)}</summary>
      <p className="mt-2 break-all text-xs text-slate-600">执行 {run.run_id}{run.plan_revision != null ? ` · 历史计划版本 ${run.plan_revision}` : ` · ${run.role_id}`}</p>
      {revision != null && run.plan_revision !== revision && <p className="mt-2 text-xs text-amber-800">历史计划的执行结果，不自动用于当前版本。</p>}
      {run.platform_task_id && <p className="mt-2 text-xs">平台任务 {run.platform_task_id}</p>}
      {run.summary && <p className="mt-2 whitespace-pre-wrap text-sm">{run.summary}</p>}
      {run.waiting_reason && <p className="mt-2 text-sm text-amber-800">{run.waiting_reason}</p>}
      {run.blockers?.map((text, index) => <p key={index} className="mt-2 text-sm text-amber-800">{text}</p>)}
      {run.state === 'submission_uncertain' && <p className="mt-2 text-sm text-amber-800">平台可能已经受理，禁止重复提交。请核对原任务。</p>}
      {run.state === 'submission_uncertain' && onResolve && <form className="mt-2 space-y-2 text-xs" onSubmit={event => {
        event.preventDefault(); const taskId = String(new FormData(event.currentTarget).get('task_id') ?? '').trim();
        if (taskId) void onResolve(run.run_id, 'bind', taskId);
      }}>
        <label>原平台任务 ID <input name="task_id" required className="rounded border p-1" /></label>
        <p>绑定需核实原提交记录；证据不足时继续保留待核对状态。</p>
        <div className="flex gap-3"><button disabled={busy} type="submit" className="text-blue-700">核对并绑定</button>
          <button disabled={busy} type="button" className="text-red-700" onClick={() => { void onResolve(run.run_id, 'abandon'); }}>终止本次跟踪（平台任务可能仍在运行）</button></div>
      </form>}
      {run.proposal && <details className="mt-3 text-xs"><summary>冻结的执行方案</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap">{JSON.stringify(run.proposal, null, 2)}</pre></details>}
      {run.metrics && <div className="mt-3"><h4 className="text-sm font-medium">真实评测指标</h4><pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(run.metrics, null, 2)}</pre></div>}
      <p className="mt-3 text-xs text-slate-600">报告：{({ not_started: '尚未生成', queued: '等待生成', running: '生成中', ready: '已生成', succeeded: '已生成', failed: '生成失败' } as Record<string, string>)[run.report_state] ?? run.report_state}</p>
      {onControl && run.plan_revision == null && <div className="mt-3 flex gap-3 text-sm">
        {['queued', 'preparing', 'waiting_platform', 'waiting_artifacts', 'needs_input'].includes(run.state) && <button disabled={busy} onClick={() => { void onControl(run.run_id, 'cancel'); }} className="text-red-700">取消任务</button>}
        {run.report_state === 'failed' && <button disabled={busy} onClick={() => { void onControl(run.run_id, 'retry_report'); }} className="text-blue-700">仅重试报告</button>}
      </div>}
      {run.artifacts.length > 0 && <ul className="mt-2 space-y-1 text-xs">{run.artifacts.map(artifact => <li key={artifact.name} className="break-all">{artifact.name}：{artifact.uri}</li>)}</ul>}
      {onReadArtifact && <div className="mt-2 flex flex-wrap gap-3 text-xs">{run.artifacts.map(artifact => <button key={artifact.name} disabled={busy} className="text-blue-700" onClick={() => {
        setError(null); void onReadArtifact(run.run_id, artifact.name).then(value => setPreview({key: run.run_id, content: value.content})).catch(failure => setError(String(failure)));
      }}>查看 {artifact.name}</button>)}</div>}
      {preview?.key === run.run_id && <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs">{preview.content}</pre>}
    </details>)}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
