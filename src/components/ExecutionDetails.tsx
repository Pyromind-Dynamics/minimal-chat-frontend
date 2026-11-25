import { useState, type ReactNode } from 'react';
import type { RequestOptions } from '../api';
import { getLatestPlan, type ChatEvent } from '../types';
import { ChatEventList } from './ChatPanel';
import { PlanBlock } from './PlanBlock';

export function ExecutionDetails({ label, summary, running = false, children, events, options }: {
  label: string; summary: string; running?: boolean; children?: ReactNode; events: ChatEvent[]; options: RequestOptions;
}) {
  const [open, setOpen] = useState(false);
  if (!events.length && !children) return null;
  const plan = open ? getLatestPlan(events) : undefined;
  return (
    <details onToggle={event => setOpen(event.currentTarget.open)} className="group/activity mb-2 min-w-0">
      <summary className={`flex min-h-7 w-fit max-w-full cursor-pointer list-none items-center gap-2 rounded-sm py-1 pr-2 text-xs hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 [&::-webkit-details-marker]:hidden ${running ? 'font-medium text-slate-700' : 'text-slate-600'}`}>
        <span className="truncate" title={summary}>{summary}</span>
        <span aria-hidden="true" className="size-1.5 shrink-0 -rotate-45 border-r border-b border-current group-open/activity:rotate-45" />
      </summary>
      {open && <div role="region" aria-label={label} tabIndex={0}
        className="ml-0.5 max-h-[min(12rem,30dvh)] min-w-0 overflow-auto overscroll-contain border-l border-slate-200 px-3 py-1 sm:max-w-[80%]">
        {children}
        <ChatEventList events={events} requestOptions={options} compactTools />
        {plan && <PlanBlock plan={plan.plan} />}
      </div>}
    </details>
  );
}
