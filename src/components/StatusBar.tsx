import type { WsState } from '../hooks/useConversationSocket';
import type { ExecutionStatus } from '../types';

interface StatusBarProps {
  wsState: WsState;
  status: ExecutionStatus;
  conversationId: string | null;
}

export function StatusBar({ wsState, status, conversationId }: StatusBarProps) {
  const wsIndicator = {
    connecting: { color: 'bg-yellow-400', label: 'Connecting...' },
    open: { color: 'bg-green-400', label: 'Connected' },
    closed: { color: 'bg-red-400', label: 'Disconnected' },
  }[wsState];

  const statusLabel = {
    idle: 'Idle',
    running: 'Running...',
    paused: 'Paused',
    waiting_for_confirmation: 'Waiting for confirmation',
    finished: 'Finished',
    error: 'Error',
    stuck: 'Stuck',
    deleting: 'Deleting',
    closed: 'Closed',
  }[status];

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b text-xs text-gray-600">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${wsIndicator.color}`} />
        <span>{wsIndicator.label}</span>
      </div>
      <div className="flex items-center gap-4">
        {conversationId && (
          <span className="font-mono text-gray-400">
            {conversationId.slice(0, 8)}
          </span>
        )}
        <span className={`font-medium ${status === 'running' ? 'text-blue-600' : ''}`}>
          {statusLabel}
        </span>
      </div>
    </div>
  );
}
