import type { WorkflowState } from '../types';

export function WorkflowBlock({ workflow }: { workflow: WorkflowState }) {
  const hasCanvas = workflow.canvas != null;
  const code = hasCanvas
    ? JSON.stringify(workflow.canvas, null, 2)
    : workflow.dsl;

  return (
    <div className="mb-4 ml-2 border-l-4 border-cyan-500 pl-3">
      <div className="overflow-hidden rounded-lg border border-cyan-200 bg-cyan-50 shadow-sm">
        <div className="flex items-center justify-between border-b border-cyan-200 bg-white px-3 py-2">
          <h3 className="truncate text-sm font-semibold text-cyan-950">
            {workflow.resource_id}
          </h3>
          <span className="rounded bg-cyan-100 px-2 py-0.5 font-mono text-[11px] text-cyan-800">
            {hasCanvas ? 'canvas' : 'workflow DSL'} · {workflow.version.slice(0, 8)}
          </span>
        </div>
        <pre className="max-h-[520px] overflow-auto p-3 text-xs leading-5 text-slate-900">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
