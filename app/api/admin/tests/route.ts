import { acceptanceStatus, defaultRunTitle } from '@/lib/acceptance-tests';
import { summarizeAcceptanceRun } from '@/lib/acceptance-conclusion';
import { ensureAcceptanceTemplate } from '@/lib/acceptance-template';
import { ApiError, apiError, readObject } from '@/lib/api';
import { ensureBackendSchema } from '@/lib/backend-schema';
import { getDb } from '@/lib/db';
import { matchesDiscardPassword, redactDiscardPasswordCopy } from '@/lib/discard-password';

export const dynamic = 'force-dynamic';

const OPS = new Set([
  'group.create', 'group.rename', 'group.delete',
  'case.create', 'case.update', 'case.delete',
  'run.create', 'run.update', 'run.delete', 'run.summarize',
  'item.update',
]);

type GroupRow = { id: number; name: string; sort: number };
type CaseRow = { id: number; group_id: number; title: string; steps: string; expected: string; sort: number };
type RunRow = {
  id: number;
  title: string;
  note: string;
  created_at: Date | string;
  total: number;
  pass: number;
  fail: number;
  blocked: number;
  pending: number;
};
type ItemRow = {
  id: number;
  group_name: string;
  title: string;
  steps: string;
  expected: string;
  sort: number;
  status: string;
  note: string;
  updated_at: Date | string;
};

function positiveId(value: unknown, name: string) {
  const n = typeof value === 'number' ? value : (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN);
  if (!Number.isSafeInteger(n) || n <= 0) throw new ApiError(400, `${name}无效`);
  return n;
}

function text(value: unknown, name: string, max: number, required: boolean) {
  if (value == null || value === '') {
    if (required) throw new ApiError(400, `请填写${name}`);
    return '';
  }
  if (typeof value !== 'string') throw new ApiError(400, `${name}无效`);
  const trimmed = value.trim();
  if (!trimmed && required) throw new ApiError(400, `请填写${name}`);
  if (trimmed.length > max) throw new ApiError(400, `${name}请控制在 ${max} 字以内`);
  return trimmed;
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function num(value: number | string) {
  return Number(value);
}

async function snapshot() {
  const db = getDb();
  const groups = await db<GroupRow[]>`
    SELECT id, name, sort FROM acceptance_groups ORDER BY sort, id
  `;
  const cases = await db<CaseRow[]>`
    SELECT id, group_id, title, steps, expected, sort FROM acceptance_cases ORDER BY sort, id
  `;
  const runs = await db<RunRow[]>`
    SELECT r.id, r.title, r.note, r.created_at,
      COUNT(i.id)::int AS total,
      COUNT(i.id) FILTER (WHERE i.status = 'pass')::int AS pass,
      COUNT(i.id) FILTER (WHERE i.status = 'fail')::int AS fail,
      COUNT(i.id) FILTER (WHERE i.status = 'blocked')::int AS blocked,
      COUNT(i.id) FILTER (WHERE i.status = 'pending')::int AS pending
    FROM acceptance_runs r
    LEFT JOIN acceptance_run_items i ON i.run_id = r.id
    GROUP BY r.id
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT 100
  `;
  const byGroup = new Map<number, CaseRow[]>();
  for (const item of cases) {
    const key = num(item.group_id);
    const list = byGroup.get(key) ?? [];
    list.push(item);
    byGroup.set(key, list);
  }
  return {
    groups: groups.map((group) => ({
      id: num(group.id),
      name: group.name,
      cases: (byGroup.get(num(group.id)) ?? []).map((item) => ({
        id: num(item.id),
        title: redactDiscardPasswordCopy(item.title),
        steps: redactDiscardPasswordCopy(item.steps),
        expected: redactDiscardPasswordCopy(item.expected),
      })),
    })),
    runs: runs.map((run) => ({
      id: num(run.id),
      title: redactDiscardPasswordCopy(run.title),
      note: redactDiscardPasswordCopy(run.note),
      createdAt: iso(run.created_at),
      total: Number(run.total),
      pass: Number(run.pass),
      fail: Number(run.fail),
      blocked: Number(run.blocked),
      pending: Number(run.pending),
    })),
  };
}

export async function GET(request: Request) {
  try {
    await ensureBackendSchema();
    await ensureAcceptanceTemplate();
    const data = await snapshot();
    const runParam = new URL(request.url).searchParams.get('run');
    if (!runParam) return Response.json(data, { headers: { 'cache-control': 'no-store' } });
    const runId = positiveId(runParam, '测试记录');
    const db = getDb();
    const [run] = await db<{ id: number; title: string; note: string; conclusion: string; created_at: Date | string }[]>`
      SELECT id, title, note, conclusion, created_at FROM acceptance_runs WHERE id = ${runId}
    `;
    if (!run) {
      return Response.json({ ...data, run: null }, { headers: { 'cache-control': 'no-store' } });
    }
    const items = await db<ItemRow[]>`
      SELECT id, group_name, title, steps, expected, sort, status, note, updated_at
      FROM acceptance_run_items
      WHERE run_id = ${runId}
      ORDER BY sort, id
    `;
    return Response.json({
      ...data,
      run: {
        id: num(run.id),
        title: redactDiscardPasswordCopy(run.title),
        note: redactDiscardPasswordCopy(run.note),
        conclusion: redactDiscardPasswordCopy(run.conclusion ?? ''),
        createdAt: iso(run.created_at),
        items: items.map((item) => ({
          id: num(item.id),
          groupName: item.group_name,
          title: redactDiscardPasswordCopy(item.title),
          steps: redactDiscardPasswordCopy(item.steps),
          expected: redactDiscardPasswordCopy(item.expected),
          status: acceptanceStatus(item.status) ?? 'pending',
          note: redactDiscardPasswordCopy(item.note),
          updatedAt: iso(item.updated_at),
        })),
      },
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await readObject(request);
  } catch (error) {
    return apiError(error);
  }
  if (typeof body.op !== 'string' || !OPS.has(body.op)) {
    return Response.json({ error: '操作无效' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
  if (body.op === 'run.delete' && !matchesDiscardPassword(body.password)) {
    return Response.json({ error: '删除密码错误' }, { status: 403, headers: { 'cache-control': 'no-store' } });
  }

  try {
    await ensureBackendSchema();
    await ensureAcceptanceTemplate();
    const db = getDb();
    let runId: number | undefined;
    let conclusion: string | undefined;

    if (body.op === 'group.create') {
      const name = text(body.name, '分组名称', 80, true);
      await db`
        INSERT INTO acceptance_groups (name, sort)
        VALUES (${name}, (SELECT COALESCE(MAX(sort), 0) + 1 FROM acceptance_groups))
      `;
    } else if (body.op === 'group.rename') {
      const id = positiveId(body.id, '分组');
      const name = text(body.name, '分组名称', 80, true);
      const updated = await db`UPDATE acceptance_groups SET name = ${name} WHERE id = ${id} RETURNING id`;
      if (!updated.length) throw new ApiError(404, '分组不存在');
    } else if (body.op === 'group.delete') {
      const id = positiveId(body.id, '分组');
      await db`DELETE FROM acceptance_groups WHERE id = ${id}`;
    } else if (body.op === 'case.create') {
      const groupId = positiveId(body.groupId, '分组');
      const title = redactDiscardPasswordCopy(text(body.title, '用例名称', 200, true));
      const steps = redactDiscardPasswordCopy(text(body.steps, '步骤', 4000, false));
      const expected = redactDiscardPasswordCopy(text(body.expected, '期望', 4000, false));
      const groups = await db`SELECT id FROM acceptance_groups WHERE id = ${groupId}`;
      if (!groups.length) throw new ApiError(404, '分组不存在');
      await db`
        INSERT INTO acceptance_cases (group_id, title, steps, expected, sort)
        VALUES (
          ${groupId}, ${title}, ${steps}, ${expected},
          (SELECT COALESCE(MAX(sort), 0) + 1 FROM acceptance_cases WHERE group_id = ${groupId})
        )
      `;
    } else if (body.op === 'case.update') {
      const id = positiveId(body.id, '用例');
      const title = redactDiscardPasswordCopy(text(body.title, '用例名称', 200, true));
      const steps = redactDiscardPasswordCopy(text(body.steps, '步骤', 4000, false));
      const expected = redactDiscardPasswordCopy(text(body.expected, '期望', 4000, false));
      const updated = await db`
        UPDATE acceptance_cases SET title = ${title}, steps = ${steps}, expected = ${expected}
        WHERE id = ${id} RETURNING id
      `;
      if (!updated.length) throw new ApiError(404, '用例不存在');
    } else if (body.op === 'case.delete') {
      const id = positiveId(body.id, '用例');
      await db`DELETE FROM acceptance_cases WHERE id = ${id}`;
    } else if (body.op === 'run.create') {
      const title = text(body.title, '测试名称', 120, false) || defaultRunTitle();
      runId = await db.begin(async (tx) => {
        const [run] = await tx<{ id: number }[]>`INSERT INTO acceptance_runs (title) VALUES (${title}) RETURNING id`;
        const inserted = await tx`
          INSERT INTO acceptance_run_items (run_id, group_name, title, steps, expected, sort)
          SELECT ${run.id}, g.name, c.title, c.steps, c.expected,
            ROW_NUMBER() OVER (ORDER BY g.sort, g.id, c.sort, c.id)::int
          FROM acceptance_cases c
          JOIN acceptance_groups g ON g.id = c.group_id
          RETURNING id
        `;
        if (!inserted.length) throw new ApiError(400, '先添加测试用例');
        return num(run.id);
      });
    } else if (body.op === 'run.update') {
      const id = positiveId(body.id, '测试记录');
      const title = redactDiscardPasswordCopy(text(body.title, '测试名称', 120, true));
      const note = redactDiscardPasswordCopy(text(body.note, '整轮说明', 4000, false));
      const conclusionText = redactDiscardPasswordCopy(text(body.conclusion, '测试结论', 4000, false));
      const updated = await db`
        UPDATE acceptance_runs SET title = ${title}, note = ${note}, conclusion = ${conclusionText}
        WHERE id = ${id} RETURNING id
      `;
      if (!updated.length) throw new ApiError(404, '测试记录不存在');
      runId = id;
    } else if (body.op === 'run.summarize') {
      const id = positiveId(body.id, '测试记录');
      conclusion = await summarizeAcceptanceRun(id);
      runId = id;
    } else if (body.op === 'run.delete') {
      const id = positiveId(body.id, '测试记录');
      await db`DELETE FROM acceptance_runs WHERE id = ${id}`;
    } else if (body.op === 'item.update') {
      const id = positiveId(body.id, '用例');
      const status = acceptanceStatus(body.status);
      if (!status) throw new ApiError(400, '结果状态无效');
      const note = redactDiscardPasswordCopy(text(body.note, '记录', 4000, false));
      const updated = await db<{ run_id: number }[]>`
        UPDATE acceptance_run_items
        SET status = ${status}, note = ${note}, updated_at = NOW()
        WHERE id = ${id}
        RETURNING run_id
      `;
      if (!updated.length) throw new ApiError(404, '用例不存在');
      runId = num(updated[0].run_id);
    }

    return Response.json({ ok: true, runId, conclusion }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
