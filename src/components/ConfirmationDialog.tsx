import type { ActionEvent } from '../types';

interface ConfirmationDialogProps {
  actions: ActionEvent[];
  description?: string;
  isSubmitting: boolean;
  onRespond: (accept: boolean) => void;
}

export function ConfirmationDialog({
  actions,
  description,
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
            Confirm agent action
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            {description || 'The agent wants to run a potentially risky action. Review it before continuing.'}
          </p>
        </div>

        <div className="max-h-[55vh] space-y-3 overflow-y-auto px-5 py-4">
          {actions.length === 0 && !description && (
            <p className="text-sm text-gray-500">
              Pending action details are still loading.
            </p>
          )}
          {actions.map((action) => (
            <div key={action.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="text-xs font-semibold text-amber-800">
                {action.tool_call.name}
              </div>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-gray-700">
                {formatArguments(action.tool_call.arguments)}
              </pre>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-100 px-5 py-4">
          <button
            type="button"
            onClick={() => onRespond(false)}
            disabled={isSubmitting}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => onRespond(true)}
            disabled={isSubmitting || (actions.length === 0 && !description)}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {isSubmitting ? 'Submitting...' : 'Allow'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatArguments(argumentsValue: Record<string, unknown> | string): string {
  if (typeof argumentsValue === 'string') {
    try {
      return JSON.stringify(JSON.parse(argumentsValue), null, 2);
    } catch {
      return argumentsValue;
    }
  }
  return JSON.stringify(argumentsValue, null, 2);
}
