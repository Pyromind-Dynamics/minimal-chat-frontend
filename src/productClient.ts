import { productRequest, type RequestOptions } from './api';
import { BACKEND_URL, LLM_API_KEY, LLM_BASE_URL, LLM_MODEL } from './config';
import {
  echomindProjectArtifactPath,
  echomindProjectNodeRunPath,
  echomindProjectNodeStartPath,
  echomindProjectPath,
  echomindProjectRunsPath,
  type ProjectArtifactDocument,
  type ProjectInfo,
  type ProjectNodeStart,
  type StageRun,
} from './echomindContract';
import type { CommandReceipt, ConversationSnapshot } from './types';
import type { PlanRevision } from './experimentPlans';

export function createProductClient(path: string) {
  const base = `${BACKEND_URL}${path}`;
  return {
    create: (options: RequestOptions) => productRequest<ConversationSnapshot>(base, {
      method: 'POST', body: JSON.stringify({ llm: { model: LLM_MODEL || undefined, api_key: LLM_API_KEY || undefined, base_url: LLM_BASE_URL || undefined }, extra: {} }),
    }, options),
    list: (options: RequestOptions) => productRequest<ConversationSnapshot[]>(base, {}, options),
    snapshot: (id: string, options: RequestOptions) => productRequest<ConversationSnapshot>(`${base}/${encodeURIComponent(id)}/snapshot`, {}, options),
    command: (id: string, command: Record<string, unknown>, options: RequestOptions) => productRequest<CommandReceipt>(`${base}/${encodeURIComponent(id)}/commands`, { method: 'POST', body: JSON.stringify(command) }, options),
    revision: (id: string, revision: number, options: RequestOptions) => productRequest<PlanRevision>(`${base}/${encodeURIComponent(id)}/experiment-plans?revision=${revision}`, {}, options),
    project: (id: string, options: RequestOptions) => productRequest<ProjectInfo>(`${BACKEND_URL}${echomindProjectPath(id)}`, {}, options),
    projectRuns: (id: string, options: RequestOptions) => productRequest<StageRun[]>(`${BACKEND_URL}${echomindProjectRunsPath(id)}`, {}, options),
    runProjectNode: (projectId: string, nodeId: string, options: RequestOptions) => productRequest<StageRun>(`${BACKEND_URL}${echomindProjectNodeRunPath(projectId, nodeId)}`, { method: 'POST' }, options),
    startProjectNode: (projectId: string, nodeId: string, options: RequestOptions) => productRequest<ProjectNodeStart>(`${BACKEND_URL}${echomindProjectNodeStartPath(projectId, nodeId)}`, { method: 'POST' }, options),
    projectArtifact: (projectId: string, artifactId: string, options: RequestOptions) => productRequest<ProjectArtifactDocument>(`${BACKEND_URL}${echomindProjectArtifactPath(projectId, artifactId)}`, {}, options),
    eventsUrl: (id: string, afterSeq: number) => `${base}/${encodeURIComponent(id)}/events?afterSeq=${afterSeq}`,
  };
}

export type ProductClient = ReturnType<typeof createProductClient>;
