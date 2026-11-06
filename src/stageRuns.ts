import type { StageRun } from './echomindContract';

export function stageRunLabel(status: StageRun['status']): string {
  return {
    clarifying: '需求澄清中',
    running: '执行中',
    waiting_user: '等待用户确认',
    waiting_external: '等待平台',
    succeeded: '已成功',
    failed: '已失败',
  }[status];
}

export function latestRunByStage(
  runs: readonly StageRun[],
): Map<string, StageRun> {
  const latest = new Map<string, StageRun>();
  for (const run of runsForStages(runs)) latest.set(run.node_id, run);
  return latest;
}

export function runsForStage(
  runs: readonly StageRun[],
  stageId: string,
): StageRun[] {
  return runs.filter(run => run.node_id === stageId);
}

function runsForStages(runs: readonly StageRun[]): StageRun[] {
  return [...runs].sort(
    (left, right) => left.created_at.localeCompare(right.created_at),
  );
}
