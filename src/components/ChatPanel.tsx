import { useEffect, useRef } from 'react';
import type { RequestOptions } from '../api';
import {
  getLatestPlan,
  getWorkflowFileObservation,
  isWorkflowFileObservationEvent,
  type ChatEvent,
  type ActionEvent,
  type ObservationEvent,
} from '../types';
import { CondensationBlock } from './CondensationBlock';
import { MessageBubble } from './MessageBubble';
import { PlanBlock } from './PlanBlock';
import { ToolCallBlock } from './ToolCallBlock';
import { WorkflowBlock } from './WorkflowBlock';

interface ChatPanelProps {
  events: ChatEvent[];
  isCondensing?: boolean;
  requestOptions: RequestOptions;
  onRollbackWorkflow?: (eventId: string) => void;
  rollbackWorkflowDisabled?: boolean;
  rollingBackWorkflowEventId?: string | null;
}

export function ChatPanel({
  events,
  isCondensing = false,
  requestOptions,
  onRollbackWorkflow,
  rollbackWorkflowDisabled,
  rollingBackWorkflowEventId,
}: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const latestPlan = getLatestPlan(events);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length, isCondensing]);

  if (events.length === 0 && !isCondensing) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        Start a conversation by sending a message below.
      </div>
    );
  }

  const actionIds = new Set<string>();
  const observationsByActionId = new Map<string, ObservationEvent>();
  for (const event of events) {
    if (event.kind === 'ActionEvent') {
      actionIds.add(event.id);
    } else if (event.kind === 'ObservationEvent' && event.action_id) {
      observationsByActionId.set(event.action_id, event);
    }
  }

  // Pair actions and observations by id; parallel tool calls are not adjacent.
  const rendered: React.ReactNode[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    if (event.kind === 'MessageEvent') {
      rendered.push(<MessageBubble key={event.id} event={event} />);
    } else if (event.kind === 'ActionEvent') {
      const observation = observationsByActionId.get(event.id);
      rendered.push(
        <div key={event.id}>
          <ToolCallBlock
            action={event as ActionEvent}
            observation={observation}
            requestOptions={requestOptions}
          />
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
