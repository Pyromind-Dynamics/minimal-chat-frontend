import type { ResourceStatus } from '../../observationsContract';
import { observationResourceMessage } from '../../observationsPresentation';
export function ResourceStatusPanel({ kind, resource }: { kind: 'tracer' | 'inference'; resource?: ResourceStatus }) {
  return <div className="observation-resources"><section className="observation-card">
    <p className="observation-muted" role="status">{observationResourceMessage(kind, resource)}</p>
  </section></div>;
}
