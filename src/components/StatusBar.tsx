import type { WsState } from '../hooks/useConversationSocket';
import type { ExecutionStatus } from '../types';
import { deriveDisplayConnectionState } from '../productStreamState';

interface StatusBarProps {
  wsState: WsState;
  status: ExecutionStatus;
  conversationId: string | null;
  isCreating: boolean;
  hasConnected: boolean;
}

export function StatusBar({
  wsState,
  status,
  conversationId,
  isCreating,
  hasConnected,
}: StatusBarProps) {
  const displayConnectionState = deriveDisplayConnectionState({
    conversationId,
    isCreating,
    connectionState: wsState,
    hasConnected,
  });
  const wsIndicator = {
    idle: { color: 'bg-gray-300', label: 'Not connected' },
    creating: { color: 'bg-blue-400', label: 'Creating conversation...' },
    connecting: { color: 'bg-yellow-400', label: 'Connecting...' },
    connected: { color: 'bg-green-400', label: 'Connected' },
    reconnecting: { color: 'bg-red-400', label: 'Reconnecting...' },
  }[displayConnectionState];

  const statusLabel = {
    idle: 'Idle',
    running: 'Running...',
    paused: 'Paused',
    waiting_for_confirmation: 'Waiting for confirmation',
    waiting_for_input: '等待你的回答',
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
        <span className={`font-medium ${status === 'waiting_for_input'
          ? 'rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-700'
          : status === 'running' ? 'text-blue-600' : ''}`}>
          {statusLabel}
        </span>
      </div>
    </div>
  );
}
