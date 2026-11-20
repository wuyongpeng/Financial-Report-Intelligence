import { apiError, ApiError, readObject, uuid } from '@/lib/api';
import {
  accountIsUnlimited,
  parseQuotaLimit,
  unlimitedSource,
  type AdminUserRecord,
} from '@/lib/admin-users';
import { generateTemporaryPassword, hashPassword, isUnlimitedUsername } from '@/lib/app-account';
import { requireAdmin } from '@/lib/auth';
import { ensureBackendSchema } from '@/lib/backend-schema';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type UserRow = {
  id: string;
  username: string;
  created_at: string | Date;
  quota_limit: number;
  unlimited: boolean;
  disabled_at: string | Date | null;
  ask_count: number | null;
  last_ask_at: string | Date | null;
};

function iso(value: string | Date | null | undefined) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const text = String(value);
  return text || null;
}

function mapUser(row: UserRow): AdminUserRecord {
  const dbUnlimited = Boolean(row.unlimited);
  const envUnlimited = isUnlimitedUsername(row.username);
  const source = unlimitedSource(envUnlimited, dbUnlimited);
  return {
    id: String(row.id),
    username: row.username,
    createdAt: iso(row.created_at) ?? '',
    askCount: Number(row.ask_count ?? 0),
    quotaLimit: Number(row.quota_limit),
    unlimited: accountIsUnlimited(envUnlimited, dbUnlimited),
    unlimitedSource: source,
    disabledAt: iso(row.disabled_at),
    lastAskAt: iso(row.last_ask_at),
  };
}

export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    await ensureBackendSchema();
    const db = getDb();
    const rows = await db<UserRow[]>`
      SELECT
        u.id,
        u.username,
        u.created_at,
        u.quota_limit,
        u.unlimited,
        u.disabled_at,
        COALESCE(c.count, 0) AS ask_count,
        c.updated_at AS last_ask_at
      FROM app_users u
      LEFT JOIN ask_counters c ON c.subject_key = 'user:' || u.username_key
      ORDER BY u.created_at DESC
      LIMIT 500
    `;
    const items = rows.map(mapUser);
    return Response.json({ items }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const body = await readObject(request);
    const id = uuid(body.id, 'id');
    const action = typeof body.action === 'string' ? body.action : '';
    let quotaLimit: number | undefined;
    let unlimited: boolean | undefined;
    let disabled: boolean | undefined;
    if (action === 'set_quota') {
      try {
        quotaLimit = parseQuotaLimit(body.quotaLimit);
      } catch (error) {
        throw new ApiError(400, error instanceof Error ? error.message : '额度须为正整数');
      }
    } else if (action === 'set_unlimited') {
      if (typeof body.unlimited !== 'boolean') throw new ApiError(400, 'unlimited 须为布尔值');
      unlimited = body.unlimited;
    } else if (action === 'set_disabled') {
      if (typeof body.disabled !== 'boolean') throw new ApiError(400, 'disabled 须为布尔值');
      disabled = body.disabled;
    } else if (action === 'reset_password') {
      // validated below after schema; no extra fields
    } else {
      throw new ApiError(400, '操作无效');
    }

    await ensureBackendSchema();
    const db = getDb();
    if (action === 'set_quota') {
      const rows = await db`UPDATE app_users SET quota_limit=${quotaLimit!}, updated_at=NOW() WHERE id=${id} RETURNING id`;
      if (!rows.length) throw new ApiError(404, '用户不存在');
    } else if (action === 'set_unlimited') {
      const rows = await db`UPDATE app_users SET unlimited=${unlimited!}, updated_at=NOW() WHERE id=${id} RETURNING id`;
      if (!rows.length) throw new ApiError(404, '用户不存在');
    } else if (action === 'reset_password') {
      const temporaryPassword = generateTemporaryPassword();
      const passwordHash = await hashPassword(temporaryPassword);
      const rows = await db<{ username: string }[]>`
        UPDATE app_users SET password_hash=${passwordHash}, updated_at=NOW() WHERE id=${id} RETURNING username
      `;
      if (!rows.length) throw new ApiError(404, '用户不存在');
      return Response.json(
        { ok: true, username: rows[0].username, temporaryPassword },
        { headers: { 'cache-control': 'no-store' } },
      );
    } else if (disabled) {
      const rows = await db`UPDATE app_users SET disabled_at=COALESCE(disabled_at, NOW()), updated_at=NOW() WHERE id=${id} RETURNING id`;
      if (!rows.length) throw new ApiError(404, '用户不存在');
    } else {
      const rows = await db`UPDATE app_users SET disabled_at=NULL, updated_at=NOW() WHERE id=${id} RETURNING id`;
      if (!rows.length) throw new ApiError(404, '用户不存在');
    }
    return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
