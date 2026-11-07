/** Deep-link question stays queued until report + conversation bootstrap are truly ready. */
export function canStartHandoffAsk(state: {
  question: string | null; sent: boolean; periodReady: boolean; memoryLoading: boolean;
  memoryReady: boolean; loading: boolean; asking: boolean; busy: boolean; reportReady: boolean;
}): boolean {
  return Boolean(state.question?.trim()) && !state.sent && state.periodReady && state.memoryReady
    && state.reportReady && !state.memoryLoading && !state.loading && !state.asking && !state.busy;
}

export function canApplyHydratedThread(state: {
  aborted: boolean; reportId: string; activeId: string; requestUnchanged: boolean; busy: boolean;
}): boolean {
  return !state.aborted && state.reportId === state.activeId && state.requestUnchanged && !state.busy;
}

/** A temporary visual turn, not a second persisted question or conversation. */
export function pendingDetailAskQuestion(state: {
  asking: boolean; preflight: string | null; handoffPending: boolean; handoff: string | null;
}): string | null {
  return (state.asking ? state.preflight?.trim() : '') || (state.handoffPending ? state.handoff?.trim() : '') || null;
}
