/** Geometry measured against the supplied circular avatar reference. */
export const VOICE_EYES = [{ x: 52, y: 69 }, { x: 101, y: 59 }] as const;
export const VOICE_EYE_TRAVEL = 22;

/**
 * Locate the eye in rendered CSS pixels. Broad viewport-relative response avoids
 * saturating immediately outside a tiny icon; result is converted to SVG travel.
 */
export function blobEyeOffset(x: number, y: number, eyeX: number, eyeY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  viewport = { width: 1000, height: 800 },
) {
  const scale = Math.min(rect.width, rect.height) / 200;
  if (!(scale > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  const centerX = rect.left + (rect.width - 200 * scale) / 2 + eyeX * scale;
  const centerY = rect.top + (rect.height - 200 * scale) / 2 + eyeY * scale;
  const rangeX = Math.max(240, rect.width * 5, viewport.width * 0.55);
  const rangeY = Math.max(200, rect.height * 5, viewport.height * 0.55);
  const dx = Math.tanh((x - centerX) / rangeX) * VOICE_EYE_TRAVEL;
  const dy = Math.tanh((y - centerY) / rangeY) * VOICE_EYE_TRAVEL;
  const factor = Math.min(1, VOICE_EYE_TRAVEL / (Math.hypot(dx, dy) || 1));
  return { x: dx * factor, y: dy * factor };
}

/** Per-mounted SVG only: no global IDs/script, listeners/timers/rAF fully released. */
export function attachBlobMotion(svg: SVGSVGElement, host: Window = window): () => void {
  const eyes = [...svg.querySelectorAll('[data-voice-eye]')];
  const blinks = [...svg.querySelectorAll('[data-voice-blink]')];
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
    eyes.forEach((eye) => eye.setAttribute('transform', 'translate(0 0)'));
    blinks.forEach((blink) => blink.setAttribute('transform', 'scale(1 1)'));
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
        const origin = VOICE_EYES[index];
        if (!origin) return;
        const offset = blobEyeOffset(pointer.x, pointer.y, origin.x, origin.y, rect,
          { width: host.innerWidth || 1000, height: host.innerHeight || 800 });
        eye.setAttribute('transform', `translate(${offset.x} ${offset.y})`);
      });
    });
  };
  const blink = () => {
    blinkTimer = host.setTimeout(() => {
      if (disposed || reduced.matches) return;
      blinks.forEach((blink) => blink.setAttribute('transform', 'scale(1 .1)'));
      openTimer = host.setTimeout(() => {
        blinks.forEach((blink) => blink.setAttribute('transform', 'scale(1 1)'));
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
