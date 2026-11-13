import type { ProjectSummary } from './echomindContract';
import type { ConversationSummary } from './types';

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
