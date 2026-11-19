import { apiError } from '@/lib/api';
import { loadCrawlCoverage } from '@/lib/crawl-coverage';
import { registeredUserKey } from '@/lib/user-key';
import { listWatchlist } from '@/lib/user-watchlist';
import { buildWatchlistDigest } from '@/lib/watchlist-digest';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const userKey = registeredUserKey(request);
    if (!userKey) {
      const payload = await loadCrawlCoverage({ codes: [], allowMock: false });
      return Response.json({ ...payload, source: 'watchlist', companies: [], digest: null }, { headers: { 'cache-control': 'no-store' } });
    }
    const watchlist = await listWatchlist(userKey);
    const addedAt = new Map(watchlist.map((row) => [row.code, row.created_at]));
    const payload = await loadCrawlCoverage({ codes: watchlist.map((row) => row.code), allowMock: false });
    const companies = payload.companies.map((company) => ({
      ...company,
      addedAt: addedAt.get(company.code) ?? company.addedAt,
    }));
    return Response.json({
      ...payload,
      source: 'watchlist',
      companies,
      digest: buildWatchlistDigest(companies),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
