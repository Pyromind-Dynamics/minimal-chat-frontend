import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RequestOptions } from '../api';
import type {
  ProjectArtifactDocument,
  ProjectEdge,
  ProjectInfo,
  ProjectNode,
  StageRun,
} from '../echomindContract';
import type { ProductClient } from '../productClient';

interface ProjectGraphPanelProps {
  client: ProductClient;
  projectId: string;
  revision: number;
  requestOptions: RequestOptions;
}

export function ProjectGraphPanel({
  client,
  projectId,
  revision,
  requestOptions,
}: ProjectGraphPanelProps) {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [runs, setRuns] = useState<StageRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<ProjectArtifactDocument | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextProject, nextRuns] = await Promise.all([
        client.project(projectId, requestOptions),
        client.projectRuns(projectId, requestOptions),
      ]);
      setProject(nextProject);
      setRuns(nextRuns);
      setSelectedRunId((current) => (
        current && nextRuns.some((run) => run.run_id === current)
          ? current
          : nextRuns[0]?.run_id ?? null
      ));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Failed to load Project Graph.');
    } finally {
      setLoading(false);
    }
  }, [client, projectId, requestOptions]);

  useEffect(() => {
    setProject(null);
    setRuns([]);
    setSelectedRunId(null);
    setArtifact(null);
    setNotice(null);
    void refresh();
  }, [projectId, revision, refresh]);

  const latestRunByNode = useMemo(() => {
    const latest = new Map<string, StageRun>();
    for (const run of runs) {
      if (!latest.has(run.node_id)) latest.set(run.node_id, run);
    }
    return latest;
  }, [runs]);

  const selectedRun = runs.find((run) => run.run_id === selectedRunId) ?? runs[0] ?? null;

  const runNode = async (node: ProjectNode) => {
    setActiveNodeId(node.id);
    setError(null);
    setNotice(null);
    try {
      const result = await client.runProjectNode(projectId, node.id, requestOptions);
      setRuns((current) => [
        result,
        ...current.filter((run) => run.run_id !== result.run_id),
      ]);
      setSelectedRunId(result.run_id);
      setNotice(`${node.title} 已完成一次验证。`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : `Failed to run ${node.title}.`);
    } finally {
      setActiveNodeId(null);
    }
  };

  const startNode = async (node: ProjectNode) => {
    setActiveNodeId(node.id);
    setError(null);
    setNotice(null);
    try {
      await client.startProjectNode(projectId, node.id, requestOptions);
      setNotice(`${node.title} 已交给当前 EchoMind 会话继续开发。`);
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : `Failed to start ${node.title}.`);
    } finally {
      setActiveNodeId(null);
    }
  };

  const openArtifact = async (artifactId: string) => {
    setError(null);
    try {
      setArtifact(await client.projectArtifact(projectId, artifactId, requestOptions));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Failed to load artifact.');
    }
  };

  const graph = project?.graph;
  const levels = graph ? layoutNodes(graph.nodes, graph.edges) : [];

  return <section className="mt-6 border-t border-slate-200 pt-5" aria-label="Project Graph">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="font-semibold">Project Graph</h2>
        <p className="mt-1 break-all text-xs text-slate-500">
          {projectId} · revision {revision}
        </p>
      </div>
      <button type="button" onClick={() => { void refresh(); }} disabled={loading || activeNodeId !== null} className="rounded border bg-white px-3 py-1 text-xs disabled:opacity-40">
        {loading ? '加载中' : '刷新'}
      </button>
    </div>
    {graph?.template && <p className="mt-2 font-mono text-[11px] text-slate-500">{graph.template}</p>}
    {levels.map((level, index) => <div key={index}>
      <div className="mt-3 grid gap-2">
        {level.map((node) => {
          const latestRun = latestRunByNode.get(node.id);
          const status = latestRun?.status ?? node.status;
          const isAgentNode = node.launch_mode === 'agent';
          return <article key={node.id} className="rounded-md border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-medium">{node.title}</h3>
                <p className="mt-1 font-mono text-[10px] uppercase text-slate-500">{node.type} · {node.executor}</p>
              </div>
              <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${statusClass(status)}`}>{status}</span>
            </div>
            <p className="mt-2 text-xs text-slate-600">{nodeSummary(node)}</p>
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-[10px] text-slate-500">{isAgentNode ? 'agent development' : 'executor validation'}</span>
              <button type="button" disabled={activeNodeId !== null} onClick={() => { void (isAgentNode ? startNode(node) : runNode(node)); }} className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium disabled:opacity-40">
                {activeNodeId === node.id ? '执行中' : isAgentNode ? '启动开发' : '运行验证'}
              </button>
            </div>
          </article>;
        })}
      </div>
      {index < levels.length - 1 && <div aria-hidden="true" className="py-1 text-center text-slate-400">↓</div>}
    </div>)}
    {!loading && graph && graph.nodes.length === 0 && <p className="mt-4 text-sm text-slate-500">Project 已创建，Graph 暂无节点。</p>}
    {error && <p role="alert" className="mt-3 border-y border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
    {notice && <p role="status" className="mt-3 border-y border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</p>}
    {selectedRun && <details className="mt-3 rounded border border-slate-200 bg-white p-3">
      <summary className="text-xs font-medium">最近一次 {selectedRun.node_id} 运行</summary>
      <p className="mt-2 text-xs text-slate-600">{selectedRun.message}</p>
      {selectedRun.error && <p className="mt-2 text-xs text-rose-700">{selectedRun.error}</p>}
      {selectedRun.artifacts.map((item) => <button key={item.artifact_id} type="button" onClick={() => { void openArtifact(item.artifact_id); }} className="mt-2 block w-full break-all rounded border bg-slate-50 px-2 py-1 text-left text-[11px] text-slate-700">
        {item.kind} · {item.artifact_id}
      </button>)}
    </details>}
    {artifact && <pre className="mt-3 max-h-64 overflow-auto rounded bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">{JSON.stringify(artifact.content, null, 2)}</pre>}
  </section>;
}

function layoutNodes(nodes: ProjectNode[], edges: ProjectEdge[]): ProjectNode[][] {
  const levels = new Map(nodes.map((node) => [node.id, 0]));
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
  return [...grouped.entries()].sort(([left], [right]) => left - right).map(([, items]) => items);
}

function nodeSummary(node: ProjectNode): string {
  const tasks = Array.isArray(node.config.tasks) ? node.config.tasks.length : 0;
  const resources = Array.isArray(node.config.resources) ? node.config.resources.length : 0;
  const capability = typeof node.config.capability === 'string' ? node.config.capability : null;
  return [capability, `${tasks} tasks`, `${resources} resources`].filter(Boolean).join(' · ');
}

function statusClass(status: ProjectNode['status'] | StageRun['status']): string {
  if (status === 'succeeded') return 'bg-emerald-100 text-emerald-700';
  if (status === 'running') return 'bg-blue-100 text-blue-700';
  if (status === 'failed') return 'bg-rose-100 text-rose-700';
  if (status === 'not_implemented') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-600';
}
