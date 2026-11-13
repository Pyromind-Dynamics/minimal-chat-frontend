import { productRequest, type RequestOptions } from './api';
import { BACKEND_URL, LLM_API_KEY, LLM_BASE_URL, LLM_MODEL } from './config';
import { PROJECTS_PATH, type ProjectSummary } from './echomindContract';
import type { CommandReceipt, ConversationSnapshot, ConversationSummary } from './types';

export function createProductClient(path: string) {
  const base = `${BACKEND_URL}${path}`;
  return {
    create: (options: RequestOptions) => productRequest<ConversationSnapshot>(base, {
      method: 'POST', body: JSON.stringify({ llm: { model: LLM_MODEL || undefined, api_key: LLM_API_KEY || undefined, base_url: LLM_BASE_URL || undefined }, extra: {} }),
    }, options),
    list: (options: RequestOptions, signal?: AbortSignal) => productRequest<ConversationSummary[]>(`${base}/summaries`, { signal }, options),
    snapshot: (id: string, options: RequestOptions, signal?: AbortSignal) => productRequest<ConversationSnapshot>(`${base}/${encodeURIComponent(id)}/snapshot`, { signal }, options),
    project: (id: string, options: RequestOptions, signal?: AbortSignal) => productRequest<{ project: Pick<ProjectSummary, 'project_id' | 'conversation_id' | 'cluster'> }>(`${BACKEND_URL}${PROJECTS_PATH}/${encodeURIComponent(id)}`, { signal }, options),
    command: (id: string, command: Record<string, unknown>, options: RequestOptions) => productRequest<CommandReceipt>(`${base}/${encodeURIComponent(id)}/commands`, { method: 'POST', body: JSON.stringify(command) }, options),
    listProjects: (options: RequestOptions, signal?: AbortSignal) => productRequest<ProjectSummary[]>(`${BACKEND_URL}${PROJECTS_PATH}`, { signal }, options),
    inputMedia: (id: string, requestId: string, contentIndex: number, imageIndex: number, options: RequestOptions) => productRequest<{url: string}>(`${base}/${encodeURIComponent(id)}/pending-inputs/${encodeURIComponent(requestId)}/media/${contentIndex}/${imageIndex}`, {}, options),
    eventsUrl: (id: string, afterSeq: number) => `${base}/${encodeURIComponent(id)}/events?afterSeq=${afterSeq}`,
  };
}

export type ProductClient = ReturnType<typeof createProductClient>;
