import { useEffect, useRef } from 'react';
import {
  getWorkflowFileObservation,
  isWorkflowFileObservationEvent,
  type ChatEvent,
  type ActionEvent,
  type ObservationEvent,
} from '../types';
import { MessageBubble } from './MessageBubble';
import { ToolCallBlock } from './ToolCallBlock';
import { WorkflowBlock } from './WorkflowBlock';

interface ChatPanelProps {
  events: ChatEvent[];
}

export function ChatPanel({ events }: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  if (events.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        Start a conversation by sending a message below.
      </div>
    );
  }

  // Pair ActionEvents with their following ObservationEvent
  const rendered: React.ReactNode[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    if (event.kind === 'MessageEvent') {
      rendered.push(<MessageBubble key={event.id} event={event} />);
    } else if (event.kind === 'ActionEvent') {
      // Look ahead for the matching observation
      const nextEvent = events[i + 1];
      const observation =
        nextEvent?.kind === 'ObservationEvent' ? nextEvent as ObservationEvent : undefined;
      rendered.push(
        <div key={event.id}>
          <ToolCallBlock
            action={event as ActionEvent}
            observation={observation}
          />
        </div>,
      );
      if (observation) {
        i++; // Skip the observation since we rendered it with the action
      }
    } else if (event.kind === 'ObservationEvent') {
      const workflowFile = getWorkflowFileObservation(event);
      if (isWorkflowFileObservationEvent(event) && workflowFile) {
        rendered.push(
          <WorkflowBlock
            key={event.id}
            observation={workflowFile}
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
          {workflowFile && (
            <WorkflowBlock
              observation={workflowFile}
            />
          )}
        </div>,
      );
    } else if (event.kind === 'ConversationStateUpdateEvent') {
      const workflowFile = getWorkflowFileObservation(event);
      if (workflowFile) {
        rendered.push(
          <WorkflowBlock
            key={event.id}
            observation={workflowFile}
          />,
        );
      }
    } else if (event.kind === 'ServerErrorEvent') {
      rendered.push(
        <div key={`error-${i}`} className="mb-3 mx-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-xs text-red-700 font-medium">Error: {event.code}</p>
          <p className="text-xs text-red-600 mt-1">{event.detail}</p>
        </div>,
      );
    }
    // Other ConversationStateUpdateEvent entries are handled by context.
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {rendered}
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
