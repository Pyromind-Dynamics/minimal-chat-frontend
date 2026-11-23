export type ObservationStatus = 'available' | 'unavailable' | 'not_configured' | 'forbidden';
export interface MetricConfig {
  key: string; title: string; unit: 'number' | 'ratio' | 'seconds' | 'percent';
  axis: 'log_step' | 'training_step' | 'time'; axis_key: string | null;
}
export interface PanelConfig {
  project_node_id: string; training_type: string; metrics: MetricConfig[];
  run_ids: string[]; platform_node_id: string | null;
}
export interface ObservationsConfig {
  schema_version: 1; panels: PanelConfig[]; orchestrator_source_id: string | null;
}
export interface RunBinding {
  project_node_id: string; run_id: string; task_id: string;
  business_status: string; platform_node_id: string | null;
  history_path?: string | null;
  training_type?: string | null; metrics?: MetricConfig[] | null;
}
export interface ResourceStatus {
  kind: 'tracer' | 'inference' | 'orchestrator'; observation_status: ObservationStatus;
  observed_at: string | null; message: string | null;
  state: string | null; runtime: string | null; busy: boolean | null;
}
export interface ObservationOverview {
  schema_version: 1; project_id: string; graph_id: string;
  lifecycle: 'development' | 'frozen'; frozen_execution_version: string | null;
  config_version: string; record_version: string; config: ObservationsConfig;
  nodes: { id: string; title: string; type: string; business_status: string; execution_id?: string }[];
  bindings: RunBinding[]; available_runs: RunBinding[];
  resources: ResourceStatus[]; observed_at: string;
  baseline?: ModelEvaluationObservation | null;
  baseline_report_task_ids?: string[];
  evaluation?: ModelEvaluationObservation | null;
  latest_evaluation?: EvaluationRow | null;
  latest_evaluation_metrics?: Record<string, number>;
  delivery_complete?: boolean;
}
export interface ModelEvaluationObservation {
  project_node_id: string; task_id: string; run_id: string | null;
  model_reference: string | null; report_path: string | null;
  metrics: Record<string, unknown>;
  observation_status: 'available' | 'unavailable'; message: string | null;
}
export interface MetricPoint {
  key: string; value: number; unit: string; source_point_id: string; source_run_id: string;
  log_step: number; training_step: number | null; time: number | null;
}
export interface SeriesPage {
  project_id: string; project_node_id: string; run_id: string; config_version: string;
  points: MetricPoint[]; next_cursor: string | null; truncated: boolean; gap: boolean;
  observation_status: ObservationStatus; analysis_status: 'not_requested';
  observed_at: string; message: string | null;
}
export interface EvaluationRow {
  metric: {
    experiment_id: string; version: string; evaluation_run_id: string; step_run_id: string;
    step: number; role: 'checkpoint' | 'baseline'; dataset_role: 'validation' | 'test' | 'train';
    comparison_group: string; metric: string; value: number; selected: boolean;
  };
  project_node_id: string | null; report_path: string | null;
  metrics_path: string | null; model_path: string | null; created_at: number;
}
export interface EvaluationPage {
  project_id: string; items: EvaluationRow[]; next_cursor: string | null;
  total: number; record_version: string; observed_at: string;
}
export interface SeriesQuery {
  project_node_id: string; run_id: string; keys?: string[]; cursor?: string; limit?: number;
}
export interface DatasetFiles {
  project_id: string; project_node_id: string; observed_at: string;
  statistics_truncated?: boolean;
  files: { name: string; path: string; size_bytes: number | null; format: string; sample_count: number | null; distributions: Record<string, Record<string, number>>; statistics_status?: 'available' | 'pending' | 'not_provided' }[];
}
