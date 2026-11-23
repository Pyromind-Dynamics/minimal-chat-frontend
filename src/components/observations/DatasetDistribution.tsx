export function DatasetDistribution({ name, counts }: { name: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts).filter(([, count]) => Number.isFinite(count) && count >= 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!entries.length) return null;
  const table = (items: typeof entries) => <table className="dataset-frequency-table" aria-label={`${name} 样本分布`}>
    <thead><tr><th scope="col">{name}</th><th scope="col">样本数</th></tr></thead>
    <tbody>{items.map(([label, count]) => <tr key={label}><th scope="row">{label}</th><td>{count.toLocaleString()}</td></tr>)}</tbody>
  </table>;
  return <section className="dataset-distribution observation-summary-table">
    {table(entries.slice(0, 5))}
    {entries.length > 5 && <details><summary>其余 {entries.length - 5} 项</summary><div className="dataset-frequency-more">{table(entries.slice(5))}</div></details>}
  </section>;
}
