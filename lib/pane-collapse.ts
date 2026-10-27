/** Gate for company-detail three-pane collapse: at most two panes may be collapsed. */
export type PaneCollapseState = {
  source: boolean;
  middle: boolean;
  chat: boolean;
};

export type PaneCollapseGate = {
  count: number;
  canCollapseSource: boolean;
  canCollapseMiddle: boolean;
  canCollapseChat: boolean;
};

export type PaneRatios = {
  source: number;
  middle: number;
  chat: number;
};

export function paneCollapseGate(collapsed: PaneCollapseState): PaneCollapseGate {
  const count =
    Number(collapsed.source) + Number(collapsed.middle) + Number(collapsed.chat);
  return {
    count,
    // Already-collapsed panes can still "collapse" (no-op / stay) so their button
    // is not the gate — only the last expanded pane is locked.
    canCollapseSource: collapsed.source || count < 2,
    canCollapseMiddle: collapsed.middle || count < 2,
    canCollapseChat: collapsed.chat || count < 2,
  };
}

/**
 * When the middle (overview) pane collapses to a rail, give its flex share to the
 * source pane so the right chat column keeps the same relative width.
 */
export function effectivePaneFlex(
  ratios: PaneRatios,
  opts: { middleCollapsed: boolean },
): { source: number; chat: number } {
  if (opts.middleCollapsed) {
    return {
      source: ratios.source + ratios.middle,
      chat: ratios.chat,
    };
  }
  return { source: ratios.source, chat: ratios.chat };
}
