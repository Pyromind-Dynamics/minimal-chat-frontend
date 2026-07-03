import type { WorkflowFileObservation } from '../types';

interface WorkflowBlockProps {
  observation: WorkflowFileObservation;
}

export function WorkflowBlock({ observation }: WorkflowBlockProps) {
  const title = observation.name || 'workflow.py';
  const summary = observation.summary;
  const code = observation.exists
    ? observation.workflow
    : `# workflow.py not found\n# ${observation.path}`;

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
          <span className="shrink-0 rounded bg-cyan-100 px-2 py-0.5 font-mono text-[11px] text-cyan-800">
            workflow.py
          </span>
        </div>
        <pre className="max-h-[520px] overflow-auto p-3 text-xs leading-5 text-slate-900">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
