import companiesJson from '@/data/companies.json';
import { parseCoreMetrics } from './parser';
import { fetchAllSources } from './sources';
import type { Announcement, Bindings, Company } from './types';

const companies = companiesJson as Company[];
const companyByCode = new Map(companies.map((company) => [company.code, company]));

function normalizeTitle(title: string, companyName: string) {
  return title.replace(companyName, '').replace(/[：:（）()\s·—-]/g, '').replace(/更正后|修订版|更新后/g, '更正');
}

async function sha256(value: string | ArrayBuffer) {
  const input = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const hash = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function logicalId(item: Announcement) {
  const date = item.publishedAt.slice(0, 10);
  return sha256(`${item.code}|${date}|${normalizeTitle(item.title, item.name)}`);
}

function periodFromTitle(title: string, publishedAt: string) {
  const year = title.match(/(20\d{2})年/)?.[1] ?? publishedAt.slice(0, 4);
  if (/半年度/.test(title)) return `${year}H1`;
  if (/第一季度/.test(title)) return `${year}Q1`;
  if (/第三季度/.test(title)) return `${year}Q3`;
  return `${year}FY`;
}

async function seedCompanies(db: D1Database, now: string) {
  const statements = companies.map((company) => db.prepare(`
    INSERT INTO companies (code, name, exchange, industry, rank, weight, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(code) DO UPDATE SET name=excluded.name, exchange=excluded.exchange,
      industry=excluded.industry, rank=excluded.rank, weight=excluded.weight, enabled=1, updated_at=excluded.updated_at
  `).bind(company.code, company.name, company.exchange, company.industry, company.rank, company.weight, now, now));
  await db.batch(statements);
}

async function updateSourceHealth(db: D1Database, health: Record<string, { ok: boolean; count: number; error?: string }>, now: string) {
  const statements = Object.entries(health).map(([source, state]) => db.prepare(`
    INSERT INTO source_health (source, last_success_at, last_failure_at, consecutive_failures, last_count, last_error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source) DO UPDATE SET
      last_success_at=CASE WHEN excluded.last_error IS NULL THEN excluded.last_success_at ELSE source_health.last_success_at END,
      last_failure_at=CASE WHEN excluded.last_error IS NOT NULL THEN excluded.last_failure_at ELSE source_health.last_failure_at END,
      consecutive_failures=CASE WHEN excluded.last_error IS NULL THEN 0 ELSE source_health.consecutive_failures + 1 END,
      last_count=excluded.last_count, last_error=excluded.last_error, updated_at=excluded.updated_at
  `).bind(source, state.ok ? now : null, state.ok ? null : now, state.ok ? 0 : 1, state.count, state.error ?? null, now));
  await db.batch(statements);
}

export async function runIngestion(env: Bindings, options: { days?: number; downloadLimit?: number; parseLimit?: number } = {}) {
  const startedAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  const days = options.days ?? 2;
  const downloadLimit = options.downloadLimit ?? 4;
  const parseLimit = options.parseLimit ?? 1;
  await env.DB.prepare('INSERT INTO ingest_runs (id, started_at, status) VALUES (?, ?, ?)').bind(runId, startedAt, 'running').run();

  try {
    await seedCompanies(env.DB, startedAt);
    const fetched = await fetchAllSources(days);
    await updateSourceHealth(env.DB, fetched.health, startedAt);

    const relevant = fetched.announcements.filter((item) => companyByCode.has(item.code));
    relevant.sort((a, b) => (a.source === 'CNINFO' ? 1 : 0) - (b.source === 'CNINFO' ? 1 : 0));
    const logical = new Map<string, Announcement>();
    for (const item of relevant) {
      const id = await logicalId(item);
      // Exchange-direct records are sorted first; CNINFO only fills a missing logical report.
      if (!logical.has(id)) logical.set(id, item);
    }

    const inserted: Array<{ id: string; item: Announcement }> = [];
    for (const [id, item] of logical) {
      const result = await env.DB.prepare(`
        INSERT OR IGNORE INTO announcements
          (id, source, source_id, code, company_name, title, report_type, published_at, discovered_at, pdf_url, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'discovered', ?, ?)
      `).bind(id, item.source, item.sourceId, item.code, companyByCode.get(item.code)?.name ?? item.name, item.title, item.reportType, item.publishedAt, startedAt, item.pdfUrl, startedAt, startedAt).run();
      if ((result.meta?.changes ?? 0) > 0) inserted.push({ id, item });
    }

    let downloadedCount = 0;
    let parsedCount = 0;
    for (const record of inserted.slice(0, downloadLimit)) {
      try {
        const response = await fetch(record.item.pdfUrl, { headers: { 'user-agent': 'FinanceAnalysisDemo/0.1 (+https://financial-report-intelligence.wuyongpeng.chatgpt.site)' } });
        if (!response.ok) throw new Error(`PDF ${response.status}`);
        const bytes = await response.arrayBuffer();
        const signature = new TextDecoder().decode(bytes.slice(0, 4));
        if (signature !== '%PDF') throw new Error('Downloaded object is not a PDF');
        const digest = await sha256(bytes);
        const key = `reports/${record.item.code}/${record.id}.pdf`;
        await env.REPORTS.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' }, customMetadata: { source: record.item.source, sourceUrl: record.item.pdfUrl } });
        const downloadedAt = new Date().toISOString();
        await env.DB.prepare(`UPDATE announcements SET status='downloaded', downloaded_at=?, pdf_key=?, pdf_sha256=?, updated_at=? WHERE id=?`)
          .bind(downloadedAt, key, digest, downloadedAt, record.id).run();
        downloadedCount += 1;

        if (parsedCount < parseLimit && bytes.byteLength < 25 * 1024 * 1024) {
          const parsed = await parseCoreMetrics(bytes);
          const period = periodFromTitle(record.item.title, record.item.publishedAt);
          const metricStatements = parsed.metrics.map((metric) => env.DB.prepare(`
            INSERT INTO financial_metrics (announcement_id, code, period, metric, value, unit, source_page, source_label, confidence, verified, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            ON CONFLICT(announcement_id, metric) DO UPDATE SET value=excluded.value, unit=excluded.unit,
              source_page=excluded.source_page, source_label=excluded.source_label, confidence=excluded.confidence
          `).bind(record.id, record.item.code, period, metric.metric, metric.value, metric.unit, metric.page, metric.sourceLabel, metric.confidence, downloadedAt));
          if (metricStatements.length) await env.DB.batch(metricStatements);
          const parsedAt = new Date().toISOString();
          await env.DB.prepare(`UPDATE announcements SET status=?, parsed_at=?, online_at=?, updated_at=? WHERE id=?`)
            .bind(parsed.metrics.length === 4 ? 'review' : 'parse_partial', parsedAt, parsedAt, parsedAt, record.id).run();
          parsedCount += 1;
        }
      } catch (error) {
        await env.DB.prepare(`UPDATE announcements SET status='download_failed', parse_error=?, updated_at=? WHERE id=?`)
          .bind(String(error), new Date().toISOString(), record.id).run();
      }
    }

    const finishedAt = new Date().toISOString();
    await env.DB.prepare(`UPDATE ingest_runs SET finished_at=?, status='success', discovered_count=?, inserted_count=?, downloaded_count=?, source_health=? WHERE id=?`)
      .bind(finishedAt, relevant.length, inserted.length, downloadedCount, JSON.stringify(fetched.health), runId).run();
    return { runId, startedAt, finishedAt, sourceHealth: fetched.health, fetched: fetched.announcements.length, relevant: relevant.length, inserted: inserted.length, downloaded: downloadedCount, parsed: parsedCount };
  } catch (error) {
    await env.DB.prepare(`UPDATE ingest_runs SET finished_at=?, status='failed', error=? WHERE id=?`).bind(new Date().toISOString(), String(error), runId).run();
    throw error;
  }
}
