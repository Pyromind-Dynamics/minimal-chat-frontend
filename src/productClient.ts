import type { DatasetFiles, EvaluationPage, ModelEvaluationObservation, ObservationOverview, ObservationsConfig, SeriesPage, SeriesQuery } from './observationsContract';
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
    observations: (id: string, options: RequestOptions, signal?: AbortSignal) => productRequest<ObservationOverview>(`${BACKEND_URL}${PROJECTS_PATH}/${encodeURIComponent(id)}/observations/overview`, { signal, cache: 'no-store' }, options),
    baselineReport: (id: string, taskId: string, options: RequestOptions, signal?: AbortSignal) => productRequest<ModelEvaluationObservation>(`${BACKEND_URL}${PROJECTS_PATH}/${encodeURIComponent(id)}/observations/baselines/${encodeURIComponent(taskId)}`, { signal, cache: 'no-store' }, options),
    datasetFiles: (id: string, nodeId: string, options: RequestOptions, signal?: AbortSignal) => productRequest<DatasetFiles>(`${BACKEND_URL}${PROJECTS_PATH}/${encodeURIComponent(id)}/observations/datasets/${encodeURIComponent(nodeId)}`, { signal, cache: 'no-store' }, options),
    evaluationHistory: (id: string, options: RequestOptions, signal?: AbortSignal, cursor?: string) => productRequest<EvaluationPage>(`${BACKEND_URL}${PROJECTS_PATH}/${encodeURIComponent(id)}/observations/evaluations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { signal, cache: 'no-store' }, options),
    trainingSeries: (id: string, query: SeriesQuery, options: RequestOptions, signal?: AbortSignal) => {
      const params = new URLSearchParams({ project_node_id: query.project_node_id, run_id: query.run_id, limit: String(query.limit ?? 1000) });
      for (const key of query.keys ?? []) params.append('keys', key);
      if (query.cursor) params.set('cursor', query.cursor);
      return productRequest<SeriesPage>(`${BACKEND_URL}${PROJECTS_PATH}/${encodeURIComponent(id)}/observations/series?${params}`, { signal, cache: 'no-store' }, options);
    },
    configureObservations: (id: string, config_version: string, config: ObservationsConfig, options: RequestOptions) => productRequest<ObservationOverview>(`${BACKEND_URL}${PROJECTS_PATH}/${encodeURIComponent(id)}/observations/configuration`, { method: 'PUT', body: JSON.stringify({ config_version, config }) }, options),
    eventsUrl: (id: string, afterSeq: number) => `${base}/${encodeURIComponent(id)}/events?afterSeq=${afterSeq}`,
  };
}

export type ProductClient = ReturnType<typeof createProductClient>;

export function createEchoMindChatClient(path: string) {
  const chatUrl = (id: string) => `${BACKEND_URL}${path}/${encodeURIComponent(id)}/chat`;
  return {
    open: (id: string, options: RequestOptions) => productRequest<ConversationSnapshot>(chatUrl(id), {
      method: 'POST',
      body: JSON.stringify({ model: LLM_MODEL || undefined, api_key: LLM_API_KEY || undefined, base_url: LLM_BASE_URL || undefined }),
    }, options),
    snapshot: (id: string, options: RequestOptions, signal?: AbortSignal) => productRequest<ConversationSnapshot | null>(`${chatUrl(id)}/snapshot`, { signal }, options),
    report: (id: string, artifactId: string, options: RequestOptions, signal?: AbortSignal) => productRequest<{text: string}>(
      `${chatUrl(id)}/reports/${encodeURIComponent(artifactId)}`, { signal, cache: 'no-store' }, options,
    ),
    command: (id: string, command: Record<string, unknown>, options: RequestOptions) => productRequest<CommandReceipt>(`${chatUrl(id)}/commands`, { method: 'POST', body: JSON.stringify(command) }, options),
    eventsUrl: (id: string, afterSeq: number) => `${chatUrl(id)}/events?afterSeq=${afterSeq}`,
  };
}

export type EchoMindChatClient = ReturnType<typeof createEchoMindChatClient>;
