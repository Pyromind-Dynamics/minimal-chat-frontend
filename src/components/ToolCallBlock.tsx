import { useState } from 'react';
import type { ActionEvent, ObservationEvent } from '../types';

interface ToolCallBlockProps {
  action: ActionEvent;
  observation?: ObservationEvent;
}

export function ToolCallBlock({ action, observation }: ToolCallBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const toolName = action.tool_call.name;
  const args = parseToolArgs(action.tool_call.arguments);
  const thought = action.thought
    ?.map((content) => content.text)
    .filter(Boolean)
    .join('\n')
    .trim();

  // Extract human-readable summary
  const summary = getSummary(toolName, args);

  // Get observation text
  const obsText = observation
    ? getObservationText(observation)
    : null;

  return (
    <div className="mb-3 ml-2 border-l-2 border-amber-300 pl-3">
      {thought && (
        <p className="mb-2 whitespace-pre-wrap text-xs leading-5 text-purple-700">
          {thought}
        </p>
      )}

      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-xs text-gray-600 hover:text-gray-900 cursor-pointer"
      >
        <span className="font-mono bg-amber-50 px-1.5 py-0.5 rounded text-amber-800">
          {toolName}
        </span>
        <span className="text-gray-500">{summary}</span>
        <span className="text-gray-400">{isExpanded ? '▼' : '▶'}</span>
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-2">
          <pre className="text-xs bg-gray-50 rounded p-2 overflow-x-auto text-gray-700">
            {JSON.stringify(args, null, 2)}
          </pre>
          {obsText && (
            <pre className="text-xs bg-green-50 rounded p-2 overflow-x-auto text-green-800 border border-green-200">
              {obsText}
            </pre>
          )}
        </div>
      )}

      {!isExpanded && obsText && (
        <p className="text-xs text-green-700 mt-1 truncate max-w-md">
          {obsText.split('\n')[0]}
        </p>
      )}
    </div>
  );
}

function getSummary(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'terminal' && args.command) {
    const cmd = String(args.command);
    return cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd;
  }
  if (toolName === 'file_editor' && args.path) {
    return String(args.path);
  }
  return '';
}

function parseToolArgs(args: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof args !== 'string') {
    return args;
  }
  try {
    const parsed = JSON.parse(args) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return { arguments: args };
  }
  return { arguments: args };
}

function getObservationText(obs: ObservationEvent): string {
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
