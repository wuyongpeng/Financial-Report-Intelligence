import goldenQuestions from '../data/golden-questions.json';
import goldenSamples from '../data/golden-samples.json';
import metricGroundTruth from '../data/metric-ground-truth.json';
import { closeDb, getDb } from '../lib/db';

type Check = { name: string; passed: boolean; detail: string };

async function main() {
  const db = getDb();
  const [coverage] = await db<Array<{ companies: number; complete: number; verified: number }>>`
    SELECT
      (SELECT COUNT(*)::int FROM companies WHERE enabled=true) AS companies,
      COUNT(DISTINCT CASE WHEN x.metric_count=4 THEN x.code END)::int AS complete,
      COUNT(DISTINCT CASE WHEN x.metric_count=4 AND x.verified_count=4 THEN x.code END)::int AS verified
    FROM (
      SELECT a.code, a.id, COUNT(m.metric)::int AS metric_count, COUNT(*) FILTER (WHERE m.verified)::int AS verified_count
      FROM announcements a LEFT JOIN financial_metrics m ON m.announcement_id=a.id
      GROUP BY a.code, a.id
    ) x
  `;
  const histories = await db<Array<{ code: string; periods: number }>>`
    SELECT code, COUNT(DISTINCT period)::int AS periods FROM financial_metrics
    WHERE code IN ${db(goldenSamples.map((sample) => sample.code))}
    GROUP BY code
  `;
  const historyByCode = new Map(histories.map((item) => [item.code, item.periods]));
  const completeGolden = goldenSamples.filter((sample) => (historyByCode.get(sample.code) ?? 0) >= sample.targetPeriods).length;
  const truthRows = await db<Array<{ announcement_id: string; metric: string; value: number; source_page: number | null }>>`
    SELECT announcement_id, metric, value, source_page FROM financial_metrics
    WHERE announcement_id IN ${db(metricGroundTruth.map((sample) => sample.announcementId))}
  `;
  const truthByKey = new Map(truthRows.map((row) => [`${row.announcement_id}:${row.metric}`, row]));
  let truthMatched = 0;
  let truthExpected = 0;
  for (const sample of metricGroundTruth) {
    for (const [metric, expected] of Object.entries(sample.metrics)) {
      truthExpected += 1;
      const actual = truthByKey.get(`${sample.announcementId}:${metric}`);
      const tolerance = Math.max(0.0001, Math.abs(expected) * 0.000001);
      if (actual && Math.abs(actual.value - expected) <= tolerance && actual.source_page === sample.sourcePage) truthMatched += 1;
    }
  }
  const checks: Check[] = [
    { name: '绿色通道公司', passed: coverage.companies >= 50, detail: `${coverage.companies}/50 家已启用` },
    { name: '四项指标完整覆盖', passed: coverage.complete >= 50, detail: `${coverage.complete}/50 家至少一份报告含四项指标` },
    { name: '人工复核覆盖', passed: coverage.verified >= 50, detail: `${coverage.verified}/50 家至少一份报告完成四项人工复核` },
    { name: '黄金样本多期数据', passed: completeGolden === goldenSamples.length, detail: `${completeGolden}/${goldenSamples.length} 家达到四期` },
    { name: '官方真值回归', passed: truthMatched === truthExpected, detail: `${truthMatched}/${truthExpected} 个已标注指标数值与页码一致` },
    { name: '标准问题集', passed: goldenQuestions.length >= 20, detail: `${goldenQuestions.length} 个验收问题` },
  ];
  for (const check of checks) console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
  if (checks.some((check) => !check.passed)) process.exitCode = 1;
}

void main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
