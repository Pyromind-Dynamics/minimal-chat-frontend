export interface PlanResource { id: string; name: string; uri: string | null; description: string }
export interface ExperimentStage { id: string; kind?: string | null; name: string; description: string; enabled: boolean; placeholder: boolean }
export interface PlanInput { name: string; resource_id: string | null; task_id: string | null; output_name: string | null }
export interface ExperimentTask {
  kind?: string | null;
  id: string; stage_id: string; name: string; description: string;
  inputs: PlanInput[]; outputs: { name: string; description: string }[];
  completion_conditions: { kind: string; description: string }[];
}
export interface WorkflowContext {
  goal: string;
  constraints: string[];
  resources: PlanResource[];
  stages: ExperimentStage[];
  tasks?: ExperimentTask[];
  edges: { source: string; target: string }[];
  conclusions: string[];
  next_steps: string[];
  blockers: string[];
  status: 'active' | 'completed';
}
