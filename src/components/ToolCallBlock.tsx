import { useState } from 'react';
import type { SnapshotOperation } from '../types';
import { ContentList } from './ContentList';

interface ToolCallBlockProps {
  operation: SnapshotOperation;
}

export function ToolCallBlock({ operation }: ToolCallBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const summary = getSummary(operation);
  const statusStyle = {
    running: 'border-amber-300 bg-amber-50 text-amber-800',
    completed: 'border-green-300 bg-green-50 text-green-800',
    failed: 'border-red-300 bg-red-50 text-red-800',
  }[operation.status];

  return (
    <div className="mb-3 ml-2 border-l-2 border-amber-300 pl-3">
      <button
        type="button"
        onClick={() => setIsExpanded((value) => !value)}
        className="flex cursor-pointer items-center gap-2 text-xs text-gray-600 hover:text-gray-900"
      >
        <span className={`rounded border px-1.5 py-0.5 font-mono ${statusStyle}`}>
          {operation.name}
        </span>
        <span className="max-w-md truncate text-gray-500">{summary}</span>
        <span className="text-gray-400">{isExpanded ? '▼' : '▶'}</span>
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-2">
          <pre className="overflow-x-auto rounded bg-gray-50 p-2 text-xs text-gray-700">
            {JSON.stringify(operation.arguments, null, 2)}
          </pre>
          {operation.output.length > 0 && (
            <div className="rounded border border-green-200 bg-green-50 p-2 text-xs text-green-800">
              <ContentList content={operation.output} />
            </div>
          )}
          {operation.details && (
            <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-700">
              {JSON.stringify(operation.details, null, 2)}
            </pre>
          )}
          {operation.error_code && (
            <p className="text-xs font-medium text-red-700">{operation.error_code}</p>
          )}
        </div>
      )}
    </div>
  );
}

function getSummary(operation: SnapshotOperation): string {
  for (const key of ['command', 'path', 'script_path', 'query']) {
    const value = operation.arguments[key];
    if (typeof value === 'string' && value) {
      return value.length > 80 ? `${value.slice(0, 80)}…` : value;
    }
  }
  return operation.status;
}
