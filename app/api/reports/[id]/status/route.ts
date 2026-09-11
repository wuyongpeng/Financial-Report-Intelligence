import { getDb } from '@/lib/db';
import { apiError, ApiError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const [row] = await getDb()`SELECT a.id, a.company_name, a.source, a.pdf_url, a.status,
      a.published_at, a.discovered_at, a.downloaded_at, a.parsed_at, a.online_at,
      (SELECT COUNT(*)::int FROM financial_metrics m WHERE m.announcement_id=a.id AND m.metric IN ('revenue','net_profit','eps','roe')) AS core_count,
      (SELECT COUNT(*)::int FROM report_chunks r WHERE r.announcement_id=a.id) AS indexed_pages
      FROM announcements a WHERE a.id=${id}`;
    if (!row) throw new ApiError(404, '报告不存在');
    return Response.json({ ...row, readable: row.core_count === 4 && row.indexed_pages > 0,
      timeline: [
        { stage: 'published', label: '来源发布', at: row.published_at, precision: row.source === 'SSE' ? 'date' : 'source' },
        { stage: 'discovered', label: '发现公告', at: row.discovered_at },
        { stage: 'downloaded', label: 'PDF 已归档', at: row.downloaded_at },
        { stage: 'parsed', label: '完成解析', at: row.parsed_at },
        { stage: 'verified', label: '人工复核上线', at: row.online_at },
      ],
      analysis: 'on-demand',
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
