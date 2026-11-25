import { useState } from 'react';
import type { RequestOptions } from '../api';
import type { ActionEvent, ObservationEvent } from '../types';
import { ContentList } from './ContentList';
import { ProgressBlock } from './ProgressBlock';
import { SampleRecordsBlock } from './SampleRecordsBlock';
import { parseToolArgs } from '../toolActivityPresentation';
import {
  getObservationDisplayText,
  getObservationContent,
  getToolErrorPresentation,
  getUserInputInterruption,
} from '../toolErrorPresentation';

interface ToolCallBlockProps {
  action: ActionEvent;
  observation?: ObservationEvent;
  requestOptions: RequestOptions;
  compact?: boolean;
}

export function ToolCallBlock({ action, observation, requestOptions, compact = false }: ToolCallBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const progress = observation?.observation as Record<string, unknown> | undefined;
  const running = progress?.operation_status === 'running';
  const cancelled = progress?.status === 'cancelled';
  const node = typeof progress?.node === 'string' ? progress.node : null;
  const command = typeof progress?.command === 'string' ? progress.command : null;
  const verdict = typeof progress?.verdict === 'string' ? progress.verdict : null;
  const phase = typeof progress?.event === 'string' ? ({
    waiting_agent: '等待 Agent 完成节点',
    agent_stage_finished: 'Agent 阶段结束，等待验收',
    verification_started: '正在验收',
    taken_over: '已交由 Agent 接手',
    regression_started: '正在验证兼容场景',
    regression_passed: '场景验证通过',
    regression_failed: '场景验证失败，不发布',
  } as Record<string, string>)[progress.event] : undefined;
  const toolName = action.tool_call.name;
  const args = parseToolArgs(action.tool_call.arguments);
  const thought = action.thought
    ?.map((content) => content.text)
    .filter(Boolean)
    .join('\n')
    .trim();

  // Extract human-readable summary
  const summary = getSummary(toolName, args, compact);
  const interruption = getUserInputInterruption(toolName, observation?.observation);
  const isError = !interruption && Boolean(observation?.observation.is_error);
  const error = isError && observation
    ? getToolErrorPresentation(observation.observation)
    : null;

  const showDetails = isExpanded || (!compact && running);
  const obsText = (!compact || showDetails)
    ? interruption?.message ?? (observation ? getObservationDisplayText(observation.observation) : null)
    : null;
  const obsImages = observation && showDetails
    ? getObservationContent(observation.observation).filter((item) => item.type !== 'text')
    : [];

  // DataFlow pipeline submissions get a live progress panel
  const progressOutputDir = toolName === 'df_submit_pipeline'
    ? extractOutputDir(observation)
    : null;

  // Local df_run_pipeline runs surface their output records directly
  const sampleRecords = toolName === 'df_run_pipeline'
    ? extractSampleRecords(observation)
    : null;

  const extraResults = <>
    {progressOutputDir && <ProgressBlock outputDir={progressOutputDir} requestOptions={requestOptions} />}
    {sampleRecords && <SampleRecordsBlock records={sampleRecords.records} recordCount={sampleRecords.recordCount} />}
  </>;

  return (
    <div className={`border-l-2 ${compact ? 'mb-1 w-full min-w-0 pl-2' : 'mb-3 ml-2 pl-3'} ${interruption ? 'border-gray-300' : isError ? 'border-red-400' : 'border-amber-300'}`}>
      {thought && (
        <p className="mb-2 whitespace-pre-wrap text-xs leading-5 text-purple-700">
          {thought}
        </p>
      )}

      <button
        type="button"
        aria-expanded={showDetails}
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex cursor-pointer items-center gap-2 text-xs text-gray-600 hover:text-gray-900 ${compact ? 'w-full min-w-0 py-1 text-left' : ''}`}
      >
        <span className={`rounded px-1.5 py-0.5 font-mono ${compact ? 'max-w-[50%] truncate' : ''} ${interruption ? 'bg-gray-100 text-gray-600' : isError ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}>
          {toolName}
        </span>
        {(interruption || cancelled || running || isError) && (
          <span className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${interruption || cancelled ? 'bg-gray-100 text-gray-600' : isError ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
            {interruption?.label ?? (cancelled ? '已取消' : running ? '执行中' : '失败')}
          </span>
        )}
        {summary && <span className={`text-gray-500 ${compact ? 'min-w-0 truncate' : ''}`} title={compact ? summary : undefined}>{summary}</span>}
        <span aria-hidden="true" className={`shrink-0 text-gray-400 ${compact ? 'ml-auto' : ''}`}>{showDetails ? '▼' : '▶'}</span>
      </button>

      {(!compact || isExpanded) && <>
        {typeof progress?.validation_case === 'string' && <p className="mt-1 break-all text-xs text-gray-600">验证案例：{progress.validation_case}{typeof progress.candidate_version === 'string' ? ` · 候选版本 ${progress.candidate_version}` : ''}</p>}
        {phase && <p className="mt-1 text-xs text-blue-600">{phase}</p>}
        {node && <p className="mt-1 break-all text-xs text-gray-600">当前节点：{node}{verdict ? ` · 验收：${verdict}` : ''}</p>}
      </>}
      {showDetails && (
        <div className={`mt-2 min-w-0 space-y-2 ${compact ? 'max-h-[min(10rem,30dvh)] overflow-auto' : ''}`}
          tabIndex={compact ? 0 : undefined} role={compact ? 'region' : undefined}
          aria-label={compact ? '工具参数与输出' : undefined}>
          <pre className="text-xs bg-gray-50 rounded p-2 overflow-x-auto text-gray-700">
            {JSON.stringify(args, null, 2)}
          </pre>
          {command && <pre className="text-xs whitespace-pre-wrap break-all">{command}</pre>}
          {obsText && (
            <pre className={`text-xs rounded p-2 overflow-x-auto border whitespace-pre-wrap ${interruption ? 'bg-gray-50 text-gray-600 border-gray-200' : isError ? 'bg-red-50 text-red-800 border-red-200' : 'bg-green-50 text-green-800 border-green-200'}`}>
              {obsText}
            </pre>
          )}
          {error?.errorCode && (
            <p className="text-xs text-red-600">
              错误码：<span className="font-mono">{error.errorCode}</span>
            </p>
          )}
          {error?.suggestion && (
            <p className="text-xs text-red-700">建议：{error.suggestion}</p>
          )}
          {obsImages.length > 0 && <ContentList content={obsImages} imageClassName={compact ? 'max-h-28 max-w-full rounded object-contain' : undefined} />}
          {compact && extraResults}
        </div>
      )}

      {!compact && !isExpanded && obsText && (
        <p className={`text-xs mt-1 truncate max-w-md ${interruption ? 'text-gray-600' : isError ? 'text-red-700' : 'text-green-700'}`}>
          {obsText.split('\n')[0]}
        </p>
      )}

      {!compact && extraResults}
    </div>
  );
}

function getSummary(toolName: string, args: Record<string, unknown>, compact: boolean): string {
  if (toolName === 'terminal' && args.command) {
    const cmd = String(args.command);
    return cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd;
  }
  if (args.path && (toolName === 'file_editor' || (compact && ['read', 'write', 'edit'].includes(toolName)))) {
    return String(args.path);
  }
  if (toolName === 'df_submit_pipeline' && args.script_path) {
    return String(args.script_path);
  }
  return '';
}

function extractOutputDir(obs: ObservationEvent | undefined): string | null {
  if (!obs) {
    return null;
  }
  const structured = (obs.observation as { output_dir?: unknown }).output_dir;
  if (typeof structured === 'string' && structured.trim()) {
    return structured.trim();
  }
  const match = getObservationDisplayText(obs.observation).match(/output_dir=([^,.\s]+)/);
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
