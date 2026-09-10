import { getDb } from '@/lib/db';
import { requireAppUser } from '@/lib/auth';

type Metric = { metric: string; value: number; unit: string; period: string };

function change(current?: number, previous?: number) {
  if (current === undefined || previous === undefined || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAppUser(request);
  if (denied) return denied;
  const { id } = await context.params;
  const db = getDb();
  const [target] = await db<Array<{ code: string; industry: string; report_type: string }>>`
    SELECT a.code, c.industry, a.report_type FROM announcements a JOIN companies c ON c.code=a.code WHERE a.id=${id}
  `;
  if (!target) return Response.json({ error: '报告不存在' }, { status: 404 });
  const reportMetrics = await db<Metric[]>`SELECT metric, value, unit, period FROM financial_metrics WHERE announcement_id=${id}`;
  const period = reportMetrics[0]?.period;
  const peers: Array<{ code: string; company_name: string; metric: string; value: number; unit: string }> = period ? await db<Array<{ code: string; company_name: string; metric: string; value: number; unit: string }>>`
    SELECT DISTINCT ON (a.code, m.metric) a.code, a.company_name, m.metric, m.value, m.unit
    FROM financial_metrics m JOIN announcements a ON a.id=m.announcement_id JOIN companies c ON c.code=a.code
    WHERE c.industry=${target.industry} AND m.period=${period} AND a.report_type=${target.report_type} AND m.metric IN ('revenue','net_profit','eps','roe')
    ORDER BY a.code, m.metric, a.published_at DESC LIMIT 200
  ` : [];
  const year = period?.match(/20\d{2}/)?.[0];
  const previousPeriod = year && period ? period.replace(year, String(Number(year) - 1)) : '';
  const previousPeers = previousPeriod ? await db<Array<{ code: string; value: number }>>`
    SELECT DISTINCT ON (a.code) a.code, m.value
    FROM financial_metrics m JOIN announcements a ON a.id=m.announcement_id JOIN companies c ON c.code=a.code
    WHERE c.industry=${target.industry} AND m.period=${previousPeriod} AND a.report_type=${target.report_type} AND m.metric='revenue'
    ORDER BY a.code, a.published_at DESC LIMIT 50
  ` : [];
  for (const current of peers.filter(p => p.metric === 'revenue')) {
    const prior = previousPeers.find(p => p.code === current.code)?.value;
    const growth = change(current.value, prior);
    if (growth !== null) peers.push({ ...current, metric: 'revenue_growth', value: growth, unit: '%' });
  }
  const history = previousPeriod ? await db<Array<{ metric: string; value: number }>>`
    SELECT DISTINCT ON (m.metric) m.metric, m.value FROM financial_metrics m JOIN announcements a ON a.id=m.announcement_id
    WHERE a.code=${target.code} AND a.report_type=${target.report_type} AND m.period=${previousPeriod}
    ORDER BY m.metric, a.published_at DESC
  ` : [];
  const latest = new Map(reportMetrics.map((metric) => [metric.metric, metric.value]));
  const prior = new Map(history.map(metric => [metric.metric, metric.value]));
  const revenueChange = change(latest.get('revenue'), prior.get('revenue'));
  const profitChange = change(latest.get('net_profit'), prior.get('net_profit'));
  const anomalies: Array<{ level: 'risk' | 'info'; title: string; detail: string }> = [];
  if (revenueChange !== null && profitChange !== null && revenueChange > 0 && profitChange < 0) {
    anomalies.push({ level: 'risk', title: '增收不增利', detail: `与上年同期同类型报告相比，营收变化 ${revenueChange.toFixed(1)}%，归母净利润变化 ${profitChange.toFixed(1)}%。` });
  }
  if (profitChange !== null && Math.abs(profitChange) >= 30) anomalies.push({ level: 'info', title: '利润波动显著', detail: `归母净利润较上年同期同类型报告变化 ${profitChange.toFixed(1)}%，建议结合管理层讨论与原文核验。` });
  return Response.json({ period, industry: target.industry, peers, anomalies, basis: '仅基于已入库结构化数据计算' }, { headers: { 'cache-control': 'no-store' } });
}
