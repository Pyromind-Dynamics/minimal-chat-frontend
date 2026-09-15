export type DisplayConnectionState =
  | 'idle'
  | 'creating'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

interface DisplayConnectionInput {
  conversationId: string | null;
  isCreating: boolean;
  connectionState: 'connecting' | 'open' | 'closed';
  hasConnected: boolean;
}

export function deriveDisplayConnectionState({
  conversationId,
  isCreating,
  connectionState,
  hasConnected,
}: DisplayConnectionInput): DisplayConnectionState {
  if (!conversationId) return isCreating ? 'creating' : 'idle';
  if (connectionState === 'open') return 'connected';
  if (connectionState === 'connecting' || !hasConnected) return 'connecting';
  return 'reconnecting';
}

export type ProductSequenceDisposition = 'ignore' | 'next' | 'gap';

export function classifyProductSequence(
  cursor: number,
  eventSequence: number,
): ProductSequenceDisposition {
  if (eventSequence <= cursor) return 'ignore';
  if (eventSequence === cursor + 1) return 'next';
  return 'gap';
}
