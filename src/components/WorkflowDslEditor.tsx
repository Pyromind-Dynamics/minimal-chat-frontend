import { useState } from 'react';

interface WorkflowDslEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Whether the value was just auto-filled from the server (vs. hand-edited). */
  isSynced: boolean;
  /** Triggers a one-click "test this workflow" message, bypassing the chat box. */
  onTest: () => void;
  testDisabled?: boolean;
}

/**
 * Stand-in for the real xyflow canvas, which this demo frontend does not
 * implement. In the real product, xyflow <-> DSL conversion happens in the
 * frontend (calling a platform-provided conversion API); the agent backend
 * only ever sees/produces DSL. This textarea lets you paste/edit that DSL
 * directly to simulate "the user changed the canvas" before sending a
 * message, and is auto-filled with the latest DSL the server pushes back
 * after each run.
 */
export function WorkflowDslEditor({
  value,
  onChange,
  isSynced,
  onTest,
  testDisabled,
}: WorkflowDslEditorProps) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="border-t bg-gray-50">
      <div className="flex w-full items-center justify-between px-4 py-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex flex-1 items-center gap-2 text-xs font-medium text-gray-600 hover:text-gray-900"
        >
          <span>
            Canvas DSL (stand-in for xyflow canvas)
            {!isSynced && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                edited, not yet sent
              </span>
            )}
          </span>
          <span className="ml-auto text-gray-400">{collapsed ? 'Show' : 'Hide'}</span>
        </button>
        <button
          type="button"
          onClick={onTest}
          disabled={testDisabled}
          title="Trigger a test run of the current workflow without typing a message"
          className="ml-3 shrink-0 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          Test workflow
        </button>
      </div>
      {!collapsed && (
        <div className="px-4 pb-3">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Paste workflow DSL here to simulate editing the canvas, or leave empty to simulate an empty canvas..."
            spellCheck={false}
            className="h-40 w-full resize-y rounded-md border border-gray-200 bg-white p-2 font-mono text-xs text-gray-800 outline-none focus:border-blue-500"
          />
          <p className="mt-1 text-[11px] text-gray-400">
            Sent as `workflow_dsl` with your next message. The server writes it to
            workflow.py if it differs from the current file, and refills this box
            with the latest workflow.py content after each run.
          </p>
        </div>
      )}
    </div>
  );
}
