import { getDb } from '@/lib/db';
import { readReport } from '@/lib/storage';
import { requireAppUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAppUser(request);
  if (denied) return denied;
  const { id } = await context.params;
  const db = getDb();
  const [record] = await db<Array<{ pdf_key: string | null; pdf_url: string }>>`SELECT pdf_key, pdf_url FROM announcements WHERE id=${id}`;
  if (!record) return new Response('Not found', { status: 404 });
  if (!record.pdf_key) return Response.redirect(record.pdf_url, 302);
  const bytes = await readReport(record.pdf_key);
  if (!bytes) return Response.redirect(record.pdf_url, 302);
  return new Response(bytes, { headers: { 'content-type': 'application/pdf', 'cache-control': 'private, max-age=86400' } });
}
