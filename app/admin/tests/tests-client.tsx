'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ACCEPTANCE_STATUSES, ACCEPTANCE_STATUS_LABEL, RUN_PHASE_ACTION, RUN_PHASE_LABEL, runPhase, type AcceptanceStatus } from '@/lib/acceptance-tests';
import { AdminHeader, AdminMain, adminStyles as s } from '../_components/admin-shell';

type CaseItem = { id: number; title: string; steps: string; expected: string };
type GroupItem = { id: number; name: string; cases: CaseItem[] };
type RunItem = {
  id: number;
  title: string;
  note: string;
  createdAt: string;
  total: number;
  pass: number;
  fail: number;
  blocked: number;
  pending: number;
};
type ResultItem = {
  id: number;
  groupName: string;
  title: string;
  steps: string;
  expected: string;
  status: AcceptanceStatus;
  note: string;
  updatedAt: string;
};
type RunDetail = { id: number; title: string; note: string; conclusion: string; createdAt: string; items: ResultItem[] };
type Payload = { groups: GroupItem[]; runs: RunItem[]; run?: RunDetail | null };

const STATUS_COLOR: Record<AcceptanceStatus, string> = {
  pending: '#5b6d86',
  pass: '#15803d',
  fail: '#b91c1c',
  blocked: '#b45309',
};

function fmtTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
}

async function call(body: Record<string, unknown>) {
  const res = await fetch('/api/admin/tests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as { error?: string; runId?: number; conclusion?: string };
  if (!res.ok) throw new Error(data.error || '保存失败');
  return data;
}

export function TestsAdminClient() {
  const router = useRouter();
  const search = useSearchParams();
  const tab = search.get('tab') === 'runs' ? 'runs' : 'template';
  const runParam = Number(search.get('run'));
  const activeRunId = tab === 'runs' && Number.isSafeInteger(runParam) && runParam > 0 ? runParam : null;

  const [data, setData] = useState<Payload>({ groups: [], runs: [] });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteRunId, setDeleteRunId] = useState<number | null>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const go = useCallback((next: { tab: 'template' | 'runs'; run?: number | null }) => {
    const q = new URLSearchParams();
    if (next.tab === 'runs') q.set('tab', 'runs');
    if (next.tab === 'runs' && next.run) q.set('run', String(next.run));
    const qs = q.toString();
    router.replace(qs ? `/admin/tests?${qs}` : '/admin/tests', { scroll: false });
  }, [router]);

  const load = useCallback(async (runId: number | null) => {
    setLoading(true);
    try {
      const res = await fetch(runId ? `/api/admin/tests?run=${runId}` : '/api/admin/tests', { cache: 'no-store' });
      const body = await res.json().catch(() => ({})) as Payload & { error?: string };
      if (!res.ok) throw new Error(body.error || '加载失败');
      setData(body);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(activeRunId); }, [activeRunId, load]);

  const caseCount = useMemo(
    () => data.groups.reduce((sum, group) => sum + group.cases.length, 0),
    [data.groups],
  );

  async function act(body: Record<string, unknown>, follow?: (result: { runId?: number }) => number | null | undefined) {
    setBusy(true);
    setError('');
    try {
      const result = await call(body);
      const nextRun = follow?.(result);
      await load(nextRun === undefined ? activeRunId : nextRun);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveItem(item: { id: number; status: AcceptanceStatus; note: string }) {
    setError('');
    try {
      await call({ op: 'item.update', id: item.id, status: item.status, note: item.note });
      setData((prev) => {
        if (!prev.run) return prev;
        const items = prev.run.items.map((row) => (
          row.id === item.id ? { ...row, status: item.status, note: item.note } : row
        ));
        const counts = { pass: 0, fail: 0, blocked: 0, pending: 0 };
        for (const row of items) counts[row.status] += 1;
        const runId = prev.run.id;
        return {
          ...prev,
          run: { ...prev.run, items },
          runs: prev.runs.map((entry) => (
            entry.id === runId ? { ...entry, ...counts, total: items.length } : entry
          )),
        };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    }
  }

  async function confirmDelete() {
    if (!deleteRunId) return;
    if (!password) {
      setPasswordError('请输入删除密码');
      return;
    }
    setBusy(true);
    setPasswordError('');
    try {
      await call({ op: 'run.delete', id: deleteRunId, password });
      setDeleteRunId(null);
      setPassword('');
      if (activeRunId === deleteRunId) go({ tab: 'runs' });
      else await load(activeRunId);
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }

  const run = data.run ?? null;

  return (
    <AdminMain>
      <AdminHeader title="验收测试" subtitle="验收测试" activeHref="/admin/tests" />
      {error ? <p style={s.err}>{error}</p> : null}
      <div style={tabRow}>
        <button type="button" style={pageTab(tab === 'template')} onClick={() => go({ tab: 'template' })}>测试例</button>
        <button type="button" style={pageTab(tab === 'runs')} onClick={() => go({ tab: 'runs' })}>测试过程</button>
      </div>

      {tab === 'template' ? (
        <section>
          <div style={toolbar}>
            <button
              type="button"
              style={s.btn}
              disabled={busy || caseCount === 0}
              onClick={() => void act({ op: 'run.create' }, (result) => {
                if (!result.runId) return null;
                go({ tab: 'runs', run: result.runId });
                return result.runId;
              })}
            >
              新建测试
            </button>
            <span style={s.muted}>这一整套共 {caseCount} 条。新建测试会在「测试过程」里生成一行，记下全部条目的实测。</span>
          </div>
          {data.groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              busy={busy}
              onRename={(name) => act({ op: 'group.rename', id: group.id, name })}
              onDelete={() => {
                if (window.confirm(`删除分组「${group.name}」及其条目？已生成的测试过程不会改。`)) void act({ op: 'group.delete', id: group.id });
              }}
              onAdd={(title, steps, expected) => act({ op: 'case.create', groupId: group.id, title, steps, expected })}
              onSaveCase={(item) => act({ op: 'case.update', ...item })}
              onDeleteCase={(item) => {
                if (window.confirm(`从这套测试例里删掉「${item.title}」？`)) void act({ op: 'case.delete', id: item.id });
              }}
            />
          ))}
          <AddGroup busy={busy} onAdd={(name) => act({ op: 'group.create', name })} />
          {loading && data.groups.length === 0 ? <p style={s.muted}>加载中…</p> : null}
        </section>
      ) : (
        <section>
          <p style={{ ...s.muted, marginTop: 0 }}>每一行是一整轮，记录这一整套全部条目的实测。点开后逐条填写结果。删除删的是整行。</p>
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>时间</th>
                  <th style={s.th}>这一整轮</th>
                  <th style={s.th}>状态</th>
                  <th style={s.th}>整套结果</th>
                  <th style={s.th}>操作</th>
                </tr>
              </thead>
              <tbody>
                {!loading && data.runs.length === 0 ? (
                  <tr><td colSpan={5} style={{ ...s.td, color: '#8b97a9' }}>还没有。到「测试例」点新建测试，会把整套记成这里的一行。</td></tr>
                ) : null}
                {data.runs.map((item) => {
                  const done = item.pass + item.fail + item.blocked;
                  const open = item.id === activeRunId;
                  const phase = runPhase(item);
                  return (
                    <tr key={item.id} style={open ? { background: '#f3f7ff' } : undefined}>
                      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{fmtTime(item.createdAt)}</td>
                      <td style={s.td}>{item.title}</td>
                      <td style={s.td}><span style={phaseBadge(phase)}>{RUN_PHASE_LABEL[phase]}</span></td>
                      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                        {item.total} 条里已记 {done}，未通过 {item.fail}，未测 {item.pending}
                      </td>
                      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                        <button type="button" style={textAct} onClick={() => go(open ? { tab: 'runs' } : { tab: 'runs', run: item.id })}>{open ? '收起' : RUN_PHASE_ACTION[phase]}</button>
                        <button type="button" style={{ ...textAct, color: '#b91c1c' }} onClick={() => { setPassword(''); setPasswordError(''); setDeleteRunId(item.id); }}>删除整行</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {activeRunId ? (
            <RunDetailView
              run={run}
              loading={loading}
              busy={busy}
              onSave={(title, note, conclusion) => act({ op: 'run.update', id: activeRunId, title, note, conclusion })}
              onSummarize={async () => {
                const result = await call({ op: 'run.summarize', id: activeRunId });
                if (result.conclusion) {
                  setData((prev) => prev.run ? { ...prev, run: { ...prev.run, conclusion: result.conclusion ?? '' } } : prev);
                }
                return result.conclusion ?? '';
              }}
              onItem={(item) => saveItem(item)}
              onDelete={() => { setPassword(''); setPasswordError(''); setDeleteRunId(activeRunId); }}
            />
          ) : null}
        </section>
      )}

      {deleteRunId ? (
        <div style={mask} onClick={() => setDeleteRunId(null)}>
          <div role="dialog" aria-label="确认删除测试记录" style={dialog} onClick={(event) => event.stopPropagation()}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>删除整轮测试记录？</h3>
            <p style={{ ...s.muted, margin: '0 0 10px' }}>删除后不能恢复。请输入删除密码。</p>
            <input
              type="password"
              autoComplete="off"
              placeholder="删除密码"
              value={password}
              onChange={(event) => { setPassword(event.target.value); setPasswordError(''); }}
              onKeyDown={(event) => { if (event.key === 'Enter') void confirmDelete(); }}
              style={{ ...s.input, width: '100%', boxSizing: 'border-box' }}
            />
            {passwordError ? <p style={{ ...s.err, margin: '8px 0 0' }}>{passwordError}</p> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button type="button" style={textAct} onClick={() => setDeleteRunId(null)}>取消</button>
              <button type="button" style={{ ...textAct, color: '#b91c1c' }} disabled={busy} onClick={() => void confirmDelete()}>删除</button>
            </div>
          </div>
        </div>
      ) : null}
    </AdminMain>
  );
}

function AddGroup({ busy, onAdd }: { busy: boolean; onAdd: (name: string) => Promise<boolean> }) {
  const [name, setName] = useState('');
  return (
    <form
      style={{ ...toolbar, marginTop: 12 }}
      onSubmit={(event) => {
        event.preventDefault();
        const next = name.trim();
        if (!next) return;
        void onAdd(next).then((ok) => { if (ok) setName(''); });
      }}
    >
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="新分组名称" style={{ ...s.input, width: 240 }} />
      <button type="submit" style={s.btn} disabled={busy || !name.trim()}>添加分组</button>
    </form>
  );
}

function GroupCard({
  group, busy, onRename, onDelete, onAdd, onSaveCase, onDeleteCase,
}: {
  group: GroupItem;
  busy: boolean;
  onRename: (name: string) => Promise<boolean>;
  onDelete: () => void;
  onAdd: (title: string, steps: string, expected: string) => Promise<boolean>;
  onSaveCase: (item: CaseItem) => Promise<boolean>;
  onDeleteCase: (item: CaseItem) => void;
}) {
  const [editing, setEditing] = useState<CaseItem | 'new' | null>(null);
  const [renaming, setRenaming] = useState(false);
  return (
    <section style={groupBox}>
      <div style={toolbar}>
        <h3 style={groupTitle}>{group.name}</h3>
        <button type="button" style={textAct} onClick={() => setRenaming(true)}>编辑</button>
        <button type="button" style={s.btnGhost} onClick={() => setEditing('new')}>添加用例</button>
        <button type="button" style={{ ...textAct, color: '#b91c1c' }} onClick={onDelete}>删除分组</button>
      </div>
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>用例</th>
              <th style={s.th}>测试步骤</th>
              <th style={s.th}>期望</th>
              <th style={s.th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {group.cases.length === 0 ? (
              <tr><td colSpan={4} style={{ ...s.td, color: '#8b97a9' }}>这个分组还没有用例</td></tr>
            ) : null}
            {group.cases.map((item) => (
              <tr key={item.id}>
                <td style={{ ...s.td, whiteSpace: 'pre-wrap', fontWeight: 650 }}>{item.title}</td>
                <td style={{ ...s.td, whiteSpace: 'pre-wrap' }}>{item.steps || '—'}</td>
                <td style={{ ...s.td, whiteSpace: 'pre-wrap' }}>{item.expected || '—'}</td>
                <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                  <button type="button" style={textAct} onClick={() => setEditing(item)}>编辑</button>
                  <button type="button" style={{ ...textAct, color: '#b91c1c' }} onClick={() => onDeleteCase(item)}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing ? (
        <CaseEditDialog
          heading={editing === 'new' ? '添加用例' : '编辑用例'}
          initial={editing === 'new' ? { title: '', steps: '', expected: '' } : editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onConfirm={async (value) => {
            if (editing === 'new') return onAdd(value.title, value.steps, value.expected);
            return onSaveCase({ id: editing.id, ...value });
          }}
        />
      ) : null}
      {renaming ? (
        <NameDialog
          heading="编辑分组"
          initial={group.name}
          busy={busy}
          onClose={() => setRenaming(false)}
          onConfirm={onRename}
        />
      ) : null}
    </section>
  );
}

function CaseEditDialog({
  heading, initial, busy, onClose, onConfirm,
}: {
  heading: string;
  initial: { title: string; steps: string; expected: string };
  busy: boolean;
  onClose: () => void;
  onConfirm: (value: { title: string; steps: string; expected: string }) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(initial.title);
  const [steps, setSteps] = useState(initial.steps);
  const [expected, setExpected] = useState(initial.expected);
  const [localError, setLocalError] = useState('');
  return (
    <div style={mask} onClick={onClose}>
      <div role="dialog" aria-label={heading} style={{ ...dialog, width: 'min(480px, calc(100vw - 32px))' }} onClick={(event) => event.stopPropagation()}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>{heading}</h3>
        <label style={fieldLabel}>用例</label>
        <input value={title} onChange={(event) => setTitle(event.target.value)} style={{ ...s.input, width: '100%', boxSizing: 'border-box', marginBottom: 10 }} />
        <label style={fieldLabel}>测试步骤</label>
        <textarea value={steps} onChange={(event) => setSteps(event.target.value)} rows={4} style={{ ...area, marginBottom: 10 }} />
        <label style={fieldLabel}>期望</label>
        <textarea value={expected} onChange={(event) => setExpected(event.target.value)} rows={3} style={area} />
        {localError ? <p style={{ ...s.err, margin: '8px 0 0' }}>{localError}</p> : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button type="button" style={textAct} onClick={onClose}>取消</button>
          <button
            type="button"
            style={s.btn}
            disabled={busy}
            onClick={() => {
              if (!title.trim()) {
                setLocalError('请填写用例');
                return;
              }
              void onConfirm({ title: title.trim(), steps: steps.trim(), expected: expected.trim() }).then((ok) => {
                if (ok) onClose();
              });
            }}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
}

function NameDialog({
  heading, initial, busy, onClose, onConfirm,
}: {
  heading: string;
  initial: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(initial);
  return (
    <div style={mask} onClick={onClose}>
      <div role="dialog" aria-label={heading} style={dialog} onClick={(event) => event.stopPropagation()}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>{heading}</h3>
        <input value={name} onChange={(event) => setName(event.target.value)} style={{ ...s.input, width: '100%', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button type="button" style={textAct} onClick={onClose}>取消</button>
          <button
            type="button"
            style={s.btn}
            disabled={busy || !name.trim()}
            onClick={() => { void onConfirm(name.trim()).then((ok) => { if (ok) onClose(); }); }}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
}

function RunDetailView({
  run, loading, busy, onSave, onSummarize, onItem, onDelete,
}: {
  run: RunDetail | null;
  loading: boolean;
  busy: boolean;
  onSave: (title: string, note: string, conclusion: string) => Promise<boolean>;
  onSummarize: () => Promise<string>;
  onItem: (item: { id: number; status: AcceptanceStatus; note: string }) => Promise<void>;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(run?.title ?? '');
  const [note, setNote] = useState(run?.note ?? '');
  const [conclusion, setConclusion] = useState(run?.conclusion ?? '');
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  useEffect(() => {
    setTitle(run?.title ?? '');
    setNote(run?.note ?? '');
    setConclusion(run?.conclusion ?? '');
  }, [run?.id, run?.title, run?.note, run?.conclusion]);

  if (!run) {
    return <p style={s.muted}>{loading ? '加载这一轮…' : '这一轮不存在，可能已经删除。'}</p>;
  }
  const counts = { pending: 0, pass: 0, fail: 0, blocked: 0 };
  for (const item of run.items) counts[item.status] += 1;
  return (
    <section style={{ marginTop: 12 }}>
      <div style={toolbar}>
        <input value={title} onChange={(event) => setTitle(event.target.value)} onBlur={() => { if (title.trim() && (title.trim() !== run.title || note !== run.note || conclusion !== run.conclusion)) void onSave(title.trim(), note, conclusion); }} style={{ ...s.input, fontWeight: 650, width: 280 }} />
        <span style={s.muted}>
          这一整轮共 {run.items.length} 条：通过 {counts.pass} · 未通过 {counts.fail} · 阻塞 {counts.blocked} · 未测 {counts.pending}
        </span>
        <button type="button" style={{ ...textAct, color: '#b91c1c', marginLeft: 'auto' }} onClick={onDelete}>删除整行</button>
      </div>
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => { if (title.trim() && (note !== run.note || title.trim() !== run.title || conclusion !== run.conclusion)) void onSave(title.trim(), note, conclusion); }}
        placeholder="整轮说明，例如环境、版本"
        rows={2}
        style={{ ...area, marginBottom: 12 }}
      />
      <div style={{ ...toolbar, marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 650, color: '#203047' }}>测试结论</span>
        <button
          type="button"
          style={s.btn}
          disabled={summarizing}
          onClick={() => {
            setSummarizing(true);
            setSummaryError('');
            void onSummarize().then((text) => {
              if (text) setConclusion(text);
            }).catch((error: unknown) => {
              setSummaryError(error instanceof Error ? error.message : '汇总失败');
            }).finally(() => setSummarizing(false));
          }}
        >
          {summarizing ? '汇总中…' : (conclusion.trim() ? '重新汇总' : 'AI 汇总')}
        </button>
        {summaryError ? <span style={{ ...s.err, margin: 0 }}>{summaryError}</span> : null}
      </div>
      <textarea
        value={conclusion}
        onChange={(event) => setConclusion(event.target.value)}
        onBlur={() => { if (title.trim() && conclusion !== run.conclusion) void onSave(title.trim(), note, conclusion); }}
        placeholder="写这一整轮的结论，或点 AI 汇总"
        rows={4}
        style={{ ...area, marginBottom: 12 }}
      />
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>分组</th>
              <th style={s.th}>这一轮里的一条</th>
              <th style={s.th}>测试步骤 / 期望</th>
              <th style={s.th}>本轮结果</th>
              <th style={s.th}>记录</th>
            </tr>
          </thead>
          <tbody>
            {run.items.map((item) => (
              <ResultRow key={item.id} item={item} busy={busy} onItem={onItem} />
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ ...s.muted, marginTop: 8 }}>开始于 {fmtTime(run.createdAt)}。上面这些行都属于这一整轮。点结果会立即保存，记录在离开输入框时保存。</p>
    </section>
  );
}

function ResultRow({
  item, busy, onItem,
}: {
  item: ResultItem;
  busy: boolean;
  onItem: (item: { id: number; status: AcceptanceStatus; note: string }) => Promise<void>;
}) {
  const [note, setNote] = useState(item.note);
  return (
    <tr>
      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{item.groupName}</td>
      <td style={{ ...s.td, fontWeight: 650 }}>{item.title}</td>
      <td style={{ ...s.td, maxWidth: 320 }}>
        <div style={{ whiteSpace: 'pre-wrap' }}>{item.steps || '—'}</div>
        <div style={{ ...s.muted, whiteSpace: 'pre-wrap', marginTop: 4 }}>期望：{item.expected || '—'}</div>
      </td>
      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {ACCEPTANCE_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              disabled={busy}
              style={statusBtn(item.status === status, STATUS_COLOR[status])}
              onClick={() => {
                if (item.status === status) return;
                const next = note.trim();
                setNote(next);
                void onItem({ id: item.id, status, note: next });
              }}
            >
              {ACCEPTANCE_STATUS_LABEL[status]}
            </button>
          ))}
        </div>
      </td>
      <td style={{ ...s.td, minWidth: 180 }}>
        <textarea
          value={note}
          rows={3}
          placeholder="现象、链接、复现"
          style={area}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => {
            const next = note.trim();
            setNote(next);
            if (next !== item.note) void onItem({ id: item.id, status: item.status, note: next });
          }}
        />
      </td>
    </tr>
  );
}

const pageTab = (active: boolean): CSSProperties => ({
  fontSize: 14,
  color: active ? '#1f4fad' : '#5b6d86',
  background: 'transparent',
  border: 'none',
  borderBottom: active ? '2px solid #1f4fad' : '2px solid transparent',
  borderRadius: 0,
  padding: '8px 2px',
  marginRight: 16,
  fontWeight: active ? 600 : 500,
  cursor: 'pointer',
  lineHeight: 1.2,
});
const tabRow: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  marginBottom: 14,
  borderBottom: '1px solid #e5eaf1',
};
const toolbar: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 };
const groupTitle: CSSProperties = { margin: 0, fontSize: 15, color: '#203047' };
const fieldLabel: CSSProperties = { display: 'block', marginBottom: 4, fontSize: 12, color: '#5b6d86' };
const groupBox: CSSProperties = { border: '1px solid #e5eaf1', borderRadius: 12, background: '#fff', padding: 12, marginBottom: 12 };
const area: CSSProperties = {
  width: '100%', boxSizing: 'border-box', border: '1px solid #d5dde8', borderRadius: 8,
  padding: '6px 8px', fontSize: 13, color: '#203047', fontFamily: 'inherit', resize: 'vertical',
};
const textAct: CSSProperties = {
  border: 0, background: 'transparent', padding: '0 6px', fontSize: 12, fontWeight: 600, color: '#1f4fad', cursor: 'pointer',
};
const mask: CSSProperties = { position: 'fixed', inset: 0, background: '#12213f66', display: 'grid', placeItems: 'center', zIndex: 50 };
const dialog: CSSProperties = { width: 320, background: '#fff', borderRadius: 12, padding: 16 };

function phaseBadge(phase: ReturnType<typeof runPhase>): CSSProperties {
  const tone = phase === 'done'
    ? { color: '#15803d', background: '#e9f7ef' }
    : phase === 'running'
      ? { color: '#1f4fad', background: '#e8f0ff' }
      : { color: '#5b6d86', background: '#f4f6f9' };
  return {
    ...tone,
    display: 'inline-block',
    borderRadius: 999,
    padding: '2px 8px',
    fontSize: 12,
    fontWeight: 650,
    whiteSpace: 'nowrap',
  };
}

function statusBtn(active: boolean, color: string): CSSProperties {
  return {
    border: `1px solid ${active ? color : '#d5dde8'}`,
    background: active ? color : '#fff',
    color: active ? '#fff' : color,
    borderRadius: 6,
    padding: '3px 8px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  };
}
