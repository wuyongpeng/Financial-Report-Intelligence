import { getDb } from '@/lib/db';

type Metric = { metric: string; value: number; unit: string; period: string };

function change(current?: number, previous?: number) {
  if (current === undefined || previous === undefined || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = getDb();
  const [target] = await db<Array<{ code: string; industry: string }>>`
    SELECT a.code, c.industry FROM announcements a JOIN companies c ON c.code=a.code WHERE a.id=${id}
  `;
  if (!target) return Response.json({ error: '报告不存在' }, { status: 404 });
  const reportMetrics = await db<Metric[]>`SELECT metric, value, unit, period FROM financial_metrics WHERE announcement_id=${id}`;
  const period = reportMetrics[0]?.period;
  const peers = period ? await db<Array<{ code: string; company_name: string; metric: string; value: number; unit: string }>>`
    SELECT a.code, a.company_name, m.metric, m.value, m.unit
    FROM financial_metrics m JOIN announcements a ON a.id=m.announcement_id JOIN companies c ON c.code=a.code
    WHERE c.industry=${target.industry} AND m.period=${period} AND m.metric IN ('revenue','net_profit','roe')
    ORDER BY a.code, m.metric LIMIT 80
  ` : [];
  const history = await db<Array<{ published_at: string; metric: string; value: number }>>`
    SELECT a.published_at, m.metric, m.value FROM financial_metrics m JOIN announcements a ON a.id=m.announcement_id
    WHERE a.code=${target.code} ORDER BY a.published_at DESC LIMIT 32
  `;
  const latest = new Map(reportMetrics.map((metric) => [metric.metric, metric.value]));
  const prior = new Map<string, number>();
  for (const metric of history) if (!prior.has(metric.metric) && metric.value !== latest.get(metric.metric)) prior.set(metric.metric, metric.value);
  const revenueChange = change(latest.get('revenue'), prior.get('revenue'));
  const profitChange = change(latest.get('net_profit'), prior.get('net_profit'));
  const anomalies: Array<{ level: 'risk' | 'info'; title: string; detail: string }> = [];
  if (revenueChange !== null && profitChange !== null && revenueChange > 0 && profitChange < 0) {
    anomalies.push({ level: 'risk', title: '增收不增利', detail: `与上一已入库报告相比，营收变化 ${revenueChange.toFixed(1)}%，归母净利润变化 ${profitChange.toFixed(1)}%。` });
  }
  if (profitChange !== null && Math.abs(profitChange) >= 30) anomalies.push({ level: 'info', title: '利润波动显著', detail: `归母净利润较上一已入库报告变化 ${profitChange.toFixed(1)}%，建议结合管理层讨论与原文核验。` });
  return Response.json({ period, industry: target.industry, peers, anomalies, basis: '仅基于已入库结构化数据计算' }, { headers: { 'cache-control': 'no-store' } });
}
