import { useEffect, useRef } from 'react';
import type {
  ConversationSnapshot,
  SnapshotMessage,
  SnapshotOperation,
} from '../types';
import { ConfirmationDialog } from './ConfirmationDialog';
import { MessageBubble } from './MessageBubble';
import { ToolCallBlock } from './ToolCallBlock';
import { WorkflowBlock } from './WorkflowBlock';

interface ChatPanelProps {
  snapshot: ConversationSnapshot | null;
  isRespondingToPermission: boolean;
  onRespondToPermission: (decision: 'allow_once' | 'deny') => void;
}

type TimelineItem =
  | { kind: 'message'; seq: number; value: SnapshotMessage }
  | { kind: 'operation'; seq: number; value: SnapshotOperation };

export function ChatPanel({
  snapshot,
  isRespondingToPermission,
  onRespondToPermission,
}: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const timeline = buildTimeline(snapshot);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [snapshot?.through_seq]);

  if (!snapshot || (timeline.length === 0 && !snapshot.workflow)) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
        Start a conversation by sending a message below.
      </div>
    );
  }

  const permission = snapshot.pending_permissions[0];
  const permissionOperation = permission?.operation_id
    ? snapshot.operations.find(
      (operation) => operation.operation_id === permission.operation_id,
    )
    : undefined;

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {timeline.map((item) => item.kind === 'message'
        ? <MessageBubble key={item.value.message_id} message={item.value} />
        : <ToolCallBlock key={item.value.operation_id} operation={item.value} />
      )}
      {snapshot.workflow && <WorkflowBlock workflow={snapshot.workflow} />}
      {permission && snapshot.capabilities.permission_reply && (
        <ConfirmationDialog
          permission={permission}
          operation={permissionOperation}
          isSubmitting={isRespondingToPermission}
          onRespond={onRespondToPermission}
        />
      )}
      <div ref={bottomRef} />
    </div>
  );
}

function buildTimeline(snapshot: ConversationSnapshot | null): TimelineItem[] {
  if (!snapshot) return [];
  return [
    ...snapshot.messages.map((message): TimelineItem => ({
      kind: 'message',
      seq: message.started_seq,
      value: message,
    })),
    ...snapshot.operations.map((operation): TimelineItem => ({
      kind: 'operation',
      seq: operation.started_seq,
      value: operation,
    })),
  ].sort((left, right) => left.seq - right.seq);
}
