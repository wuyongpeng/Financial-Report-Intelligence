import { getDb } from '@/lib/db';
import { buildOutline } from '@/lib/outline';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
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
