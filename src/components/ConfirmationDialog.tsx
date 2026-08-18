import type { SnapshotOperation, SnapshotPermission } from '../types';

interface ConfirmationDialogProps {
  permission: SnapshotPermission;
  operation?: SnapshotOperation;
  isSubmitting: boolean;
  onRespond: (decision: 'allow_once' | 'deny') => void;
}

export function ConfirmationDialog({
  permission,
  operation,
  isSubmitting,
  onRespond,
}: ConfirmationDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmation-title"
    >
      <div className="w-full max-w-xl rounded-xl border border-amber-200 bg-white shadow-xl">
        <div className="border-b border-amber-100 px-5 py-4">
          <h2 id="confirmation-title" className="text-base font-semibold text-gray-900">
            Confirm agent operation
          </h2>
          <p className="mt-1 text-sm text-gray-600">{permission.description}</p>
        </div>

        <div className="max-h-[55vh] overflow-y-auto px-5 py-4">
          {operation ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="text-xs font-semibold text-amber-800">
                {operation.name}
              </div>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-gray-700">
                {JSON.stringify(operation.arguments, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="text-sm text-gray-500">One or more operations are pending.</p>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-100 px-5 py-4">
          <button
            type="button"
            onClick={() => onRespond('deny')}
            disabled={isSubmitting}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={() => onRespond('allow_once')}
            disabled={isSubmitting || !permission.choices.includes('allow_once')}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:bg-gray-300"
          >
            {isSubmitting ? 'Submitting...' : 'Allow once'}
          </button>
        </div>
      </div>
    </div>
  );
}
