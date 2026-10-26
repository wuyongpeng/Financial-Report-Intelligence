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
