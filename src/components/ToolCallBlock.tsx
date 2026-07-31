import { useState } from 'react';
import type { RequestOptions } from '../api';
import type { ActionEvent, ObservationEvent } from '../types';
import { ProgressBlock } from './ProgressBlock';
import { SampleRecordsBlock } from './SampleRecordsBlock';

interface ToolCallBlockProps {
  action: ActionEvent;
  observation?: ObservationEvent;
  requestOptions: RequestOptions;
}

export function ToolCallBlock({ action, observation, requestOptions }: ToolCallBlockProps) {
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

  // DataFlow pipeline submissions get a live progress panel
  const progressOutputDir = toolName === 'df_submit_pipeline'
    ? extractOutputDir(observation)
    : null;

  // Local df_run_pipeline runs surface their output records directly
  const sampleRecords = toolName === 'df_run_pipeline'
    ? extractSampleRecords(observation)
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

      {progressOutputDir && (
        <ProgressBlock outputDir={progressOutputDir} requestOptions={requestOptions} />
      )}
      {sampleRecords && (
        <SampleRecordsBlock
          records={sampleRecords.records}
          recordCount={sampleRecords.recordCount}
        />
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
  if (toolName === 'df_submit_pipeline' && args.script_path) {
    return String(args.script_path);
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

function extractOutputDir(obs: ObservationEvent | undefined): string | null {
  if (!obs) {
    return null;
  }
  const structured = (obs.observation as { output_dir?: unknown }).output_dir;
  if (typeof structured === 'string' && structured.trim()) {
    return structured.trim();
  }
  const match = getObservationText(obs).match(/output_dir=([^,.\s]+)/);
  return match ? match[1] : null;
}

function extractSampleRecords(obs: ObservationEvent | undefined): {
  records: Record<string, unknown>[];
  recordCount: number | null;
} | null {
  if (!obs) {
    return null;
  }
  const structured = obs.observation as {
    sample_records?: unknown;
    record_count?: unknown;
  };
  if (
    !Array.isArray(structured.sample_records) ||
    structured.sample_records.length === 0
  ) {
    return null;
  }
  const records = structured.sample_records.filter(
    (record): record is Record<string, unknown> =>
      typeof record === 'object' && record !== null,
  );
  if (records.length === 0) {
    return null;
  }
  const recordCount =
    typeof structured.record_count === 'number' ? structured.record_count : null;
  return { records, recordCount };
}
