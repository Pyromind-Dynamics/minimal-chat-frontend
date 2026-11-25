import './ExecutionDetails.css';
import { useId, useState, type ReactNode } from 'react';
import type { RequestOptions } from '../api';
import { getLatestPlan, type ChatEvent } from '../types';
import { ChatEventList } from './ChatPanel';
import { PlanBlock } from './PlanBlock';

export function ExecutionDetails({ label, summary, running = false, children, events, options }: {
  label: string; summary: string; running?: boolean; children?: ReactNode; events: ChatEvent[]; options: RequestOptions;
}) {
  const [open, setOpen] = useState(false);
  const arcGradientId = useId();
  if (!events.length && !children) return null;
  const plan = open ? getLatestPlan(events) : undefined;
  return (
    <details onToggle={event => setOpen(event.currentTarget.open)} className="group/activity mb-2 min-w-0">
      <summary className={`flex min-h-7 w-fit max-w-full cursor-pointer list-none items-center gap-2.5 rounded-md py-1 pr-2 text-xs leading-5 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 [&::-webkit-details-marker]:hidden ${running ? 'font-medium text-slate-700' : 'text-slate-600'}`}>
        {running && <span role="img" aria-label="执行中" data-tool-running-indicator className="execution-activity-status">
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round">
            <defs>
              <linearGradient id={arcGradientId} gradientUnits="userSpaceOnUse" x1="18.5" y1="10" x2="5.9" y2="17.45">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
                <stop offset="55%" stopColor="currentColor" stopOpacity="0.5" />
                <stop offset="100%" stopColor="currentColor" />
              </linearGradient>
            </defs>
            <circle cx="10" cy="10" r="8.5" className="text-violet-200" />
            <circle cx="10" cy="10" r="8.5" pathLength="100" stroke={`url(#${arcGradientId})`}
              strokeWidth="2" strokeDasharray="33 67"
              className="execution-activity-arc" />
            <path d="m6.5 7.5 2.5 2.5-2.5 2.5m4 0h3" />
          </svg>
        </span>}
        <span className="line-clamp-2 min-w-0 [overflow-wrap:anywhere]" title={summary}>{summary}</span>
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round"
          className="size-3 shrink-0 text-slate-500 transition-transform group-open/activity:rotate-90 motion-reduce:transition-none">
          <path d="m6 4 4 4-4 4" />
        </svg>
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
