import type { ResourceStatus } from '../../observationsContract';
import { observationResourceMessage } from '../../observationsPresentation';
export function OrchestratorReadonly({ resource }: { resource?: ResourceStatus }) {
  return <section className="observation-card" aria-label="Orchestrator 状态">
    {resource?.runtime && resource.observation_status !== 'forbidden' && <dl className="observation-facts">
      <dt>运行资源</dt><dd>{resource.runtime}</dd>
    </dl>}
    {(!resource?.runtime || resource.observation_status !== 'available') && <p className="observation-empty" role="status">{observationResourceMessage('orchestrator', resource)}</p>}
  </section>;
}
