import type { ConnectionState } from '../hooks/useProductEventStream';
import type { ConversationStatus, SnapshotUsage } from '../types';

interface StatusBarProps {
  connectionState: ConnectionState;
  status: ConversationStatus;
  conversationId: string | null;
  usage?: SnapshotUsage;
}

export function StatusBar({
  connectionState,
  status,
  conversationId,
  usage,
}: StatusBarProps) {
  const connection = {
    connecting: { color: 'bg-yellow-400', label: 'Connecting...' },
    open: { color: 'bg-green-400', label: 'SSE connected' },
    closed: { color: 'bg-red-400', label: 'Disconnected' },
  }[connectionState];
  const statusLabel = {
    idle: 'Idle',
    running: 'Running...',
    waiting_permission: 'Waiting for permission',
    failed: 'Failed',
    closed: 'Closed',
  }[status];

  return (
    <div className="flex items-center justify-between border-b bg-gray-50 px-4 py-2 text-xs text-gray-600">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${connection.color}`} />
        <span>{connection.label}</span>
      </div>
      <div className="flex items-center gap-4">
        {usage && (
          <span className="text-gray-400">
            {usage.input_tokens + usage.output_tokens} tokens
          </span>
        )}
        {conversationId && (
          <span className="font-mono text-gray-400">{conversationId.slice(0, 8)}</span>
        )}
        <span className={`font-medium ${status === 'running' ? 'text-blue-600' : ''}`}>
          {statusLabel}
        </span>
      </div>
    </div>
  );
}
