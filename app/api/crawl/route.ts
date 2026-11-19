import { loadCrawlCoverage } from '@/lib/crawl-coverage';

export const dynamic = 'force-dynamic';

export async function GET() {
  const payload = await loadCrawlCoverage();
  return Response.json(payload, { headers: { 'cache-control': 'no-store' } });
}
