import type { PendingUserInput, UserInputAnswer } from './types.ts';

export type AnswerDraft = { kind: 'option' | 'text'; value: string };

export function recommendedUserInputDrafts(
  request: PendingUserInput,
): Record<string, AnswerDraft> {
  const drafts: Record<string, AnswerDraft> = {};
  for (const question of request.questions) {
    const recommended = question.options.filter((option) =>
      /(?:^|[（(【[\s:：—-])(?:推荐|recommended)(?=$|[）)】\]\s:：·—-])/iu.test(option.label),
    );
    if (recommended.length === 1) {
      drafts[question.id] = { kind: 'option', value: recommended[0].id };
    }
  }
  return drafts;
}

export function buildUserInputAnswers(
  request: PendingUserInput,
  drafts: Record<string, AnswerDraft>,
): UserInputAnswer[] | null {
  const answers: UserInputAnswer[] = [];
  for (const question of request.questions) {
    const draft = drafts[question.id];
    if (!draft) return null;
    if (draft.kind === 'option') {
      if (!question.options.some((option) => option.id === draft.value)) return null;
      answers.push({ question_id: question.id, option_id: draft.value });
    } else {
      const text = draft.value.trim();
      if (!text) return null;
      answers.push({ question_id: question.id, text });
    }
  }
  return answers;
}
