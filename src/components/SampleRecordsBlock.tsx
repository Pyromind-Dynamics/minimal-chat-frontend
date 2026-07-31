import { useState } from 'react';

interface SampleRecordsBlockProps {
  records: Record<string, unknown>[];
  recordCount: number | null;
}

export function SampleRecordsBlock({ records, recordCount }: SampleRecordsBlockProps) {
  const [showRecords, setShowRecords] = useState(true);

  if (records.length === 0) {
    return null;
  }
  const total = recordCount ?? records.length;

  return (
    <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-emerald-800">本地处理结果</span>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
          共 {total} 条
        </span>
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowRecords((current) => !current)}
          className="text-[11px] font-medium text-emerald-700 hover:text-emerald-900"
        >
          {showRecords ? '▼' : '▶'} 展示 {records.length} 条样本记录
        </button>
        {showRecords && (
          <pre className="mt-1 max-h-72 overflow-auto rounded border border-emerald-200 bg-white p-2 font-mono text-[10px] text-gray-700">
            {records.map((record) => JSON.stringify(record, null, 2)).join('\n')}
          </pre>
        )}
      </div>
    </div>
  );
}
