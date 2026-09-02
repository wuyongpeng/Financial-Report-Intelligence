import { readFile, writeFile } from 'node:fs/promises';

const companies = JSON.parse(await readFile(new URL('../data/companies.json', import.meta.url), 'utf8'));
const goldenSamples = JSON.parse(await readFile(new URL('../data/golden-samples.json', import.meta.url), 'utf8'));
const goldenByCode = new Map(goldenSamples.map((sample) => [sample.code, sample]));
const endpoint = 'https://www.cninfo.com.cn/new';
const start = process.env.BACKFILL_START ?? '2025-01-01';
const end = new Date().toISOString().slice(0, 10);
const reports = [];
const headers = {
  'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
  referer: 'https://www.cninfo.com.cn/',
  'user-agent': 'FinanceAnalysisDemo/0.1 (+https://financial-report-intelligence.wuyongpeng.chatgpt.site)',
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function post(path, body) {
  const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers, body });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

function classify(title) {
  if (/半年度报告/.test(title)) return 'semiannual';
  if (/季度报告/.test(title)) return 'quarterly';
  return 'annual';
}

for (const [index, company] of companies.entries()) {
  try {
    const matches = await post('/information/topSearch/query', new URLSearchParams({
      keyWord: company.code, maxNum: '5', plate: '',
    }));
    const match = matches.find((item) => item.code === company.code);
    if (!match?.orgId) throw new Error('company orgId not found');
    await wait(420);

    const payload = await post('/hisAnnouncement/query', new URLSearchParams({
      pageNum: '1', pageSize: '30', column: 'szse', tabName: 'fulltext', plate: '',
      stock: `${company.code},${match.orgId}`, searchkey: '', secid: '',
      category: 'category_ndbg_szsh;category_bndbg_szsh;category_yjdbg_szsh;category_sjdbg_szsh',
      trade: '', seDate: `${start}~${end}`, sortName: '', sortType: '', isHLtitle: 'true',
    }));
    const matchesToKeep = (payload.announcements ?? []).filter((entry) => {
      const title = String(entry.announcementTitle ?? '').replace(/<[^>]+>/g, '');
      return !/摘要|英文版|取消/.test(title) && /(年度报告|半年度报告|季度报告)/.test(title);
    }).slice(0, goldenByCode.get(company.code)?.targetPeriods ?? 1);
    if (!matchesToKeep.length) throw new Error('no report found');
    for (const item of matchesToKeep) {
      const title = String(item.announcementTitle ?? '').replace(/<[^>]+>/g, '');
      reports.push({
        id: `CNINFO:${item.announcementId}`,
        source: 'CNINFO', source_id: String(item.announcementId), code: company.code,
        company_name: company.name, title, report_type: classify(title),
        published_at: new Date(Number(item.announcementTime)).toISOString(),
        discovered_at: new Date().toISOString(),
        pdf_url: `https://static.cninfo.com.cn/${String(item.adjunctUrl).replace(/^\//, '')}`,
        status: 'official_snapshot', industry: company.industry, rank: company.rank,
      });
    }
    process.stdout.write(`${String(index + 1).padStart(2, '0')}/50 ${company.code} ${company.name} ✓ ${matchesToKeep.length} report(s)\n`);
  } catch (error) {
    process.stdout.write(`${String(index + 1).padStart(2, '0')}/50 ${company.code} ${company.name} × ${error.message}\n`);
  }
  // A single polite stream is deliberate: no parallel burst against the public service.
  await wait(680);
}

reports.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
await writeFile(new URL('../data/seed-reports.json', import.meta.url), `${JSON.stringify(reports, null, 2)}\n`);
process.stdout.write(`saved ${reports.length} official reports\n`);
if (reports.length < 45) process.exitCode = 2;
