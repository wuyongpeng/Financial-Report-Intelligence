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
    return Response.json(
      { ok: true, active: true, token: invite.token },
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
      { ok: true, id: row.id, createdAt: row.created_at },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}
