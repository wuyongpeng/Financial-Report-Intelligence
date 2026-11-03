'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  AdminHeader,
  AdminLoginForm,
  adminStyles as s,
  useAdminSession,
} from '../_components/admin-shell';
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

  const toggleCardFilter = useCallback((key: Exclude<CardFilter, null>) => {
    setCardFilter((prev) => {
      const next = prev === key ? null : key;
      return next;
    });
    // Card filter owns the abnormal view; clear checkbox so UI stays unambiguous.
    setOnlyAbnormal(false);
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

  useEffect(() => {
    if (session.admin) void load();
  }, [session.admin]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    if (!payload) return [];
    const q = codeQuery.trim();
    return payload.rows.filter((row) => {
      if (cardFilter === 'abnormal' && !row.abnormal) return false;
      if (cardFilter === 'missing' && !row.issues.includes('missing')) return false;
      if (cardFilter === 'absurd_yoy' && !row.issues.includes('absurd_yoy')) return false;
      // Checkbox only when no card filter (card filter takes priority).
      if (!cardFilter && onlyAbnormal && !row.abnormal) return false;
      if (periodFilter && row.period !== periodFilter) return false;
      if (q && !row.code.includes(q) && !(row.name && row.name.includes(q))) return false;
      return true;
    });
  }, [payload, onlyAbnormal, cardFilter, periodFilter, codeQuery]);

  if (!session.ready) {
    return <main style={s.wrap}><p style={{ color: '#6b7a8d' }}>加载中…</p></main>;
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
    <main style={{ ...s.wrapWide, maxWidth: 1400 }}>
      <AdminHeader
        title="解析指标总览"
        subtitle={payload?.note ?? '/admin/metrics'}
        activeHref="/admin/metrics"
        onLogout={() => { void session.logout(); }}
      />

      {error ? <p style={s.err}>{error}</p> : null}

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
          仅异常{cardFilter ? '（已被卡片筛选覆盖）' : ''}
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
              {OVERVIEW_METRICS.map((m) => (
                <th key={m} style={s.th}>{OVERVIEW_METRIC_LABEL[m]}</th>
              ))}
              <th style={s.th}>异常</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 ? (
              <tr><td colSpan={8} style={{ ...s.td, color: '#8b97a9' }}>暂无记录</td></tr>
            ) : null}
            {rows.map((row) => (
              <tr key={`${row.code}-${row.period}`}>
                <td style={s.td}>
                  <Link href={row.href} style={linkStyle}>{row.code}</Link>
                </td>
                <td style={s.td}>
                  <Link href={row.href} style={{ ...linkStyle, color: '#3a4d66' }}>
                    {row.name || '—'}
                  </Link>
                </td>
                <td style={s.td}>{row.period}</td>
                {OVERVIEW_METRICS.map((m) => (
                  <td key={m} style={s.td}>
                    <MetricCellView metric={m} row={row} />
                  </td>
                ))}
                <td style={s.td}>
                  {row.abnormal ? (
                    <span style={{ color: '#b91c1c', fontWeight: 650 }}>
                      {row.issues.map(issueLabel).join(' · ')}
                    </span>
                  ) : (
                    <span style={{ color: '#15803d' }}>正常</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ ...s.muted, marginTop: 14 }}>
        展示口径与详情页一致：金额按元÷1e8 显示「亿」，ROE 带 %，同比优先披露 yoy_pct / prior。
        悬停明细仍在详情页卡片上。本页只读，不改库。
      </p>
    </main>
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
      title={active ? `取消筛选：${label}` : `筛选：${label}`}
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
      <p style={{ ...s.cardLabel, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>{label}</span>
        <span style={{ color: active ? accent : '#94a3b8', fontWeight: 650 }}>
          {active ? '筛选中 · 再点取消' : '点击筛选'}
        </span>
      </p>
      <p style={{ ...s.cardValue, color: accent }}>{value}</p>
    </button>
  );
}

function MetricCellView({ metric, row }: { metric: HeadlineMetricName; row: OverviewRow }) {
  const cell = row.metrics[metric];
  const bad = cell.issues.length > 0;
  return (
    <div>
      <div style={{ fontWeight: 600, color: bad && cell.issues.includes('missing') ? '#b91c1c' : '#203047' }}>
        {cell.valueText}
      </div>
      <div style={{
        marginTop: 2,
        fontSize: 11,
        color: cell.issues.includes('absurd_yoy') ? '#b91c1c' : '#6b7a8d',
        fontWeight: cell.issues.includes('absurd_yoy') ? 650 : 400,
      }}
      >
        同比 {cell.yoyText}
        {' · '}
        <span style={{ color: cell.issues.includes('no_page') ? '#b91c1c' : undefined }}>
          {cell.pageText}
        </span>
      </div>
      {cell.issues.length > 0 ? (
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
