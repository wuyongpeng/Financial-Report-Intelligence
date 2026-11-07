import { apiError, readObject, requiredText } from '@/lib/api';
import { resolveAssistantTurn } from '@/lib/assistant-turn-server';
import { sanitizeModelId } from '@/lib/reader-prefs';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const body = await readObject(request);
    const question = requiredText(body.question, 'question', 2000);
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (Array.isArray(body.history)) for (const row of body.history.slice(-8)) {
      if (row && typeof row === 'object' && (row.role === 'user' || row.role === 'assistant') && typeof row.content === 'string') history.push({ role: row.role, content: row.content.slice(0, 1200) });
    }
    const result = await resolveAssistantTurn({
      question,
      history,
      surface: body.surface === 'report' ? 'report' : 'home',
      context: typeof body.context === 'string' ? body.context.slice(0, 200) : '',
      modelId: sanitizeModelId(body.modelId),
    }, request.signal);
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
