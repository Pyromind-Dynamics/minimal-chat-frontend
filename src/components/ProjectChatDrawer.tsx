import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const heightKey = 'echomind.projectChatHeight';
const minHeight = 128;
const defaultHeight = 360;

export function ProjectChatDrawer({ history, composer }: {
  history: (expanded: boolean) => ReactNode;
  composer: (panel: { id: string; expanded: boolean }) => ReactNode;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const pointerInside = useRef(false);
  const drag = useRef<{ pointerId: number; y: number; startHeight: number; height: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [height, setHeight] = useState(() => {
    const saved = typeof window === 'undefined' ? null : window.localStorage.getItem(heightKey);
    const value = Number(saved);
    return Number.isFinite(value) && value > 0 ? Math.max(minHeight, value) : defaultHeight;
  });

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      pointerInside.current = root.current?.contains(event.target as Node) ?? false;
      if (!pointerInside.current) setExpanded(false);
    };
    const clearPointer = () => { pointerInside.current = false; };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', clearPointer, true);
    document.addEventListener('pointercancel', clearPointer, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', clearPointer, true);
      document.removeEventListener('pointercancel', clearPointer, true);
      clearPointer();
    };
  }, [expanded]);

  const resize = (requested: number) => {
    const anchor = root.current;
    if (!anchor?.parentElement) return height;
    const available = Math.max(0, anchor.parentElement.clientHeight - anchor.offsetHeight - 12);
    const next = Math.round(Math.min(available, Math.max(minHeight, requested)));
    setHeight(next);
    return next;
  };

  const close = () => {
    root.current?.focus({ preventScroll: true });
    setExpanded(false);
  };

  return <div ref={root} className="project-chat-composer" tabIndex={-1}
    onFocus={event => {
      if (event.target !== event.currentTarget) setExpanded(true);
    }}
    onBlur={event => {
      // Selecting text in the drawer can blur the input without a new focus target.
      if (event.relatedTarget ? !event.currentTarget.contains(event.relatedTarget) : !pointerInside.current) {
        setExpanded(false);
      }
    }}
    onKeyDown={event => {
      if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented) return;
      close();
    }}>
    {composer({ id, expanded })}
    <section ref={drawer} id={id} aria-label="Chat" hidden={!expanded}
      className="project-chat-drawer" style={{ height }}>
      <div className="project-chat-drawer-header">
        <button type="button" className="project-chat-resize" aria-label="调整对话高度"
          title="拖动或用上下方向键调整对话高度"
          onPointerDown={event => {
            if (!event.isPrimary || event.button !== 0 || !drawer.current) return;
            const startHeight = drawer.current.getBoundingClientRect().height;
            drag.current = { pointerId: event.pointerId, y: event.clientY, startHeight, height: startHeight };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            const current = drag.current;
            if (current?.pointerId !== event.pointerId) return;
            current.height = resize(current.startHeight + current.y - event.clientY);
          }}
          onLostPointerCapture={event => {
            if (drag.current?.pointerId !== event.pointerId) return;
            if (drag.current.height !== drag.current.startHeight) localStorage.setItem(heightKey, String(drag.current.height));
            drag.current = null;
          }}
          onKeyDown={event => {
            if (!drawer.current || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
            event.preventDefault();
            const step = event.key === 'ArrowUp' ? 32 : -32;
            const next = resize(drawer.current.getBoundingClientRect().height + step);
            localStorage.setItem(heightKey, String(next));
          }}>
          <span aria-hidden="true" />
        </button>
        <button type="button" className="project-chat-close" aria-label="关闭对话" title="关闭对话" onClick={close}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {history(expanded)}
    </section>
  </div>;
}
