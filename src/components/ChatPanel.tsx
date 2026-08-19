import { useEffect, useRef } from 'react';
import type { RequestOptions } from '../api';
import {
  getLatestPlan,
  getWorkflowFileObservation,
  isWorkflowFileObservationEvent,
  type ChatEvent,
  type ActionEvent,
  type ContentItem,
  type ExecutionStatus,
  type ObservationEvent,
  type PendingOutboundMessage,
  type StreamingMessage,
} from '../types';
import { ConfirmationDialog } from './ConfirmationDialog';
import { CondensationBlock } from './CondensationBlock';
import { ContentList } from './ContentList';
import { MessageBubble } from './MessageBubble';
import { PlanBlock } from './PlanBlock';
import { SubAgentBlock } from './SubAgentBlock';
import { ToolCallBlock } from './ToolCallBlock';
import { WorkflowBlock } from './WorkflowBlock';

interface ChatPanelProps {
  events: ChatEvent[];
  isCondensing?: boolean;
  requestOptions: RequestOptions;
  onRollbackWorkflow?: (eventId: string) => void;
  rollbackWorkflowDisabled?: boolean;
  rollingBackWorkflowEventId?: string | null;
  status: ExecutionStatus;
  isRespondingToConfirmation?: boolean;
  onRespondToConfirmation?: (accept: boolean) => void;
  pendingOutboundMessages?: PendingOutboundMessage[];
  streamingMessages?: Record<string, StreamingMessage>;
}

export function ChatPanel({
  events,
  isCondensing = false,
  requestOptions,
  onRollbackWorkflow,
  rollbackWorkflowDisabled,
  rollingBackWorkflowEventId,
  status,
  isRespondingToConfirmation = false,
  onRespondToConfirmation,
  pendingOutboundMessages = [],
  streamingMessages = {},
}: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const streaming = Object.values(streamingMessages);
  const streamingIds = new Set(streaming.map((message) => message.messageId));
  const streamingRunIds = new Set(
    streaming.flatMap((message) => message.runId ? [message.runId] : []),
  );
  const visibleEvents = events.filter(
    (event) => event.kind !== 'MessageEvent'
      || event.source !== 'agent'
      || (!streamingIds.has(event.id) && !streamingRunIds.has(event.run_id ?? '')),
  );
  const latestPlan = getLatestPlan(visibleEvents);
  const streamingTextLength = streaming.reduce(
    (total, message) => total + message.text.length,
    0,
  );

  // Auto-scroll to bottom on new events
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleEvents.length, isCondensing, pendingOutboundMessages.length, streamingTextLength]);

  if (
    visibleEvents.length === 0
    && pendingOutboundMessages.length === 0
    && streaming.length === 0
    && !isCondensing
  ) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        Start a conversation by sending a message below.
      </div>
    );
  }

  const actionIds = new Set<string>();
  const observationsByActionId = new Map<string, ObservationEvent>();
  for (const event of visibleEvents) {
    if (event.kind === 'ActionEvent') {
      actionIds.add(event.id);
    } else if (event.kind === 'ObservationEvent' && event.action_id) {
      observationsByActionId.set(event.action_id, event);
    }
  }
  const pendingActions = visibleEvents.filter(
    (event): event is ActionEvent =>
      event.kind === 'ActionEvent' && !observationsByActionId.has(event.id),
  );

  // Pair actions and observations by id; parallel tool calls are not adjacent.
  const rendered: React.ReactNode[] = [];
  for (let i = 0; i < visibleEvents.length; i++) {
    const event = visibleEvents[i];

    if (event.kind === 'MessageEvent') {
      rendered.push(<MessageBubble key={event.id} event={event} />);
    } else if (event.kind === 'ActionEvent') {
      const observation = observationsByActionId.get(event.id);
      rendered.push(
        <div key={event.id}>
          {event.tool_call.name === 'subagent' ? (
            <SubAgentBlock action={event} observation={observation} />
          ) : (
            <ToolCallBlock
              action={event as ActionEvent}
              observation={observation}
              requestOptions={requestOptions}
            />
          )}
        </div>,
      );
    } else if (event.kind === 'ObservationEvent') {
      if (event.action_id && actionIds.has(event.action_id)) {
        continue;
      }
      const workflowFile = getWorkflowFileObservation(event);
      if (isWorkflowFileObservationEvent(event) && workflowFile) {
        rendered.push(
          <WorkflowBlock
            key={event.id}
            eventId={event.id}
            observation={workflowFile}
            onRollback={onRollbackWorkflow}
            rollbackDisabled={rollbackWorkflowDisabled}
            isRollingBack={rollingBackWorkflowEventId === event.id}
          />,
        );
        continue;
      }

      // Standalone observation (no preceding action found)
      rendered.push(
        <div key={event.id}>
          <div className="mb-3 ml-2 border-l-2 border-green-300 pl-3">
            <pre className="text-xs bg-green-50 rounded p-2 overflow-x-auto text-green-800">
              {getObsText(event as ObservationEvent)}
            </pre>
            <ContentList
              content={getObsImages(event as ObservationEvent)}
              imageClassName="mt-2 max-h-80 max-w-full rounded-lg object-contain"
            />
          </div>
        </div>,
      );
    } else if (event.kind === 'Condensation') {
      rendered.push(<CondensationBlock key={event.id} event={event} />);
    } else if (event.kind === 'ConversationStateUpdateEvent') {
      // The server pushes workflow.py updates out-of-band via this event
      // (key === 'pyromind_workflow'), independent of any specific tool call.
      const workflowFile = getWorkflowFileObservation(event);
      if (workflowFile) {
        rendered.push(
          <WorkflowBlock
            key={event.id}
            eventId={event.id}
            observation={workflowFile}
            onRollback={onRollbackWorkflow}
            rollbackDisabled={rollbackWorkflowDisabled}
            isRollingBack={rollingBackWorkflowEventId === event.id}
          />,
        );
      }
      // Other ConversationStateUpdateEvent entries (e.g. execution_status)
      // are handled by ChatContext and don't need to be rendered here.
    } else if (event.kind === 'ServerErrorEvent') {
      rendered.push(
        <div key={`error-${i}`} className="mb-3 mx-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-xs text-red-700 font-medium">Error: {event.code}</p>
          <p className="text-xs text-red-600 mt-1">{event.detail}</p>
        </div>,
      );
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {rendered}
      {pendingOutboundMessages.map((message) => (
        <MessageBubble
          key={message.commandId}
          event={{
            kind: 'MessageEvent',
            id: `pending:${message.commandId}`,
            timestamp: '',
            source: 'user',
            run_id: message.commandId,
            delivery_status: message.status,
            llm_message: {
              role: 'user',
              content: [{ type: 'text', text: message.text }],
            },
          }}
        />
      ))}
      {streaming.map((message) => (
        <MessageBubble
          key={message.messageId}
          event={{
            kind: 'MessageEvent',
            id: message.messageId,
            timestamp: '',
            source: 'agent',
            run_id: message.runId,
            llm_message: {
              role: 'assistant',
              content: [{ type: 'text', text: message.text || '…' }],
            },
          }}
        />
      ))}
      {latestPlan && <PlanBlock plan={latestPlan.plan} />}
      {isCondensing && (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 ml-2 flex items-center gap-2 text-xs text-gray-500"
        >
          <span
            aria-hidden="true"
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600"
          />
          <span>正在压缩上下文，请稍候…</span>
        </div>
      )}
      {status === 'waiting_for_confirmation' && onRespondToConfirmation && (
        <ConfirmationDialog
          actions={pendingActions}
          isSubmitting={isRespondingToConfirmation}
          onRespond={onRespondToConfirmation}
        />
      )}
      <div ref={bottomRef} />
    </div>
  );
}

function getObsText(obs: ObservationEvent): string {
  if (obs.observation.to_llm_content) {
    return obs.observation.to_llm_content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { type: 'text'; text: string }).text)
      .join('\n');
  }
  if (obs.observation.content) {
    return obs.observation.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { type: 'text'; text: string }).text)
      .join('\n');
  }
  return JSON.stringify(obs.observation.result ?? obs.observation, null, 2);
}

function getObsImages(obs: ObservationEvent): ContentItem[] {
  const content = obs.observation.content ?? [];
  return content.filter((item) => item.type !== 'text');
}
