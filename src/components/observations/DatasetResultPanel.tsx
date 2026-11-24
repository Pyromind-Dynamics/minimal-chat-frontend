import type { ObservationDatasetFile } from '../../observationsContract';

function DatasetDistribution({ name, counts }: { name: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const table = (items: typeof entries) => <table className="observation-data-table dataset-frequency-table" aria-label={`${name} 样本分布`}>
    <thead><tr><th scope="col">{name}</th><th scope="col">样本数</th></tr></thead>
    <tbody>{items.map(([label, count]) => <tr key={label}><th scope="row">{label}</th><td>{count.toLocaleString()}</td></tr>)}</tbody>
  </table>;
  return <section className="observation-table-frame dataset-distribution observation-summary-table">
    {table(entries.slice(0, 5))}
    {entries.length > 5 && <details><summary>其余 {entries.length - 5} 项</summary><div className="dataset-frequency-more">{table(entries.slice(5))}</div></details>}
  </section>;
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '未提供';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(2)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

export function DatasetResultPanel({ files }: { files: ObservationDatasetFile[] }) {
  return <div className="observation-dataset-files">
    {files.map(file => {
      const distributions = Object.entries(file.distributions).filter(([name, counts]) => {
        const dimension = name.toLowerCase();
        const entries = Object.values(counts);
        return entries.length > 0 && dimension !== 'category' &&
          (['split', 'task'].includes(dimension) || entries.length !== 1 || entries[0] !== file.sample_count);
      });
      return <section key={file.path}>
        <strong>{file.name}</strong>
        <dl className="observation-facts">
          <dt>路径</dt><dd title={file.path}>{file.path}</dd>
          <dt>大小</dt><dd title={file.size_bytes === null ? undefined : `${file.size_bytes} bytes`}>{formatSize(file.size_bytes)}</dd>
          <dt>样本总数</dt><dd>{file.sample_count === null ? '未提供' : `${file.sample_count.toLocaleString()} 条`}</dd>
        </dl>
        {distributions.length > 0 && <div className="dataset-distributions">
          {distributions.map(([name, counts]) => <DatasetDistribution key={name} name={name} counts={counts} />)}
        </div>}
      </section>;
    })}
  </div>;
}
