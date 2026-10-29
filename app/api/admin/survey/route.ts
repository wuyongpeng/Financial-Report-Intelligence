import { requireAdmin } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { readProductDocument } from '@/lib/product-documents';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const content = await readProductDocument('用户调研.md');
    if (content == null) {
      return Response.json({ error: '未找到用户调研文档' }, { status: 404, headers: { 'cache-control': 'no-store' } });
    }
    return Response.json({ title: '用户调研', content }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
