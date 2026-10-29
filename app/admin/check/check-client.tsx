'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AdminHeader,
  AdminLoginForm,
  adminStyles as s,
  useAdminSession,
} from '../_components/admin-shell';
import {
  CHECK_METRICS,
  formatConverted,
  METRIC_LABEL,
  type CheckCell,
  type CheckMetric,
  type CheckSummary,
} from '@/lib/metrics-check';

type CheckPayload = {
  periodNote: string;
  summary: CheckSummary;
  cells: CheckCell[];
  thirdPartyCount: number;
};

export function CheckAdminClient() {
  const session = useAdminSession();
  const [payload, setPayload] = useState<CheckPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [onlyMismatch, setOnlyMismatch] = useState(true);
  const [metricFilter, setMetricFilter] = useState<'' | CheckMetric>('');
  const [codeQuery, setCodeQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/check', { cache: 'no-store', credentials: 'same-origin' });
      if (res.status === 401) {
        session.setAdmin(false);
        setError('管理员登录已失效，请重新登录');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || '加载失败');
      }
      setPayload(await res.json() as CheckPayload);
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
    return payload.cells.filter((cell) => {
      if (onlyMismatch && cell.status === 'OK') return false;
      if (metricFilter && cell.metric !== metricFilter) return false;
      if (q && !cell.code.includes(q) && !(cell.name && cell.name.includes(q))) return false;
      return true;
    });
  }, [payload, onlyMismatch, metricFilter, codeQuery]);

  if (!session.ready) {
    return <main style={s.wrap}><p style={{ color: '#6b7a8d' }}>加载中…</p></main>;
  }

  if (!session.admin) {
    return (
      <AdminLoginForm
        title="核心指标核对"
        hint="需要管理员密码后才能查看第三方对照结果。"
        password={session.password}
        setPassword={session.setPassword}
        loginError={session.loginError}
        loggingIn={session.loggingIn}
        onSubmit={() => { void session.submitLogin(); }}
      />
    );
  }

  return (
    <main style={s.wrapWide}>
      <AdminHeader
        title="核心指标核对 · 第三方对照"
        subtitle={payload?.periodNote ?? '/admin/check'}
        activeHref="/admin/check"
        onLogout={() => { void session.logout(); }}
      />

      {error ? <p style={s.err}>{error}</p> : null}

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
                <p style={{ ...s.muted, margin: '4px 0 0', fontSize: 11 }}>OK · BAD · MISS</p>
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
          仅不一致
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
        <input
          style={{ ...s.input, width: 140 }}
          placeholder="搜代码 / 公司"
          value={codeQuery}
          onChange={(e) => setCodeQuery(e.target.value)}
        />
        <button type="submit" style={s.btn} disabled={loading}>{loading ? '刷新中…' : '刷新'}</button>
        <span style={{ ...s.muted, alignSelf: 'center' }}>
          {payload ? `第三方 ${payload.thirdPartyCount} 家 · 展示 ${rows.length} 行` : ''}
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
              <th style={s.th}>结论</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 ? (
              <tr><td colSpan={8} style={{ ...s.td, color: '#8b97a9' }}>暂无记录</td></tr>
            ) : null}
            {rows.map((cell) => (
              <tr key={`${cell.code}-${cell.metric}`}>
                <td style={s.td}>{cell.code}</td>
                <td style={s.td}>{cell.name || '—'}</td>
                <td style={s.td}>{cell.period || '—'}</td>
                <td style={s.td}>{cell.metricLabel}</td>
                <td style={s.td}>{formatThird(cell)}</td>
                <td style={s.td}>{formatConverted(cell.metric, cell.dbConverted)}</td>
                <td style={s.td}>{cell.dbRaw || '—'}</td>
                <td style={{
                  ...s.td,
                  fontWeight: 650,
                  color: cell.status === 'OK' ? '#15803d' : cell.status === 'BAD' ? '#b91c1c' : '#a16207',
                }}
                >
                  {cell.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ ...s.muted, marginTop: 14 }}>
        第三方≠官方真值集；已做单位容错（元/千元/万元等折算 · 约 1% 相对容差）。本页仅作核对证据，不宣称准确率。
      </p>
    </main>
  );
}

function formatThird(cell: CheckCell) {
  if (cell.thirdParty == null) return '—';
  return formatConverted(cell.metric, cell.thirdParty);
}
