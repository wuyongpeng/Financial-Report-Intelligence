'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  AdminHeader,
  AdminHelpTip,
  AdminMain,
  adminStyles as s,
} from '../_components/admin-shell';
import {
  CHECK_METRICS,
  checkCellMatchesSearch,
  formatConverted,
  METRIC_LABEL,
  type CheckMetric,
  type CheckSummary,
} from '@/lib/metrics-check';
import { checkReviewKey, isPendingCheck, type ManagedCheckCell, type CheckProgressStatus, CHECK_PROGRESS_LABEL, summarizeCheckProgress, type CheckReviewStatus, summarizeCheckReviews } from '@/lib/metrics-check-review';

type CheckPayload = {
  periodNote: string;
  summary: CheckSummary;
  cells: ManagedCheckCell[];
  reviewSummary: ReturnType<typeof summarizeCheckReviews>;
  progressSummary: ReturnType<typeof summarizeCheckProgress>;
  thirdPartyCount: number;
};

export function CheckAdminClient() {
  const [payload, setPayload] = useState<CheckPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [onlyMismatch, setOnlyMismatch] = useState(true);
  const [metricFilter, setMetricFilter] = useState<'' | CheckMetric>('');
  const [codeQuery, setCodeQuery] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [progressFilter, setProgressFilter] = useState<'' | CheckProgressStatus>('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string[]>([]);
  const locks = useRef(new Set<string>());
  const [parses, setParses] = useState<Array<{ id: string; label: string; parsedAt: string | null; started: number; sawParsing: boolean }>>([]);
  const [opsKey, setOpsKey] = useState<string | null>(null);
  const [discardTarget, setDiscardTarget] = useState<ManagedCheckCell | null>(null);
  const [discardPassword, setDiscardPassword] = useState('');
  const [discardPasswordError, setDiscardPasswordError] = useState('');
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/check', { cache: 'no-store', credentials: 'same-origin' });
      if (generation !== loadGeneration.current) return;
      if (res.status === 401) {
        setError('加载失败：未授权');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || '加载失败');
      }
      const next = await res.json() as CheckPayload;
      if (generation === loadGeneration.current) setPayload(next);
    } catch (e) {
      if (generation === loadGeneration.current) setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);


  const lock = (key: string) => {
    if (locks.current.has(key)) return false;
    locks.current.add(key);
    setBusy([...locks.current]);
    return true;
  };
  const unlock = (key: string) => { locks.current.delete(key); setBusy([...locks.current]); };

  const reviewRow = async (cell: ManagedCheckCell, status: CheckReviewStatus) => {
    const key = checkReviewKey(cell);
    if (!lock(key)) return;
    setActionMsg('');
    try {
      const res = await fetch('/api/admin/check', { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: cell.code, period: cell.period, metric: cell.metric, fingerprint: cell.fingerprint, status }) });
      const body = await res.json() as { error?: string };
      if (!res.ok) throw new Error(body.error || '审核失败');
      setActionMsg(`${cell.code} ${cell.period} ${cell.metricLabel}：${status === 'approved' ? '已审核通过' : '已标记异常'}`);
      await load();
    } catch (error) {
      setActionMsg(error instanceof Error ? error.message : '审核失败');
      await load();
    } finally { unlock(key); }
  };

  const noteKey = (cell: ManagedCheckCell) => `${checkReviewKey(cell)}:${cell.fingerprint}`;
  const currentNote = (cell: ManagedCheckCell) => notes[noteKey(cell)] ?? cell.progressNote;
  const progressRow = async (cell: ManagedCheckCell, status: CheckProgressStatus) => {
    const key = checkReviewKey(cell);
    if (!lock(key)) return;
    try {
      const res = await fetch('/api/admin/check', { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'progress', code: cell.code,
          period: cell.period, metric: cell.metric, fingerprint: cell.fingerprint, status, note: currentNote(cell) }) });
      const body = await res.json() as { error?: string };
      if (!res.ok) throw new Error(body.error || '处理状态保存失败');
      setActionMsg(`${cell.code} ${cell.period} ${cell.metricLabel}：已保存为${CHECK_PROGRESS_LABEL[status]}（不改变审核结论）`);
      await load();
    } catch (error) { setActionMsg(error instanceof Error ? error.message : '处理状态保存失败'); await load(); }
    finally { unlock(key); }
  };

  const confirmDiscard = async () => {
    if (!discardTarget?.announcementId) return;
    if (!discardPassword) {
      setDiscardPasswordError('请输入删除密码');
      return;
    }
    const cell = discardTarget;
    const password = discardPassword;
    try {
      const res = await fetch('/api/crawl/discard', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ announcementId: cell.announcementId, password }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string; note?: string };
      if (!res.ok) {
        setDiscardPasswordError(body.error || '删除失败');
        return;
      }
      setDiscardTarget(null);
      setDiscardPassword('');
      setActionMsg(body.note || `已删除 ${cell.code} ${cell.period}`);
      await load();
    } catch (error) {
      setDiscardPasswordError(error instanceof Error ? error.message : '删除失败');
    }
  };

  const parseRow = async (cell: ManagedCheckCell) => {
    const id = cell.announcementId;
    if (!id || !lock(`parse:${id}`)) return;
    const label = `${cell.code} ${cell.period}`;
    setActionMsg(`${label}：正在请求解析…`);
    let watching = false;
    try {
      const before = await fetch(`/api/reports/${encodeURIComponent(id)}/status`, { cache: 'no-store' });
      if (!before.ok) throw new Error('无法读取报告状态，请刷新后重试');
      const baseline = await before.json() as { parsed_at: string | null };
      const res = await fetch('/api/crawl/trigger', { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'parse', codes: [cell.code], parseOnly: true, immediate: true,
          announcementIds: [id], periods: [cell.period] }) });
      const body = await res.json() as { ok?: boolean; error?: string; note?: string };
      if (!res.ok || body.ok === false) throw new Error(body.error || '解析请求失败');
      setActionMsg(`${label}：已接受解析请求，后台执行；完成后自动刷新核对结果`);
      setParses(current => [...current, { id, label, parsedAt: baseline.parsed_at, started: Date.now(), sawParsing: false }]);
      watching = true;
      await load();
    } catch (error) { setActionMsg(error instanceof Error ? error.message : '解析请求失败'); }
    finally { if (!watching) unlock(`parse:${id}`); }
  };

  // Poll only explicitly requested reports. No automatic or table-wide parse side effect.
  useEffect(() => {
    if (!parses.length) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const next = [] as typeof parses;
      let changed = false;
      for (const task of parses) {
        try {
          const res = await fetch(`/api/reports/${encodeURIComponent(task.id)}/status`, { cache: 'no-store', signal: controller.signal });
          if (!res.ok) throw new Error('状态读取失败');
          const state = await res.json() as { status: string; parsed_at: string | null };
          if (controller.signal.aborted) return;
          if (state.parsed_at && state.parsed_at !== task.parsedAt && state.status !== 'parsing') {
            setActionMsg(`${task.label}：${state.status === 'parse_partial' ? '本轮解析结束，指标仍不完整' : '本轮解析已完成'}，已刷新核对结果（原始差异仍按实展示）`);
          } else if (task.sawParsing && state.status !== 'parsing') {
            setActionMsg(`${task.label}：解析未完成，已刷新状态，可稍后重试`);
          } else if (Date.now() - task.started > 300_000) {
            setActionMsg(`${task.label}：后台解析尚未确认完成，请刷新查看；不会自动重复请求`);
          } else { next.push({ ...task, sawParsing: task.sawParsing || state.status === 'parsing' }); continue; }
          unlock(`parse:${task.id}`);
          changed = true;
        } catch {
          if (controller.signal.aborted) return;
          if (Date.now() - task.started <= 300_000) next.push(task);
          else { unlock(`parse:${task.id}`); setActionMsg(`${task.label}：无法确认解析状态，请刷新查看`); }
        }
      }
      if (controller.signal.aborted) return;
      setParses(next);
      if (changed) void load();
    }, 3000);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [parses, load]);

  const rows = useMemo(() => {
    if (!payload) return [];
    const q = codeQuery.trim();
    return payload.cells.filter((cell) => {
      if (onlyMismatch && !isPendingCheck(cell)) return false;
      if (metricFilter && cell.metric !== metricFilter) return false;
      if (progressFilter && cell.progressStatus !== progressFilter) return false;
      if (q && !checkCellMatchesSearch(cell, q)) return false;
      return true;
    });
  }, [payload, onlyMismatch, metricFilter, codeQuery, progressFilter]);

  return (
    <AdminMain>
      <AdminHeader
        title="指标核对"
        activeHref="/admin/check"
      />

      {error ? <p role="alert" style={s.err}>{error}</p> : null}
      {actionMsg ? <p role="status" style={s.muted}>{actionMsg}</p> : null}

      {payload ? (
        <div style={s.cardRow}>
          {CHECK_METRICS.map((metric) => {
            const sum = payload.summary[metric];
            return (
              <article key={metric} style={s.card}>
                <p style={s.cardLabel}>{METRIC_LABEL[metric]}</p>
                <p style={s.cardValue}>
                  <span style={{ color: '#15803d' }}>{sum.ok}</span>
                  {' · '}
                  <span style={{ color: '#b91c1c' }}>{sum.bad}</span>
                  {' · '}
                  <span style={{ color: '#a16207' }}>{sum.miss}</span>
                </p>
                <p style={{ ...s.muted, margin: '4px 0 0', fontSize: 11 }}>OK · BAD · MISS（原始核对）</p>
                <p style={{ ...s.muted, margin: '4px 0 0', fontSize: 11 }}>待处理 {payload.reviewSummary[metric].pending} · 已审核 {payload.reviewSummary[metric].approved} · 人工标异 {payload.reviewSummary[metric].flagged}</p>
              </article>
            );
          })}
        </div>
      ) : null}

      <form
        style={s.filters}
        onSubmit={(e) => { e.preventDefault(); void load(); }}
      >
        <label style={{ ...s.muted, display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0 }}>
          <input
            type="checkbox"
            checked={onlyMismatch}
            onChange={(e) => setOnlyMismatch(e.target.checked)}
          />
          仅待处理异常
        </label>
        <select
          style={s.input}
          value={metricFilter}
          onChange={(e) => setMetricFilter(e.target.value as '' | CheckMetric)}
        >
          <option value="">全部指标</option>
          {CHECK_METRICS.map((m) => (
            <option key={m} value={m}>{METRIC_LABEL[m]}</option>
          ))}
        </select>
        <select style={s.input} value={progressFilter} onChange={e => setProgressFilter(e.target.value as '' | CheckProgressStatus)} aria-label="处理状态筛选">
          <option value="">全部处理状态</option>
          {(['open', 'in_progress', 'resolved'] as const).map(status => <option key={status} value={status}>{CHECK_PROGRESS_LABEL[status]} {payload?.progressSummary[status] ?? 0}</option>)}
        </select>
        <input
          style={{ ...s.input, width: 180, flex: '0 1 220px', fontSize: 12, padding: '5px 8px' }}
          placeholder="快速检索"
          value={codeQuery}
          maxLength={80}
          onChange={(e) => setCodeQuery(e.target.value)}
        />
        <button type="submit" style={s.btn} disabled={loading}>{loading ? '刷新中…' : '刷新'}</button>
        <span style={{ ...s.muted, alignSelf: 'center', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {payload ? `第三方 ${payload.thirdPartyCount} 家 · 展示 ${rows.length} 行` : ''}
          {payload?.periodNote ? <AdminHelpTip text={payload.periodNote} /> : null}
        </span>
      </form>

      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>代码</th>
              <th style={s.th}>公司</th>
              <th style={s.th}>期次</th>
              <th style={s.th}>指标</th>
              <th style={s.th}>第三方</th>
              <th style={s.th}>库内折算</th>
              <th style={s.th}>原始值</th>
              <th style={s.th}>原始结论 / 审核</th>
              <th style={s.th}>状态</th>
              <th style={s.th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 ? (
              <tr><td colSpan={10} style={{ ...s.td, color: '#8b97a9' }}>暂无记录</td></tr>
            ) : null}
            {rows.map((cell) => (
              <tr key={`${cell.code}-${cell.period}-${cell.metric}`}>
                <td style={s.td}>{cell.code}</td>
                <td style={s.td}>{cell.name || '—'}</td>
                <td style={s.td}>
                  {cell.code && cell.period ? (
                    <Link
                      href={`/${cell.code}?period=${encodeURIComponent(cell.period)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={periodLinkStyle}
                    >
                      {cell.period}
                    </Link>
                  ) : (
                    cell.period || '—'
                  )}
                </td>
                <td style={s.td}>{cell.metricLabel}</td>
                <td style={s.td}>{formatThird(cell)}</td>
                <td style={s.td}>
                  {formatConverted(cell.metric, cell.dbConverted)}
                  {cell.note ? (
                    <div style={{ ...s.muted, fontSize: 11, marginTop: 2 }}>{cell.note}</div>
                  ) : null}
                </td>
                <td style={s.td}>{cell.dbRaw || '—'}</td>
                <td style={{
                  ...s.td,
                  fontWeight: 650,
                  color: cell.status === 'OK' ? '#15803d' : cell.status === 'BAD' ? '#b91c1c' : '#a16207',
                }}
                >
                  {cell.status}
                  <div style={{ ...s.muted, fontSize: 11, marginTop: 3 }}>
                    {cell.reviewStatus === 'approved' ? '已审核通过' : cell.reviewStatus === 'flagged' ? '人工标异' : cell.reviewStale ? '数据已变化，需重新审核' : '未审核'}
                  </div>
                </td>
                <td style={s.td}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 650,
                      color: cell.progressStatus === 'resolved' ? '#15803d' : cell.progressStatus === 'in_progress' ? '#b45309' : '#6b7a8d',
                    }}
                    title={cell.progressUpdatedAt
                      ? `更新：${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short' }).format(new Date(cell.progressUpdatedAt))}（上海）`
                      : undefined}
                  >
                    {CHECK_PROGRESS_LABEL[cell.progressStatus]}
                  </span>
                  {cell.progressStale ? <div style={{ ...s.muted, fontSize: 11, marginTop: 3 }}>数据已变化，已重新打开</div> : null}
                </td>
                <td style={s.td}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, whiteSpace: 'nowrap', position: 'relative' }}>
                    <button type="button" style={textAct} disabled={cell.reviewStatus === 'approved' || busy.includes(checkReviewKey(cell)) || busy.includes(`parse:${cell.announcementId}`)} onClick={() => void reviewRow(cell, 'approved')}>审核通过</button>
                    <button type="button" style={textAct} disabled={cell.reviewStatus === 'flagged' || busy.includes(checkReviewKey(cell)) || busy.includes(`parse:${cell.announcementId}`)} onClick={() => void reviewRow(cell, 'flagged')}>标记异常</button>
                    <button type="button" style={textAct} aria-label={`${cell.code} ${cell.metricLabel}更多操作`} aria-expanded={opsKey === checkReviewKey(cell)} onClick={() => setOpsKey((current) => current === checkReviewKey(cell) ? null : checkReviewKey(cell))}>⋯</button>
                    {opsKey === checkReviewKey(cell) ? (
                      <div role="menu" style={opsMenu}>
                        <button type="button" style={menuItem} disabled={!cell.announcementId || busy.includes(`parse:${cell.announcementId}`)} onClick={() => { setOpsKey(null); void parseRow(cell); }}>{busy.includes(`parse:${cell.announcementId}`) ? '解析中…' : '解析'}</button>
                        <button type="button" style={menuItem} disabled={cell.progressStatus === 'in_progress' || busy.includes(checkReviewKey(cell))} onClick={() => { setOpsKey(null); void progressRow(cell, 'in_progress'); }}>处理中</button>
                        <button type="button" style={menuItem} disabled={cell.progressStatus === 'resolved' || busy.includes(checkReviewKey(cell))} onClick={() => { setOpsKey(null); void progressRow(cell, 'resolved'); }}>已处理</button>
                        <button type="button" style={{ ...menuItem, color: '#b91c1c' }} disabled={!cell.announcementId} onClick={() => { setOpsKey(null); setDiscardPassword(''); setDiscardPasswordError(''); setDiscardTarget(cell); }}>删除</button>
                      </div>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ ...s.muted, marginTop: 14 }}>
        第三方≠官方真值集；已做单位容错（元/千元/万元等折算 · 约 1% 相对容差）。Q3 库内若为单季，营收/净利/EPS 会加同公司 H1 折成累计再比（ROE 不折算）。审核通过仅清除待审差异，不改原始差异或处理进度；已处理不等于数据正确。可用处理状态切到处理中、已处理或未处理（重新打开）。数据实质变化后重新打开并使旧审核失效，旧处理说明仍保留；无变化重复解析不重开。解析仅作用于所点行对应报告，可完成后再次解析。本页仅作核对证据，不宣称准确率。
      </p>
      {discardTarget ? (
        <div style={{ position: 'fixed', inset: 0, background: '#12213f66', display: 'grid', placeItems: 'center', zIndex: 40 }} onClick={() => setDiscardTarget(null)}>
          <div role="dialog" aria-label="确认删除" style={{ width: 320, background: '#fff', borderRadius: 12, padding: 16 }} onClick={(event) => event.stopPropagation()}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>确认删除？</h3>
            <p style={{ ...s.muted, margin: '0 0 10px' }}>{discardTarget.code} {discardTarget.name || ''} · {discardTarget.period}</p>
            <input type="password" autoComplete="off" placeholder="删除密码" value={discardPassword} onChange={(event) => { setDiscardPassword(event.target.value); setDiscardPasswordError(''); }} style={{ ...s.input, width: '100%', boxSizing: 'border-box' }} />
            {discardPasswordError ? <p style={{ ...s.err, margin: '8px 0 0' }}>{discardPasswordError}</p> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button type="button" style={textAct} onClick={() => setDiscardTarget(null)}>取消</button>
              <button type="button" style={{ ...textAct, color: '#b91c1c' }} onClick={() => void confirmDiscard()}>删除</button>
            </div>
          </div>
        </div>
      ) : null}
    </AdminMain>
  );
}

function formatThird(cell: ManagedCheckCell) {
  if (cell.thirdParty == null) return '—';
  return formatConverted(cell.metric, cell.thirdParty);
}

const periodLinkStyle: CSSProperties = {
  color: '#1f4fad',
  textDecoration: 'none',
  fontWeight: 600,
};

const textAct: CSSProperties = {
  border: 0,
  background: 'transparent',
  padding: '0 6px',
  fontSize: 12,
  fontWeight: 600,
  color: '#1f4fad',
  cursor: 'pointer',
};

const menuItem: CSSProperties = {
  border: 0,
  background: 'transparent',
  textAlign: 'left',
  padding: '6px 10px',
  fontSize: 12,
  color: '#31465f',
  cursor: 'pointer',
};

const opsMenu: CSSProperties = {
  position: 'absolute',
  right: 0,
  top: '100%',
  zIndex: 8,
  minWidth: 96,
  display: 'flex',
  flexDirection: 'column',
  background: '#fff',
  border: '1px solid #e6ebf2',
  borderRadius: 8,
  boxShadow: '0 8px 20px #13213b14',
  padding: 4,
};

