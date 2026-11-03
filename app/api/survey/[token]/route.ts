import { ApiError, apiError, readObject } from '@/lib/api';
import { ensureBackendSchema } from '@/lib/backend-schema';
import { getDb } from '@/lib/db';
import { isValidSurveyToken, parseSurveySubmission } from '@/lib/survey';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ token: string }> };

async function loadInvite(token: string) {
  if (!isValidSurveyToken(token)) throw new ApiError(404, '链接无效或已失效');
  await ensureBackendSchema();
  const db = getDb();
  const rows = await db<Array<{ id: number; token: string; active: boolean }>>`
    SELECT id, token, active FROM survey_invites WHERE token = ${token} LIMIT 1
  `;
  const row = rows[0];
  if (!row) throw new ApiError(404, '链接无效或已失效');
  return row;
}

export async function GET(_request: Request, context: Context) {
  try {
    const { token } = await context.params;
    const invite = await loadInvite(token);
    if (!invite.active) {
      return Response.json(
        { ok: false, active: false, error: '此调研链接已关闭' },
        { status: 410, headers: { 'cache-control': 'no-store' } },
      );
    }
    const db = getDb();
    const existing = await db<Array<{
      id: number;
      nickname: string | null;
      basic: Record<string, unknown>;
      deep: Record<string, unknown> | null;
      created_at: string;
    }>>`
      SELECT id, nickname, basic, deep, created_at
      FROM survey_responses
      WHERE invite_id = ${invite.id}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const row = existing[0];
    if (!row) {
      return Response.json(
        { ok: true, active: true, token: invite.token, submitted: false },
        { headers: { 'cache-control': 'no-store' } },
      );
    }
    return Response.json(
      {
        ok: true,
        active: true,
        token: invite.token,
        submitted: true,
        submission: {
          id: row.id,
          nickname: row.nickname,
          basic: row.basic,
          deep: row.deep,
          createdAt: row.created_at,
        },
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { token } = await context.params;
    const invite = await loadInvite(token);
    if (!invite.active) throw new ApiError(410, '此调研链接已关闭');

    const body = await readObject(request);
    const parsed = parseSurveySubmission(body);
    const db = getDb();

    const existing = await db<Array<{ id: number }>>`
      SELECT id FROM survey_responses
      WHERE invite_id = ${invite.id}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (existing[0]) {
      const [row] = await db<Array<{ id: number; created_at: string }>>`
        UPDATE survey_responses
        SET
          nickname = ${parsed.nickname},
          basic = ${db.json(parsed.basic)},
          deep = ${parsed.deep ? db.json(parsed.deep) : null}
        WHERE id = ${existing[0].id}
        RETURNING id, created_at
      `;
      return Response.json(
        { ok: true, id: row.id, createdAt: row.created_at, updated: true },
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    const [row] = await db<Array<{ id: number; created_at: string }>>`
      INSERT INTO survey_responses (invite_id, nickname, basic, deep)
      VALUES (
        ${invite.id},
        ${parsed.nickname},
        ${db.json(parsed.basic)},
        ${parsed.deep ? db.json(parsed.deep) : null}
      )
      RETURNING id, created_at
    `;
    return Response.json(
      { ok: true, id: row.id, createdAt: row.created_at, updated: false },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}
