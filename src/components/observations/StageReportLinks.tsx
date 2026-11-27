import type { StageReportLink } from '../../observationsPresentation';

export function StageReportLinks({ links, nodeId }: { links: StageReportLink[]; nodeId: string }) {
  if (!links.length) return null;
  const history = links.filter(link => link.historical);
  function renderLink(link: StageReportLink) {
    const params = new URLSearchParams({ 'echomind-report': link.id, view: 'readable' });
    if (link.attribution) params.set('attribution-node', nodeId);
    return <li key={link.id}><a href={'#' + params.toString()}>{link.title}</a><small>{link.id}</small></li>;
  }
  return <section className="stage-report-links" aria-label="已交付报告">
    <h4>已交付报告</h4>
    <ul>{links.filter(link => !link.historical).map(renderLink)}</ul>
    {history.length > 0 && <details><summary>历史报告（{history.length}）</summary>
      <ul>{history.map(renderLink)}</ul></details>}
  </section>;
}
