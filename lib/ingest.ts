import companiesJson from '@/data/companies.json';
import seedReportsJson from '@/data/seed-reports.json';
import { getDb } from './db';
import { parseCoreMetrics } from './parser';
import { fetchAllSources } from './sources';
import { putReport, readReport } from './storage';
import type { Announcement, Company } from './types';

const companies = companiesJson as Company[];
const companyByCode = new Map(companies.map((company) => [company.code, company]));
const seedReports = seedReportsJson as Array<{
  id: string; source: Announcement['source']; source_id: string; code: string; company_name: string;
  title: string; report_type: Announcement['reportType']; published_at: string; discovered_at: string; pdf_url: string;
}>;

type StoredAnnouncement = {
  id: string; source: Announcement['source']; source_id: string; code: string; company_name: string;
  title: string; report_type: Announcement['reportType']; published_at: string; pdf_url: string; pdf_key: string | null; status: string;
};

function normalizeTitle(title: string, companyName: string) {
  return title.replace(companyName, '').replace(/[：:（）()\s·—-]/g, '').replace(/更正后|修订版|更新后/g, '更正');
}

async function sha256(value: string | ArrayBuffer) {
  const input = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const hash = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function logicalId(item: Announcement) {
  return sha256(`${item.code}|${item.publishedAt.slice(0, 10)}|${normalizeTitle(item.title, item.name)}`);
}

function periodFromTitle(title: string, publishedAt: string) {
  const year = title.match(/(20\d{2})年/)?.[1] ?? publishedAt.slice(0, 4);
  if (/半年度/.test(title)) return `${year}H1`;
  if (/第一季度/.test(title)) return `${year}Q1`;
  if (/第三季度/.test(title)) return `${year}Q3`;
  return `${year}FY`;
}

async function seedCompanies(now: string) {
  const db = getDb();
  await db.begin(async (tx) => {
    for (const company of companies) {
      await tx`
        INSERT INTO companies (code, name, exchange, industry, rank, weight, enabled, created_at, updated_at)
        VALUES (${company.code}, ${company.name}, ${company.exchange}, ${company.industry}, ${company.rank}, ${company.weight}, true, ${now}, ${now})
        ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, exchange=EXCLUDED.exchange,
          industry=EXCLUDED.industry, rank=EXCLUDED.rank, weight=EXCLUDED.weight, enabled=true, updated_at=EXCLUDED.updated_at
      `;
    }
  });
}

async function seedSnapshotAnnouncements(now: string) {
  const db = getDb();
  let seeded = 0;
  await db.begin(async (tx) => {
    for (const item of seedReports) {
      const result = await tx`
        INSERT INTO announcements
          (id, source, source_id, code, company_name, title, report_type, published_at, discovered_at, pdf_url, status, created_at, updated_at)
        VALUES (${item.id}, ${item.source}, ${item.source_id}, ${item.code}, ${item.company_name}, ${item.title}, ${item.report_type},
          ${item.published_at}, ${item.discovered_at || now}, ${item.pdf_url}, 'discovered', ${now}, ${now})
        ON CONFLICT (id) DO NOTHING
      `;
      seeded += result.count;
    }
  });
  return seeded;
}

export async function bootstrapLiveData() {
  const now = new Date().toISOString();
  await seedCompanies(now);
  const seeded = await seedSnapshotAnnouncements(now);
  return { companies: companies.length, announcements: seedReports.length, seeded, at: now };
}

async function updateSourceHealth(health: Record<string, { ok: boolean; count: number; error?: string }>, now: string) {
  const db = getDb();
  await db.begin(async (tx) => {
    for (const [source, state] of Object.entries(health)) {
      await tx`
        INSERT INTO source_health (source, last_success_at, last_failure_at, consecutive_failures, last_count, last_error, updated_at)
        VALUES (${source}, ${state.ok ? now : null}, ${state.ok ? null : now}, ${state.ok ? 0 : 1}, ${state.count}, ${state.error ?? null}, ${now})
        ON CONFLICT (source) DO UPDATE SET
          last_success_at=CASE WHEN EXCLUDED.last_error IS NULL THEN EXCLUDED.last_success_at ELSE source_health.last_success_at END,
          last_failure_at=CASE WHEN EXCLUDED.last_error IS NOT NULL THEN EXCLUDED.last_failure_at ELSE source_health.last_failure_at END,
          consecutive_failures=CASE WHEN EXCLUDED.last_error IS NULL THEN 0 ELSE source_health.consecutive_failures + 1 END,
          last_count=EXCLUDED.last_count, last_error=EXCLUDED.last_error, updated_at=EXCLUDED.updated_at
      `;
    }
  });
}

export async function recoverStaleRuns() {
  const db = getDb();
  await db`
    UPDATE ingest_runs SET status='interrupted', finished_at=NOW(), error='Worker restarted before the run completed'
    WHERE status='running' AND started_at < NOW() - INTERVAL '45 minutes'
  `;
}

export async function processBacklog(options: { downloadLimit?: number; parseLimit?: number } = {}) {
  const db = getDb();
  const downloadLimit = options.downloadLimit ?? 1;
  const parseLimit = options.parseLimit ?? 1;
  const backlog = await db<StoredAnnouncement[]>`
    SELECT id, source, source_id, code, company_name, title, report_type, published_at, pdf_url, pdf_key, status
    FROM announcements
    WHERE status IN ('discovered', 'download_failed', 'downloaded')
    ORDER BY CASE status WHEN 'downloaded' THEN 0 WHEN 'discovered' THEN 1 ELSE 2 END, published_at DESC
    LIMIT 100
  `;

  let downloaded = 0;
  let parsed = 0;
  let failed = 0;
  for (const record of backlog) {
    if (downloaded >= downloadLimit && parsed >= parseLimit) break;
    try {
      let bytes: ArrayBuffer | null = null;
      let pdfKey = record.pdf_key;
      if (!pdfKey && downloaded < downloadLimit) {
        const referer = record.source === 'CNINFO' ? 'https://www.cninfo.com.cn/' : record.source === 'SSE' ? 'https://www.sse.com.cn/' : 'https://www.szse.cn/';
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        let response: Response;
        try {
          response = await fetch(record.pdf_url, { signal: controller.signal, headers: {
            accept: 'application/pdf,*/*;q=0.8', referer,
            'user-agent': 'FinanceReportIntelligence/1.0 (+https://github.com/wuyongpeng/Financial-Report-Intelligence)',
          } });
        } finally {
          clearTimeout(timer);
        }
        if (!response.ok) throw new Error(`PDF ${response.status}`);
        bytes = await response.arrayBuffer();
        if (new TextDecoder().decode(bytes.slice(0, 4)) !== '%PDF') throw new Error('Downloaded object is not a PDF');
        const digest = await sha256(bytes);
        pdfKey = `reports/${record.code}/${record.id}.pdf`;
        await putReport(pdfKey, bytes);
        const downloadedAt = new Date().toISOString();
        await db`
          UPDATE announcements SET status='downloaded', downloaded_at=${downloadedAt}, pdf_key=${pdfKey}, pdf_sha256=${digest}, parse_error=NULL, updated_at=${downloadedAt}
          WHERE id=${record.id}
        `;
        downloaded += 1;
      } else if (pdfKey && parsed < parseLimit) {
        const object = await readReport(pdfKey);
        if (object) bytes = object.buffer.slice(object.byteOffset, object.byteOffset + object.byteLength);
      }

      if (bytes && parsed < parseLimit && bytes.byteLength < 25 * 1024 * 1024) {
        const extracted = await parseCoreMetrics(bytes);
        const period = periodFromTitle(record.title, record.published_at);
        const createdAt = new Date().toISOString();
        await db.begin(async (tx) => {
          for (const metric of extracted.metrics) {
            await tx`
              INSERT INTO financial_metrics (announcement_id, code, period, metric, value, unit, source_page, source_label, confidence, verified, created_at)
              VALUES (${record.id}, ${record.code}, ${period}, ${metric.metric}, ${metric.value}, ${metric.unit}, ${metric.page}, ${metric.sourceLabel}, ${metric.confidence}, false, ${createdAt})
              ON CONFLICT (announcement_id, metric) DO UPDATE SET value=EXCLUDED.value, unit=EXCLUDED.unit,
                source_page=EXCLUDED.source_page, source_label=EXCLUDED.source_label, confidence=EXCLUDED.confidence
            `;
          }
          await tx`
            UPDATE announcements SET status=${extracted.metrics.length === 4 ? 'review' : 'parse_partial'}, parsed_at=${createdAt}, parse_error=NULL, updated_at=${createdAt}
            WHERE id=${record.id}
          `;
        });
        parsed += 1;
      }
    } catch (error) {
      failed += 1;
      await db`UPDATE announcements SET status='download_failed', parse_error=${String(error)}, updated_at=${new Date().toISOString()} WHERE id=${record.id}`;
    }
  }
  return { backlog: backlog.length, downloaded, parsed, failed };
}

export async function runIngestion(options: { days?: number; downloadLimit?: number; parseLimit?: number } = {}) {
  const db = getDb();
  await recoverStaleRuns();
  const startedAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  const days = options.days ?? 2;
  const downloadLimit = options.downloadLimit ?? 5;
  const parseLimit = options.parseLimit ?? 3;
  await db`INSERT INTO ingest_runs (id, started_at, status) VALUES (${runId}, ${startedAt}, 'running')`;

  try {
    const bootstrap = await bootstrapLiveData();
    const fetched = await fetchAllSources(days);
    await updateSourceHealth(fetched.health, startedAt);
    const relevant = fetched.announcements.filter((item) => companyByCode.has(item.code));
    const cutoff = new Date(Date.now() - (days + 1) * 86400000).toISOString();
    const existing = await db<Array<{ id: string; source: string; source_id: string }>>`
      SELECT id, source, source_id FROM announcements WHERE published_at >= ${cutoff}
    `;
    const existingIds = new Set(existing.map((item) => item.id));
    const existingSourceIds = new Set(existing.map((item) => `${item.source}:${item.source_id}`));
    relevant.sort((a, b) => (a.source === 'CNINFO' ? 1 : 0) - (b.source === 'CNINFO' ? 1 : 0));
    const logical = new Map<string, Announcement>();
    let skipped = 0;
    for (const item of relevant) {
      const id = await logicalId(item);
      if (existingIds.has(id) || existingSourceIds.has(`${item.source}:${item.sourceId}`)) { skipped += 1; continue; }
      if (!logical.has(id)) logical.set(id, item);
    }
    let inserted = 0;
    for (const [id, item] of logical) {
      const result = await db`
        INSERT INTO announcements
          (id, source, source_id, code, company_name, title, report_type, published_at, discovered_at, pdf_url, status, created_at, updated_at)
        VALUES (${id}, ${item.source}, ${item.sourceId}, ${item.code}, ${companyByCode.get(item.code)?.name ?? item.name}, ${item.title}, ${item.reportType},
          ${item.publishedAt}, ${startedAt}, ${item.pdfUrl}, 'discovered', ${startedAt}, ${startedAt})
        ON CONFLICT (id) DO NOTHING
      `;
      inserted += result.count;
    }
    const processed = await processBacklog({ downloadLimit, parseLimit });
    const finishedAt = new Date().toISOString();
    await db`
      UPDATE ingest_runs SET finished_at=${finishedAt}, status='success', discovered_count=${relevant.length}, inserted_count=${inserted},
        downloaded_count=${processed.downloaded}, source_health=${JSON.stringify(fetched.health)}::jsonb WHERE id=${runId}
    `;
    return { runId, startedAt, finishedAt, seeded: bootstrap.seeded, fetched: fetched.announcements.length, relevant: relevant.length, skipped, inserted, ...processed };
  } catch (error) {
    await db`UPDATE ingest_runs SET finished_at=${new Date().toISOString()}, status='failed', error=${String(error)} WHERE id=${runId}`;
    throw error;
  }
}
