import { productRequest, type RequestOptions } from './api';
import { BACKEND_URL, LLM_API_KEY, LLM_BASE_URL, LLM_MODEL } from './config';
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
    eventsUrl: (id: string, afterSeq: number) => `${base}/${encodeURIComponent(id)}/events?afterSeq=${afterSeq}`,
  };
}

export type ProductClient = ReturnType<typeof createProductClient>;
