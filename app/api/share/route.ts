import { apiError, readObject } from '@/lib/api';
import { ensureConversationOwner } from '@/lib/auth';
import { createSharedAnswer } from '@/lib/shared-answers';
import { jsonOk, loginRequired, registeredUserKey } from '@/lib/user-key';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    if (!registeredUserKey(request)) return loginRequired();
    const { owner } = ensureConversationOwner(request);
    const body = await readObject(request) as {
      conversationId?: string; reportId?: string; code?: string; companyName?: string;
      period?: string; question?: string; answer?: string; evidence?: unknown;
    };
    const question = String(body.question ?? '').trim();
    const answer = String(body.answer ?? '').trim();
    if (!question || !answer) return Response.json({ error: '缺少问题和答案' }, { status: 400 });
    const share = await createSharedAnswer({
      ownerKey: owner,
      conversationId: body.conversationId ?? null,
      reportId: body.reportId ?? null,
      code: body.code ?? null,
      companyName: body.companyName ?? null,
      period: body.period ?? null,
      question,
      answer,
      evidence: Array.isArray(body.evidence) ? body.evidence as never : [],
    });
    return jsonOk({ id: share.id, href: `/share/${share.id}` }, 201);
  } catch (error) {
    return apiError(error);
  }
}
