import { apiError, ApiError, readObject, requiredText } from '@/lib/api';
import { generateHomeAskAnswer } from '@/lib/home-ask';
import type { HomeRosterRow } from '@/lib/home-roster-snapshot';

export const dynamic = 'force-dynamic';

function parseRows(value: unknown): HomeRosterRow[] {
  if (!Array.isArray(value)) return [];
  const out: HomeRosterRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const code = typeof row.code === 'string' ? row.code.trim() : '';
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!/^\d{6}$/.test(code) || !name) continue;
    const industryGroup = typeof row.industryGroup === 'string' ? row.industryGroup : '其他';
    const reportPeriod = typeof row.reportPeriod === 'string' ? row.reportPeriod : null;
    const flags = Array.isArray(row.flags)
      ? row.flags.filter((f): f is string => typeof f === 'string').slice(0, 8)
      : [];
    out.push({ code, name, industryGroup, reportPeriod, flags });
    if (out.length >= 80) break;
  }
  return out;
}

function parseHistory(value: unknown): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const role = row.role === 'user' || row.role === 'assistant' ? row.role : null;
    const content = typeof row.content === 'string' ? row.content.trim() : '';
    if (!role || !content || content.length > 800) continue;
    out.push({ role, content });
    if (out.length >= 8) break;
  }
  return out;
}

export async function POST(request: Request) {
  try {
    const body = await readObject(request);
    const question = requiredText(body.question, 'question', 400);
    const rosterSnapshot = requiredText(body.rosterSnapshot, 'rosterSnapshot', 8_000);
    const rows = parseRows(body.rows);
    if (!rows.length && !rosterSnapshot.includes('清单为空')) {
      // Allow empty roster asks; snapshot may still describe empty state.
    }
    const history = parseHistory(body.history);
    const result = await generateHomeAskAnswer({
      question,
      rosterSnapshot,
      rows,
      history,
    });
    return Response.json(
      { answer: result.answer, openCode: result.openCode ?? null, mode: result.mode },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof ApiError) return apiError(error);
    return apiError(error);
  }
}
