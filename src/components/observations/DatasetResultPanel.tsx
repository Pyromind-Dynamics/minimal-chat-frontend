import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationSnapshot } from '../../types';
import type { DatasetFiles } from '../../observationsContract';
import type { RequestOptions } from '../../api';
import type { ProductClient } from '../../productClient';
import { startObservationPolling } from '../../observationsPolling';
import { DatasetDistribution } from './DatasetDistribution';
import { observationEvidenceVersion, observationStageMessage } from '../../observationsPresentation';
import { visibleDatasetDistributions } from '../../datasetPresentation';

const resultsByClient = new WeakMap<ProductClient, Map<string, { expires: number; data: DatasetFiles }>>();

export function DatasetResultPanel({ snapshot, projectId, nodeId, status, client, options }: { snapshot?: ConversationSnapshot | null; projectId: string; nodeId: string; status?: string; client: ProductClient; options: RequestOptions }) {
  const recentResults = useMemo(() => {
    let cache = resultsByClient.get(client);
    if (!cache) { cache = new Map(); resultsByClient.set(client, cache); }
    return cache;
  }, [client]);
  const auth = useMemo(() => ({ cookie: options.cookie, xCluster: options.xCluster, userId: options.userId }), [options.cookie, options.xCluster, options.userId]);
  const version = observationEvidenceVersion(snapshot, projectId, nodeId);
  const identity = JSON.stringify([projectId, nodeId, auth]);
  const cacheKey = JSON.stringify([identity, version]);
  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;
  const [result, setResult] = useState<{ identity: string; data?: DatasetFiles; error?: string } | null>(() => {
    const cached = recentResults.get(cacheKey);
    return cached && cached.expires > Date.now() ? { identity, data: cached.data } : null;
  });
  const invalidateRef = useRef<() => void>(() => {});
  const versionRef = useRef(version);
  useEffect(() => {
    const poller = startObservationPolling({
      isVisible: () => document.visibilityState !== 'hidden',
      read: async signal => {
        const requestedKey = cacheKeyRef.current;
        const data = await client.datasetFiles(projectId, nodeId, auth, signal);
        if (data.project_id !== projectId || data.project_node_id !== nodeId) throw new Error('数据集归属不一致');
        return { data, requestedKey };
      },
      onData: ({ data, requestedKey }) => {
        const oldest = recentResults.keys().next().value;
        if (recentResults.size >= 16 && oldest !== undefined) recentResults.delete(oldest);
        recentResults.set(requestedKey, { expires: Date.now() + 300_000, data });
        setResult({ identity, data });
      },
      onError: error => setResult(previous => ({ ...(previous?.identity === identity ? previous : null), identity, error: error.message })),
    });
    invalidateRef.current = poller.invalidate;
    document.addEventListener('visibilitychange', poller.visibilityChanged);
    return () => { poller.stop(); document.removeEventListener('visibilitychange', poller.visibilityChanged); };
  }, [client, projectId, nodeId, auth, identity, recentResults]);
  useEffect(() => {
    if (versionRef.current !== version) {
      versionRef.current = version;
      invalidateRef.current();
    }
  }, [version]);
  const current = result?.identity === identity ? result : null;
  if (current?.error && !current.data?.files.length) return <p className="observation-error" role="alert">数据集信息暂不可用</p>;
  if (!current && status === 'completed') return <p className="rsi-detail-help" role="status">正在读取数据集信息</p>;
  if (!current?.data?.files.length) return <p className="rsi-detail-help" role="status">{observationStageMessage('dataset', status)}</p>;
  const size = (bytes: number | null) => bytes == null ? '未提供' : bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(2)} KiB` : bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(2)} MiB` : `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  return <div className="observation-dataset-files">
    {current.error && <p className="observation-error">数据暂不可用，保留上次查询结果</p>}
    {current.data.statistics_truncated && <p className="observation-muted">部分样本分布暂未展示</p>}
    {current.data.files.map(file => {
      const path = file.path.startsWith('/workspace/') ? file.path : null;
      return <section key={file.name}>
        <strong>{file.name}</strong>
        <dl className="observation-facts">
          <dt>路径</dt>
          <dd className="observation-dataset-path" title={path ?? undefined}>{path ?? '未登记完整路径'}</dd>
          <dt>大小</dt>
          <dd title={file.size_bytes == null ? undefined : `${file.size_bytes} bytes`}>{size(file.size_bytes)}</dd>
          <dt>样本总数</dt>
          <dd>{file.sample_count == null ? (file.statistics_status === 'pending' ? '等待样本统计' : '未提供') : `${file.sample_count.toLocaleString()} 条`}</dd>
        </dl>
        <div className="dataset-distributions">
          {visibleDatasetDistributions(file.distributions ?? {}, file.sample_count).map(([dimension, counts]) => <DatasetDistribution key={dimension} name={dimension} counts={counts} />)}
        </div>
      </section>;
    })}
  </div>;
}
