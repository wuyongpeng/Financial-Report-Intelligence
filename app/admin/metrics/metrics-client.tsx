'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  AdminHeader,
  AdminHelpTip,
  AdminMain,
  adminStyles as s,
} from '../_components/admin-shell';
import {
  issueLabel,
  OVERVIEW_METRICS,
  OVERVIEW_METRIC_LABEL,
  overviewRowMatchesSearch,
  type OverviewIssue,
  type OverviewRow,
  type OverviewSummary,
} from '@/lib/metrics-overview';
import { splitTitleAttention, titleHasAttentionKeyword } from '@/lib/metrics-title-attention';
import { buildBatchParseTriggerBodies, type HeadlineMetricName } from '@/lib/crawl-display';
import {
  REVIEW_REASON_LABEL,
  REVIEW_REASONS,
  type ReviewLogEntry,
  type ReviewLogSummary,
  type ReviewReason,
} from '@/lib/metrics-review-log';

type MetricsRow = OverviewRow & { ackReason: ReviewReason | null };

type MetricsPayload = {
  note: string;
  summary: OverviewSummary;
  periods: string[];
  rows: MetricsRow[];
  reviewLog?: {
    summary: ReviewLogSummary;
    recent: ReviewLogEntry[];
  };
};

/** Top summary cards that filter the table. */
type CardFilter = 'abnormal' | 'missing' | 'absurd_yoy' | 'audit_non_standard' | null;

export function MetricsAdminClient() {
  const [payload, setPayload] = useState<MetricsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [onlyAbnormal, setOnlyAbnormal] = useState(false);
  /** Clickable summary-card filter: null = off; same card again clears. */
  const [cardFilter, setCardFilter] = useState<CardFilter>(null);
  const [periodFilter, setPeriodFilter] = useState('');
  const [codeQuery, setCodeQuery] = useState('');
  const [onlyTitleAttention, setOnlyTitleAttention] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<OverviewRow | null>(null);
  const [discardPassword, setDiscardPassword] = useState('');
  const [discardPasswordError, setDiscardPasswordError] = useState('');
  const [flagTarget, setFlagTarget] = useState<OverviewRow | null>(null);
  const [flagNote, setFlagNote] = useState('');
  const [flagError, setFlagError] = useState('');
  const [ackTargets, setAckTargets] = useState<OverviewRow[]>([]);
  const [ackReason, setAckReason] = useState<ReviewReason | null>(null);
  const [ackError, setAckError] = useState('');
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
        setError('加载失败：未授权');
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
  }, []);

  const confirmDiscard = useCallback(async () => {
    if (!discardTarget?.announcementId) return;
    if (!discardPassword) {
      setDiscardPasswordError('请输入删除密码');
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
        setActionMsg('请求未授权，请刷新后重试');
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
  }, [closeDiscard, discardPassword, discardTarget, load]);

  const closeAck = useCallback(() => {
    setAckTargets([]);
    setAckReason(null);
    setAckError('');
  }, []);

  const askAck = useCallback((row: OverviewRow) => {
    if (!row.announcementId) {
      setActionMsg(`${row.code} ${row.period} 缺少公告 id，无法审核`);
      return;
    }
    if (row.acked) return;
    setActionMsg('');
    setAckReason(null);
    setAckError('');
    setAckTargets([row]);
  }, []);

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
        setFlagError('请求未授权，请刷新后重试');
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
  }, [closeFlag, flagNote, flagTarget, load, rowBusyId]);

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
        setActionMsg('请求未授权，请刷新后重试');
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
  }, [batchBusy, rowBusyId, rowKey]);

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
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    if (!payload) return [];
    const q = codeQuery.trim();
    return payload.rows.filter((row) => {
      if (cardFilter === 'abnormal' && !row.abnormal) return false;
      if (cardFilter === 'missing' && !(row.abnormal && row.issues.includes('missing'))) return false;
      if (cardFilter === 'absurd_yoy' && !(row.abnormal && row.issues.includes('absurd_yoy'))) return false;
      // 非标 chip: only non-standard auditor opinions (risk).
      if (cardFilter === 'audit_non_standard' && row.auditOpinionKind !== 'non_standard') return false;
      // Checkbox only when no card filter (card filter takes priority).
      if (!cardFilter && onlyAbnormal && !row.abnormal) return false;
      if (periodFilter && row.period !== periodFilter) return false;
      if (onlyTitleAttention && !titleHasAttentionKeyword(row.title || '')) return false;
      if (q && !overviewRowMatchesSearch(row, q)) return false;
      return true;
    });
  }, [payload, onlyAbnormal, cardFilter, periodFilter, codeQuery, onlyTitleAttention]);

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

  const askBatchAck = useCallback(() => {
    const targets = selectedRows.filter((row) => row.announcementId && !row.acked);
    if (!targets.length) {
      setActionMsg('所选行无需审核通过（已审或无公告 id）');
      return;
    }
    if (batchBusy || rowBusyId) return;
    setActionMsg('');
    setAckReason(null);
    setAckError('');
    setAckTargets(targets);
  }, [batchBusy, rowBusyId, selectedRows]);

  const confirmAck = useCallback(async () => {
    const targets = ackTargets.filter((row) => row.announcementId && !row.acked);
    if (!targets.length || batchBusy || rowBusyId) return;
    const batch = targets.length > 1;
    if (batch) setBatchBusy(true);
    else setRowBusyId(`${targets[0].code}:${targets[0].period}`);
    setAckError('');
    let done = 0;
    let failed = 0;
    let lastNote = '';
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
              reason: ackReason ?? undefined,
            }),
          });
          const body = await res.json().catch(() => ({})) as { error?: string; note?: string };
          if (res.status === 401) {
            setAckError('请求未授权，请刷新后重试');
            return;
          }
          if (!res.ok) throw new Error(body.error || 'ack failed');
          done += 1;
          if (body.note) lastNote = body.note;
        } catch {
          failed += 1;
        }
      }
      if (!done) {
        setAckError('审核失败');
        return;
      }
      closeAck();
      setActionMsg(
        failed
          ? `批量审核：成功 ${done} · 失败 ${failed}`
          : batch
            ? `已审核通过 ${done} 行`
            : (lastNote || `已审核通过 ${targets[0].code} ${targets[0].period}`),
      );
      if (batch) clearSelection();
      await load();
    } catch (e) {
      setAckError(e instanceof Error ? e.message : '审核失败');
    } finally {
      setRowBusyId(null);
      setBatchBusy(false);
    }
  }, [ackReason, ackTargets, batchBusy, clearSelection, closeAck, load, rowBusyId]);

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
            setActionMsg('请求未授权，请刷新后重试');
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
  }, [batchBusy, clearSelection, load, rowBusyId, selectedRows]);

  return (
    <AdminMain>
      <AdminHeader
        title="解析总览"
        activeHref="/admin/metrics"
      >
        {error ? <p style={{ ...s.err, margin: '8px 0 0' }}>{error}</p> : null}
        {actionMsg ? <p style={{ ...s.muted, margin: '8px 0 0', color: '#15803d' }}>{actionMsg}</p> : null}
      </AdminHeader>

      {payload ? (
        <div style={s.chipRow}>
          <article style={s.cardCompact}>
            <p style={s.cardLabel}>公司×期次</p>
            <p style={s.cardValueCompact}>{payload.summary.rows}</p>
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
          <SummaryFilterCard
            label="同比离谱"
            value={payload.summary.absurdYoy}
            active={cardFilter === 'absurd_yoy'}
            accent="#b91c1c"
            onClick={() => toggleCardFilter('absurd_yoy')}
          />
          <SummaryFilterCard
            label="非标"
            value={payload.summary.auditNonStandard}
            active={cardFilter === 'audit_non_standard'}
            accent="#b91c1c"
            labelColor="#b91c1c"
            onClick={() => toggleCardFilter('audit_non_standard')}
          />
        </div>
      ) : null}

      {payload?.reviewLog ? <ReviewLogPanel log={payload.reviewLog} abnormal={payload.summary.abnormal} /> : null}

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
        <label style={{ ...s.muted, display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0 }}>
          <input
            type="checkbox"
            checked={onlyTitleAttention}
            onChange={(e) => setOnlyTitleAttention(e.target.checked)}
          />
          标题含问询/关注函等
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
          style={{ ...s.input, width: 180, flex: '0 1 220px', fontSize: 12, padding: '5px 8px' }}
          placeholder="快速检索"
          value={codeQuery}
          maxLength={80}
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
            onClick={askBatchAck}
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
              <th style={{ ...s.th, ...colCode }}>代码</th>
              <th style={{ ...s.th, ...colName }}>公司</th>
              <th style={{ ...s.th, ...colPeriod }}>期次</th>
              <th style={{ ...s.th, ...colTitle }}>报告全称</th>
              <th style={{ ...s.th, ...colAudit }}>审计意见</th>
              {OVERVIEW_METRICS.map((m) => (
                <th key={m} style={{ ...s.th, ...colMetric }}>{OVERVIEW_METRIC_LABEL[m]}</th>
              ))}
              <th style={{ ...s.th, ...colStatus }}>异常</th>
              <th style={{ ...s.th, ...colActions }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 ? (
              <tr><td colSpan={12} style={{ ...s.td, color: '#8b97a9' }}>暂无记录</td></tr>
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
                  <td style={{ ...s.td, ...colCode }}>
                    <Link href={row.href} style={linkStyle}>{row.code}</Link>
                  </td>
                  <td style={{ ...s.td, ...colName }}>
                    <Link href={row.href} style={{ ...linkStyle, color: '#3a4d66' }}>
                      {row.name || '—'}
                    </Link>
                  </td>
                  <td style={{ ...s.td, ...colPeriod }}>
                    <Link
                      href={row.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ ...linkStyle, color: '#3a4d66' }}
                    >
                      <span style={{ color: row.issues.includes('period_mismatch') && !row.acked ? '#b91c1c' : undefined }} title={row.issues.includes('period_mismatch') ? '指标期次与报告全称不一致' : undefined}>
                        {row.period}
                      </span>
                    </Link>
                  </td>
                  <td style={{ ...s.td, ...colTitle }}>
                    <TitleCell title={row.title} />
                  </td>
                  <td style={{ ...s.td, ...colAudit }}>
                    <AuditOpinionCell row={row} />
                  </td>
                  {OVERVIEW_METRICS.map((m) => (
                    <td key={m} style={{ ...s.td, ...colMetric }}>
                      <MetricCellView metric={m} row={row} />
                    </td>
                  ))}
                  <td style={{ ...s.td, ...colStatus }}>
                    {row.acked ? (
                      <span>
                        <span style={{ color: '#15803d', fontWeight: 650 }}>已审</span>
                        {row.ackReason ? (
                          <div style={{ marginTop: 2, fontSize: 11, color: '#3a4d66', fontWeight: 500 }} title={REVIEW_REASON_LABEL[row.ackReason]}>
                            {REVIEW_REASON_LABEL[row.ackReason]}
                          </div>
                        ) : null}
                      </span>
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
                  <td style={{ ...s.td, ...colActions }}>
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
                          onClick={() => askAck(row)}
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
        数据不对点解析可本行重抽；错抓点删除。审核通过可记原因也可不选：真数，或解析错在抽数、页码单位、报告期次。用户反馈点标记异常（可写短备注）。每次通过或标异都另留一条记录。
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
                  opacity: Boolean(discardPassword) && !rowBusyId ? 1 : 0.5,
                  cursor: Boolean(discardPassword) && !rowBusyId ? 'pointer' : 'not-allowed',
                }}
                disabled={!discardPassword || Boolean(rowBusyId)}
                onClick={() => { void confirmDiscard(); }}
              >
                {rowBusyId ? '删除中…' : '删除'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {ackTargets.length > 0 ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="审核通过"
          style={confirmBackdrop}
          onClick={() => { if (!rowBusyId && !batchBusy) closeAck(); }}
        >
          <div style={{ ...confirmDialog, width: 'min(480px, 100%)' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 650 }}>审核通过</h3>
            {ackTargets.length === 1 ? (
              <>
                <p style={{ ...s.muted, margin: '0 0 8px' }}>
                  {ackTargets[0].code} {ackTargets[0].name || ''} · {ackTargets[0].period}
                </p>
                <p style={{ margin: '0 0 12px', fontSize: 13, color: '#3a4d66' }}>
                  系统当时提示：{ackTargets[0].issues.length
                    ? ackTargets[0].issues.map(issueLabel).join(' · ')
                    : '没有缺数、无页码、同比离谱或期次不符'}
                </p>
              </>
            ) : (
              <p style={{ ...s.muted, margin: '0 0 12px' }}>
                将通过 {ackTargets.length} 行。每一行记下当时系统标出的类型。
              </p>
            )}
            <p style={{ ...s.muted, margin: '0 0 8px' }}>原因可选，不选也能通过。</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {REVIEW_REASONS.map((reason) => {
                const selected = ackReason === reason;
                return (
                  <button
                    key={reason}
                    type="button"
                    aria-pressed={selected}
                    disabled={Boolean(rowBusyId) || batchBusy}
                    onClick={() => setAckReason(selected ? null : reason)}
                    style={{
                      textAlign: 'left',
                      font: 'inherit',
                      fontSize: 13,
                      padding: '7px 10px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      border: selected ? '1.5px solid #15803d' : '1px solid #e5eaf1',
                      background: selected ? '#f0fdf4' : '#fff',
                      color: '#203047',
                    }}
                  >
                    {REVIEW_REASON_LABEL[reason]}
                  </button>
                );
              })}
            </div>
            {ackError ? <p style={s.err}>{ackError}</p> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" style={s.btnGhost} disabled={Boolean(rowBusyId) || batchBusy} onClick={closeAck}>
                取消
              </button>
              <button
                type="button"
                style={s.btnAck}
                disabled={Boolean(rowBusyId) || batchBusy}
                onClick={() => { void confirmAck(); }}
              >
                {rowBusyId || batchBusy ? '…' : '通过'}
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



function ReviewLogPanel({
  log,
  abnormal,
}: {
  log: { summary: ReviewLogSummary; recent: ReviewLogEntry[] };
  abnormal: number;
}) {
  const summary = log.summary;
  return (
    <section style={{ margin: '0 0 12px', padding: '10px 12px', border: '1px solid #e5eaf1', borderRadius: 8, background: '#f8fafc' }}>
      <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 650, color: '#203047' }}>处理记录</p>
      <p style={{ margin: 0, fontSize: 13, color: '#3a4d66', lineHeight: 1.6 }}>
        当前异常 {abnormal} 条
        <br />
        审核通过 {summary.ackCount} 次
        {summary.unstated ? `，其中未选原因 ${summary.unstated} 次` : ''}
        <br />
        不是错误 {summary.realDisclosure} 次
        <br />
        解析错了 {summary.parseError} 次
        （抽错数 {summary.parseValue} · 页码或单位 {summary.parsePageUnit} · 报告或期次 {summary.parsePeriod}）
        {summary.flagCount ? ` · 标异 ${summary.flagCount} 次` : ''}
      </p>
      {log.recent.length > 0 ? (
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {['时间', '公司', '期次', '动作', '当时系统提示', '原因'].map((label) => (
                  <th key={label} style={{ ...s.th, fontSize: 11 }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {log.recent.map((event) => (
                <tr key={event.id}>
                  <td style={s.td}>{formatReviewTime(event.createdAt)}</td>
                  <td style={s.td}>{event.code} {event.name}</td>
                  <td style={s.td}>{event.period}</td>
                  <td style={s.td}>{event.action === 'acked' ? '通过' : '标异'}</td>
                  <td style={s.td}>{event.issues.length ? event.issues.map(issueLabel).join(' · ') : '—'}</td>
                  <td style={s.td}>
                    {event.reason ? REVIEW_REASON_LABEL[event.reason] : event.note || (event.action === 'acked' ? '未选原因' : '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p style={{ ...s.muted, margin: '8px 0 0' }}>还没有审核或标异记录。点通过之后会出现在这里。</p>
      )}
    </section>
  );
}

function formatReviewTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function AuditOpinionCell({ row }: { row: OverviewRow }) {
  const kind = row.auditOpinionKind;
  if (kind === 'non_standard') {
    return (
      <span style={{ color: '#b91c1c', fontWeight: 650 }} title={row.auditOpinionLabel}>
        非标
        {row.auditOpinionLabel && row.auditOpinionLabel !== '非标意见' ? (
          <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: '#9a3412', marginTop: 1 }}>
            {row.auditOpinionLabel.length > 10 ? `${row.auditOpinionLabel.slice(0, 10)}…` : row.auditOpinionLabel}
          </span>
        ) : null}
      </span>
    );
  }
  if (kind === 'standard') {
    return <span style={{ color: '#3a4d66' }} title={row.auditOpinionLabel}>标准</span>;
  }
  return <span style={{ color: '#8b97a9' }} title="本期未见审计意见">未见</span>;
}

function SummaryFilterCard({
  label,
  value,
  active,
  accent,
  labelColor,
  onClick,
}: {
  label: string;
  value: number;
  active: boolean;
  accent: string;
  labelColor?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      style={{
        ...s.cardCompact,
        textAlign: 'left',
        cursor: 'pointer',
        font: 'inherit',
        border: active ? `1.5px solid ${accent}` : '1px solid #e5eaf1',
        background: active ? '#fff7ed' : '#fff',
        boxShadow: active ? `0 0 0 2px ${accent}22` : 'none',
      }}
    >
      <p style={{ ...s.cardLabel, ...(labelColor ? { color: labelColor, fontWeight: 650 } : null) }}>{label}</p>
      <p style={{ ...s.cardValueCompact, color: accent }}>{value}</p>
    </button>
  );
}

const TITLE_TRUNCATE = 22;

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

/** Key identity cols: never wrap; squeeze title / metrics / status / actions instead. */
const colCode: CSSProperties = {
  whiteSpace: 'nowrap',
  minWidth: 72,
  width: 72,
  overflowWrap: 'normal',
  wordBreak: 'keep-all',
};
const colName: CSSProperties = {
  whiteSpace: 'nowrap',
  minWidth: 108,
  overflowWrap: 'normal',
  wordBreak: 'keep-all',
};
const colPeriod: CSSProperties = {
  whiteSpace: 'nowrap',
  minWidth: 72,
  width: 72,
  overflowWrap: 'normal',
  wordBreak: 'keep-all',
};
const colTitle: CSSProperties = {
  maxWidth: 148,
  width: 148,
  overflowWrap: 'anywhere',
};
const colAudit: CSSProperties = { minWidth: 88, maxWidth: 120, whiteSpace: 'nowrap' };
const colMetric: CSSProperties = {
  maxWidth: 118,
  overflowWrap: 'anywhere',
};
const colStatus: CSSProperties = {
  maxWidth: 120,
  overflowWrap: 'anywhere',
};
const colActions: CSSProperties = {
  maxWidth: 168,
  overflowWrap: 'anywhere',
};

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
