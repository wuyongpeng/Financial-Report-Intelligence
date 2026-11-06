/** Human-friendly finance amounts (DB stores currency as 元). Canonical copy uses 亿元/万元. */

export function formatFinanceAmount(value: number, unit = '元'): string {
  if (!Number.isFinite(value)) return '—';
  const u = (unit || '').trim();
  if (u === '%' || /％/.test(u)) return `${trimNum(value)}%`;
  if (/元\/?股|每股/.test(u)) return `${trimNum(value)}元/股`;

  // Parser normalizes table units into 元. If a caller still passes 百万元/千元 with
  // yuan-scale magnitudes, treat as 元 to avoid「32483000000百万元」.
  if (u === '百万元' || u === '千元' || u === '万元') {
    if (Math.abs(value) >= 1e6) return formatFinanceAmount(value, '元');
    return `${trimNum(value)}${u}`;
  }
  if (u === '亿元' || u === '万亿元') return `${trimNum(value)}${u}`;

  if (!u || u === '元' || u === '人民币元' || u === 'RMB' || /人民币/.test(u)) {
    const abs = Math.abs(value);
    if (abs >= 1e8) return `${trimNum(value / 1e8)}亿元`;
    if (abs >= 1e6) return `${trimNum(value / 1e4)}万元`;
    return `${trimNum(value)}元`;
  }
  return `${trimNum(value)}${u}`;
}

/** Metric-aware wrapper for overview / crawl / detail cards (value always in 元 for currency). */
export function formatMetricFinanceAmount(
  metric: string,
  value: number,
): string {
  if (!Number.isFinite(value)) return '—';
  if (metric === 'roe') return formatFinanceAmount(value, '%');
  if (metric === 'eps') return formatFinanceAmount(value, '元/股');
  const currency = new Set([
    'revenue', 'net_profit', 'total_assets', 'total_liabilities', 'operating_cash_flow', 'operating_cost',
    'non_recurring_pnl', 'profit_ex_non_recurring',
    'cash_and_equivalents', 'restricted_cash',
    'short_term_borrowings', 'long_term_borrowings', 'bonds_payable', 'current_portion_debt',
    'goodwill', 'equity_parent',
  ]);
  if (currency.has(metric)) {
    // Keep card/yoy copy on the 亿元 scale even for a true zero baseline.
    if (value === 0) return '0亿元';
    return formatFinanceAmount(value, '元');
  }
  return formatFinanceAmount(value, '元');
}

/**
 * Rewrite long raw「元」amounts in prose for display / TTS.
 * Leaves short amounts, page numbers, and stock codes alone.
 */
export function humanizeYuanInText(text: string): string {
  if (!text) return text;
  return text.replace(/(-?\d{1,3}(?:,\d{3})+|\d{7,})(?:\.(\d+))?\s*元(?!\/?股)/g, (full, intPart: string, frac?: string) => {
    const raw = `${String(intPart).replace(/,/g, '')}${frac != null ? `.${frac}` : ''}`;
    const n = Number(raw);
    if (!Number.isFinite(n) || Math.abs(n) < 1e6) return full;
    return formatFinanceAmount(n, '元');
  });
}

function trimNum(n: number): string {
  return n.toLocaleString('zh-CN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(n) ? 0 : undefined,
  });
}
