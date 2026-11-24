import { useEffect, useMemo, useRef, useState } from 'react';
import { ProductApiError, type RequestOptions } from '../api';
import type { ProductClient } from '../productClient';
import type { MetricConfig, MetricPoint, ObservationOverview, ObservationReportDetails, ObservationReportQuery, RunBinding, SeriesPage } from '../observationsContract';
import { mergePoints } from '../observationsPresentation';
import { startObservationPolling } from '../observationsPolling';

function useObservationOptions(options: RequestOptions) {
  return useMemo(() => ({ cookie: options.cookie, xCluster: options.xCluster, userId: options.userId }), [options.cookie, options.xCluster, options.userId]);
}
export function useProjectObservations(client: ProductClient, projectId: string, options: RequestOptions, evidenceVersion = '') {
  const auth = useObservationOptions(options);
  const identity = JSON.stringify([projectId, auth]);
  const [result, setResult] = useState<{ identity: string; overview: ObservationOverview } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  const evidenceRef = useRef(evidenceVersion);
  useEffect(() => {
    setError(null); setResult(current => current?.identity === identity ? current : null);
    const poller = startObservationPolling({
      isVisible: () => document.visibilityState !== 'hidden',
      read: async signal => {
        const overview = await client.observations(projectId, auth, signal);
        if (overview.project_id !== projectId) throw new Error('项目状态归属不一致');
        return overview;
      },
      onData: overview => {
        setResult({ identity, overview });
        setError(null);
      },
      onError: value => setError(value.message),
    });
    refreshRef.current = poller.invalidate;
    document.addEventListener('visibilitychange', poller.visibilityChanged);
    return () => { poller.stop(); document.removeEventListener('visibilitychange', poller.visibilityChanged); };
  }, [client, projectId, auth, identity]);
  useEffect(() => {
    if (evidenceRef.current !== evidenceVersion) {
      evidenceRef.current = evidenceVersion;
      refreshRef.current();
    }
  }, [evidenceVersion]);
  return {
    overview: result?.identity === identity ? result.overview : null,
    error,
    refresh: () => refreshRef.current(),
  };
}

export function useObservationReport(client: ProductClient, projectId: string, query: ObservationReportQuery, reportIds: string[], options: RequestOptions) {
  const { project_node_id, analysis_job_id, report_version_id } = query;
  const auth = useObservationOptions(options);
  const identity = reportIds.length || analysis_job_id || report_version_id
    ? JSON.stringify([projectId, project_node_id, analysis_job_id, report_version_id, reportIds, auth]) : null;
  const [result, setResult] = useState<{ identity: string; report?: ObservationReportDetails; unavailable?: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!identity) return;
    const requestIdentity = identity;
    const controller = new AbortController();
    const { signal } = controller;
    let retries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function read() {
      void client.observationReport(projectId, { project_node_id, analysis_job_id, report_version_id }, auth, signal).then(report => {
        if (signal.aborted) return;
        if (report.project_id !== projectId || report.project_node_id !== project_node_id ||
          (report_version_id && (report.report_version_ids.length !== 1 || report.report_version_ids[0] !== report_version_id))) {
          setResult({ identity: requestIdentity, unavailable: true });
          return;
        }
        setResult({ identity: requestIdentity, report });
      }).catch((error: unknown) => {
        if (signal.aborted) return;
        const temporary = !(error instanceof ProductApiError) ||
          error.status >= 500 || [408, 409, 429].includes(error.status);
        if (temporary && retries < 2) {
          timer = setTimeout(read, 1000 * 2 ** retries++);
        } else {
          setResult({ identity: requestIdentity, unavailable: true });
        }
      });
    }
    read();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [analysis_job_id, auth, client, identity, project_node_id, projectId, report_version_id, attempt]);
  function retry() {
    setResult(null);
    setAttempt(value => value + 1);
  }
  return { loading: identity !== null && result?.identity !== identity, retry, ...(result?.identity === identity ? result : null) };
}

type TrainingResult = { identity: string; page: SeriesPage; points: MetricPoint[]; lastSuccess: string | null; error: string | null };
const trainingCacheVersion = 3;
const trainingResults = new WeakMap<ProductClient, Map<string, { expires: number; result: TrainingResult }>>();
function trainingCache(client: ProductClient) {
  let cache = trainingResults.get(client);
  if (!cache) { cache = new Map(); trainingResults.set(client, cache); }
  return cache;
}
export function useTrainingObservations(client: ProductClient, projectId: string, nodeId: string, metrics: MetricConfig[], runId: string, configVersion: string, options: RequestOptions, binding?: RunBinding) {
  const auth = useObservationOptions(options);
  const identity = JSON.stringify([trainingCacheVersion, projectId, nodeId, runId, configVersion, auth, binding?.task_id, binding?.platform_node_id, metrics]);
  const cache = trainingCache(client);
  const cachedResult = () => { const cached = cache.get(identity); return cached && cached.expires > Date.now() ? cached.result : null; };
  const [result, setResult] = useState<TrainingResult | null>(cachedResult);
  const invalidateRef = useRef<() => void>(() => {});
  const running = binding?.business_status === 'running';
  const runningRef = useRef(running);
  useEffect(() => {
    const cached = cache.get(identity);
    const retained = cached && cached.expires > Date.now() ? cached.result : null;
    setResult(retained);
    if (!runId || metrics.length === 0) return;
    let cursor = retained?.page.observation_status === 'available' ? retained.page.next_cursor ?? undefined : undefined;
    const readSeries = (signal: AbortSignal) => client.trainingSeries(
      projectId, { project_node_id: nodeId, run_id: runId, cursor }, auth, signal,
    );
    const poller = startObservationPolling({
      isVisible: () => document.visibilityState !== 'hidden',
      isTrainingRunning: () => runningRef.current,
      read: async signal => {
        const page = await readSeries(signal).catch((error: unknown) => {
          if (!cursor || !(error instanceof ProductApiError) || error.status !== 422) throw error;
          signal.throwIfAborted();
          cursor = undefined;
          return readSeries(signal);
        });
        if (page.project_id !== projectId || page.project_node_id !== nodeId || page.run_id !== runId || page.config_version !== configVersion) throw new Error('训练指标归属不一致');
        return page;
      },
      onData: page => {
        if (page.observation_status === 'available') cursor = page.next_cursor ?? undefined;
        setResult(previous => {
          const prior = previous?.identity === identity ? previous : null;
          const changedSource = page.points.length > 0 && prior?.points.length && page.points[0].source_run_id !== prior.points[0].source_run_id;
          const next = { identity, page, points: mergePoints(changedSource ? [] : prior?.points ?? [], page.points), lastSuccess: page.observation_status === 'available' ? page.observed_at : prior?.lastSuccess ?? null, error: null };
          if (page.observation_status === 'available') {
            if (cache.size >= 16 && !cache.has(identity)) cache.delete(cache.keys().next().value!);
            cache.set(identity, { expires: Date.now() + 300_000, result: next });
          }
          return next;
        });
      },
      onError: value => {
        setResult(previous => previous ? { ...previous, error: value.message } : { identity, page: { project_id: projectId, project_node_id: nodeId, run_id: runId, config_version: configVersion, points: [], next_cursor: null, truncated: false, gap: false, observation_status: 'unavailable', analysis_status: 'not_requested', observed_at: new Date().toISOString(), message: null }, points: [], lastSuccess: null, error: value.message });
      },
    });
    invalidateRef.current = poller.invalidate;
    document.addEventListener('visibilitychange', poller.visibilityChanged);
    return () => {
      invalidateRef.current = () => {};
      poller.stop();
      document.removeEventListener('visibilitychange', poller.visibilityChanged);
    };
  }, [client, projectId, nodeId, runId, configVersion, auth, identity, metrics.length, cache]);
  useEffect(() => {
    if (runningRef.current === running) return;
    runningRef.current = running;
    invalidateRef.current();
  }, [running]);
  return result?.identity === identity ? result : null;
}
