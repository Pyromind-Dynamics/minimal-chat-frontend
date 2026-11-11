export const ECHOMIND_CONVERSATIONS_PATH = '/api/v2/echomind/conversations';
export const PROJECTS_PATH = '/api/echomind/projects';

export interface ProjectSummary {
  project_id: string;
  name: string;
  description: string;
  skill: string;
  owner_user_id: string | null;
  conversation_id: string;
  cluster: string;
  lifecycle: 'development' | 'frozen';
  node_count: number;
  created_at: string;
  updated_at: string;
}
