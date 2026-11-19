import { apiError, ApiError } from '@/lib/api';
import { deleteClientAudit, readClientAuditDetail } from '@/lib/list-client-audit';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function auditId(raw: string) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw new ApiError(400, '记录不存在');
  return id;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const detail = await readClientAuditDetail(auditId(id));
    if (!detail) throw new ApiError(404, '记录不存在');
    return Response.json(detail, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const removed = await deleteClientAudit(auditId(id));
    if (!removed) throw new ApiError(404, '记录不存在');
    return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
