import { executionLabel, type ExperimentExecution } from '../experimentExecutions';

export function ExperimentExecutionPanel({ executions, revision }: {
  executions: readonly ExperimentExecution[]; revision: number;
}) {
  if (!executions.length) return null;
  return <section aria-label="实验执行记录" className="mt-5 space-y-3">
    <h3 className="font-semibold">执行记录</h3>
    {executions.map(run => <details key={run.run_id} className="rounded border bg-white p-3">
      <summary className="text-sm font-medium">{run.task_name} · {executionLabel(run.state)}</summary>
      <p className="mt-2 break-all text-xs text-slate-600">执行 {run.run_id} · 计划版本 {run.plan_revision}</p>
      {run.plan_revision !== revision && <p className="mt-2 text-xs text-amber-800">历史计划的执行结果，不自动用于当前版本。</p>}
      {run.platform_task_id && <p className="mt-2 text-xs">平台任务 {run.platform_task_id}</p>}
      {run.state === 'submission_uncertain' && <p className="mt-2 text-sm text-amber-800">平台可能已经受理，禁止重复提交。请核对原任务。</p>}
      {run.proposal && <details className="mt-3 text-xs"><summary>冻结的执行方案</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap">{JSON.stringify(run.proposal, null, 2)}</pre></details>}
      {run.metrics && <div className="mt-3"><h4 className="text-sm font-medium">真实评测指标</h4><pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(run.metrics, null, 2)}</pre></div>}
      <p className="mt-3 text-xs text-slate-600">报告：{({ not_started: '尚未生成', queued: '等待生成', running: '生成中', succeeded: '已生成', failed: '生成失败' } as Record<string, string>)[run.report_state] ?? run.report_state}</p>
      {run.artifacts.length > 0 && <ul className="mt-2 space-y-1 text-xs">{run.artifacts.map(artifact => <li key={artifact.name} className="break-all">{artifact.name}：{artifact.uri}</li>)}</ul>}
    </details>)}
  </section>;
}
