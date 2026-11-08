export const dynamic = 'force-dynamic';

/** Memory is local only. This route does not call a model and does not write anything. */
export async function POST() {
  return Response.json({ patch: { action: 'none' } }, { headers: { 'cache-control': 'no-store' } });
}
