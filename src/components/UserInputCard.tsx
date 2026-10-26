import { useRef, useState } from 'react';
import type { PendingUserInput, RespondToUserInput } from '../types';
import { buildUserInputAnswers, recommendedUserInputDrafts, type AnswerDraft } from '../userInput';

export function UserInputCard({ request, onRespond }: {
  request: PendingUserInput;
  onRespond: RespondToUserInput;
}) {
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({});
  const [submitting, setSubmitting] = useState<'answered' | 'cancelled' | null>(null);
  const [error, setError] = useState('');
  const textDrafts = useRef<Record<string, string>>({});
  const lastCommand = useRef({ payload: '', id: '' });
  const busy = submitting !== null;
  const recommendedDrafts = recommendedUserInputDrafts(request);
  const recommendedCount = Object.keys(recommendedDrafts).length;
  const answers = buildUserInputAnswers(request, drafts);
  const completed = new Set(request.questions.filter((question) =>
    buildUserInputAnswers({ ...request, questions: [question] }, drafts) !== null,
  ).map((question) => question.id));

  async function submit(status: 'answered' | 'cancelled') {
    if (busy || (status === 'answered' && !answers)) return;
    const submittedAnswers = status === 'answered' ? answers! : [];
    const payload = JSON.stringify({ status, answers: submittedAnswers });
    if (lastCommand.current.payload !== payload) {
      lastCommand.current = { payload, id: crypto.randomUUID() };
    }
    setSubmitting(status);
    setError('');
    try {
      await onRespond(request.request_id, status, submittedAnswers, lastCommand.current.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败，请重试');
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <form aria-label="回答 Agent 的问题" aria-busy={busy}
      className="relative my-5 min-w-0 rounded-2xl border border-slate-200 bg-white text-left text-sm text-slate-800 shadow-sm"
      onSubmit={(event) => { event.preventDefault(); void submit('answered'); }}>
      <div className="flex items-start gap-3 rounded-t-2xl border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-6">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
            <path d="M10 9a2 2 0 0 1 4 .5c0 1.5-2 1.5-2 3M12 15h.01" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold tracking-tight text-slate-900">需要你确认</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">回答后，Agent 会继续当前任务。等待不会自动超时。</p>
        </div>
        <span role="status" aria-live="polite" className="shrink-0 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs tabular-nums text-slate-500">
          已回答 {completed.size}/{request.questions.length}
        </span>
      </div>
      {recommendedCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3 sm:px-6">
          <button type="button" disabled={busy}
            onClick={() => {
              setDrafts((current) => ({ ...current, ...recommendedDrafts }));
              setError('');
            }}
            className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-50">
            一键选择推荐项
          </button>
          <span className="text-xs leading-5 text-slate-500">替换 {recommendedCount} 题的选择，其他回答保留；选后仍可修改。</span>
        </div>
      )}
      <fieldset disabled={busy} className="min-w-0 space-y-6 px-5 py-5 sm:px-6">
        {request.questions.map((question, index) => {
          const draft = drafts[question.id];
          const freeText = question.options.length === 0 || draft?.kind === 'text';
          const update = (value: AnswerDraft) => {
            if (value.kind === 'text') textDrafts.current[question.id] = value.value;
            setDrafts((current) => ({ ...current, [question.id]: value }));
            setError('');
          };
          const name = `${request.request_id}:${question.id}`;
          return (
            <fieldset key={question.id} className="min-w-0 space-y-2.5">
              <legend className="mb-3 w-full">
                <span className="flex items-start gap-2.5">
                  <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${completed.has(question.id) ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                    {completed.has(question.id) ? '✓' : index + 1}
                  </span>
                  <span className="min-w-0 flex-1 break-words font-medium leading-6 text-slate-900"><span className="sr-only">问题 {index + 1}：</span>{question.prompt}</span>
                  <span className="shrink-0 pt-1 text-[11px] text-slate-400">{question.options.length ? '单选或自填' : '文字回答'}</span>
                </span>
              </legend>
              {question.options.map((option) => {
                const selected = draft?.kind === 'option' && draft.value === option.id;
                return (
                  <label key={option.id} className={choiceClass(selected)}>
                    <input type="radio" name={name} checked={selected}
                      onChange={() => update({ kind: 'option', value: option.id })}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600" />
                    <span className="min-w-0 break-words leading-5">
                      <span className="font-medium">{option.label}</span>
                      {option.description && <span className="mt-1 block text-xs leading-5 text-slate-500">{option.description}</span>}
                    </span>
                  </label>
                );
              })}
              {question.options.length > 0 && (
                <label className={choiceClass(draft?.kind === 'text')}>
                  <input type="radio" name={name} checked={draft?.kind === 'text'}
                    onChange={() => update({ kind: 'text', value: textDrafts.current[question.id] ?? '' })}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600" />
                  <span className="leading-5"><span className="font-medium">自填答案</span><span className="ml-2 text-xs text-slate-400">按你的实际情况填写</span></span>
                </label>
              )}
              {freeText && <textarea aria-label={`问题 ${index + 1} 的自填答案`} rows={3}
                placeholder="在这里填写你的回答…"
                value={draft?.kind === 'text' ? draft.value : ''}
                onChange={(event) => update({ kind: 'text', value: event.target.value })}
                className="block w-full resize-y rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-3 leading-6 text-slate-800 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-3 focus:ring-indigo-100 disabled:opacity-60" />}
            </fieldset>
          );
        })}
      </fieldset>
      <div className="sticky bottom-0 z-10 rounded-b-2xl border-t border-slate-100 bg-white/95 px-5 py-4 backdrop-blur-sm sm:px-6">
        {error && <p role="alert" className="mb-3 break-words rounded-xl border border-red-100 bg-red-50 px-3.5 py-3 text-xs leading-5 text-red-700">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" disabled={busy} onClick={() => void submit('cancelled')}
            className="rounded-lg px-3 py-2.5 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-50">
            {submitting === 'cancelled' ? '正在暂停…' : '取消并暂停'}
          </button>
          <div className="ml-auto flex items-center gap-3">
            <span className={`text-xs ${answers ? 'text-indigo-600' : 'text-slate-500'}`}>
              {answers ? '已答完，可以继续' : `还差 ${request.questions.length - completed.size} 题`}
            </span>
            <button type="submit" disabled={busy || !answers}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none">
              {submitting === 'answered' ? '提交中…' : '提交全部答案'}<span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">取消会停止本轮 Agent，已提交的后台任务仍会保留。</p>
      </div>
    </form>
  );
}

function choiceClass(selected: boolean) {
  return `flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition focus-within:ring-2 focus-within:ring-indigo-200 ${selected
    ? 'border-indigo-400 bg-indigo-50/60 ring-1 ring-indigo-100'
    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`;
}
