import type { PlanStatus, PlanStep } from '../types';

const statusStyle: Record<PlanStatus, string> = {
  pending: 'text-gray-400',
  in_progress: 'text-amber-600',
  completed: 'text-green-600',
};

const statusIcon: Record<PlanStatus, string> = {
  pending: '○',
  in_progress: '●',
  completed: '✓',
};

export function PlanBlock({ plan }: { plan: PlanStep[] }) {
  return (
    <div className="mb-3 rounded-lg border border-gray-200 bg-white p-3">
      <div className="space-y-2">
        {plan.map((item, index) => (
          <div key={`${index}-${item.step}`} className="flex items-start gap-2 text-sm">
            <span className={statusStyle[item.status]}>{statusIcon[item.status]}</span>
            <span className={item.status === 'completed' ? 'text-gray-500 line-through' : 'text-gray-800'}>
              {item.step}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
