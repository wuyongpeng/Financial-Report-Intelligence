export const coreMetricNames = ['revenue', 'net_profit', 'eps', 'roe'] as const;

export function hasCoreMetrics(metrics: readonly { metric: string; value?: number }[]) {
  return coreMetricNames.every(name => metrics.some(m => m.metric === name && (m.value === undefined || Number.isFinite(m.value))));
}
