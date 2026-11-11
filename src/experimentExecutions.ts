export interface ExperimentExecution {
  run_id: string;
  plan_sequence?: number | null;
  stage_snapshot?: {id: string; kind?: string | null; name: string; description?: string} | null;
  project_id: string;
  plan_revision: number | null;
  task_id: string;
  stage_id: string | null;
  task_name: string;
  intent?: string;
  summary?: string | null;
  report_uri?: string | null;
  blockers?: string[];
  waiting_reason?: string | null;
  checkpoint?: {
    checkpoint_id: string;
    status: 'pending' | 'approved' | 'revise';
    document: { summary: string; sample_count: number; retained_count: number; source_count?: number; validation?: Record<string, unknown>; preview: Record<string, unknown>[] };
    evidence: Record<string, string>;
  } | null;
  role_id: string;
  state: string;
  report_state: string;
  fingerprint: string | null;
  proposal: Record<string, unknown> | null;
  metrics: Record<string, unknown> | null;
  platform_task_id: string | null;
  artifacts: { name: string; uri: string; sha256: string }[];
}

const labels: Record<string, string> = {
  prepared: '方案已准备 · 未提交平台',
  needs_input: '执行受阻', queued: '排队中', preparing: '准备执行', awaiting_confirmation: '等待执行确认',
  waiting_user: '等待用户确认', waiting_confirmation: '等待工作流确认',
  queued_submission: '等待提交平台', submitting: '正在提交平台', waiting_platform: '等待平台结果',
  agent_completed: '本轮已结束 · 等待交付报告', waiting_analysis: '结果已返回 · 等待分析与交付', analyzing: '正在分析平台结果',
  waiting_artifacts: '等待产物校验', reported: '已交付报告', succeeded: '已成功', failed: '已失败', rejected: '已拒绝',
  submission_uncertain: '提交结果待核对', cancel_requested: '取消中', cancelled: '已取消',
  abandoned: '已终止跟踪 · 平台任务可能仍在运行', waiting_authorization: '等待重新授权',
};
export function executionLabel(state: string): string { return labels[state] ?? `状态：${state}`; }

export function executionProgressLabel(run: ExperimentExecution): string {
  if (run.state === 'waiting_artifacts') return run.report_state === 'failed' ? '产物登记失败' : '正在整理产物';
  if (run.report_state === 'failed') return `${executionLabel(run.state)} · 报告失败`;
  if (run.state === 'succeeded' && run.report_state !== 'ready') return '执行已完成 · 正在生成报告';
  return executionLabel(run.state);
}
