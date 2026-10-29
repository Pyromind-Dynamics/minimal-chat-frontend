export interface PlanResource { id: string; name: string; uri: string | null; description: string }
export interface ExperimentStage { id: string; name: string; description: string; enabled: boolean; placeholder: boolean }
export interface PlanInput { name: string; resource_id: string | null; task_id: string | null; output_name: string | null }
export interface ExperimentTask {
  id: string; stage_id: string; name: string; description: string;
  inputs: PlanInput[]; outputs: { name: string; description: string }[];
  completion_conditions: { kind: string; description: string }[];
}
export interface WorkflowPlan {
  schema_version: 1; name: string; goal: string; resources: PlanResource[];
  unresolved: string[]; stages: ExperimentStage[]; tasks: ExperimentTask[];
  edges: { source: string; target: string }[];
}
export interface PlanProposal {
  proposal_id: string; base_revision: number; plan: WorkflowPlan; summary: string;
  changes: string[]; status: 'pending' | 'superseded' | 'rejected' | 'confirmed'; created_at: string;
}
export interface PlanRevision {
  project_id: string; revision: number; plan: WorkflowPlan; confirmed_by: string; confirmed_at: string;
}
export interface ExperimentPlanView {
  project_id: string | null; current_revision: number; current: PlanRevision | null;
  pending_proposal: PlanProposal | null;
  history: { revision: number; name: string; confirmed_at: string }[];
}

export function layoutPlan(plan: WorkflowPlan) {
  const levels = new Map(plan.stages.map(stage => [stage.id, 0]));
  for (let pass = 0; pass < plan.stages.length; pass += 1) {
    let changed = false;
    for (const edge of plan.edges) {
      const next = (levels.get(edge.source) ?? 0) + 1;
      if (next > (levels.get(edge.target) ?? 0)) { levels.set(edge.target, next); changed = true; }
    }
    if (!changed) break;
  }
  const last = Math.max(...levels.values());
  for (const stage of plan.stages) {
    if (stage.placeholder && !plan.edges.some(edge => edge.source === stage.id || edge.target === stage.id)) levels.set(stage.id, last + 1);
  }
  const counts = new Map<number, number>();
  const nodes = plan.stages.map(stage => {
    const level = levels.get(stage.id) ?? 0;
    const column = counts.get(level) ?? 0;
    counts.set(level, column + 1);
    return { ...stage, x: column * 190 + 10, y: level * 100 + 10 };
  });
  const columns = Math.max(1, ...counts.values());
  for (const node of nodes) node.x += (columns - (counts.get(levels.get(node.id) ?? 0) ?? 1)) * 95;
  return { nodes, width: columns * 190, height: (Math.max(...levels.values()) + 1) * 100 };
}

export function planDiff(before: WorkflowPlan, after: WorkflowPlan) {
  const rows: { label: string; before: string; after: string }[] = [];
  const add = (label: string, old: string, value: string) => { if (old !== value) rows.push({ label, before: old || '无', after: value || '无' }); };
  add('项目名称', before.name, after.name);
  add('实验目标', before.goal, after.goal);
  add('待补充事项', before.unresolved.join('\n'), after.unresolved.join('\n'));
  const compare = <T extends { id: string; name: string }>(label: string, old: T[], values: T[], describe: (value: T) => string) => {
    const keys = new Set([...old, ...values].map(item => item.id));
    for (const key of keys) {
      const a = old.find(item => item.id === key), b = values.find(item => item.id === key);
      add(`${label}：${b?.name ?? a?.name}`, a ? describe(a) : '', b ? describe(b) : '');
    }
  };
  compare('资源', before.resources, after.resources, r => [r.name, r.uri, r.description].filter(Boolean).join('\n'));
  compare('阶段', before.stages, after.stages, s => [s.name, s.description, s.placeholder ? '占位' : s.enabled ? '启用' : '未启用'].join('\n'));
  const describeTask = (plan: WorkflowPlan, task: ExperimentTask) => [
    task.name, plan.stages.find(stage => stage.id === task.stage_id)?.name ?? task.stage_id, task.description,
    ...task.inputs.map(input => `${input.name} ← ${input.resource_id ? plan.resources.find(resource => resource.id === input.resource_id)?.name : plan.tasks.find(upstream => upstream.id === input.task_id)?.name}${input.output_name ? ` / ${input.output_name}` : ''}`),
    ...task.outputs.map(output => `${output.name}：${output.description}`),
    ...task.completion_conditions.map(condition => `${condition.kind}：${condition.description}`),
  ].filter(Boolean).join('\n');
  const keys = new Set([...before.tasks, ...after.tasks].map(task => task.id));
  for (const id of keys) {
    const a = before.tasks.find(task => task.id === id), b = after.tasks.find(task => task.id === id);
    add(`任务：${b?.name ?? a?.name}`, a ? describeTask(before, a) : '', b ? describeTask(after, b) : '');
  }
  const edges = (plan: WorkflowPlan) => plan.edges.map(edge => `${plan.stages.find(stage => stage.id === edge.source)?.name} → ${plan.stages.find(stage => stage.id === edge.target)?.name}`).sort().join('\n');
  add('阶段连线', edges(before), edges(after));
  return rows;
}
