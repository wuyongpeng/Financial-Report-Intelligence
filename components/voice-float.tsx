'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import '@/app/voice-float.css';

export type VoiceFloatProps = {
  listening: boolean;
  speaking?: boolean;
  busy?: boolean;
  partial?: string;
  hint?: string;
  onEnd: () => void;
  onFinalize?: () => void;
  onBargeIn?: () => void;
  /** Extra head controls (e.g. auto-jump checkbox on detail). */
  headExtra?: React.ReactNode;
};

type Pos = { left: number; top: number };

const POS_KEY = 'eva-voice-float-pos';
const MARGIN = 8;

function clampPos(left: number, top: number, w: number, h: number): Pos {
  if (typeof window === 'undefined') return { left, top };
  const maxL = Math.max(MARGIN, window.innerWidth - w - MARGIN);
  const maxT = Math.max(MARGIN, window.innerHeight - h - MARGIN);
  return {
    left: Math.min(maxL, Math.max(MARGIN, left)),
    top: Math.min(maxT, Math.max(MARGIN, top)),
  };
}

function readStoredPos(): Pos | null {
  try {
    const raw = sessionStorage.getItem(POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Pos>;
    if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null;
    return { left: parsed.left, top: parsed.top };
  } catch {
    return null;
  }
}

function writeStoredPos(pos: Pos | null) {
  try {
    if (!pos) sessionStorage.removeItem(POS_KEY);
    else sessionStorage.setItem(POS_KEY, JSON.stringify(pos));
  } catch {
    /* ignore */
  }
}

export function VoiceFloat({
  listening,
  speaking = false,
  busy = false,
  partial = '',
  hint,
  onEnd,
  onFinalize,
  onBargeIn,
  headExtra,
}: VoiceFloatProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origLeft: number;
    origTop: number;
  } | null>(null);

  // Restore last drag within this browser tab session (cleared when float unmounts / voice ends).
  useEffect(() => {
    const stored = readStoredPos();
    if (!stored) return;
    const el = rootRef.current;
    const w = el?.offsetWidth ?? 420;
    const h = el?.offsetHeight ?? 120;
    setPos(clampPos(stored.left, stored.top, w, h));
  }, []);

  // Reset to default placement next time voice starts.
  useEffect(() => {
    return () => {
      writeStoredPos(null);
    };
  }, []);

  const reclamp = useCallback(() => {
    setPos((prev) => {
      if (!prev) return prev;
      const el = rootRef.current;
      if (!el) return prev;
      const next = clampPos(prev.left, prev.top, el.offsetWidth, el.offsetHeight);
      writeStoredPos(next);
      return next;
    });
  }, []);

  useEffect(() => {
    window.addEventListener('resize', reclamp);
    return () => window.removeEventListener('resize', reclamp);
  }, [reclamp]);

  const onPointerDownHead = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a, input, label, select, textarea')) return;
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left,
      origTop: rect.top,
    };
    setDragging(true);
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const el = rootRef.current;
    if (!el) return;
    const next = clampPos(
      d.origLeft + (e.clientX - d.startX),
      d.origTop + (e.clientY - d.startY),
      el.offsetWidth,
      el.offsetHeight,
    );
    setPos(next);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    setPos((prev) => {
      if (prev) writeStoredPos(prev);
      return prev;
    });
  };

  const title = listening
    ? '正在聆听…'
    : speaking
      ? '正在朗读…'
      : busy
        ? '思考中…'
        : '语音';
  const body =
    partial
    || hint
    || (speaking
      ? '回答朗读中，说话或点「打断」可直接接着问'
      : busy
        ? '正在处理，请稍候…'
        : '说出公司名称、代码或问题；停顿即发送');

  const style = pos
    ? ({
        left: pos.left,
        top: pos.top,
        right: 'auto',
        bottom: 'auto',
        transform: 'none',
      } as React.CSSProperties)
    : undefined;

  return (
    <div
      ref={rootRef}
      className={`eva-voice-float${pos ? ' is-placed' : ''}${dragging ? ' is-dragging' : ''}`}
      style={style}
      role="status"
      aria-live="polite"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        className="eva-voice-float-head"
        onPointerDown={onPointerDownHead}
        title="拖动可移动位置"
      >
        <b>{title}</b>
        {headExtra}
      </div>
      <div className="eva-voice-float-text">{body}</div>
      <div className="eva-voice-float-actions">
        <button type="button" onClick={onEnd}>结束语音</button>
        {listening && onFinalize ? (
          <button type="button" className="primary" onClick={onFinalize}>说完了</button>
        ) : null}
        {(speaking || busy) && !listening && onBargeIn ? (
          <button type="button" className="primary" onClick={onBargeIn}>打断</button>
        ) : null}
      </div>
    </div>
  );
}
