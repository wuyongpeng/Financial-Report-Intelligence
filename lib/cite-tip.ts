/** How far to move a cite tooltip (px, negative = left) so it stays inside the clip box. */
export function citeTipShift(
  tip: { left: number; width: number },
  bounds: { left: number; right: number },
  pad = 8,
) {
  let shift = 0;
  const overflowRight = tip.left + tip.width - (bounds.right - pad);
  if (overflowRight > 0) shift -= overflowRight;
  const overflowLeft = bounds.left + pad - (tip.left + shift);
  if (overflowLeft > 0) shift += overflowLeft;
  return shift;
}

/** Pull [P1] hover cards back inside the chat pane (and any overflow box in between). */
export function placeCiteTip(host: HTMLElement) {
  const tip = host.querySelector<HTMLElement>(':scope > .cd-cite-tip');
  if (!tip) return;
  tip.style.left = '0px';
  const bounds = citeTipBounds(host);
  if (!bounds) return;
  const rect = tip.getBoundingClientRect();
  tip.style.left = `${Math.round(citeTipShift(rect, bounds))}px`;
}

function citeTipBounds(host: HTMLElement) {
  const panel = host.closest('#cd-chat-panel');
  if (!panel) return null;
  let left = Number.NEGATIVE_INFINITY;
  let right = Number.POSITIVE_INFINITY;
  let node: HTMLElement | null = host.parentElement;
  while (node) {
    const overflowX = getComputedStyle(node).overflowX;
    if (overflowX === 'auto' || overflowX === 'hidden' || overflowX === 'scroll' || overflowX === 'clip') {
      const rect = node.getBoundingClientRect();
      left = Math.max(left, rect.left + node.clientLeft);
      right = Math.min(right, rect.left + node.clientLeft + node.clientWidth);
    }
    if (node === panel) break;
    node = node.parentElement;
  }
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    const rect = panel.getBoundingClientRect();
    return { left: rect.left, right: rect.right };
  }
  return { left, right };
}
