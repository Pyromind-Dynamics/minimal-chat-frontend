import { useState, type ReactNode } from 'react';
import type { RequestOptions } from '../api';
import { getLatestPlan, type ChatEvent } from '../types';
import { ChatEventList } from './ChatPanel';
import { PlanBlock } from './PlanBlock';

export function ExecutionDetails({ label, summary, children, events, options }: {
  label?: string; summary?: ReactNode; children?: ReactNode; events: ChatEvent[]; options: RequestOptions;
}) {
  const [open, setOpen] = useState(false);
  if (!events.length && !children) return null;
  const steps = summary ? 0 : events.filter(event => event.kind === 'ActionEvent').length;
  const plan = open ? getLatestPlan(events) : undefined;
  return (
    <details onToggle={event => setOpen(event.currentTarget.open)} className="group mb-3 rounded-md border border-slate-200 bg-slate-50">
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-xs text-slate-700 hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-violet-600 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 -rotate-45 border-r border-b border-current group-open:rotate-45" />
        {summary ?? <span className="font-medium">{label}</span>}
        {steps > 0 && <span className="text-slate-500">{steps} 个步骤</span>}
      </summary>
      {open && <div className="max-h-72 overflow-auto border-t border-slate-200 p-3">
        {children}
        <ChatEventList events={events} requestOptions={options} />
        {plan && <PlanBlock plan={plan.plan} />}
      </div>}
    </details>
  );
}
