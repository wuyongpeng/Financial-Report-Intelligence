import { apiError, ApiError, readObject, requiredText } from '@/lib/api';
import { reflectReaderMemoryOnServer } from '@/lib/reader-memory-reflect';

export const dynamic = 'force-dynamic';

function parseNotes(value: unknown): Array<{ id: string; text: string }> {
  if (!Array.isArray(value)) return [];
  const notes: Array<{ id: string; text: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as { id?: unknown; text?: unknown };
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const text = typeof row.text === 'string' ? row.text.trim() : '';
    if (!id || !text || id.length > 80 || text.length > 80) continue;
    notes.push({ id, text });
    if (notes.length >= 12) break;
  }
  return notes;
}

export async function POST(request: Request) {
  try {
    const body = await readObject(request);
    const question = requiredText(body.question, '问题', 400);
    const context = typeof body.context === 'string' ? body.context.trim().slice(0, 80) : undefined;
    const patch = await reflectReaderMemoryOnServer({
      question,
      notes: parseNotes(body.notes),
      context,
      signal: request.signal,
    });
    return Response.json({ patch }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof ApiError) return apiError(error);
    return Response.json({ patch: { action: 'none' } }, { headers: { 'cache-control': 'no-store' } });
  }
}
