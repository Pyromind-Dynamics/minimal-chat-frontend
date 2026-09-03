import type { BaseObservation, ContentItem } from './types';

const OPENHANDS_ERROR_HEADER = '[An error occurred during execution.]';

const ERROR_CODE_LABELS: Record<string, string> = {
  sample_selection_limit: '采样路径数量超过限制',
  tool_timeout: '工具执行超时',
  tool_execution_failed: '工具执行失败（未保存具体原因）',
};

export interface ToolErrorPresentation {
  message: string;
  errorCode: string | null;
  suggestion: string | null;
}

export function getToolErrorPresentation(
  observation: BaseObservation,
): ToolErrorPresentation {
  const errorCode = nonEmptyString(observation.error_code);
  const output = meaningfulText(observation);
  const detailsMessage = nonEmptyString(observation.error_message);
  const message = output
    || detailsMessage
    || (errorCode ? ERROR_CODE_LABELS[errorCode] : null)
    || '工具执行失败（旧记录未保存具体原因）';
  return {
    message,
    errorCode,
    suggestion: nonEmptyString(observation.suggestion),
  };
}

export function getObservationDisplayText(observation: BaseObservation): string {
  const text = meaningfulText(observation);
  if (text) return text;
  if (observation.is_error) return getToolErrorPresentation(observation).message;
  return JSON.stringify(observation.result ?? observation, null, 2);
}

function meaningfulText(observation: BaseObservation): string {
  const preferred = observation.to_llm_content ?? observation.content ?? [];
  return preferred
    .filter(isTextContent)
    .map((item) => item.text.trim())
    .filter((text) => text && text !== OPENHANDS_ERROR_HEADER)
    .join('\n')
    .trim();
}

function isTextContent(
  item: ContentItem,
): item is Extract<ContentItem, { type: 'text' }> {
  return item.type === 'text';
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
