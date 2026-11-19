import { apiError } from '@/lib/api';
import { getSharedAnswer } from '@/lib/shared-answers';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const share = await getSharedAnswer(id);
    if (!share) return Response.json({ error: '分享不存在或已删除' }, { status: 404 });
    return Response.json({
      id: share.id,
      code: share.code,
      companyName: share.companyName,
      period: share.period,
      question: share.question,
      answer: share.answer,
      evidence: share.evidence,
      createdAt: share.createdAt,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
