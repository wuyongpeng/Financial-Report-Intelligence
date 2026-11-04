'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  AdminHeader,
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
import type { HeadlineMetricName } from '@/lib/crawl-display';

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
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState('');

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

  if (!session.ready) {
    return <AdminMain><p style={{ color: '#6b7a8d' }}>加载中…</p></AdminMain>;
  }

  if (!session.admin) {
    return (
      <AdminLoginForm
        title="解析指标总览"
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
        title="解析指标总览"
        subtitle={payload?.note ?? '/admin/metrics'}
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
        <span style={{ ...s.muted, alignSelf: 'center' }}>
          {payload ? `展示 ${rows.length} / ${payload.summary.rows} 行` : ''}
        </span>
      </form>

      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
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
              <tr><td colSpan={10} style={{ ...s.td, color: '#8b97a9' }}>暂无记录</td></tr>
            ) : null}
            {rows.map((row) => {
              const busyKey = `${row.code}:${row.period}`;
              const busy = rowBusyId === busyKey;
              return (
                <tr key={busyKey}>
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
                    ) : row.abnormal ? (
                      <span style={{ color: '#b91c1c', fontWeight: 650 }}>
                        {row.issues.map(issueLabel).join(' · ')}
                      </span>
                    ) : (
                      <span style={{ color: '#15803d' }}>正常</span>
                    )}
                  </td>
                  <td style={s.td}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {row.abnormal && !row.acked ? (
                        <button
                          type="button"
                          style={{
                            ...s.btnAck,
                            opacity: row.announcementId && !busy ? 1 : 0.45,
                            cursor: row.announcementId && !busy ? 'pointer' : 'not-allowed',
                          }}
                          disabled={!row.announcementId || busy}
                          onClick={() => { void ackRow(row); }}
                        >
                          {busy ? '…' : '审核通过'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        style={{
                          ...s.btnDanger,
                          opacity: row.announcementId && !busy ? 1 : 0.45,
                          cursor: row.announcementId && !busy ? 'pointer' : 'not-allowed',
                        }}
                        disabled={!row.announcementId || busy}
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
        展示口径与详情页一致。错抓（如业绩预告）点删除；真暴增（如天齐 +1324%）点审核通过后不再进异常列表。
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
  return (
    <span title={full} style={{ color: '#3a4d66', fontSize: 12, lineHeight: 1.35 }}>
      {short}
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
