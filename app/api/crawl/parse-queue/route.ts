import { authorizeProductWrite } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { abortParseAnnouncements } from '@/lib/ingest';
import { PARSE_ABORT_MESSAGE } from '@/lib/parse-abort';

export const dynamic = 'force-dynamic';

function authorized(request: Request) {
  return authorizeProductWrite(request);
}

/**
 * action=abort  中止排队解析 / 解析中的一份：退出自动队列，落 parse_parked。
 * 稍后详情页或采集页手动「解析」经 enqueueParseFront 会回到 downloaded。
 */
export async function POST(request: Request) {
  const auth = authorized(request);
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { action?: unknown; id?: unknown; ids?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '请求体无效' }, { status: 400 });
  }

  const action = typeof body.action === 'string' ? body.action : 'abort';
  if (action !== 'abort') return Response.json({ error: '不支持的 action' }, { status: 400 });

  const ids: string[] = [];
  if (typeof body.id === 'string' && body.id.trim()) ids.push(body.id.trim());
  if (Array.isArray(body.ids)) {
    for (const item of body.ids) {
      if (typeof item === 'string' && item.trim()) ids.push(item.trim());
    }
  }
  const unique = [...new Set(ids)];
  if (!unique.length) return Response.json({ error: '需要 id' }, { status: 400 });

  try {
    const result = await abortParseAnnouncements(unique);
    return Response.json(
      {
        ok: true,
        auth,
        action,
        ids: unique,
        aborted: result.aborted,
        abortedNow: result.abortedNow,
        message: PARSE_ABORT_MESSAGE,
        note: result.aborted
          ? `已中止 ${result.aborted} 份，退出排队解析；稍后可手动再解析。`
          : '未找到可中止的排队/解析中任务（可能已搁置或不在队列）。',
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}
