import { randomBytes } from 'node:crypto';
import { requireAdmin } from '@/lib/auth';
import { ApiError, apiError, readObject } from '@/lib/api';
import { ensureBackendSchema } from '@/lib/backend-schema';
import { getDb } from '@/lib/db';
import { countMap, isValidSurveyToken } from '@/lib/survey';

export const dynamic = 'force-dynamic';

function createToken(length = 12) {
  return randomBytes(Math.ceil((length * 3) / 4)).toString('base64url').slice(0, length);
}

type InviteRow = {
  id: number;
  token: string;
  note: string | null;
  active: boolean;
  created_at: string;
  response_count: number | string;
};

type ResponseRow = {
  id: number;
  invite_id: number;
  token: string;
  invite_note: string | null;
  nickname: string | null;
  basic: Record<string, unknown>;
  deep: Record<string, unknown> | null;
  created_at: string;
};

export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    await ensureBackendSchema();
    const db = getDb();
    const invites = await db<InviteRow[]>`
      SELECT i.id, i.token, i.note, i.active, i.created_at,
        COALESCE(COUNT(r.id), 0)::int AS response_count
      FROM survey_invites i
      LEFT JOIN survey_responses r ON r.invite_id = i.id
      GROUP BY i.id
      ORDER BY i.created_at DESC
      LIMIT 200
    `;
    const responses = await db<ResponseRow[]>`
      SELECT r.id, r.invite_id, i.token, i.note AS invite_note, r.nickname, r.basic, r.deep, r.created_at
      FROM survey_responses r
      JOIN survey_invites i ON i.id = r.invite_id
      ORDER BY r.created_at DESC
      LIMIT 200
    `;

    const basics = responses.map((row) => row.basic ?? {});
    const deeps = responses.map((row) => row.deep).filter(Boolean) as Array<Record<string, unknown>>;
    const d4All: string[] = [];
    for (const deep of deeps) {
      const d4 = deep.d4 as { choices?: string[] } | undefined;
      if (d4?.choices) d4All.push(...d4.choices);
    }
    const d4Counts = countMap(d4All);
    const d4Top = Object.entries(d4Counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
      .slice(0, 7)
      .map(([label, count]) => ({ label, count }));

    const b1Values: Array<string | null | undefined> = [];
    for (const b of basics) {
      if (Array.isArray(b.b1)) {
        for (const item of b.b1) {
          if (typeof item === 'string') b1Values.push(item);
        }
      } else if (typeof b.b1 === 'string') {
        b1Values.push(b.b1);
      }
    }
    const b6Values = basics.map((b) => {
      const b6 = b.b6;
      if (!b6 || typeof b6 !== 'object' || Array.isArray(b6)) return null;
      const choice = (b6 as Record<string, unknown>).choice;
      const product = (b6 as Record<string, unknown>).product;
      if (choice === '用过') {
        return typeof product === 'string' && product.trim() ? `用过:${product.trim()}` : '用过';
      }
      return typeof choice === 'string' ? choice : null;
    });
    const summary = {
      responseCount: responses.length,
      deepCount: deeps.length,
      b1: countMap(b1Values),
      b2: countMap(basics.map((b) => typeof b.b2 === 'string' ? b.b2 : null)),
      b3: countMap(basics.map((b) => typeof b.b3 === 'string' ? b.b3 : null)),
      b4: countMap(basics.map((b) => typeof b.b4 === 'string' ? b.b4 : null)),
      b5: countMap(basics.map((b) => typeof b.b5 === 'string' ? b.b5 : null)),
      b6: countMap(b6Values),
      d4Top,
    };

    return Response.json({
      invites: invites.map((row) => ({
        id: row.id,
        token: row.token,
        note: row.note,
        active: row.active,
        createdAt: row.created_at,
        responseCount: Number(row.response_count) || 0,
        path: `/survey/${row.token}`,
      })),
      summary,
      responses: responses.map((row) => ({
        id: row.id,
        inviteId: row.invite_id,
        token: row.token,
        inviteNote: row.invite_note,
        nickname: row.nickname,
        basic: row.basic,
        deep: row.deep,
        createdAt: row.created_at,
      })),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    await ensureBackendSchema();
    const body = await readObject(request);
    let note: string | null = null;
    if (typeof body.note === 'string') {
      const trimmed = body.note.trim();
      if (trimmed) {
        if (trimmed.length > 120) throw new ApiError(400, '备注最多 120 字');
        note = trimmed;
      }
    }

    const db = getDb();
    let token = '';
    let row: { id: number; token: string; note: string | null; active: boolean; created_at: string } | undefined;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      token = createToken(12);
      try {
        const inserted = await db<Array<{
          id: number; token: string; note: string | null; active: boolean; created_at: string;
        }>>`
          INSERT INTO survey_invites (token, note)
          VALUES (${token}, ${note})
          RETURNING id, token, note, active, created_at
        `;
        row = inserted[0];
        break;
      } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        if (code === '23505') continue; // unique_violation
        throw error;
      }
    }
    if (!row) throw new ApiError(500, '生成邀请失败，请重试');

    return Response.json({
      ok: true,
      invite: {
        id: row.id,
        token: row.token,
        note: row.note,
        active: row.active,
        createdAt: row.created_at,
        responseCount: 0,
        path: `/survey/${row.token}`,
      },
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    await ensureBackendSchema();
    const body = await readObject(request);
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!isValidSurveyToken(token)) throw new ApiError(400, 'token 无效');

    const hasActive = typeof body.active === 'boolean';
    const hasNote = Object.prototype.hasOwnProperty.call(body, 'note');
    if (!hasActive && !hasNote) throw new ApiError(400, '缺少更新字段');

    let note: string | null | undefined;
    if (hasNote) {
      if (body.note === null) {
        note = null;
      } else if (typeof body.note === 'string') {
        const trimmed = body.note.trim();
        if (trimmed.length > 120) throw new ApiError(400, '备注最多 120 字');
        note = trimmed || null;
      } else {
        throw new ApiError(400, 'note 须为字符串');
      }
    }

    const db = getDb();
    let rows: Array<{
      id: number; token: string; note: string | null; active: boolean; created_at: string;
    }>;
    if (hasActive && hasNote) {
      rows = await db`
        UPDATE survey_invites
        SET active = ${body.active as boolean}, note = ${note as string | null}
        WHERE token = ${token}
        RETURNING id, token, note, active, created_at
      `;
    } else if (hasActive) {
      rows = await db`
        UPDATE survey_invites
        SET active = ${body.active as boolean}
        WHERE token = ${token}
        RETURNING id, token, note, active, created_at
      `;
    } else {
      rows = await db`
        UPDATE survey_invites
        SET note = ${note as string | null}
        WHERE token = ${token}
        RETURNING id, token, note, active, created_at
      `;
    }
    if (!rows.length) throw new ApiError(404, '邀请不存在');
    const row = rows[0]!;
    return Response.json({
      ok: true,
      invite: {
        id: row.id,
        token: row.token,
        note: row.note,
        active: row.active,
        createdAt: row.created_at,
        path: `/survey/${row.token}`,
      },
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
