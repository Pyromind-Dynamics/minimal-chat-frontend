import type { WorkflowFileObservation } from '../types';

interface WorkflowBlockProps {
  eventId: string;
  observation: WorkflowFileObservation;
  onRollback?: (eventId: string) => void;
  rollbackDisabled?: boolean;
  isRollingBack?: boolean;
}

export function WorkflowBlock({
  eventId,
  observation,
  onRollback,
  rollbackDisabled,
  isRollingBack,
}: WorkflowBlockProps) {
  const title = observation.name || 'workflow.py';
  const summary = observation.summary;
  const hasXyflow = observation.exists && observation.xyflow;
  const code = observation.exists
    ? hasXyflow
      ? JSON.stringify(observation.xyflow, null, 2)
      : observation.workflow
    : `# workflow.py not found\n# ${observation.path}`;
  const badge = hasXyflow ? 'xyflow.json' : 'workflow.py';

  return (
    <div className="mb-4 ml-2 border-l-4 border-cyan-500 pl-3">
      <div className="overflow-hidden rounded-lg border border-cyan-200 bg-cyan-50 shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-cyan-200 bg-white px-3 py-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-cyan-950">
              {title}
            </h3>
            {summary && (
              <p className="mt-0.5 text-xs text-cyan-700">
                {summary}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded bg-cyan-100 px-2 py-0.5 font-mono text-[11px] text-cyan-800">
              {badge}
            </span>
            {onRollback && (
              <button
                type="button"
                onClick={() => onRollback(eventId)}
                disabled={rollbackDisabled || isRollingBack}
                className="rounded-md border border-cyan-200 bg-white px-2 py-1 text-[11px] font-medium text-cyan-800 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
              >
                {isRollingBack ? 'Rolling back...' : 'Rollback'}
              </button>
            )}
          </div>
        </div>
        <pre className="max-h-[520px] overflow-auto p-3 text-xs leading-5 text-slate-900">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
