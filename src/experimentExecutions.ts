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
  needs_input: '等待补充输入', queued: '排队中', preparing: '准备评测方案', awaiting_confirmation: '等待执行确认',
  queued_submission: '等待提交平台', submitting: '正在提交平台', waiting_platform: '等待平台',
  waiting_artifacts: '等待产物校验', succeeded: '已成功', failed: '已失败', rejected: '已拒绝',
  submission_uncertain: '提交结果待核对', cancel_requested: '取消中', cancelled: '已取消',
  abandoned: '已终止跟踪 · 平台任务可能仍在运行', waiting_authorization: '等待重新授权',
};
export function executionLabel(state: string): string { return labels[state] ?? `状态：${state}`; }

export function stageExecutionLabel(executions: readonly ExperimentExecution[], stageId: string, runIds: readonly string[] = [], unassociatedLabel = '尚未执行'): string {
  const matching = executions.filter(run => run.stage_id === stageId || runIds.includes(run.run_id));
  return matching.length ? executionLabel(matching[matching.length - 1].state) : unassociatedLabel;
}
