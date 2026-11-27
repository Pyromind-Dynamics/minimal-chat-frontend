export type ObservationStatus = 'available' | 'unavailable' | 'not_configured' | 'forbidden';
export interface MetricConfig {
  key: string; title: string; unit: string;
  axis: 'log_step' | 'training_step' | 'time'; axis_key: string | null;
}
export interface PanelConfig {
  project_node_id: string; training_type: string; metrics: MetricConfig[];
  platform_node_id: string | null;
}
export interface ObservationMetricGroup {
  title: string; labels: Record<string, string>;
}
export type ObservationDetailBlock =
  | { type: 'select'; label: string; min_options?: 1 | 2 }
  | { type: 'metrics'; source: 'report' | 'analysis'; groups?: ObservationMetricGroup[]; empty_message?: string | null }
  | { type: 'status'; source: 'report' | 'analysis'; subject: string; loading_message?: string | null; unavailable_message?: string | null }
  | { type: 'dataset_files'; empty_message: string }
  | { type: 'summary' | 'findings' | 'artifacts' | 'analysis_version' | 'training_curves' };
export interface ObservationDetailSection {
  id: string; label: string; selection: 'report_version' | 'analysis_version' | 'task_id';
  blocks: ObservationDetailBlock[];
}
export interface ObservationDetailForm {
  project_node_id: string; sections: ObservationDetailSection[];
}
export interface ObservationsConfig {
  schema_version: 1; panels: PanelConfig[];
  detail_forms?: { schema_version: number; forms: ObservationDetailForm[] } | null;
}
export interface RunBinding {
  project_node_id: string; run_id: string; task_id: string;
  business_status: string; platform_node_id: string | null;
}
export interface StageAnalysis {
  job_id: string;
  stage_id: string;
  plan_sequence: number;
  run_ids: string[];
  status: 'queued' | 'ready' | 'failed';
  report_ids?: string[];
  report_version_id: string | null;
  result: {
    summary: string;
    findings: string[];
    metrics: { label: string; value: number; unit: MetricConfig['unit'] }[];
    artifacts: { artifact_id: string; name: string; kind: string; storage_ref: string }[];
  } | null;
}
export interface ObservationNode {
  id: string; title: string; type: string; business_status: string; current_run_ids: string[];
  report_version_ids?: string[];
  analysis_report_version_ids?: string[];
  historical_report_version_ids?: string[];
  execution_complete?: boolean;
  delivery_status?: 'pending' | 'registering' | 'failed';
  delivery_error?: string;
  delivery_error_field?: string;
}
export interface ObservationOverview {
  schema_version: 1; project_id: string; config_version: string; record_version: string;
  config: ObservationsConfig; plan_sequence: number | null;
  nodes: ObservationNode[];
  bindings: RunBinding[]; available_runs: RunBinding[];
  stage_analyses: StageAnalysis[];
  observed_at: string;
}
export interface ObservationDatasetFile {
  name: string; path: string; size_bytes: number | null; sample_count: number | null;
  distributions: Record<string, Record<string, number>>;
}
export interface ObservationReportIssue {
  field: string;
  code: 'invalid_metric' | 'invalid_count' | 'invalid_file' | 'invalid_check' | 'truncated' | 'unreadable_report' | 'invalid_report';
}
export interface ObservationReportDetails {
  project_id: string; project_node_id: string; report_version_ids: string[];
  metrics: NonNullable<StageAnalysis['result']>['metrics'];
  files: ObservationDatasetFile[];
  summaries?: string[];
  checks?: Record<string, boolean>;
  issues?: ObservationReportIssue[];
}
export interface ObservationReportQuery {
  project_node_id: string; analysis_job_id?: string; report_version_id?: string;
}
export interface MetricPoint {
  key: string; value: number; unit: string; source_point_id: string; source_run_id: string;
  log_step: number; training_step: number | null; epoch?: number | null; time: number | null;
}
export interface SeriesPage {
  project_id: string; project_node_id: string; run_id: string; config_version: string;
  points: MetricPoint[]; next_cursor: string | null; truncated: boolean; gap: boolean;
  observation_status: ObservationStatus; analysis_status: 'not_requested';
  observed_at: string; message: string | null;
  ignored_keys?: string[];
}
export interface SeriesQuery {
  project_node_id: string; run_id: string; keys?: string[]; cursor?: string; limit?: number;
}
