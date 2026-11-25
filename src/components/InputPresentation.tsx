import { reviewDocument } from '../reviewDocument';
import { useEffect, useRef, useState } from 'react';
import type { ReadInputHtml, ReadInputMedia, UserInputPresentation } from '../types';
import { ContentList } from './ContentList';

/** The same content renderer as Chat; no task or checkpoint document parsing. */
export function InputPresentation({presentation, requestId, readMedia, readHtml}: {
  presentation: UserInputPresentation; requestId: string; readHtml?: ReadInputHtml; readMedia?: ReadInputMedia;
}) {
  return <div aria-label="确认内容" className="space-y-3 border-b border-slate-100 p-4">
    {presentation.html_artifact && readHtml && <HtmlView key={requestId + presentation.html_artifact.sha256}
      requestId={requestId} readHtml={readHtml} />}
    {presentation.content.map((item, contentIndex) => item.type === 'text'
      ? <ContentList key={contentIndex} content={[item]} markdown />
      : <div key={contentIndex} className="flex flex-wrap gap-2">{(item.type === 'image' ? item.image_urls : [item.url]).map((source, imageIndex) =>
        <PresentationImage key={`${imageIndex}:${source}`} source={source} requestId={requestId} contentIndex={contentIndex} imageIndex={imageIndex} readMedia={readMedia} />,
      )}</div>)}
  </div>;
}

function PresentationImage({source, requestId, contentIndex, imageIndex, readMedia}: {
  source: string; requestId: string; contentIndex: number; imageIndex: number; readMedia?: ReadInputMedia;
}) {
  const storage = source.startsWith('/') && !source.startsWith('//');
  const [resolved, setResolved] = useState('');
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!storage || !readMedia) return;
    let current = true;
    setError(false);
    void readMedia(requestId, contentIndex, imageIndex).then(result => { if (current) setResolved(result.url); }).catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [source, storage, requestId, contentIndex, imageIndex, readMedia, attempt]);
  const url = storage ? resolved : source;
  return <div className="min-w-0 max-w-full">
    {url ? <button type="button" aria-label="放大图片" className="block rounded-lg border bg-slate-50 p-1" onClick={() => setExpanded(true)}><ContentList content={[{type:'image_url', image_url:{url}}]} /></button>
      : error ? <button type="button" className="text-xs text-violet-700" onClick={() => setAttempt(value => value + 1)}>图片加载失败，点击重试</button>
        : <p className="break-all text-xs text-slate-500">{readMedia ? '正在加载图片…' : source}</p>}
    {expanded && <ImageDialog url={url} onClose={() => setExpanded(false)} />}
  </div>;
}

function ImageDialog({url, onClose}: {url: string; onClose: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} aria-label="图片预览" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }} className="fixed inset-0 m-auto max-h-[90vh] max-w-[95vw] overflow-auto rounded-xl bg-white p-4 backdrop:bg-black/60">
    <button type="button" onClick={onClose} className="mb-3 ml-auto block rounded border px-3 py-1 text-sm">关闭图片</button>
    <ContentList content={[{type:'image_url',image_url:{url}}]} imageClassName="max-h-[75vh] max-w-full object-contain" />
  </dialog>;
}

function HtmlView({requestId, readHtml}: {requestId: string; readHtml: ReadInputHtml}) {
  const [document, setDocument] = useState('');
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setDocument('');
    setError(false);
    readHtml(requestId).then(({html}) => {
      if (active) setDocument(reviewDocument(html));
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [requestId, readHtml, attempt]);
  if (error) return <button type="button" onClick={() => setAttempt(value => value + 1)}>对照图加载失败，重试</button>;
  return document ? <iframe sandbox="" referrerPolicy="no-referrer" title="标注对照" srcDoc={document}
    className="h-96 w-full resize-y rounded border bg-white" /> : <p>正在加载对照图…</p>;
}
