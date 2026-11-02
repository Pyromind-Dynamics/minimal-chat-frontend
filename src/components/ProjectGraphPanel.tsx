import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RequestOptions } from '../api';
import type {
  ProjectEdge,
  ProjectGraphView,
  ProjectNode,
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGraph(await client.projectGraph(projectId, requestOptions));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Failed to load the Project Graph.',
      );
    } finally {
      setLoading(false);
    }
  }, [client, projectId, requestOptions]);

  useEffect(() => {
    setGraph(null);
    void refresh();
  }, [graphRevision, refresh]);

  const levels = useMemo(
    () => graph ? layoutNodes(graph.nodes, graph.edges) : [],
    [graph],
  );

  return <section className="mt-6 border-t border-slate-200 pt-5" aria-label="Project Graph">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Working Graph</h2>
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
        {level.map(node => <NodeCard key={node.id} node={node} />)}
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

function NodeCard({ node }: { node: ProjectNode }) {
  return <article className="rounded-md border border-slate-200 bg-white p-3">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="break-words text-sm font-medium">{node.title}</h3>
        <p className="mt-1 break-all font-mono text-[10px] text-slate-500">
          {node.id} · {node.type} · {node.executor}
        </p>
      </div>
      <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
        {node.launch_mode === 'agent' ? 'Agent 配置' : 'Executor 验证'}
      </span>
    </div>
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-slate-600">查看配置</summary>
      <pre className="mt-2 max-h-48 overflow-auto rounded bg-slate-950 p-2 text-[10px] leading-4 text-slate-100">
        {JSON.stringify(node.config, null, 2)}
      </pre>
    </details>
  </article>;
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
