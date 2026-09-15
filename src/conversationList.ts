import type { ConversationSnapshot } from './types';

export function sortConversations(
  conversations: ConversationSnapshot[],
): ConversationSnapshot[] {
  return [...conversations].sort(
    (a, b) => activityTime(b) - activityTime(a),
  );
}

function activityTime(conversation: ConversationSnapshot): number {
  const time = Date.parse(conversation.updated_at ?? '');
  return Number.isFinite(time) ? time : 0;
}

export function formatConversationUpdatedAt(value?: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
