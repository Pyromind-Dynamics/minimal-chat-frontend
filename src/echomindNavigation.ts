import type { ProjectSummary } from './echomindContract';
import type { ConversationSummary } from './types';

type ActivityDates = { updated_at?: string | null; created_at?: string | null };

function activityTime(value?: string | null) {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) ? time : -Infinity;
}

export function conversationActivityAt(item: ActivityDates) {
  if (activityTime(item.updated_at) !== -Infinity) return item.updated_at;
  return item.created_at;
}

export function latestActivityAt(first?: string | null, second?: string | null) {
  return (activityTime(first) >= activityTime(second) ? first : second) ?? null;
}

export function newestActivityFirst(a: ActivityDates, b: ActivityDates) {
  const first = activityTime(conversationActivityAt(a));
  const second = activityTime(conversationActivityAt(b));
  return first === second ? 0 : second - first;
}

export function projectsByConversationActivity(
  projects: ProjectSummary[],
  conversations: (ActivityDates & Pick<ConversationSummary, 'conversation_id'>)[],
) {
  const byId = new Map(conversations.map(item => [item.conversation_id, item]));
  return projects.map(project => {
    const conversation = byId.get(project.conversation_id);
    const activity = conversation && conversationActivityAt(conversation);
    return {
      project,
      updated_at: activityTime(activity) === -Infinity ? conversationActivityAt(project) : activity,
    };
  }).sort(newestActivityFirst);
}

export interface EchoMindSelection {
  project: ProjectSummary | null;
  conversationId: string;
}

export function resolveEchoMindSelection({
  urlProjectId,
  savedProjectId,
  urlConversationId,
  savedConversationId,
  projects,
  conversations,
}: {
  urlProjectId?: string | null;
  savedProjectId?: string | null;
  urlConversationId?: string | null;
  savedConversationId?: string | null;
  projects: ProjectSummary[];
  conversations: Pick<ConversationSummary, 'conversation_id'>[];
}): EchoMindSelection | null {
  const projectsById = new Map(projects.map(project => [project.project_id, project]));
  for (const projectId of [urlProjectId, savedProjectId]) {
    const project = projectId ? projectsById.get(projectId) : undefined;
    if (project) {
      return { project, conversationId: project.conversation_id };
    }
  }

  const conversationsById = new Map(
    conversations.map(conversation => [conversation.conversation_id, conversation]),
  );
  for (const conversationId of [urlConversationId, savedConversationId]) {
    const conversation = conversationId
      ? conversationsById.get(conversationId)
      : undefined;
    if (conversation) {
      return { project: null, conversationId: conversation.conversation_id };
    }
  }

  const first = conversations[0];
  return first ? { project: null, conversationId: first.conversation_id } : null;
}
