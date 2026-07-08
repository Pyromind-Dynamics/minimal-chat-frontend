import { useState } from 'react';

interface WorkflowDslEditorProps {
  value: string;
  onChange: (value: string) => void;
  isSynced: boolean;
  onTest: () => void;
  testDisabled?: boolean;
}

export function WorkflowDslEditor({
  value,
  onChange,
  isSynced,
  onTest,
  testDisabled,
}: WorkflowDslEditorProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="border-t bg-gray-50">
      <div className="flex w-full items-center justify-between gap-3 px-4 py-2">
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs font-medium text-gray-700 hover:text-gray-950"
        >
          <span className="truncate">Workflow JSON</span>
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              isSynced
                ? 'bg-green-100 text-green-700'
                : 'bg-amber-100 text-amber-800'
            }`}
          >
            {isSynced ? 'Synced' : 'Edited'}
          </span>
          <span className="ml-auto shrink-0 text-gray-400">
            {collapsed ? 'Show' : 'Hide'}
          </span>
        </button>
        <button
          type="button"
          onClick={onTest}
          disabled={testDisabled}
          className="shrink-0 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          Test
        </button>
      </div>
      {!collapsed && (
        <div className="px-4 pb-3">
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder='{"name":"workflow","nodes":[],"edges":[]}'
            spellCheck={false}
            className="h-40 w-full resize-y rounded-md border border-gray-200 bg-white p-2 font-mono text-xs leading-5 text-gray-900 outline-none focus:border-blue-500"
          />
        </div>
      )}
    </div>
  );
}
