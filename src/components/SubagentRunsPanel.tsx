import { useMemo } from 'react';
import { operationCard } from '../productSnapshot';
import { groupSubagentOperations, subagentDisplay, subagentStatus, subagentStatusLabel } from '../subagentPresentation';
import type { TimelineOperation } from '../types';
import { SubAgentBlock } from './SubAgentBlock';
import { executionProgressLabel, type ExperimentExecution } from '../experimentExecutions';

function runState(history: TimelineOperation[], executions: readonly ExperimentExecution[]) {
  const latest = history.at(-1)!;
  const execution = executions.find(run => run.run_id === latest.execution?.task_run_id);
  const native = subagentStatus(latest.details, latest.status, latest.error_code);
  return execution && execution.state !== 'preparing'
    ? { state: execution.state, label: executionProgressLabel(execution) }
    : { state: native, label: subagentStatusLabel(native) };
}

export function SubagentRunsPanel({ operations, executions = [] }: {
  operations: TimelineOperation[]; executions?: readonly ExperimentExecution[];
}) {
  const { histories, related } = useMemo(() => {
    const groups = groupSubagentOperations(operations);
    const priority = (history: TimelineOperation[]) => {
      const { state } = runState(history, executions);
      return ({ running: 0, analyzing: 0, queued: 1, waiting_platform: 1, waiting_analysis: 1, paused: 2, unknown: 3 } as Record<string, number>)[state] ?? 4;
    };
    return {
      histories: [...groups.runs.values()].sort((a, b) =>
        priority(a) - priority(b) || b.at(-1)!.started_seq - a.at(-1)!.started_seq),
      related: groups.related,
    };
  }, [operations, executions]);
  const current = histories[0]?.at(-1);
  if (!current) return null;
  const display = subagentDisplay(current.details);
  const { label } = runState(histories[0], executions);
  return <details aria-label="子 Agent 运行记录" className="mb-3 border-b border-slate-200 pb-3">
    <summary className="cursor-pointer text-xs text-slate-700">
      <span className="font-medium">{label}</span>
      <span className="ml-2 text-slate-400">全部 {histories.length}</span>
      <span className="mt-1 block truncate pl-4 text-slate-600" title={display?.task}>
        {display?.task || '未记录任务说明'}
      </span>
    </summary>
    <div className="mt-3 max-h-72 overflow-y-auto">
      {histories.map(history => <SubAgentBlock key={history[0].item_id} statusText={runState(history, executions).label}
        {...operationCard(history[0], history, related)} />)}
    </div>
  </details>;
}
