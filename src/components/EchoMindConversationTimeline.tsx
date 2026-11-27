import { Fragment, useMemo } from 'react';
import type { RequestOptions } from '../api';
import { groupEchoMindTurns, type EchoMindTurn } from '../echomindConversationPresentation';
import { summarizeToolActivity } from '../toolActivityPresentation';
import type { ChatEvent, ConversationSnapshot } from '../types';
import { ChatEventList } from './ChatPanel';
import { ExecutionDetails } from './ExecutionDetails';

export function EchoMindConversationTimeline({
  events, executionEvents, snapshot, options, onOpenConfirmation, activeRunId, projectChat, readOnly,
}: {
  events: ChatEvent[];
  snapshot: ConversationSnapshot | null;
  options: RequestOptions;
  onOpenConfirmation?: () => void;
  activeRunId?: string | null;
  readOnly?: boolean;
} & ({ projectChat: true; executionEvents?: never } | { projectChat?: false; executionEvents: ChatEvent[] })) {
  const { entries, turns, background } = useMemo(() => groupEchoMindTurns(events, executionEvents ?? [], snapshot, projectChat),
    [events, executionEvents, snapshot, projectChat]);
  const backgroundActivity = summarizeToolActivity(background);
  const activeTurn = activeRunId && (turns.find(turn => turn.id === activeRunId) ?? turns.findLast(turn =>
    turn.messages.some(event => event.kind === 'MessageEvent' && event.run_id === activeRunId)));
  const executionReadOnly = readOnly || snapshot?.capabilities.read_only === true;
  const unboundRunActive = snapshot?.status === 'running' && !activeRunId;
  const activeBackground = Boolean(activeRunId && background.some(event => event.kind === 'ActionEvent' && event.run_id === activeRunId));
  return <>
    {entries.map(entry => {
      if (entry.kind === 'notice' || !entry.turn || entry.messages[0] !== entry.turn.messages[0]) {
        return <ChatEventList key={entry.kind === 'notice' ? entry.message.id : entry.id}
          events={entry.messages} requestOptions={options} />;
      }
      return <Fragment key={entry.id}>
        <ChatEventList events={entry.messages.slice(0, 1)} requestOptions={options} />
        <TurnExecution turn={entry.turn} options={options} onOpenConfirmation={onOpenConfirmation}
          readOnly={executionReadOnly} unboundRunActive={unboundRunActive}
          active={entry.turn === activeTurn} />
        <ChatEventList events={entry.messages.slice(1)} requestOptions={options} />
      </Fragment>;
    })}
    {background.length > 0 && <ExecutionDetails label="会话执行记录"
      summary={backgroundActivity ? `会话执行记录 · ${backgroundActivity.text}` : '会话执行记录'}
      running={!executionReadOnly && (activeBackground
        ? !!backgroundActivity && backgroundActivity.status !== 'waiting'
        : unboundRunActive && backgroundActivity?.status === 'running')}
      events={background} options={options} />}
  </>;
}

function TurnExecution({ turn, options, onOpenConfirmation, active, readOnly, unboundRunActive }: {
  turn: EchoMindTurn;
  options: RequestOptions;
  onOpenConfirmation?: () => void;
  active: boolean;
  readOnly: boolean;
  unboundRunActive: boolean;
}) {
  const { execution: events, progress, needsConfirmation } = turn;
  if (!progress.length && !events.length && !needsConfirmation) return null;
  const activity = summarizeToolActivity(events);
  const attention = progress.filter(item => item.needsAttention);
  const primary = progress.find(item => !item.needsAttention && !item.settled)
    ?? progress.findLast(item => !item.needsAttention);
  const taskDetails = progress.filter(item => item !== primary || item.stage || item.attempts?.length);
  const explanations = progress.filter(item => item.reason || (item !== primary && item.reportReady));
  const hasDetails = taskDetails.length > 0 || explanations.length > 0;
  const progressText = primary && `${primary.stage ?? primary.title} · ${primary.status}`;
  const pendingProgress = primary?.settled ? undefined : progressText;
  const summary = activity && (active || activity.status !== 'finished') ? activity.text : pendingProgress ?? activity?.text ?? progressText ?? '执行详情';
  const running = !readOnly && (active
    ? !!activity && activity.status !== 'waiting'
    : unboundRunActive && activity?.status === 'running');
  return <section aria-label="本轮执行" className="min-w-0">
    {primary && !events.length && !hasDetails && <p className="mb-2 break-words text-xs text-slate-600">{progressText}</p>}
    <ExecutionDetails label="执行详情" summary={summary} running={running} events={events} options={options}>
      {hasDetails && <>
        {taskDetails.length > 0 && <ul className="mb-2 space-y-1 text-xs text-slate-700">
          {taskDetails.map(item => <li key={item.id} className="break-words">
            <span className="font-medium">{item.stage && `${item.stage} · `}{item.title}</span>
            <span className="ml-2 text-slate-600">{item.status}</span>
            {item.attempts && <ol aria-label="重试记录" className="mt-1 space-y-1 pl-3 text-slate-600">
              {item.attempts.map((attempt, index) => <li key={attempt.id}>
                第 {index + 1} 次 · {attempt.status}{attempt.reason && ` · ${attempt.reason}`}
              </li>)}
            </ol>}
          </li>)}
        </ul>}
        {explanations.map(item => {
          if (item.reason) return <p key={item.id} className="mb-2 break-words text-xs text-amber-800">
            {item !== primary && <span className="font-medium">{item.title} · {item.status} · </span>}{item.reason}
          </p>;
          return <p key={item.id} className={`mb-2 break-words text-xs ${item.needsAttention ? 'text-amber-800' : 'text-slate-700'}`}>
            {item.title} · {item.status}
          </p>;
        })}
      </>}
    </ExecutionDetails>
    {attention.map(item => <p key={item.id} className="mb-2 break-words text-xs font-medium text-amber-800">
      {item.stage ?? item.title} · {item.status}
    </p>)}
    {needsConfirmation && onOpenConfirmation && <button type="button" onClick={onOpenConfirmation}
      className="mb-2 text-xs font-medium text-violet-700 underline">查看待确认事项</button>}
  </section>;
}
