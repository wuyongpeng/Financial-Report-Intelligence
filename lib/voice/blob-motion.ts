export const VOICE_BLOB_PATH = 'M40,100 C30,40 70,20 110,20 C160,20 180,60 180,110 C180,160 140,180 90,180 C40,180 50,160 40,100 Z';

/** Convert CSS pixels to SVG units, respecting centered xMidYMid meet. */
export function blobEyeOffset(x: number, y: number, eyeX: number, eyeY: number, rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>) {
  const scale = Math.min(rect.width, rect.height) / 200;
  if (!(scale > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  const dx = (x - rect.left - (rect.width - 200 * scale) / 2) / scale - eyeX;
  const dy = (y - rect.top - (rect.height - 200 * scale) / 2) / scale - eyeY;
  const factor = Math.min(1, 6 / (Math.hypot(dx, dy) || 1));
  return { x: dx * factor, y: dy * factor };
}

/** Per-mounted SVG only: no global IDs/script, listeners/timers/rAF fully released. */
export function attachBlobMotion(svg: SVGSVGElement, host: Window = window): () => void {
  const eyes = [...svg.querySelectorAll('ellipse')];
  const reduced = host.matchMedia('(prefers-reduced-motion: reduce)');
  const fine = host.matchMedia('(hover: hover) and (pointer: fine)');
  let frame: number | undefined;
  let blinkTimer: number | undefined;
  let openTimer: number | undefined;
  let pointer = { x: 0, y: 0 };
  let disposed = false;
  const reset = () => {
    if (frame !== undefined) host.cancelAnimationFrame(frame);
    host.clearTimeout(blinkTimer);
    host.clearTimeout(openTimer);
    frame = undefined;
    eyes.forEach((eye) => { eye.setAttribute('transform', 'translate(0 0)'); eye.setAttribute('ry', '12'); });
  };
  const move = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || reduced.matches || !fine.matches) return;
    pointer = { x: event.clientX, y: event.clientY };
    if (frame !== undefined) return;
    frame = host.requestAnimationFrame(() => {
      frame = undefined;
      if (disposed || reduced.matches) return;
      const rect = svg.getBoundingClientRect();
      eyes.forEach((eye, index) => {
        const offset = blobEyeOffset(pointer.x, pointer.y, index ? 115 : 85, 75, rect);
        eye.setAttribute('transform', `translate(${offset.x} ${offset.y})`);
      });
    });
  };
  const blink = () => {
    blinkTimer = host.setTimeout(() => {
      if (disposed || reduced.matches) return;
      eyes.forEach((eye) => eye.setAttribute('ry', '1.2'));
      openTimer = host.setTimeout(() => {
        eyes.forEach((eye) => eye.setAttribute('ry', '12'));
        blink();
      }, 120);
    }, 4200);
  };
  const configure = () => {
    host.removeEventListener('pointermove', move);
    reset();
    if (disposed || reduced.matches) return;
    if (fine.matches) host.addEventListener('pointermove', move, { passive: true });
    blink();
  };
  reduced.addEventListener('change', configure);
  fine.addEventListener('change', configure);
  configure();
  return () => {
    disposed = true;
    host.removeEventListener('pointermove', move);
    reduced.removeEventListener('change', configure);
    fine.removeEventListener('change', configure);
    reset();
  };
}
