import { useCallback, useEffect, useRef, useState } from 'react';
import type { RequestOptions } from '../api';
import { ProjectReportViewer } from './ProjectReportViewer';
import { getRuntimeSlot, type ProjectRuntimeSlot } from '../echomindResources';
import {
  comparable, deployable, deploymentActive, deploymentHistory,
  deploymentStatusLabel, modelReports, rankCandidates, refreshModelReport,
  startDeployment, type DeploymentRecord, type ModelEvaluationRecord,
} from '../echomindOperations';

const button = 'rounded border bg-white px-3 py-1.5 text-xs disabled:opacity-40';
const section = 'min-w-0 rounded-lg border bg-white p-4 xl:col-span-2';
const reportLabels = {pending: '待读取', ready: '已归档', invalid: '评测无效', unavailable: '读取失败'};
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

export function ProjectModelOperations({ projectId, requestOptions, onOpenRun, onReportsChanged }: {
  projectId: string; requestOptions: RequestOptions; onOpenRun: (runId: string) => void;
  onReportsChanged?: (reports: ModelEvaluationRecord[], error: string, loading: boolean) => void;
}) {
  const [candidates, setCandidates] = useState<ModelEvaluationRecord[]>([]);
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [slot, setSlot] = useState<ProjectRuntimeSlot | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [group, setGroup] = useState('');
  const [metric, setMetric] = useState('mean_overall_score');
  const [ascending, setAscending] = useState(false);
  const [deploymentChoice, setDeploymentChoice] = useState<{candidate_id: string} | {rollback_deployment_id: string} | null>(null);
  const [openReport, setOpenReport] = useState<string | null>(null);
  const generation = useRef(0);
  const hydrated = useRef(new Set<string>());
  const requests = useRef(new Map<string, string>());

  const refresh = useCallback(async () => {
    const epoch = generation.current;
    const [reports, history, resources] = await Promise.allSettled([
      modelReports(projectId, requestOptions), deploymentHistory(projectId, requestOptions), getRuntimeSlot(projectId, requestOptions),
    ]);
    if (epoch !== generation.current) return;
    const nextErrors: Record<string, string> = {};
    if (reports.status === 'fulfilled') setCandidates(reports.value.candidates);
    else nextErrors.reports = messageOf(reports.reason);
    if (history.status === 'fulfilled') setDeployments(history.value);
    else nextErrors.deployments = messageOf(history.reason);
    if (resources.status === 'fulfilled') setSlot(resources.value);
    else { setSlot(null); nextErrors.deployments = messageOf(resources.reason); }
    setErrors(current => ({...current, reports: '', deployments: '', ...nextErrors}));
    setLoading(false);
  }, [projectId, requestOptions]);

  useEffect(() => {
    generation.current += 1;
    setBusy(null);
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000);
    return () => { generation.current += 1; clearInterval(timer); };
  }, [refresh]);

  const reportError = errors.reports ?? '';
  useEffect(() => {
    onReportsChanged?.(candidates, reportError, loading);
  }, [candidates, reportError, loading, onReportsChanged]);

  const readReport = useCallback(async (candidateId: string) => {
    const epoch = generation.current;
    const report = await refreshModelReport(projectId, candidateId, requestOptions);
    if (epoch === generation.current) {
      setCandidates(current => current.map(item => item.candidate_id === candidateId ? report : item));
      setErrors(current => ({...current, [candidateId]: ''}));
    }
  }, [projectId, requestOptions]);

  useEffect(() => {
    const candidate = candidates.find(item => item.report_status === 'pending' && !hydrated.current.has(item.candidate_id));
    if (!candidate) return;
    hydrated.current.add(candidate.candidate_id);
    const epoch = generation.current;
    void readReport(candidate.candidate_id).catch(error => {
      if (epoch === generation.current) setErrors(current => ({...current, [candidate.candidate_id]: messageOf(error)}));
    });
  }, [candidates, readReport]);

  async function act(id: string, operation: () => Promise<void>) {
    if (busy) return;
    const epoch = generation.current;
    setBusy(id);
    setErrors(current => ({...current, action: ''}));
    try { await operation(); if (epoch === generation.current) await refresh(); }
    catch (error) { if (epoch === generation.current) setErrors(current => ({...current, action: messageOf(error)})); }
    finally { if (epoch === generation.current) setBusy(null); }
  }

  const activeDeployment = deployments.find(deploymentActive);
  const servingId = slot?.serving_inference?.resource_id;
  const latestSuccess = [...deployments].filter(item => item.status === 'succeeded' && item.target?.resource_id === servingId).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const groups = [...new Set(candidates.flatMap(item => item.comparison_group ? [item.comparison_group] : []))];
  const metrics = [...new Set(candidates.flatMap(item => Object.keys(item.metrics)))].sort();
  const visible = group ? rankCandidates(candidates, group, metric, ascending) : candidates;
  const compared = selected.map(id => candidates.find(item => item.candidate_id === id)).filter((item): item is ModelEvaluationRecord => !!item);
  const canCompare = compared.length === 2 && comparable(compared[0], compared[1]);

  async function deploy() {
    if (!deploymentChoice) return;
    const choice = deploymentChoice;
    const key = JSON.stringify(choice);
    const requestId = requests.current.get(key) ?? crypto.randomUUID();
    requests.current.set(key, requestId);
    await startDeployment(projectId, choice, requestId, requestOptions);
    requests.current.delete(key);
    setDeploymentChoice(null);
  }

  return <>
    <section className={section} aria-label="模型与评测报告">
      <h3 className="text-sm font-semibold">模型与评测报告</h3>
      <p className="mt-1 text-xs text-slate-500">分数来自本 Project 的 Eval 产物。评测完成不自动上线；只有评测集和规则等条件一致的版本才可比较。</p>
      {errors.reports && <p role="alert" className="mt-2 text-xs text-red-700">{errors.reports}</p>}
      <div className="my-3 flex flex-wrap gap-2">
        <select aria-label="评测比较组" className="max-w-72 rounded border p-1 text-xs" value={group} onChange={event => setGroup(event.target.value)}>
          <option value="">全部版本 · 按时间查看</option>
          {groups.map((value, index) => <option key={value} value={value}>相同评测口径 {index + 1} · {value.slice(0, 8)}</option>)}
        </select>
        {group && <>
          <select aria-label="排名指标" className="rounded border p-1 text-xs" value={metric} onChange={event => setMetric(event.target.value)}>
            {!metrics.includes(metric) && <option value={metric}>{metric}</option>}
            {metrics.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <select aria-label="排名方向" className="rounded border p-1 text-xs" value={ascending ? 'asc' : 'desc'} onChange={event => setAscending(event.target.value === 'asc')}>
            <option value="desc">越高越好</option><option value="asc">越低越好</option>
          </select>
        </>}
      </div>
      {loading && <p className="text-xs">正在读取模型记录…</p>}
      {!loading && !candidates.length && <p className="text-xs text-slate-500">还没有完成训练与评测的模型版本。</p>}
      {group && !visible.length && <p className="text-xs text-slate-500">该比较组没有此指标，不生成排名。</p>}
      <div className="space-y-3">{visible.map(candidate => <ModelReportCard key={candidate.candidate_id} candidate={candidate}
        selected={selected.includes(candidate.candidate_id)} current={latestSuccess?.candidate_id === candidate.candidate_id}
        busy={!!busy || !!activeDeployment} error={errors[candidate.candidate_id]}
        onSelect={() => setSelected(current => current.includes(candidate.candidate_id) ? current.filter(id => id !== candidate.candidate_id) : [...current.slice(-1), candidate.candidate_id])}
        onRead={() => void act('read-report', () => readReport(candidate.candidate_id))}
        onView={() => setOpenReport(candidate.candidate_id)}
        onRun={() => onOpenRun(candidate.run_id)} onDeploy={() => setDeploymentChoice({candidate_id: candidate.candidate_id})} />)}</div>
      {openReport && <ProjectReportViewer key={openReport} projectId={projectId} candidateId={openReport} requestOptions={requestOptions} onClose={() => setOpenReport(null)} />}
      {compared.length === 2 && (canCompare ? <div className="mt-3 overflow-x-auto rounded border p-3">
        <h4 className="mb-2 text-xs font-semibold">所选模型对比 · 相同评测口径</h4>
        <table className="w-full text-left text-xs"><thead><tr><th>指标</th>{compared.map(item => <th key={item.candidate_id}>第 {item.round_no} 轮 · {item.candidate_id.slice(0, 8)}</th>)}</tr></thead>
          <tbody>{[...new Set(compared.flatMap(item => Object.keys(item.metrics)))].map(name => <tr key={name}><td className="py-1">{name}</td>{compared.map(item => <td key={item.candidate_id}>{formatMetric(item.metrics[name])}</td>)}</tr>)}</tbody>
        </table>
      </div> : <p role="status" className="mt-3 rounded bg-amber-50 p-2 text-xs">所选版本的评测口径不同或指纹不完整，不进行分数比较。</p>)}
    </section>

    <section className={section} aria-label="模型部署与回滚">
      <h3 className="text-sm font-semibold">模型部署与回滚</h3>
      <p className="mt-1 text-xs text-slate-500">先验证候选 Inference，再切换 Tracer 上游并验证流量。平台切换可能短暂重启 Tracer；旧 Inference 保留用于回滚，也会继续占用资源。</p>
      {errors.deployments && <p role="alert" className="mt-2 text-xs text-red-700">{errors.deployments}</p>}
      {!deployments.length && <p className="mt-2 text-xs text-slate-500">当前沿用已搭建的 Inference，尚无人工部署记录。</p>}
      <ul className="mt-3 space-y-2">{deployments.map(item => <li key={item.deployment_id} className="rounded border p-2 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2"><span>{deploymentStatusLabel[item.status]} · {item.deployment_id.slice(0, 8)}</span>
          {item.deployment_id === latestSuccess?.deployment_id && <button className={button} disabled={!!busy || !!activeDeployment} onClick={() => setDeploymentChoice({rollback_deployment_id: item.deployment_id})}>回滚到本次部署前版本</button>}
        </div>
        <p className="mt-1 break-all text-slate-500">{item.model_uri}</p>
        {item.error && <p role="status" className="mt-1 text-red-700">{item.error}</p>}
        {item.cleanup_status === 'pending' && <p className="mt-1 text-amber-800">失败候选资源待释放{item.cleanup_error ? `：${item.cleanup_error}` : '，后台正在核对并重试'}</p>}
        {item.cleanup_status === 'released' && <p className="mt-1 text-slate-500">失败候选资源已释放。</p>}
      </li>)}</ul>
      {deploymentChoice && <div role="group" aria-label="确认模型切换" className="mt-3 rounded border border-blue-200 bg-blue-50 p-3 text-xs">
        <p>即将{'candidate_id' in deploymentChoice ? `部署候选 ${deploymentChoice.candidate_id.slice(0, 8)}` : '恢复所选部署之前的模型'}。只有切换验证成功后才更新线上版本。</p>
        <div className="mt-2 flex gap-2"><button className={button} disabled={!!busy || !!activeDeployment} onClick={() => void act('deploy', deploy)}>确认切换</button><button className={button} disabled={!!busy} onClick={() => setDeploymentChoice(null)}>取消</button></div>
      </div>}
      {errors.action && <p role="alert" className="mt-3 text-xs text-red-700">{errors.action}</p>}
      {busy && <p role="status" className="mt-2 text-xs text-slate-500">正在处理…</p>}
    </section>
  </>;
}

function formatMetric(value: number | undefined): string {
  return value === undefined ? '—' : Number.isInteger(value) ? String(value) : value.toFixed(4);
}

export function ModelReportCard({candidate, selected, current, busy, error, onSelect, onRead, onRun, onDeploy, onView}: {
  candidate: ModelEvaluationRecord; selected: boolean; current: boolean; busy: boolean; error?: string;
  onSelect: () => void; onRead: () => void; onRun: () => void; onDeploy: () => void;
  onView?: () => void;
}) {
  return <article className="rounded border p-3 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label className="flex items-center gap-2"><input type="checkbox" checked={selected} onChange={onSelect} />
        <span className="font-medium">第 {candidate.round_no} 轮 · {candidate.candidate_id.slice(0, 8)}{candidate.execution_mode === 'debug' ? ' · 调试' : ''}</span>
      </label>
      <span>{reportLabels[candidate.report_status]}{current ? ' · 当前线上模型' : ''}</span>
    </div>
    <p className="mt-2 text-slate-500">{new Date(candidate.created_at).toLocaleString()} · 批次 {candidate.source_batch_id ?? '手动运行'}</p>
    <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1">{Object.entries(candidate.metrics).slice(0, 8).map(([name, value]) => <div key={name}><dt className="inline text-slate-500">{name} </dt><dd className="inline font-medium">{formatMetric(value)}</dd></div>)}</dl>
    <details className="mt-2"><summary className="cursor-pointer text-blue-700">评测标准、模型与报告</summary>
      <p className="mt-2 break-all text-slate-500">训练起点：{candidate.training_base_uri ?? '未记录'}</p>
      <p className="mt-1 break-all text-slate-500">模型：{candidate.model_uri}</p>
      <p className="mt-1 break-all text-slate-500">验证集：{candidate.evaluation_dataset_uri ?? '未记录'}</p>
      <p className="mt-1 break-all text-slate-500">报告：{candidate.report_html_uri ?? candidate.report_uri}</p>
      <p className="mt-1 text-slate-500">规则指纹：{candidate.evaluation_config_sha256 ?? '待核验'} · 数据指纹：{candidate.dataset_sha256 ?? '待核验'}</p>
      {candidate.pass_threshold !== null && <p className="mt-2">样本通过阈值：{candidate.pass_threshold}（不代表模型上线标准）</p>}
      <ul className="mt-2 space-y-1">{candidate.rubrics.map(rule => <li key={rule.name}>{rule.criterion} · 权重 {rule.weight}{rule.required ? ' · 必须通过' : ''}</li>)}</ul>
      {!candidate.rubrics.length && <p className="mt-2 text-slate-500">尚未读取到评分维度，请读取报告核验。</p>}
      <dl className="mt-2 space-y-1">{Object.entries(candidate.metrics).map(([name, value]) => <div key={name}><dt className="inline">{name}：</dt><dd className="inline">{formatMetric(value)}</dd></div>)}</dl>
    </details>
    {candidate.issues.length > 0 && <p role="status" className="mt-2 text-amber-800">{candidate.issues.join(' · ')}</p>}
    {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      <button className={button} disabled={busy} onClick={onRead}>读取评测报告</button>
      {onView && <button className={button} disabled={candidate.report_status === 'pending'} onClick={onView}>查看报告与样本</button>}
      <button className={button} onClick={onRun}>查看执行记录</button>
      <button className={button} disabled={busy || current || !deployable(candidate)} onClick={onDeploy}>部署到 Inference</button>
    </div>
    {!deployable(candidate) && <p className="mt-2 text-slate-500">只有已验证的生产评测报告和完整模型产物可用于部署。</p>}
  </article>;
}
