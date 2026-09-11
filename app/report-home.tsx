'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import {
  freshnessLabel,
  formatMetricValue,
  INDUSTRY_CHIPS,
  yoyChange,
  type CrawlCompanyCoverage,
  type CrawlStats,
  type IndustryGroup,
} from '@/lib/crawl-display';
import {
  buildCompanyAskUrl,
  coverageHasMatchingReport,
  hasQuestionIntent,
  matchCompany,
  parseHomeQuery,
  resolveListedCompany,
  periodLabelZh,
  pickBestReport,
  type ParsedPeriod,
} from '@/lib/home-search';
import type { Report } from '@/lib/detail-model';
import './report-home.css';

type SortMode = 'default' | 'popular';
type ViewMode = 'grid' | 'list';
type ListSortKey = 'name' | 'code' | 'industry' | 'revenue' | 'net_profit' | 'eps' | 'yoy' | 'updatedAt' | 'status';
type ListSortDir = 'asc' | 'desc';

type DialogState =
  | { kind: 'unrecognized'; query: string }
  | { kind: 'missing-company'; listed: { code: string; name: string }; query?: string }
  | { kind: 'missing-report'; company: CrawlCompanyCoverage; period: ParsedPeriod }
;

const VIEW_STORAGE_KEY = 'home_view_mode';
const STAR_STORAGE_KEY = 'home_starred_codes';

function deltaLabel(n: number | undefined) {
  return n === undefined ? '暂无同比' : `同比 ${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function matchKeyword(item: CrawlCompanyCoverage, keyword: string) {
  if (!keyword) return true;
  const hay = `${item.name} ${item.code} ${item.industry} ${item.industryGroup} ${item.theme ?? ''}`.toLowerCase();
  return keyword.split(/\s+/).filter(Boolean).every((part) => hay.includes(part));
}

function isConnected(item: CrawlCompanyCoverage) {
  return item.metrics.length > 0;
}

function statusMeta(item: CrawlCompanyCoverage) {
  if (item.metrics.length) return '已接入可读财报';
  if (item.covered || item.parseStatus === 'parsing') return '等待解析';
  if (item.parseStatus === 'failed') return '解析失败';
  return '等待抓取';
}

function metricByName(item: CrawlCompanyCoverage, name: string) {
  return item.metrics.find((m) => m.metric === name);
}

function primaryYoy(item: CrawlCompanyCoverage) {
  const revenue = metricByName(item, 'revenue');
  if (revenue) return yoyChange(revenue.value, revenue.prior);
  const profit = metricByName(item, 'net_profit');
  if (profit) return yoyChange(profit.value, profit.prior);
  return undefined;
}

function readStoredView(): ViewMode {
  if (typeof window === 'undefined') return 'grid';
  try {
    const raw = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return raw === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

function readStarredCodes(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STAR_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c): c is string => typeof c === 'string' && /^\d{6}$/.test(c));
  } catch {
    return [];
  }
}

function StarButton({
  code,
  starred,
  onToggle,
}: {
  code: string;
  starred: boolean;
  onToggle: (code: string) => void;
}) {
  return (
    <button
      type="button"
      className={`rh-star ${starred ? 'on' : ''}`}
      aria-pressed={starred}
      aria-label={starred ? '取消收藏' : '收藏'}
      title={starred ? '取消收藏' : '收藏'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(code);
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        {starred ? (
          <path
            fill="currentColor"
            d="M8 1.4l1.9 3.85 4.25.62-3.08 3 0.73 4.23L8 11.1l-3.8 2 0.73-4.23-3.08-3 4.25-.62L8 1.4z"
          />
        ) : (
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            d="M8 2.1l1.55 3.14 3.47.5-2.51 2.45.59 3.45L8 10.05l-3.1 1.63.59-3.45L3 5.74l3.47-.5L8 2.1z"
          />
        )}
      </svg>
    </button>
  );
}

export default function ReportHome() {
  const [coverage, setCoverage] = useState<CrawlCompanyCoverage[]>([]);
  const [stats, setStats] = useState<CrawlStats | null>(null);
  const [, setSource] = useState<'postgresql' | 'crawl-mock' | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [industry, setIndustry] = useState<IndustryGroup | '全部'>('全部');
  const [sortMode, setSortMode] = useState<SortMode>('default');
  const [viewMode, setViewMode] = useState<ViewMode>(() => readStoredView());
  const [listSort, setListSort] = useState<{ key: ListSortKey; dir: ListSortDir } | null>(null);
  const [waitToast, setWaitToast] = useState<string | null>(null);
  const [starred, setStarred] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);

  useEffect(() => {
    setStarred(readStarredCodes());
  }, []);

  const refreshCoverage = useCallback(async () => {
    try {
      const response = await fetch('/api/crawl', { cache: 'no-store' });
      if (!response.ok) throw new Error(`抓取接口 ${response.status}`);
      const payload = await response.json() as {
        source?: 'postgresql' | 'crawl-mock';
        stats: CrawlStats;
        companies: CrawlCompanyCoverage[];
        warning?: string;
      };
      setCoverage(payload.companies ?? []);
      setStats(payload.stats ?? null);
      setSource(payload.source ?? '');
      setError(payload.warning ?? (payload.source === 'crawl-mock' ? '当前展示为演示兜底数据（库为空或暂不可用）。' : ''));
    } catch (err) {
      setError(`真实数据暂时无法读取：${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCoverage();
    const timer = window.setInterval(() => { void refreshCoverage(); }, 5 * 60 * 1000);
    return () => { window.clearInterval(timer); };
  }, [refreshCoverage]);

  useEffect(() => {
    if (!waitToast) return;
    const timer = window.setTimeout(() => setWaitToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [waitToast]);

  const setView = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, mode);
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  const toggleStar = useCallback((code: string) => {
    setStarred((prev) => {
      const next = prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code];
      try {
        window.localStorage.setItem(STAR_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const starredSet = useMemo(() => new Set(starred), [starred]);

  const liveFilter = !hasQuestionIntent(search);
  const keyword = liveFilter ? search.trim().toLowerCase() : '';
  const filtered = useMemo(() => {
    let rows = coverage.filter((item) => matchKeyword(item, keyword));
    if (industry !== '全部') rows = rows.filter((item) => item.industryGroup === industry);
    rows = [...rows];

    if (listSort && viewMode === 'list') {
      const { key, dir } = listSort;
      const mul = dir === 'asc' ? 1 : -1;
      rows.sort((a, b) => {
        const av = (() => {
          if (key === 'name') return a.name;
          if (key === 'code') return a.code;
          if (key === 'industry') return a.industryGroup;
          if (key === 'revenue') return metricByName(a, 'revenue')?.value ?? -Infinity;
          if (key === 'net_profit') return metricByName(a, 'net_profit')?.value ?? -Infinity;
          if (key === 'eps') return metricByName(a, 'eps')?.value ?? -Infinity;
          if (key === 'yoy') return primaryYoy(a) ?? -Infinity;
          if (key === 'updatedAt') return a.lastCrawlAt ? new Date(a.lastCrawlAt).getTime() : 0;
          return statusMeta(a);
        })();
        const bv = (() => {
          if (key === 'name') return b.name;
          if (key === 'code') return b.code;
          if (key === 'industry') return b.industryGroup;
          if (key === 'revenue') return metricByName(b, 'revenue')?.value ?? -Infinity;
          if (key === 'net_profit') return metricByName(b, 'net_profit')?.value ?? -Infinity;
          if (key === 'eps') return metricByName(b, 'eps')?.value ?? -Infinity;
          if (key === 'yoy') return primaryYoy(b) ?? -Infinity;
          if (key === 'updatedAt') return b.lastCrawlAt ? new Date(b.lastCrawlAt).getTime() : 0;
          return statusMeta(b);
        })();
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul;
        return String(av).localeCompare(String(bv), 'zh-CN') * mul;
      });
    } else if (sortMode === 'popular') {
      rows.sort((a, b) => b.popularity - a.popularity || a.rank - b.rank);
    } else {
      rows.sort((a, b) => a.rank - b.rank || a.code.localeCompare(b.code));
    }

    // Starred companies first; keep relative order within each group.
    rows.sort((a, b) => Number(starredSet.has(b.code)) - Number(starredSet.has(a.code)));
    return rows;
  }, [coverage, keyword, industry, sortMode, listSort, viewMode, starredSet]);

  function cycleListSort(key: ListSortKey) {
    setListSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }

  function onEmptyCardActivate(e: MouseEvent | KeyboardEvent, item: CrawlCompanyCoverage) {
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(hover: none), (max-width: 760px)').matches;
    if (!isMobile) return;
    e.preventDefault();
    setWaitToast(`${item.name}（${item.code}）：等待抓取`);
  }

  async function navigateWithAsk(company: CrawlCompanyCoverage, question: string, period: ParsedPeriod) {
    const pre = coverageHasMatchingReport(company, period);
    let periodToken = period.token ?? null;
    let matched: Report | null = null;

    if (pre !== 'no') {
      try {
        const response = await fetch(`/api/reports?code=${encodeURIComponent(company.code)}&limit=100`, { cache: 'no-store' });
        if (response.ok) {
          const payload = await response.json() as { reports?: Report[] };
          matched = pickBestReport(payload.reports ?? [], period);
          if (matched?.metrics?.[0]?.period) periodToken = matched.metrics[0].period;
          else if (period.token) periodToken = period.token;
        }
      } catch {
        /* fall through — still navigate if coverage says yes */
      }
    }

    const periodSpecific = Boolean(period.year || period.kind || period.token || period.quarter);
    if (periodSpecific && !matched && pre !== 'yes') {
      setDialog({ kind: 'missing-report', company, period });
      return;
    }

    const url = buildCompanyAskUrl(company.code, question, periodToken);
    window.location.href = url;
  }

  async function onSearchSubmit() {
    const raw = search.trim();
    if (!raw || submitting) return;
    const parsed = parseHomeQuery(raw);

    // Pure 6-digit code without question → open company
    if (/^\d{6}$/.test(raw) && !parsed.hasQuestionIntent) {
      const hit = matchCompany(raw, coverage);
      if (!hit) {
        setDialog({ kind: 'unrecognized', query: raw });
        return;
      }
      window.location.href = `/${hit.code}`;
      return;
    }

    // Short name/code filter-only: keep filtering & scroll
    if (!parsed.hasQuestionIntent) {
      const hit = matchCompany(parsed.companyQuery || raw, coverage);
      if (hit && (parsed.companyQuery === hit.name || parsed.companyQuery === hit.code || /^\d{6}$/.test(raw))) {
        window.location.href = `/${hit.code}`;
        return;
      }
      document.getElementById('rh-companies')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    setSubmitting(true);
    try {
      // 1) Recognize listed company from A-share table (precise name/code, not AI)
      const listed = resolveListedCompany(raw) ?? resolveListedCompany(parsed.companyQuery || raw);
      if (!listed) {
        setDialog({ kind: 'unrecognized', query: raw });
        return;
      }
      // 2) Check whether it is in the active 60-company monitor pool
      const company = coverage.find((c) => c.code === listed.code)
        ?? matchCompany(listed.code, coverage)
        ?? matchCompany(listed.name, coverage);
      if (!company) {
        setDialog({ kind: 'missing-company', listed, query: raw });
        return;
      }
      await navigateWithAsk(company, raw, parsed.period);
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmMissingCompany() {
    if (!dialog || dialog.kind !== 'missing-company') return;
    const { listed } = dialog;
    setDialogBusy(true);
    try {
      const response = await fetch('/api/companies/watch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: listed.code }),
      });
      const payload = await response.json() as {
        ok?: boolean;
        error?: string;
        note?: string;
        enabledCount?: number;
      };
      if (!response.ok) {
        setWaitToast(payload.error ?? '加入监控池失败，请稍后重试');
        return;
      }
      setWaitToast(payload.note ?? `已将「${listed.name}」加入监控池`);
      setDialog(null);
      await refreshCoverage();
    } finally {
      setDialogBusy(false);
    }
  }

  async function confirmMissingReport() {
    if (!dialog || dialog.kind !== 'missing-report') return;
    const { company } = dialog;
    setDialogBusy(true);
    try {
      const response = await fetch('/api/crawl/trigger', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'backlog', codes: [company.code] }),
      });
      const payload = await response.json() as {
        ok?: boolean;
        error?: string;
        note?: string;
        downloaded?: number;
        parsed?: number;
        paused?: boolean;
      };
      if (!response.ok) {
        setWaitToast(payload.error ?? '采集触发失败，请稍后在「数据源采集」重试');
        setDialog(null);
        return;
      }
      setWaitToast(
        payload.note
          ?? `已为 ${company.name}（${company.code}）触发温和采集：下载 ${payload.downloaded ?? 0} · 解析 ${payload.parsed ?? 0}`,
      );
      setDialog(null);
    } catch (err) {
      setWaitToast(`网络异常：${String(err)}`);
      setDialog(null);
    } finally {
      setDialogBusy(false);
    }
  }

  const filtering = Boolean(keyword || industry !== '全部');

  return (
    <section className="rh-home">
      <header className="rh-intro">
        <h1>财报智析 Eva</h1>
        <p className="rh-intro-sub">问财报，有出处</p>
      </header>

      <form
        className="rh-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void onSearchSubmit();
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 5 5" />
        </svg>
        <input
          aria-label="搜索或提问：公司名称、股票代码，或自然语言问题"
          placeholder="问财报，例如：贵州茅台26年Q2半年报增长是否缓慢"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={submitting}
        />
        {search && (
          <button className="rh-clear" type="button" aria-label="清空搜索" onClick={() => setSearch('')}>
            ×
          </button>
        )}
        <button className="rh-search-submit" type="submit" disabled={submitting || !search.trim()} aria-label="搜索">
          {submitting ? '…' : <span aria-hidden="true">→</span>}
        </button>
      </form>

      {error && (
        <div className="rh-error" role="alert">
          {error}
        </div>
      )}

      <section className="rh-companies" id="rh-companies" aria-labelledby="rh-list-title">
        <div className="rh-filters" aria-label="筛选与排序">
          <div className="rh-filter-bar">
            <div className="rh-chip-row" role="radiogroup" aria-label="行业筛选">
              <button
                type="button"
                role="radio"
                aria-checked={industry === '全部'}
                className={industry === '全部' ? 'rh-chip active' : 'rh-chip'}
                onClick={() => setIndustry('全部')}
              >
                全部
              </button>
              {INDUSTRY_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  role="radio"
                  aria-checked={industry === chip}
                  className={industry === chip ? 'rh-chip active' : 'rh-chip'}
                  onClick={() => setIndustry(chip)}
                >
                  {chip}
                </button>
              ))}
            </div>
            <div className="rh-toolbar-right">
              <label className="rh-sort">
                <span>排序</span>
                <select
                  value={sortMode}
                  onChange={(e) => {
                    setSortMode(e.target.value as SortMode);
                    setListSort(null);
                  }}
                  aria-label="排序方式"
                >
                  <option value="default">默认</option>
                  <option value="popular">热门</option>
                </select>
              </label>
              <div className="rh-view-toggle" role="group" aria-label="视图切换">
                <button
                  type="button"
                  className={viewMode === 'grid' ? 'rh-view-btn active' : 'rh-view-btn'}
                  aria-label="网格视图"
                  aria-pressed={viewMode === 'grid'}
                  onClick={() => setView('grid')}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <rect x="1" y="1" width="6" height="6" rx="1" />
                    <rect x="9" y="1" width="6" height="6" rx="1" />
                    <rect x="1" y="9" width="6" height="6" rx="1" />
                    <rect x="9" y="9" width="6" height="6" rx="1" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={viewMode === 'list' ? 'rh-view-btn active' : 'rh-view-btn'}
                  aria-label="列表视图"
                  aria-pressed={viewMode === 'list'}
                  onClick={() => setView('list')}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <rect x="1" y="2" width="14" height="2" rx="0.5" />
                    <rect x="1" y="7" width="14" height="2" rx="0.5" />
                    <rect x="1" y="12" width="14" height="2" rx="0.5" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="rh-card-grid rh-card-grid-all" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rh-skeleton-card">
                <div className="rh-skel rh-skel-title" />
                <div className="rh-skel rh-skel-line" />
                <div className="rh-skel rh-skel-metrics" />
              </div>
            ))}
          </div>
        ) : viewMode === 'list' ? (
          <div className="rh-table-wrap">
            <table className="rh-table">
              <thead>
                <tr>
                  <th scope="col" className="rh-th-star">
                    <span className="sr-only">收藏</span>
                  </th>
                  {(
                    [
                      ['name', '名称'],
                      ['code', '代码'],
                      ['industry', '行业'],
                      ['revenue', '营收'],
                      ['net_profit', '净利润'],
                      ['eps', 'EPS'],
                      ['yoy', '同比'],
                      ['updatedAt', '更新'],
                      ['status', '状态'],
                    ] as Array<[ListSortKey, string]>
                  ).map(([key, label]) => {
                    const active = listSort?.key === key;
                    const arrow = !active ? '↕' : listSort?.dir === 'asc' ? '↑' : '↓';
                    return (
                      <th key={key} scope="col">
                        <button
                          type="button"
                          className={`rh-th-sort ${active ? 'active' : ''}`}
                          onClick={() => cycleListSort(key)}
                          aria-label={`${label}排序`}
                        >
                          {label}
                          <span aria-hidden="true">{arrow}</span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const connected = isConnected(item);
                  const revenue = metricByName(item, 'revenue');
                  const profit = metricByName(item, 'net_profit');
                  const eps = metricByName(item, 'eps');
                  const yoy = primaryYoy(item);
                  const isStarred = starredSet.has(item.code);
                  return (
                    <tr key={item.code} className={connected ? '' : 'rh-row-empty'}>
                      <td className="rh-td-star">
                        <StarButton code={item.code} starred={isStarred} onToggle={toggleStar} />
                      </td>
                      <td>
                        <Link href={`/${item.code}`} className="rh-table-name">
                          {item.name}
                        </Link>
                      </td>
                      <td>
                        <span className="rh-code-with-star">
                          {item.code}
                        </span>
                      </td>
                      <td>{item.industryGroup}</td>
                      <td>{revenue ? formatMetricValue('revenue', revenue.value) : '—'}</td>
                      <td>{profit ? formatMetricValue('net_profit', profit.value) : '—'}</td>
                      <td>{eps ? formatMetricValue('eps', eps.value) : '—'}</td>
                      <td>
                        {yoy === undefined ? (
                          '—'
                        ) : (
                          <span className={yoy >= 0 ? 'rh-ashare-up' : 'rh-ashare-down'}>
                            {yoy >= 0 ? '+' : ''}{yoy.toFixed(1)}%
                          </span>
                        )}
                      </td>
                      <td>{freshnessLabel(item.lastCrawlAt)}</td>
                      <td>{statusMeta(item)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rh-card-grid rh-card-grid-all">
            {filtered.map((item) => {
              const connected = isConnected(item);
              const isStarred = starredSet.has(item.code);
              if (!connected) {
                return (
                  <Link
                    key={item.code}
                    href={`/${item.code}`}
                    className="rh-company-card rh-company-card-empty"
                    aria-label={`${item.name} ${item.code}，等待抓取`}
                    title="等待抓取"
                    onClick={(e) => onEmptyCardActivate(e, item)}
                  >
                    <div className="rh-empty-card-body">
                      <h3>
                        {item.name}
                        <small className="rh-code-with-star">
                          {item.code}
                          <StarButton code={item.code} starred={isStarred} onToggle={toggleStar} />
                        </small>
                      </h3>
                    </div>
                    <span className="rh-empty-hover-tip" aria-hidden="true">等待抓取</span>
                    <div className="rh-card-meta">等待抓取</div>
                  </Link>
                );
              }

              const previewMetrics = item.metrics.slice(0, 3);
              return (
                <Link
                  key={item.code}
                  href={`/${item.code}`}
                  className="rh-company-card rh-company-card-connected"
                  aria-label={`查看${item.name}财报`}
                >
                  <span className="rh-connected-badge" title="已接入可读">
                    已接入可读
                  </span>
                  <div className="rh-card-top">
                    <div>
                      <h3>
                        {item.name}
                        <small className="rh-code-with-star">
                          {item.code}
                          <StarButton code={item.code} starred={isStarred} onToggle={toggleStar} />
                        </small>
                      </h3>
                      <p>
                        <span className="rh-industry-badge">{item.industryGroup}</span>
                        {item.theme ? <span>{item.theme}</span> : null}
                      </p>
                    </div>
                  </div>
                  <div className="rh-card-metrics rh-card-metrics-3">
                    {previewMetrics.map((metric) => {
                      const delta = yoyChange(metric.value, metric.prior);
                      return (
                        <div key={metric.metric}>
                          <span>{metric.label}</span>
                          <strong>{formatMetricValue(metric.metric, metric.value)}</strong>
                          {delta === undefined ? (
                            <small>暂无同比</small>
                          ) : (
                            <small className={delta >= 0 ? 'rh-ashare-up' : 'rh-ashare-down'}>
                              <span aria-hidden="true">{delta >= 0 ? '↑' : '↓'}</span> {deltaLabel(delta)}
                            </small>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="rh-card-meta">
                    <span>{freshnessLabel(item.lastCrawlAt)}</span>
                    <span>{statusMeta(item)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {!filtered.length && !loading && (
          <div className="rh-empty">
            <b>没有符合条件的公司</b>
            <p>试试调整行业，或换一个公司简称 / 六位代码；完整问题请点发送走追问路径。</p>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setIndustry('全部');
              }}
            >
              清除筛选
            </button>
          </div>
        )}
      </section>

      <footer className="rh-footnote">数据来自公开财报与公告列表温和轮询；关键数字可定位原文。内容仅供研究参考。</footer>

      {waitToast && (
        <div className="rh-wait-toast" role="status" aria-live="polite">
          {waitToast}
        </div>
      )}

      {dialog && (
        <div
          className="rh-dialog-backdrop"
          role="presentation"
          onClick={() => { if (!dialogBusy) setDialog(null); }}
        >
          <div
            className="rh-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rh-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            {dialog.kind === 'unrecognized' ? (
              <>
                <h2 id="rh-dialog-title">没有识别到上市公司</h2>
                <p>
                  未能从「{dialog.query}」中匹配到 A 股公司全称或六位代码。请换用官方简称（如「牧原股份」）或代码后再试；不会把整句问题当成公司名入库。
                </p>
                <div className="rh-dialog-actions">
                  <button type="button" className="rh-dialog-confirm" disabled={dialogBusy} onClick={() => setDialog(null)}>
                    知道了
                  </button>
                </div>
              </>
            ) : dialog.kind === 'missing-company' ? (
              <>
                <h2 id="rh-dialog-title">不在当前监控池，是否立即加入？</h2>
                <p>
                  已识别到上市公司「{dialog.listed.name}」（{dialog.listed.code}），但还不在当前 {stats?.universe ?? coverage.length} 家监控池。是否立即加入？
                </p>
                <div className="rh-dialog-actions">
                  <button type="button" className="rh-dialog-cancel" disabled={dialogBusy} onClick={() => setDialog(null)}>
                    取消
                  </button>
                  <button type="button" className="rh-dialog-confirm" disabled={dialogBusy} onClick={() => void confirmMissingCompany()}>
                    {dialogBusy ? '加入中…' : '确认加入'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 id="rh-dialog-title">
                  {periodLabelZh(dialog.period)}尚未下载，是否立即采集？
                </h2>
                <p>
                  {dialog.company.name}（{dialog.company.code}）在监控池内，但未找到匹配的
                  {periodLabelZh(dialog.period)}可读财报。确认后将对该代码触发一轮温和积压处理（每次最多下载/解析 1 份）。
                </p>
                <div className="rh-dialog-actions">
                  <button type="button" className="rh-dialog-cancel" disabled={dialogBusy} onClick={() => setDialog(null)}>
                    取消
                  </button>
                  <button type="button" className="rh-dialog-confirm" disabled={dialogBusy} onClick={() => void confirmMissingReport()}>
                    {dialogBusy ? '触发中…' : '立即采集'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
