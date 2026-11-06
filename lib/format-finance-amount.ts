/** Human-friendly finance amounts for chat / audit copy (stored values are usually 元). */

export function formatFinanceAmount(value: number, unit = '元'): string {
  if (!Number.isFinite(value)) return '—';
  const u = (unit || '').trim();
  if (u === '%' || /％/.test(u)) {
    return `${trimNum(value)}%`;
  }
  if (/元\/?股|每股/.test(u)) {
    return `${trimNum(value)}元/股`;
  }
  // Currency-like units stored as 元 (parser normalizes 百万元→元).
  if (!u || u === '元' || u === '人民币元' || u === 'RMB' || /人民币/.test(u)) {
    const abs = Math.abs(value);
    if (abs >= 1e8) return `${trimNum(value / 1e8)}亿元`;
    if (abs >= 1e6) return `${trimNum(value / 1e4)}万元`;
    return `${trimNum(value)}元`;
  }
  if (u === '亿元' || u === '万亿元') return `${trimNum(value)}${u}`;
  if (u === '万元' || u === '百万元' || u === '千元') return `${trimNum(value)}${u}`;
  return `${trimNum(value)}${u}`;
}

function trimNum(n: number): string {
  return n.toLocaleString('zh-CN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(n) ? 0 : undefined,
  });
}
