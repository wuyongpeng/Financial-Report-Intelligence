export type VoiceFloatPosition = { left: number; top: number };
export const VOICE_FLOAT_MARGIN = 8;

export function clampVoiceFloatPosition(left: number, top: number, width: number, height: number,
  viewport: { width: number; height: number }): VoiceFloatPosition {
  const margin = VOICE_FLOAT_MARGIN;
  return {
    left: Math.min(Math.max(margin, viewport.width - width - margin), Math.max(margin, Number.isFinite(left) ? left : margin)),
    top: Math.min(Math.max(margin, viewport.height - height - margin), Math.max(margin, Number.isFinite(top) ? top : margin)),
  };
}

/** Shared mouse/touch drag lifecycle. Position is local to this mounted voice session. */
export function attachVoiceFloatDrag(root: HTMLElement, host: Window = window): () => void {
  let disposed = false;
  let position: VoiceFloatPosition | null = null;
  let drag: { pointerId: number; x: number; y: number; left: number; top: number } | null = null;
  const clamp = (left: number, top: number) => {
    const rect = root.getBoundingClientRect();
    return clampVoiceFloatPosition(left, top, rect.width, rect.height, { width: host.innerWidth, height: host.innerHeight });
  };
  const place = (next: VoiceFloatPosition) => {
    position = next;
    Object.assign(root.style, { left: `${next.left}px`, top: `${next.top}px`, right: 'auto', bottom: 'auto', transform: 'none' });
  };
  const end = (event?: PointerEvent) => {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    const id = drag.pointerId;
    drag = null;
    root.removeAttribute('data-voice-dragging');
    if (root.hasPointerCapture?.(id)) root.releasePointerCapture(id);
  };
  const down = (event: PointerEvent) => {
    const target = event.target as Element | null;
    if (drag || !event.isPrimary || event.button !== 0 || !target?.closest) return;
    if (!target.closest('[data-voice-drag-surface]')
      || target.closest('button, a, input, label, select, textarea, [data-voice-no-drag]')) return;
    const rect = root.getBoundingClientRect();
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    // Window listeners also handle capture loss / implementations without capture support.
    try { root.setPointerCapture?.(event.pointerId); } catch { /* window fallback */ }
    event.preventDefault();
  };
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) < 3 && !root.hasAttribute('data-voice-dragging')) return;
    root.setAttribute('data-voice-dragging', '');
    place(clamp(drag.left + dx, drag.top + dy));
    event.preventDefault();
  };
  const reclamp = () => {
    if (disposed) return;
    // A resize during a gesture starts a fresh drag rather than using stale geometry.
    end();
    const rect = root.getBoundingClientRect();
    const next = clamp(position?.left ?? rect.left, position?.top ?? rect.top);
    if (position || next.left !== rect.left || next.top !== rect.top) place(next);
  };
  root.addEventListener('pointerdown', down);
  root.addEventListener('lostpointercapture', end);
  host.addEventListener('pointermove', move, { passive: false });
  host.addEventListener('pointerup', end);
  host.addEventListener('pointercancel', end);
  host.addEventListener('resize', reclamp);
  const Observer = (host as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  const observer = Observer ? new Observer(reclamp) : null;
  observer?.observe(root);
  reclamp();
  return () => {
    disposed = true;
    end();
    observer?.disconnect();
    root.removeEventListener('pointerdown', down);
    root.removeEventListener('lostpointercapture', end);
    host.removeEventListener('pointermove', move);
    host.removeEventListener('pointerup', end);
    host.removeEventListener('pointercancel', end);
    host.removeEventListener('resize', reclamp);
    if (position) ['left', 'top', 'right', 'bottom', 'transform'].forEach((key) => root.style.removeProperty(key));
  };
}
