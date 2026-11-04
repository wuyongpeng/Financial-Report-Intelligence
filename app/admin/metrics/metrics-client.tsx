'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  AdminHeader,
  AdminHelpTip,
  AdminLoginForm,
  AdminMain,
  adminStyles as s,
  useAdminSession,
} from '../_components/admin-shell';
import { DISCARD_CONFIRM_PASSWORD } from '@/lib/discard-password';
import {
  issueLabel,
  OVERVIEW_METRICS,
  OVERVIEW_METRIC_LABEL,
  type OverviewIssue,
  type OverviewRow,
  type OverviewSummary,
} from '@/lib/metrics-overview';
import { splitTitleAttention } from '@/lib/metrics-title-attention';
import { buildBatchParseTriggerBodies, type HeadlineMetricName } from '@/lib/crawl-display';

type MetricsPayload = {
  note: string;
  summary: OverviewSummary;
  periods: string[];
  rows: OverviewRow[];
};

/** Top summary cards that filter the table. */
type CardFilter = 'abnormal' | 'missing' | 'absurd_yoy' | null;

export function MetricsAdminClient() {
  const session = useAdminSession();
  const [payload, setPayload] = useState<MetricsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [onlyAbnormal, setOnlyAbnormal] = useState(false);
  /** Clickable summary-card filter: null = off; same card again clears. */
  const [cardFilter, setCardFilter] = useState<CardFilter>(null);
  const [periodFilter, setPeriodFilter] = useState('');
  const [codeQuery, setCodeQuery] = useState('');
  const [discardTarget, setDiscardTarget] = useState<OverviewRow | null>(null);
  const [discardPassword, setDiscardPassword] = useState('');
  const [discardPasswordError, setDiscardPasswordError] = useState('');
  const [flagTarget, setFlagTarget] = useState<OverviewRow | null>(null);
  const [flagNote, setFlagNote] = useState('');
  const [flagError, setFlagError] = useState('');
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  const toggleCardFilter = useCallback((key: Exclude<CardFilter, null>) => {
    setCardFilter((prev) => {
      const next = prev === key ? null : key;
      return next;
    });
    // Card filter owns the abnormal view; clear checkbox so UI stays unambiguous.
    setOnlyAbnormal(false);
  }, []);

  const closeDiscard = useCallback(() => {
    setDiscardTarget(null);
    setDiscardPassword('');
    setDiscardPasswordError('');
  }, []);

  const closeFlag = useCallback(() => {
    setFlagTarget(null);
    setFlagNote('');
    setFlagError('');
  }, []);

  const askFlag = useCallback((row: OverviewRow) => {
    if (!row.announcementId) {
      setActionMsg(`${row.code} ${row.period} 缺少公告 id，无法标记`);
      return;
    }
    if (row.flagged) return;
    setActionMsg('');
    setFlagNote(row.reviewNote || '');
    setFlagError('');
    setFlagTarget(row);
  }, []);

  const askDiscard = useCallback((row: OverviewRow) => {
    if (!row.announcementId) {
      setActionMsg(`${row.code} ${row.period} 缺少公告 id，无法删除`);
      return;
    }
    setActionMsg('');
    setDiscardPassword('');
    setDiscardPasswordError('');
    setDiscardTarget(row);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/metrics', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (res.status === 401) {
        session.setAdmin(false);
        setError('管理员登录已失效，请重新登录');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || '加载失败');
      }
      setPayload(await res.json() as MetricsPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [session]);

  const confirmDiscard = useCallback(async () => {
    if (!discardTarget?.announcementId) return;
    if (discardPassword !== DISCARD_CONFIRM_PASSWORD) {
      setDiscardPasswordError('删除密码错误');
      return;
    }
    const row = discardTarget;
    const password = discardPassword;
    const busyKey = `${row.code}:${row.period}`;
    setRowBusyId(busyKey);
    setDiscardPasswordError('');
    try {
      const res = await fetch('/api/crawl/discard', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ announcementId: row.announcementId, password }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string; note?: string };
      if (res.status === 401) {
        session.setAdmin(false);
        setActionMsg('管理员登录已失效，请重新登录');
        closeDiscard();
        return;
      }
      if (!res.ok) {
        setDiscardPasswordError(body.error || '删除失败');
        return;
      }
      closeDiscard();
      setActionMsg(body.note || `已剔除 ${row.code} ${row.period}`);
      await load();
    } catch (e) {
      setDiscardPasswordError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setRowBusyId(null);
    }
  }, [closeDiscard, discardPassword, discardTarget, load, session]);

  const ackRow = useCallback(async (row: OverviewRow) => {
    if (!row.announcementId) {
      setActionMsg(`${row.code} ${row.period} 缺少公告 id，无法审核`);
      return;
    }
    if (row.acked) return;
    const busyKey = `${row.code}:${row.period}`;
    if (rowBusyId === busyKey) return;
    setRowBusyId(busyKey);
    setActionMsg('');
    try {
      const res = await fetch('/api/admin/metrics/ack', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          announcementId: row.announcementId,
          code: row.code,
          period: row.period,
        }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string; note?: string };
      if (res.status === 401) {
        session.setAdmin(false);
        setActionMsg('管理员登录已失效，请重新登录');
        return;
      }
      if (!res.ok) {
        setActionMsg(body.error || '审核失败');
        return;
      }
      setActionMsg(body.note || `已审核通过 ${row.code} ${row.period}`);
      await load();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : '审核失败');
    } finally {
      setRowBusyId(null);
    }
  }, [load, rowBusyId, session]);

  const confirmFlag = useCallback(async () => {
    if (!flagTarget?.announcementId) return;
    const row = flagTarget;
    const busyKey = `${row.code}:${row.period}`;
    if (rowBusyId === busyKey) return;
    setRowBusyId(busyKey);
    setFlagError('');
    setActionMsg('');
    try {
      const res = await fetch('/api/admin/metrics/flag', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          announcementId: row.announcementId,
          code: row.code,
          period: row.period,
          note: flagNote.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string; note?: string };
      if (res.status === 401) {
        session.setAdmin(false);
        setFlagError('管理员登录已失效，请重新登录');
        return;
      }
      if (!res.ok) {
        setFlagError(body.error || '标记失败');
        return;
      }
      closeFlag();
      setActionMsg(body.note || `已标记异常 ${row.code} ${row.period}`);
      await load();
    } catch (e) {
      setFlagError(e instanceof Error ? e.message : '标记失败');
    } finally {
      setRowBusyId(null);
    }
  }, [closeFlag, flagNote, flagTarget, load, rowBusyId, session]);

  const rowKey = useCallback((row: OverviewRow) => `${row.code}:${row.period}`, []);

  const parseRow = useCallback(async (row: OverviewRow) => {
    if (!row.announcementId) {
      setActionMsg(`${row.code} ${row.period} 缺少公告 id，无法解析`);
      return;
    }
    const busyKey = rowKey(row);
    if (rowBusyId === busyKey || batchBusy) return;
    setRowBusyId(busyKey);
    setActionMsg(`解析排队中 ${row.code} ${row.period}…`);
    try {
      const res = await fetch('/api/crawl/trigger', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'parse',
          codes: [row.code],
          parseOnly: true,
          immediate: true,
          announcementIds: [row.announcementId],
          periods: [row.period],
        }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string; note?: string; ok?: boolean };
      if (res.status === 401) {
        session.setAdmin(false);
        setActionMsg('管理员登录已失效，请重新登录');
        return;
      }
      if (!res.ok || body.ok === false) {
        setActionMsg(body.error || `解析失败 ${row.code} ${row.period}`);
        return;
      }
      setActionMsg(body.note || `已开始重新解析 ${row.code} ${row.period}`);
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : '解析失败');
    } finally {
      setRowBusyId(null);
    }
  }, [batchBusy, rowBusyId, rowKey, session]);

  const toggleSelectKey = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedKeys(new Set());
  }, []);

  useEffect(() => {
    if (session.admin) void load();
  }, [session.admin]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    if (!payload) return [];
    const q = codeQuery.trim();
    return payload.rows.filter((row) => {
      if (cardFilter === 'abnormal' && !row.abnormal) return false;
      if (cardFilter === 'missing' && !(row.abnormal && row.issues.includes('missing'))) return false;
      if (cardFilter === 'absurd_yoy' && !(row.abnormal && row.issues.includes('absurd_yoy'))) return false;
      // Checkbox only when no card filter (card filter takes priority).
      if (!cardFilter && onlyAbnormal && !row.abnormal) return false;
      if (periodFilter && row.period !== periodFilter) return false;
      if (q && !row.code.includes(q) && !(row.name && row.name.includes(q))) return false;
      return true;
    });
  }, [payload, onlyAbnormal, cardFilter, periodFilter, codeQuery]);

  const selectableRows = useMemo(
    () => rows.filter((row) => Boolean(row.announcementId)),
    [rows],
  );

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedKeys.has(rowKey(row))),
    [rows, selectedKeys, rowKey],
  );

  const allVisibleSelected = selectableRows.length > 0
    && selectableRows.every((row) => selectedKeys.has(rowKey(row)));

  const toggleSelectVisible = useCallback(() => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const row of selectableRows) next.delete(rowKey(row));
      } else {
        for (const row of selectableRows) next.add(rowKey(row));
      }
      return next;
    });
  }, [allVisibleSelected, rowKey, selectableRows]);

  // Drop selections that disappeared after filter/reload.
  useEffect(() => {
    const alive = new Set(rows.map((row) => rowKey(row)));
    setSelectedKeys((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const key of prev) {
        if (alive.has(key)) next.add(key);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [rows, rowKey]);

  const batchParse = useCallback(async () => {
    const targets = selectedRows.filter((row) => row.announcementId);
    if (!targets.length) {
      setActionMsg('请先勾选有公告 id 的行');
      return;
    }
    if (batchBusy || rowBusyId) return;
    setBatchBusy(true);
    setActionMsg(`批量解析排队中 ${targets.length} 份…`);
    let done = 0;
    let failed = 0;
    try {
      const ids = targets.map((row) => row.announcementId!).filter(Boolean);
      const bodies = buildBatchParseTriggerBodies(ids);
      for (const body of bodies) {
        try {
          const res = await fetch('/api/crawl/trigger', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          const payload = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; queued?: number };
          if (!res.ok || payload.ok === false) throw new Error(payload.error || '解析失败');
          done += body.announcementIds.length;
        } catch {
          failed += body.announcementIds.length;
        }
      }
      setActionMsg(
        failed
          ? `批量解析：入队 ${done} · 失败 ${failed}`
          : `已加入排队解析 ${done} 份`,
      );
      clearSelection();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : '批量解析失败');
    } finally {
      setBatchBusy(false);
    }
  }, [batchBusy, clearSelection, rowBusyId, selectedRows]);

  const batchAck = useCallback(async () => {
    const targets = selectedRows.filter((row) => row.announcementId && !row.acked);
    if (!targets.length) {
      setActionMsg('所选行无需审核通过（已审或无公告 id）');
      return;
    }
    if (batchBusy || rowBusyId) return;
    setBatchBusy(true);
    setActionMsg(`批量审核中 ${targets.length} 行…`);
    let done = 0;
    let failed = 0;
    try {
      for (const row of targets) {
        try {
          const res = await fetch('/api/admin/metrics/ack', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              announcementId: row.announcementId,
              code: row.code,
              period: row.period,
            }),
          });
          if (res.status === 401) {
            session.setAdmin(false);
            setActionMsg('管理员登录已失效，请重新登录');
            return;
          }
          if (!res.ok) throw new Error('ack failed');
          done += 1;
        } catch {
          failed += 1;
        }
      }
      setActionMsg(failed ? `批量审核：成功 ${done} · 失败 ${failed}` : `已审核通过 ${done} 行`);
      clearSelection();
      await load();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : '批量审核失败');
    } finally {
      setBatchBusy(false);
    }
  }, [batchBusy, clearSelection, load, rowBusyId, selectedRows, session]);

  const batchFlag = useCallback(async () => {
    const targets = selectedRows.filter((row) => row.announcementId && !row.flagged);
    if (!targets.length) {
      setActionMsg('所选行无需标记异常（已标或无公告 id）');
      return;
    }
    if (batchBusy || rowBusyId) return;
    setBatchBusy(true);
    setActionMsg(`批量标记中 ${targets.length} 行…`);
    let done = 0;
    let failed = 0;
    try {
      for (const row of targets) {
        try {
          const res = await fetch('/api/admin/metrics/flag', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              announcementId: row.announcementId,
              code: row.code,
              period: row.period,
            }),
          });
          if (res.status === 401) {
            session.setAdmin(false);
            setActionMsg('管理员登录已失效，请重新登录');
            return;
          }
          if (!res.ok) throw new Error('flag failed');
          done += 1;
        } catch {
          failed += 1;
        }
      }
      setActionMsg(failed ? `批量标记：成功 ${done} · 失败 ${failed}` : `已标记异常 ${done} 行`);
      clearSelection();
      await load();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : '批量标记失败');
    } finally {
      setBatchBusy(false);
    }
  }, [batchBusy, clearSelection, load, rowBusyId, selectedRows, session]);

  if (!session.ready) {
    return <AdminMain><p style={{ color: '#6b7a8d' }}>加载中…</p></AdminMain>;
  }

  if (!session.admin) {
    return (
      <AdminLoginForm
        title="解析总览"
        hint="需要管理员密码后才能查看四核解析展示效果。"
        password={session.password}
        setPassword={session.setPassword}
        loginError={session.loginError}
        loggingIn={session.loggingIn}
        onSubmit={() => { void session.submitLogin(); }}
      />
    );
  }

  return (
    <AdminMain>
      <AdminHeader
        title="解析总览"
        activeHref="/admin/metrics"
        onLogout={() => { void session.logout(); }}
      />

      {error ? <p style={s.err}>{error}</p> : null}
      {actionMsg ? <p style={{ ...s.muted, color: '#15803d' }}>{actionMsg}</p> : null}

      {payload ? (
        <div style={s.cardRow}>
          <article style={s.card}>
            <p style={s.cardLabel}>公司×期次</p>
            <p style={s.cardValue}>{payload.summary.rows}</p>
          </article>
          <SummaryFilterCard
            label="异常行"
            value={payload.summary.abnormal}
            active={cardFilter === 'abnormal'}
            accent={payload.summary.abnormal ? '#b91c1c' : '#15803d'}
            onClick={() => toggleCardFilter('abnormal')}
          />
          <SummaryFilterCard
            label="缺核"
            value={payload.summary.missingCore}
            active={cardFilter === 'missing'}
            accent="#b45309"
            onClick={() => toggleCardFilter('missing')}
          />
          <article style={s.card}>
            <p style={s.cardLabel}>无页码</p>
            <p style={s.cardValue}>{payload.summary.noPage}</p>
          </article>
          <SummaryFilterCard
            label="同比离谱"
            value={payload.summary.absurdYoy}
            active={cardFilter === 'absurd_yoy'}
            accent="#b91c1c"
            onClick={() => toggleCardFilter('absurd_yoy')}
          />
        </div>
      ) : null}

      <form
        style={s.filters}
        onSubmit={(e) => { e.preventDefault(); void load(); }}
      >
        <label style={{ ...s.muted, display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0 }}>
          <input
            type="checkbox"
            checked={!cardFilter && onlyAbnormal}
            disabled={Boolean(cardFilter)}
            onChange={(e) => {
              setCardFilter(null);
              setOnlyAbnormal(e.target.checked);
            }}
          />
          仅异常
        </label>
        <select
          style={s.input}
          value={periodFilter}
          onChange={(e) => setPeriodFilter(e.target.value)}
        >
          <option value="">全部期次</option>
          {(payload?.periods ?? []).map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <input
          style={{ ...s.input, width: 140 }}
          placeholder="搜代码 / 公司"
          value={codeQuery}
          onChange={(e) => setCodeQuery(e.target.value)}
        />
        <button type="submit" style={s.btn} disabled={loading}>
          {loading ? '刷新中…' : '刷新'}
        </button>
        <span style={{ ...s.muted, alignSelf: 'center', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {payload ? `展示 ${rows.length} / ${payload.summary.rows} 行` : ''}
          {payload?.note ? <AdminHelpTip text={payload.note} /> : null}
        </span>
      </form>

      {selectedKeys.size > 0 ? (
        <div style={{
          ...s.filters,
          marginTop: -4,
          padding: '8px 10px',
          background: '#f6f8fc',
          border: '1px solid #e5eaf1',
          borderRadius: 8,
        }}
        >
          <span style={{ ...s.muted, alignSelf: 'center' }}>已选 {selectedKeys.size}</span>
          <button
            type="button"
            style={{ ...s.btnParse, opacity: batchBusy || rowBusyId ? 0.45 : 1 }}
            disabled={batchBusy || Boolean(rowBusyId)}
            onClick={() => { void batchParse(); }}
          >
            {batchBusy ? '…' : '批量解析'}
          </button>
          <button
            type="button"
            style={{ ...s.btnAck, opacity: batchBusy || rowBusyId ? 0.45 : 1 }}
            disabled={batchBusy || Boolean(rowBusyId)}
            onClick={() => { void batchAck(); }}
          >
            批量审核通过
          </button>
          <button
            type="button"
            style={{ ...s.btnFlag, opacity: batchBusy || rowBusyId ? 0.45 : 1 }}
            disabled={batchBusy || Boolean(rowBusyId)}
            onClick={() => { void batchFlag(); }}
          >
            批量标记异常
          </button>
          <button
            type="button"
            style={s.btnGhost}
            disabled={batchBusy || Boolean(rowBusyId)}
            onClick={clearSelection}
          >
            取消选择
          </button>
        </div>
      ) : null}

      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={{ ...s.th, width: 36 }}>
                <input
                  type="checkbox"
                  aria-label="全选当前列表"
                  checked={allVisibleSelected}
                  disabled={!selectableRows.length || batchBusy}
                  onChange={toggleSelectVisible}
                />
              </th>
              <th style={s.th}>代码</th>
              <th style={s.th}>公司</th>
              <th style={s.th}>期次</th>
              <th style={s.th}>报告全称</th>
              {OVERVIEW_METRICS.map((m) => (
                <th key={m} style={s.th}>{OVERVIEW_METRIC_LABEL[m]}</th>
              ))}
              <th style={s.th}>异常</th>
              <th style={s.th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 ? (
              <tr><td colSpan={11} style={{ ...s.td, color: '#8b97a9' }}>暂无记录</td></tr>
            ) : null}
            {rows.map((row) => {
              const busyKey = `${row.code}:${row.period}`;
              const busy = rowBusyId === busyKey;
              const rowBg = row.flagged
                ? '#fff7ed'
                : row.abnormal
                  ? '#fff8f8'
                  : row.acked
                    ? '#f4faf6'
                    : undefined;
              const statusBits: string[] = [];
              if (row.flagged) statusBits.push('人工标异');
              if (!row.acked && row.issues.length > 0) {
                statusBits.push(...row.issues.map(issueLabel));
              }
              const selected = selectedKeys.has(busyKey);
              return (
                <tr key={busyKey} style={rowBg ? { background: rowBg } : undefined}>
                  <td style={s.td}>
                    <input
                      type="checkbox"
                      aria-label={`选择 ${row.code} ${row.period}`}
                      checked={selected}
                      disabled={!row.announcementId || batchBusy}
                      onChange={() => toggleSelectKey(busyKey)}
                    />
                  </td>
                  <td style={s.td}>
                    <Link href={row.href} style={linkStyle}>{row.code}</Link>
                  </td>
                  <td style={s.td}>
                    <Link href={row.href} style={{ ...linkStyle, color: '#3a4d66' }}>
                      {row.name || '—'}
                    </Link>
                  </td>
                  <td style={s.td}>
                    <Link href={row.href} style={{ ...linkStyle, color: '#3a4d66' }}>{row.period}</Link>
                  </td>
                  <td style={{ ...s.td, maxWidth: 220 }}>
                    <TitleCell title={row.title} />
                  </td>
                  {OVERVIEW_METRICS.map((m) => (
                    <td key={m} style={s.td}>
                      <MetricCellView metric={m} row={row} />
                    </td>
                  ))}
                  <td style={s.td}>
                    {row.acked ? (
                      <span style={{ color: '#15803d', fontWeight: 650 }}>已审</span>
                    ) : statusBits.length > 0 ? (
                      <div>
                        <span style={{
                          color: row.flagged ? '#b45309' : '#b91c1c',
                          fontWeight: 650,
                        }}
                        >
                          {statusBits.join(' · ')}
                        </span>
                        {row.flagged && row.reviewNote ? (
                          <div style={{ marginTop: 2, fontSize: 11, color: '#9a6b2f' }} title={row.reviewNote}>
                            {row.reviewNote.length > 28 ? `${row.reviewNote.slice(0, 28)}…` : row.reviewNote}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <span style={{ color: '#15803d' }}>正常</span>
                    )}
                  </td>
                  <td style={s.td}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                      <button
                        type="button"
                        style={{
                          ...s.btnParse,
                          opacity: row.announcementId && !busy && !batchBusy ? 1 : 0.45,
                          cursor: row.announcementId && !busy && !batchBusy ? 'pointer' : 'not-allowed',
                        }}
                        disabled={!row.announcementId || busy || batchBusy}
                        onClick={() => { void parseRow(row); }}
                      >
                        {busy ? '…' : '解析'}
                      </button>
                      {!row.acked && row.abnormal ? (
                        <button
                          type="button"
                          style={{
                            ...s.btnAck,
                            opacity: row.announcementId && !busy && !batchBusy ? 1 : 0.45,
                            cursor: row.announcementId && !busy && !batchBusy ? 'pointer' : 'not-allowed',
                          }}
                          disabled={!row.announcementId || busy || batchBusy}
                          onClick={() => { void ackRow(row); }}
                        >
                          {busy ? '…' : '审核通过'}
                        </button>
                      ) : null}
                      {!row.flagged ? (
                        <button
                          type="button"
                          style={{
                            ...s.btnFlag,
                            opacity: row.announcementId && !busy && !batchBusy ? 1 : 0.45,
                            cursor: row.announcementId && !busy && !batchBusy ? 'pointer' : 'not-allowed',
                          }}
                          disabled={!row.announcementId || busy || batchBusy}
                          onClick={() => askFlag(row)}
                        >
                          标记异常
                        </button>
                      ) : null}
                      <button
                        type="button"
                        style={{
                          ...s.btnDanger,
                          opacity: row.announcementId && !busy && !batchBusy ? 1 : 0.45,
                          cursor: row.announcementId && !busy && !batchBusy ? 'pointer' : 'not-allowed',
                        }}
                        disabled={!row.announcementId || busy || batchBusy}
                        onClick={() => askDiscard(row)}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ ...s.muted, marginTop: 14 }}>
        数据不对点解析可本行重抽；错抓点删除；真暴增或修完后点审核通过；用户反馈/人工发现点标记异常（可写短备注）。标记异常与审核通过互斥，均可再切换。可勾选多行批量解析 / 审核 / 标异。
      </p>

      {discardTarget ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="确认删除"
          style={confirmBackdrop}
          onClick={() => { if (!rowBusyId) closeDiscard(); }}
        >
          <div style={confirmDialog} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 650 }}>确认删除？</h3>
            <p style={{ ...s.muted, margin: '0 0 8px' }}>
              {discardTarget.code} {discardTarget.name || ''} · {discardTarget.period}
            </p>
            {discardTarget.title ? (
              <p style={{ ...s.muted, margin: '0 0 12px', color: '#3a4d66' }}>
                {discardTarget.title.replace(/\s+/g, ' ').slice(0, 100)}
              </p>
            ) : null}
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ ...s.muted, display: 'block', marginBottom: 6 }}>删除密码</span>
              <input
                type="password"
                autoComplete="off"
                autoFocus
                style={{ ...s.input, width: '100%', boxSizing: 'border-box' }}
                value={discardPassword}
                disabled={Boolean(rowBusyId)}
                onChange={(e) => {
                  setDiscardPassword(e.target.value);
                  if (discardPasswordError) setDiscardPasswordError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void confirmDiscard();
                  }
                }}
              />
              {discardPasswordError ? (
                <span style={{ ...s.err, display: 'block', marginTop: 6 }}>{discardPasswordError}</span>
              ) : null}
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" style={s.btnGhost} disabled={Boolean(rowBusyId)} onClick={closeDiscard}>
                取消
              </button>
              <button
                type="button"
                style={{
                  ...s.btn,
                  background: '#b91c1c',
                  opacity: discardPassword === DISCARD_CONFIRM_PASSWORD && !rowBusyId ? 1 : 0.5,
                  cursor: discardPassword === DISCARD_CONFIRM_PASSWORD && !rowBusyId ? 'pointer' : 'not-allowed',
                }}
                disabled={discardPassword !== DISCARD_CONFIRM_PASSWORD || Boolean(rowBusyId)}
                onClick={() => { void confirmDiscard(); }}
              >
                {rowBusyId ? '删除中…' : '删除'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {flagTarget ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="标记异常"
          style={confirmBackdrop}
          onClick={() => { if (!rowBusyId) closeFlag(); }}
        >
          <div style={confirmDialog} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 650 }}>标记异常</h3>
            <p style={{ ...s.muted, margin: '0 0 8px' }}>
              {flagTarget.code} {flagTarget.name || ''} · {flagTarget.period}
            </p>
            {flagTarget.title ? (
              <p style={{ ...s.muted, margin: '0 0 12px', color: '#3a4d66' }}>
                {flagTarget.title.replace(/\s+/g, ' ').slice(0, 100)}
              </p>
            ) : null}
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ ...s.muted, display: 'block', marginBottom: 6 }}>备注（可选）</span>
              <input
                type="text"
                value={flagNote}
                onChange={(e) => setFlagNote(e.target.value)}
                placeholder="如：用户反馈净利不对 / 问财口径"
                maxLength={200}
                style={{ ...s.input, width: '100%', boxSizing: 'border-box' }}
              />
            </label>
            {flagError ? <p style={s.err}>{flagError}</p> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                style={s.btnGhost}
                disabled={Boolean(rowBusyId)}
                onClick={closeFlag}
              >
                取消
              </button>
              <button
                type="button"
                style={{ ...s.btnFlag, background: '#fffbeb' }}
                disabled={Boolean(rowBusyId)}
                onClick={() => { void confirmFlag(); }}
              >
                {rowBusyId ? '…' : '确认标记'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </AdminMain>
  );
}


function SummaryFilterCard({
  label,
  value,
  active,
  accent,
  onClick,
}: {
  label: string;
  value: number;
  active: boolean;
  accent: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      style={{
        ...s.card,
        textAlign: 'left',
        cursor: 'pointer',
        width: '100%',
        font: 'inherit',
        border: active ? `2px solid ${accent}` : '1px solid #e5eaf1',
        background: active ? '#fff7ed' : '#fff',
        boxShadow: active ? `0 0 0 3px ${accent}22` : 'none',
      }}
    >
      <p style={s.cardLabel}>{label}</p>
      <p style={{ ...s.cardValue, color: accent }}>{value}</p>
    </button>
  );
}

const TITLE_TRUNCATE = 32;

function truncateTitle(title: string, max = TITLE_TRUNCATE): string {
  const t = title.trim();
  if (!t) return '';
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function TitleCell({ title }: { title: string }) {
  const full = title?.trim() || '';
  if (!full) return <span style={{ color: '#8b97a9' }}>—</span>;
  const short = truncateTitle(full);
  const segments = splitTitleAttention(short);
  return (
    <span title={full} style={{ color: '#3a4d66', fontSize: 12, lineHeight: 1.35 }}>
      {segments.map((seg, i) =>
        seg.kind === 'hit' ? (
          <span key={i} style={{ color: '#b91c1c', fontWeight: 650 }}>{seg.text}</span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </span>
  );
}

function MetricCellView({ metric, row }: { metric: HeadlineMetricName; row: OverviewRow }) {
  const cell = row.metrics[metric];
  const bad = cell.issues.length > 0 && !row.acked;
  return (
    <div>
      <div style={{ fontWeight: 600, color: bad && cell.issues.includes('missing') ? '#b91c1c' : '#203047' }}>
        {cell.valueText}
      </div>
      <div style={{
        marginTop: 2,
        fontSize: 11,
        color: !row.acked && cell.issues.includes('absurd_yoy') ? '#b91c1c' : '#6b7a8d',
        fontWeight: !row.acked && cell.issues.includes('absurd_yoy') ? 650 : 400,
      }}
      >
        同比 {cell.yoyText}
        {' · '}
        <span style={{ color: !row.acked && cell.issues.includes('no_page') ? '#b91c1c' : undefined }}>
          {cell.pageText}
        </span>
      </div>
      {!row.acked && cell.issues.length > 0 ? (
        <div style={{ marginTop: 2, fontSize: 11, color: '#b91c1c' }}>
          {cell.issues.map((i: OverviewIssue) => issueLabel(i)).join(' · ')}
        </div>
      ) : null}
    </div>
  );
}

const linkStyle: CSSProperties = {
  color: '#1f4fad',
  textDecoration: 'none',
  fontWeight: 600,
};

const confirmBackdrop: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(16, 24, 40, 0.35)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 80,
  padding: 16,
};

const confirmDialog: CSSProperties = {
  width: 'min(420px, 100%)',
  background: '#fff',
  borderRadius: 12,
  border: '1px solid #e5eaf1',
  padding: 18,
  boxShadow: '0 12px 40px rgba(16, 24, 40, 0.18)',
};
