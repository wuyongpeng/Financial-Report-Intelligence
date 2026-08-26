import { getBindings } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { DB, REPORTS } = getBindings();
  const record = await DB.prepare('SELECT pdf_key, pdf_url FROM announcements WHERE id=?').bind(id).first<{ pdf_key?: string; pdf_url: string }>();
  if (!record) return new Response('Not found', { status: 404 });
  if (!record.pdf_key) return Response.redirect(record.pdf_url, 302);
  const object = await REPORTS.get(record.pdf_key);
  if (!object) return Response.redirect(record.pdf_url, 302);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=86400');
  return new Response(object.body, { headers });
}
