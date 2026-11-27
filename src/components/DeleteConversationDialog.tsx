import { useEffect, useId, useRef } from 'react';

export function DeleteConversationDialog({ title, projectNames, pending, error, onClose, onConfirm }: {
  title: string;
  projectNames: string[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const heading = useId();
  const description = useId();

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    cancel.current?.focus();
    return () => element?.close();
  }, []);

  return <dialog ref={dialog} role="alertdialog" aria-labelledby={heading} aria-describedby={description}
    className="echomind-delete-dialog"
    onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}>
    <h2 id={heading}>删除会话</h2>
    <p id={description}>「{title}」及其所有关联 Project 将从工作区移除。历史记录和产物将保留。</p>
    {projectNames.length > 0 && <ul aria-label="将一同移除的 Project">
      {projectNames.map((name, index) => <li key={index}>{name}</li>)}
    </ul>}
    {error && <p className="echomind-delete-error" role="alert">{error}</p>}
    <footer>
      <button type="button" ref={cancel} disabled={pending} onClick={onClose}>取消</button>
      <button type="button" disabled={pending} onClick={onConfirm}>{pending ? '正在删除…' : '确认删除'}</button>
    </footer>
  </dialog>;
}
