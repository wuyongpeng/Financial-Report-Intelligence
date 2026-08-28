import { getDb } from '@/lib/db';
import { buildOutline } from '@/lib/outline';
import { requireAppUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAppUser(request);
  if (denied) return denied;
  const { id } = await context.params;
  const db = getDb();
  const chunks = await db<Array<{ page: number; content: string }>>`
    SELECT page, content FROM report_chunks WHERE announcement_id=${id} ORDER BY page LIMIT 120
  `;
  return Response.json({
    source: 'parsed_pdf_text',
    indexedPages: chunks.length,
    outline: buildOutline(chunks),
    pages: chunks.map((chunk) => ({ page: chunk.page, content: chunk.content.slice(0, 1200) })),
  }, { headers: { 'cache-control': 'no-store' } });
}
