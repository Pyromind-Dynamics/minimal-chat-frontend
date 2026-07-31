import { useEffect, useRef, useState } from 'react';
import {
  getDataPreparationProgress,
  type DataPreparationProgress,
  type RequestOptions,
} from '../api';

const POLL_INTERVAL_MS = 10000;

interface ProgressBlockProps {
  outputDir: string;
  requestOptions: RequestOptions;
}

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0) {
    return '--';
  }
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60}m`;
}

function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) {
    return '--';
  }
  return `${rate.toFixed(2)} rec/s`;
}

export function ProgressBlock({ outputDir, requestOptions }: ProgressBlockProps) {
  const [data, setData] = useState<DataPreparationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(true);
  const [showRecords, setShowRecords] = useState(false);
  const optionsRef = useRef(requestOptions);
  optionsRef.current = requestOptions;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchProgress = async () => {
      try {
        const result = await getDataPreparationProgress(
          outputDir,
          optionsRef.current,
        );
        if (cancelled) {
          return;
        }
        setData(result);
        setError(null);
        if (result.percent !== null && result.percent >= 100 && timer) {
          clearInterval(timer);
          setIsPolling(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load progress');
        }
      }
    };

    void fetchProgress();
    timer = setInterval(() => void fetchProgress(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [outputDir]);

  const percent = data?.percent ?? 0;
  const isComplete = (data?.percent ?? 0) >= 100;
  const records = data?.latest_records ?? [];

  return (
    <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-blue-800">数据处理进度</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              isComplete
                ? 'bg-green-100 text-green-700'
                : 'bg-blue-100 text-blue-700'
            }`}
          >
            {isComplete ? '已完成' : isPolling ? '运行中' : '已停止'}
          </span>
        </div>
        <span className="font-mono text-xs font-semibold text-blue-900">
          {percent.toFixed(1)}%
        </span>
      </div>

      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-blue-100">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isComplete ? 'bg-green-500' : 'bg-blue-500'
          }`}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>

      {error && (
        <p className="mt-2 text-[11px] text-red-600">{error}</p>
      )}

      {!data?.progress_found && !error && (
        <p className="mt-2 text-[11px] text-gray-500">
          等待任务启动（progress.json 尚未生成）…
        </p>
      )}

      {data?.progress_found && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] sm:grid-cols-6">
          <Stat label="已处理" value={`${data.processed ?? 0}/${data.total ?? 0}`} />
          <Stat label="成功" value={String(data.succeeded ?? 0)} />
          <Stat label="失败" value={String(data.failed ?? 0)} />
          <Stat label="速率" value={formatRate(data.records_per_second)} />
          <Stat label="已用时" value={formatDuration(data.elapsed_ms)} />
          <Stat label="预计剩余" value={formatDuration(data.eta_ms)} />
        </div>
      )}

      {records.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowRecords((current) => !current)}
            className="text-[11px] font-medium text-blue-700 hover:text-blue-900"
          >
            {showRecords ? '▼' : '▶'} 最新 {records.length} 条处理结果
          </button>
          {showRecords && (
            <pre className="mt-1 max-h-48 overflow-auto rounded border border-blue-200 bg-white p-2 font-mono text-[10px] text-gray-700">
              {records
                .map((record) => JSON.stringify(record, null, 2))
                .join('\n')}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-white/70 px-2 py-1">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className="font-mono font-semibold text-gray-800">{value}</div>
    </div>
  );
}
