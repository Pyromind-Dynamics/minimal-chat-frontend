import { formatMetric } from '../observationsPresentation';
import { MarkdownContent } from './MarkdownContent';

export function RegisteredReportContent({ text, attribution = false }: { text: string; attribution?: boolean }) {
  let document: unknown;
  try { document = JSON.parse(text); } catch {
    return <MarkdownContent imageClassName="max-w-full">{text}</MarkdownContent>;
  }
  const original = document && typeof document === 'object' && !Array.isArray(document) ? document as Record<string, unknown> : {};
  const nested = original.attribution_report;
  const fields = nested && typeof nested === 'object' && !Array.isArray(nested) ? nested as Record<string, unknown> : original;
  const isAttribution = attribution || fields !== original;
  const summary = typeof fields.summary === 'string' ? fields.summary.trim() : '';
  const findings = Array.isArray(fields.findings)
    ? fields.findings.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [];
  const metrics = Array.isArray(fields.metrics) ? fields.metrics.flatMap(item =>
    item && typeof item.label === 'string' && typeof item.value === 'number'
      ? [{ label: item.label, value: formatMetric(item.value, typeof item.unit === 'string' ? item.unit : undefined) }] : []) : [];
  return <div className="grid gap-3 text-sm">
    {summary && <section><h3 className="mb-1 font-medium">摘要</h3>
      <MarkdownContent imageClassName="max-w-full">{summary}</MarkdownContent></section>}
    {findings.length > 0 && <section><h3 className="mb-1 font-medium">{isAttribution ? '归因结论' : '结论'}</h3>
      <ul className="list-disc space-y-1 pl-5">{findings.map((item, index) => <li key={index}>
        <MarkdownContent imageClassName="max-w-full">{item}</MarkdownContent>
      </li>)}</ul></section>}
    {metrics.length > 0 && <table className="observation-data-table" aria-label={isAttribution ? "归因指标" : "报告指标"}>
      <thead><tr><th scope="col">指标</th><th scope="col">数值</th></tr></thead>
      <tbody>{metrics.map(({label, value}, index) => <tr key={index}><th scope="row">{label}</th><td>{value}</td></tr>)}</tbody>
    </table>}
    {!summary && !findings.length && !metrics.length && <p>此版本的详细内容可在报告原文中查看。</p>}
    <details><summary className="cursor-pointer">报告原文（JSON）</summary>
      <pre className="mt-2">{JSON.stringify(document, null, 2)}</pre></details>
  </div>;
}
