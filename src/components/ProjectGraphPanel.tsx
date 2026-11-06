import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RequestOptions } from '../api';
import {
  nodeConfigDigest,
  type ProjectArtifact,
  type ProjectArtifactDocument,
  type ProjectEdge,
  type ProjectGraphView,
  type ProjectNode,
  type StageRun,
} from '../echomindContract';
import type { ProductClient } from '../productClient';

interface ProjectGraphPanelProps {
  client: ProductClient;
  projectId: string;
  graphRevision: number;
  requestOptions: RequestOptions;
}

export function ProjectGraphPanel({
  client,
  projectId,
  graphRevision,
  requestOptions,
}: ProjectGraphPanelProps) {
  const [graph, setGraph] = useState<ProjectGraphView | null>(null);
  const [runs, setRuns] = useState<StageRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const [nextGraph, nextRuns] = await Promise.all([
        client.projectGraph(projectId, requestOptions),
        client.projectRuns(projectId, requestOptions),
      ]);
      setGraph(nextGraph);
      setRuns(nextRuns);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Failed to load the Project Graph.',
      );
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [client, projectId, requestOptions]);

  useEffect(() => {
    void refresh();
  }, [graphRevision, refresh]);

  const levels = useMemo(
    () => graph ? layoutNodes(graph.nodes, graph.edges) : [],
    [graph],
  );
  const runsByNode = useMemo(() => groupRunsByNode(runs), [runs]);

  const readArtifact = async (artifact: ProjectArtifact) => {
    const document = await client.projectArtifact(
      projectId,
      artifact.artifact_id,
      requestOptions,
    );
    return document;
  };

  return <section
    className="mt-6 min-w-0 border-t border-slate-200 pt-5"
    aria-label="Project Graph"
  >
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">实验流程</h2>
          {graph && <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
            {graph.lifecycle === 'development' ? '开发中' : '已发布'}
          </span>}
        </div>
        <p className="mt-1 break-all text-xs text-slate-500">
          {projectId}
        </p>
        {graph && <p className="mt-1 break-all font-mono text-[10px] text-slate-500">
          graph {graph.graph_id} · {graph.template ?? 'custom'}
        </p>}
      </div>
      <button
        type="button"
        onClick={() => { void refresh(); }}
        disabled={loading}
        className="rounded border bg-white px-3 py-1 text-xs disabled:opacity-40"
      >
        {loading ? '加载中' : '刷新'}
      </button>
    </div>

    {levels.map((level, index) => <div key={index}>
      <div className="mt-3 grid gap-2">
        {level.map(node => <NodeCard
          key={node.id}
          node={node}
          runs={runsByNode.get(node.id) ?? []}
          onReadArtifact={readArtifact}
        />)}
      </div>
      {index < levels.length - 1 && (
        <div aria-hidden="true" className="py-1 text-center text-slate-400">↓</div>
      )}
    </div>)}

    {!loading && graph && graph.nodes.length === 0 && (
      <p className="mt-4 text-sm text-slate-500">Project 已创建，当前 Graph 暂无节点。</p>
    )}
    {graph && graph.requirements.length > 0 && <details className="mt-4 rounded-md border border-slate-200 bg-white p-3">
      <summary className="text-xs font-medium">需求清单 · {graph.requirements.length}</summary>
      <ul className="mt-2 space-y-2 text-xs">
        {graph.requirements.map(item => <li key={item.key}>
          <span className="font-medium">{item.label}</span>
          <span className={`ml-2 ${item.status === 'missing' ? 'text-amber-700' : 'text-emerald-700'}`}>
            {item.status === 'missing' ? '待补充' : '已确认'}
          </span>
          {item.value && <p className="mt-0.5 break-all text-slate-500">{item.value}</p>}
        </li>)}
      </ul>
    </details>}
    {error && <p role="alert" className="mt-3 border-y border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
      {error}
    </p>}
  </section>;
}

interface NodeCardProps {
  node: ProjectNode;
  runs: StageRun[];
  onReadArtifact: (artifact: ProjectArtifact) => Promise<ProjectArtifactDocument>;
}

function NodeCard({
  node,
  runs,
  onReadArtifact,
}: NodeCardProps) {
  const latest = runs[0] ?? null;
  const [currentDigest, setCurrentDigest] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<ProjectArtifactDocument | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [loadingArtifactId, setLoadingArtifactId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void nodeConfigDigest(node).then(digest => {
      if (active) setCurrentDigest(digest);
    }).catch(() => {
      if (active) setCurrentDigest(null);
    });
    return () => {
      active = false;
    };
  }, [node]);

  const stale = Boolean(
    latest
    && latest.status === 'succeeded'
    && currentDigest
    && latest.node_config_digest !== currentDigest,
  );

  const showArtifact = async (item: ProjectArtifact) => {
    setLoadingArtifactId(item.artifact_id);
    setArtifactError(null);
    try {
      setArtifact(await onReadArtifact(item));
    } catch (failure) {
      setArtifactError(
        failure instanceof Error ? failure.message : '读取 Artifact 失败',
      );
    } finally {
      setLoadingArtifactId(null);
    }
  };

  return <article className="min-w-0 rounded-md border border-slate-200 bg-white p-3">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 className="break-words text-sm font-medium">{node.title}</h3>
          <StatusBadge latest={latest} stale={stale} />
        </div>
        <p className="mt-1 break-all font-mono text-[10px] text-slate-500">
          {node.id} · {node.type} · {node.execution_role || node.executor.kind}
        </p>
      </div>
    </div>

    {latest && <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-500">
      <span>{runTime(latest.created_at)}</span>
      <span>·</span>
      <span>{latest.message}</span>
    </div>}
    {latest && latest.input_refs.length > 0 && <details className="mt-2">
      <summary className="cursor-pointer text-[10px] text-slate-500">
        输入 · {latest.input_refs.length}
      </summary>
      <ul className="mt-1 space-y-0.5 rounded bg-slate-50 px-2 py-1.5 font-mono text-[10px] text-slate-600">
        {latest.input_refs.map(inputRef => <li key={inputRef} className="break-all">
          {inputRef}
        </li>)}
      </ul>
    </details>}
    {latest && latest.task_runs.length > 0 && <details className="mt-2">
      <summary className="cursor-pointer text-[10px] text-slate-500">
        执行明细 · {latest.task_runs.length}
      </summary>
      <ul className="mt-1 space-y-1 rounded bg-slate-50 px-2 py-1.5 text-[10px]">
        {latest.task_runs.map(taskRun => <li
          key={taskRun.task_run_id}
          className="flex min-w-0 items-center justify-between gap-2"
        >
          <span className="min-w-0 truncate">
            {taskRun.role_id || 'task'} · {taskRun.task_run_id}
          </span>
          <RunStatus status={taskRun.status} />
        </li>)}
      </ul>
    </details>}
    {latest?.error && <p className="mt-2 break-words rounded bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">
      {latest.error}
    </p>}
    {latest?.artifacts.map(item => <button
      key={item.artifact_id}
      type="button"
      onClick={() => { void showArtifact(item); }}
      disabled={loadingArtifactId !== null}
      className="mt-2 rounded border border-slate-300 px-2 py-1 text-[10px] text-slate-700 disabled:opacity-40"
    >
      {loadingArtifactId === item.artifact_id ? '读取中' : `查看报告 · ${item.kind}`}
    </button>)}
    {artifactError && <p role="alert" className="mt-2 text-[11px] text-rose-700">
      {artifactError}
    </p>}
    {artifact && <div className="mt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium text-slate-600">
          {artifact.artifact.kind} · {artifact.artifact.content_sha256.slice(0, 12)}
        </span>
        <button
          type="button"
          onClick={() => setArtifact(null)}
          className="text-[10px] text-slate-500 underline"
        >
          关闭
        </button>
      </div>
      <pre className="mt-1 max-h-56 overflow-auto rounded bg-slate-950 p-2 text-[10px] leading-4 text-slate-100">
        {JSON.stringify(artifact.content, null, 2)}
      </pre>
    </div>}
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-slate-600">查看配置</summary>
      <pre className="mt-2 max-h-48 overflow-auto rounded bg-slate-950 p-2 text-[10px] leading-4 text-slate-100">
        {JSON.stringify(node.config, null, 2)}
      </pre>
    </details>
  </article>;
}

function StatusBadge({
  latest,
  stale,
}: {
  latest: StageRun | null;
  stale: boolean;
}) {
  if (stale) {
    return <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
      验证已过期
    </span>;
  }
  if (latest) return <RunStatus status={latest.status} />;
  return <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
    待验证
  </span>;
}

function RunStatus({ status }: { status: StageRun['status'] }) {
  const label = {
    clarifying: '需求梳理中',
    running: '执行中',
    waiting_user: '待用户确认',
    waiting_external: '等待平台',
    succeeded: '执行完成',
    failed: '执行失败',
  }[status];
  const tone = status === 'succeeded'
    ? 'bg-emerald-100 text-emerald-800'
    : status === 'failed'
      ? 'bg-rose-100 text-rose-800'
      : status === 'waiting_user' || status === 'waiting_external'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-sky-100 text-sky-800';
  return <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${tone}`}>
    {label}
  </span>;
}

function runTime(value: string): string {
  return new Date(value).toLocaleString();
}

function groupRunsByNode(runs: StageRun[]): Map<string, StageRun[]> {
  const grouped = new Map<string, StageRun[]>();
  for (const run of runs) {
    grouped.set(run.node_id, [...(grouped.get(run.node_id) ?? []), run]);
  }
  return grouped;
}

function layoutNodes(
  nodes: ProjectNode[],
  edges: ProjectEdge[],
): ProjectNode[][] {
  const levels = new Map(nodes.map(node => [node.id, 0]));
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const next = (levels.get(edge.source) ?? 0) + 1;
      if (next > (levels.get(edge.target) ?? 0)) {
        levels.set(edge.target, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const grouped = new Map<number, ProjectNode[]>();
  for (const node of nodes) {
    const level = levels.get(node.id) ?? 0;
    grouped.set(level, [...(grouped.get(level) ?? []), node]);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, items]) => items);
}
