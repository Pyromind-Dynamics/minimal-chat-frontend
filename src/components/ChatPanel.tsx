import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
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
  type ProductPermission,
  type PendingUserInput,
  type RespondToUserInput,
} from '../types';
import { ConfirmationDialog } from './ConfirmationDialog';
import { CondensationBlock } from './CondensationBlock';
import { ContentList } from './ContentList';
import { MessageBubble } from './MessageBubble';
import { PlanBlock } from './PlanBlock';
import { SubAgentBlock } from './SubAgentBlock';
import { ToolCallBlock } from './ToolCallBlock';
import { WorkflowBlock } from './WorkflowBlock';
import { UserInputCard } from './UserInputCard';
import { getObservationContent, getObservationDisplayText } from '../toolErrorPresentation';

interface ChatPanelProps {
  autoScroll?: 'always' | 'follow';
  logLabel?: string;
  emptyText?: string;
  children?: ReactNode;
  contentKey?: string | number;
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
  pendingPermission?: ProductPermission;
  pendingInputs?: PendingUserInput[];
  onRespondToUserInput?: RespondToUserInput;
  conversationId?: string | null;
}

export function ChatPanel({
  autoScroll = 'always',
  logLabel,
  emptyText = 'Start a conversation by sending a message below.',
  children,
  contentKey,
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
  pendingPermission,
  pendingInputs = [],
  onRespondToUserInput,
  conversationId,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previousContentKey = useRef<string | number | undefined>(undefined);
  const inputRef = useRef<HTMLDivElement>(null);
  const visibleEvents = events;
  const latestPlan = getLatestPlan(visibleEvents);
  const pendingInputIds = pendingInputs.map((input) => input.request_id).join(',');
  const textLength = events.reduce((total, event) => total + (
    event.kind === 'MessageEvent' ? event.llm_message.content.reduce((size, block) =>
      size + (block.type === 'text' ? block.text.length : 0), 0) : 0
  ), 0);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (pendingInputIds) return;
    if (autoScroll === 'follow') {
      if (followRef.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      return;
    }
    const changed = previousContentKey.current !== contentKey;
    previousContentKey.current = contentKey;
    if (changed && contentKey !== undefined) contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleEvents, isCondensing, pendingOutboundMessages.length, textLength, pendingInputIds, contentKey, autoScroll]);

  useEffect(() => {
    if (pendingInputIds) inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [pendingInputIds]);

  if (
    visibleEvents.length === 0
    && pendingOutboundMessages.length === 0
    && pendingInputs.length === 0
    && !isCondensing
    && !pendingPermission
    && !children
  ) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-gray-400 text-sm">
        {emptyText}
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
      event.kind === 'ActionEvent' && (
        pendingPermission
          ? pendingPermission.operation_ids.includes(event.id)
          : !observationsByActionId.has(event.id)
            || observationsByActionId.get(event.id)?.observation.operation_status === 'running'
      ),
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
          {event.category === 'subagent' ? (
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
    <>
    <div ref={scrollRef} role={logLabel ? 'log' : undefined} aria-label={logLabel} tabIndex={logLabel ? 0 : undefined} onScroll={autoScroll === 'follow' ? () => {
      const element = scrollRef.current;
      if (!element) return;
      const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
      followRef.current = atBottom;
      setFollowing(atBottom);
    } : undefined} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
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
      {latestPlan && <PlanBlock plan={latestPlan.plan} />}
      {children && <div ref={contentRef}>{children}</div>}
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
      {(pendingPermission || status === 'waiting_for_confirmation') && onRespondToConfirmation && (
        <ConfirmationDialog
          actions={pendingActions}
          description={pendingPermission?.description}
          isSubmitting={isRespondingToConfirmation}
          onRespond={onRespondToConfirmation}
        />
      )}
      {onRespondToUserInput && pendingInputs.length > 0 && (
        <div ref={inputRef} className="mx-auto w-full max-w-3xl">
          {pendingInputs.map((request) => (
            <UserInputCard key={`${conversationId}:${request.request_id}`} request={request} onRespond={onRespondToUserInput} />
          ))}
        </div>
      )}
      <div ref={bottomRef} />
    </div>
    {autoScroll === 'follow' && !following && <button type="button" className="shrink-0 border-t bg-violet-50 py-2 text-xs text-violet-700" onClick={() => {
      followRef.current = true; setFollowing(true);
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }}>查看最新消息 ↓</button>}
    </>
  );
}

function getObsText(obs: ObservationEvent): string {
  return getObservationDisplayText(obs.observation);
}

function getObsImages(obs: ObservationEvent): ContentItem[] {
  const content = getObservationContent(obs.observation);
  return content.filter((item) => item.type !== 'text');
}
