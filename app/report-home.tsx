'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import {
  freshnessAt,
  freshnessLabel,
  freshnessTooltip,
  formatMetricValue,
  hasDownloadedPdf,
  hasReadableMetrics,
  INDUSTRY_CHIPS,
  yoyChange,
  type CrawlCompanyCoverage,
  type CrawlStats,
  type IndustryGroup,
} from '@/lib/crawl-display';
import {
  buildCompanyAskUrl,
  coverageHasMatchingReport,
  matchCompany,
  parseHomeQuery,
  queryMatchesCompany,
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
  | { kind: 'unrecognized'; query: string; suggestedCode?: string }
  | { kind: 'missing-company'; listed: { code: string; name: string }; query?: string }
  | { kind: 'missing-report'; company: CrawlCompanyCoverage; period: ParsedPeriod }
;

const SEARCH_PLACEHOLDERS = [
  '贵州茅台2026半年报增长是否缓慢？',
  '招商银行净利润同比怎么样？',
  '宁德时代毛利率最近怎么变？',
  '工业富联营收和净利谁更快？',
  '对比茅台和五粮液的ROE',
] as const;

const VIEW_STORAGE_KEY = 'home_view_mode';
const STAR_STORAGE_KEY = 'home_starred_codes';

function deltaLabel(n: number | undefined) {
  return n === undefined ? '暂无同比' : `同比 ${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function matchKeyword(item: CrawlCompanyCoverage, keyword: string) {
  return queryMatchesCompany(keyword, item);
}

function isConnected(item: CrawlCompanyCoverage) {
  return hasDownloadedPdf(item);
}

function statusMeta(item: CrawlCompanyCoverage) {
  if (hasReadableMetrics(item)) return '已接入';
  if (hasDownloadedPdf(item) && (item.parseStatus === 'failed' || item.parseError)) return '解析失败';
  if (hasDownloadedPdf(item) && item.parseStatus === 'parsing') return '已下载·解析中';
  if (hasDownloadedPdf(item) && item.parseStatus === 'queued') return '已下载·排队解析';
  if (hasDownloadedPdf(item)) return '已接入·待解析';
  if (item.parseStatus === 'failed') return '抓取失败';
  if (item.covered) return '已发现·待下载';
  return '等待抓取';
}

function recentPeriodTokens(item: CrawlCompanyCoverage) {
  const periods = item.recentPeriods?.filter(Boolean).slice(0, 6) ?? [];
  if (periods.length) return periods;
  if (item.reportPeriod) return [item.reportPeriod];
  return [] as string[];
}

function recentPeriodsLabel(item: CrawlCompanyCoverage) {
  return recentPeriodTokens(item).join(' | ');
}

function shortParseError(err: string | null | undefined) {
  if (!err) return '解析未完成，可在数据采集页重试';
  const one = err.replace(/\s+/g, ' ').trim();
  return one.length > 72 ? `${one.slice(0, 72)}…` : one;
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
  const [crawlingCodes, setCrawlingCodes] = useState<string[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [joinName, setJoinName] = useState('');
  /** Card grid: show 3 rows first, then reveal one-by-one as user scrolls. */
  const [visibleCardCount, setVisibleCardCount] = useState(9);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);


  useEffect(() => {
    setStarred(readStarredCodes());
  }, []);

  useEffect(() => {
    if (search.trim()) return;
    const timer = window.setInterval(() => {
      setPlaceholderIndex((i) => (i + 1) % SEARCH_PLACEHOLDERS.length);
    }, 4800);
    return () => window.clearInterval(timer);
  }, [search]);

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

  useEffect(() => {
    if (!dialog || dialog.kind !== 'unrecognized') return;
    const fromQuery = dialog.suggestedCode
      ?? dialog.query.match(/(?<!\d)(\d{6})(?!\d)/)?.[1]
      ?? '';
    setJoinCode(fromQuery);
    setJoinName('');
  }, [dialog]);

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

  const parsedSearch = useMemo(() => parseHomeQuery(search), [search]);
  const recognizedListed = useMemo(() => {
    const raw = search.trim();
    if (!raw) return null;
    return resolveListedCompany(raw) ?? resolveListedCompany(parsedSearch.companyQuery || raw);
  }, [search, parsedSearch.companyQuery]);
  const keyword = search.trim();
  const filtered = useMemo(() => {
    let rows = coverage;
    if (recognizedListed) {
      rows = coverage.filter((item) => item.code === recognizedListed.code);
    } else if (keyword) {
      rows = coverage.filter((item) => matchKeyword(item, parsedSearch.companyQuery || keyword));
      // Free-text questions without a resolvable company keep the full card grid.
      if (parsedSearch.hasQuestionIntent && !parsedSearch.companyQuery) rows = coverage;
    }
    if (industry !== '全部' && !recognizedListed) rows = rows.filter((item) => item.industryGroup === industry);
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
      rows.sort((a, b) => Number(hasReadableMetrics(b)) - Number(hasReadableMetrics(a)) || Number(isConnected(b)) - Number(isConnected(a)) || b.popularity - a.popularity || a.rank - b.rank);
    } else {
      rows.sort((a, b) => Number(hasReadableMetrics(b)) - Number(hasReadableMetrics(a)) || Number(isConnected(b)) - Number(isConnected(a)) || a.rank - b.rank || a.code.localeCompare(b.code));
    }

    // Starred companies first; keep relative order within each group.
    rows.sort((a, b) => Number(starredSet.has(b.code)) - Number(starredSet.has(a.code)));
    return rows;
  }, [coverage, keyword, industry, sortMode, listSort, viewMode, starredSet, recognizedListed, parsedSearch]);

  const gridCols = viewMode === 'list' ? 1 : 3;
  const initialRows = 3;
  const initialCards = gridCols * initialRows;

  useEffect(() => {
    setVisibleCardCount(initialCards);
  }, [initialCards, keyword, industry, sortMode, viewMode, listSort]);

  const visibleCards = useMemo(
    () => (viewMode === 'list' ? filtered : filtered.slice(0, visibleCardCount)),
    [filtered, viewMode, visibleCardCount],
  );
  const hasMoreCards = viewMode !== 'list' && visibleCardCount < filtered.length;

  useEffect(() => {
    if (!hasMoreCards) return;
    const node = loadMoreRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setVisibleCardCount((n) => Math.min(filtered.length, n + 1));
      },
      { root: null, rootMargin: '200px 0px', threshold: 0 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasMoreCards, filtered.length, visibleCardCount]);


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

  async function onSearchSubmit(override?: string) {
    const raw = (override ?? search).trim();
    if (!raw || submitting) return;
    const parsed = parseHomeQuery(raw);

    // Pure 6-digit code without question → open, join if listed, or offer code-join dialog
    if (/^\d{6}$/.test(raw) && !parsed.hasQuestionIntent) {
      const hit = matchCompany(raw, coverage);
      if (hit) {
        window.location.href = `/${hit.code}`;
        return;
      }
      const listed = resolveListedCompany(raw);
      if (listed) {
        setDialog({ kind: 'missing-company', listed, query: raw });
        return;
      }
      setDialog({ kind: 'unrecognized', query: raw, suggestedCode: raw });
      return;
    }

    // Short name/code filter-only: open company, or offer to join monitor pool if only in 全量识别名录.
    if (!parsed.hasQuestionIntent) {
      const hit = matchCompany(parsed.companyQuery || raw, coverage)
        ?? matchCompany(raw, coverage);
      if (hit) {
        window.location.href = `/${hit.code}`;
        return;
      }
      const listed = resolveListedCompany(raw) ?? resolveListedCompany(parsed.companyQuery || raw);
      if (listed) {
        setDialog({ kind: 'missing-company', listed, query: raw });
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
        body: JSON.stringify({ code: listed.code, name: listed.name }),
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
        setWaitToast(payload.error ?? '采集触发失败，请稍后在「数据采集」重试');
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

  async function triggerHomeCrawl(item: CrawlCompanyCoverage, e?: MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    if (crawlingCodes.includes(item.code)) {
      window.location.href = `/sources?focus=${encodeURIComponent(item.code)}`;
      return;
    }
    setCrawlingCodes((prev) => (prev.includes(item.code) ? prev : [...prev, item.code]));
    setWaitToast(`${item.name}（${item.code}）：正在发现并下载财报…`);
    try {
      const response = await fetch('/api/crawl/trigger', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'backlog', codes: [item.code] }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; note?: string; paused?: boolean };
      if (!response.ok) {
        setCrawlingCodes((prev) => prev.filter((c) => c !== item.code));
        setWaitToast(payload.error ?? '立即抓取失败，请在数据源页确认自动抓取已开启');
        return;
      }
      setWaitToast(payload.note ?? `${item.name}：已进入抓取队列`);
    } catch (err) {
      setCrawlingCodes((prev) => prev.filter((c) => c !== item.code));
      setWaitToast(`网络异常：${String(err)}`);
      return;
    }
    window.location.href = `/sources?focus=${encodeURIComponent(item.code)}`;
  }

  async function joinByCodeFromDialog() {
    if (!dialog || dialog.kind !== 'unrecognized') return;
    const code = joinCode.trim();
    const name = joinName.trim();
    if (!/^\d{6}$/.test(code)) {
      setWaitToast('请填写有效的六位股票代码');
      return;
    }
    setDialogBusy(true);
    try {
      const response = await fetch('/api/companies/watch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, ...(name ? { name } : {}) }),
      });
      const payload = await response.json() as {
        ok?: boolean;
        error?: string;
        note?: string;
        needName?: boolean;
      };
      if (!response.ok) {
        setWaitToast(payload.error ?? '加入监控池失败');
        if (payload.needName) {
          /* keep dialog open for name */
        }
        return;
      }
      setWaitToast(payload.note ?? `已将 ${code} 加入监控池`);
      setDialog(null);
      setSearch('');
      await refreshCoverage();
    } finally {
      setDialogBusy(false);
    }
  }

  async function reportMissingToAdmin() {
    if (!dialog || dialog.kind !== 'unrecognized') return;
    setDialogBusy(true);
    try {
      const response = await fetch('/api/companies/report-missing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: dialog.query,
          ...(joinCode.trim() ? { code: joinCode.trim() } : {}),
          ...(joinName.trim() ? { name: joinName.trim() } : {}),
        }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; note?: string };
      if (!response.ok) {
        setWaitToast(payload.error ?? '上报失败，请稍后重试');
        return;
      }
      setWaitToast(payload.note ?? '已上报给管理员');
      setDialog(null);
    } finally {
      setDialogBusy(false);
    }
  }

  const listedOutsidePool = recognizedListed
    && !coverage.some((item) => item.code === recognizedListed.code)
    ? recognizedListed
    : null;

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
          placeholder={SEARCH_PLACEHOLDERS[placeholderIndex]}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={submitting}
        />
        {search && (
          <button className="rh-clear" type="button" aria-label="清空搜索" onClick={() => setSearch('')}>
            ×
          </button>
        )}
        <button
          className="rh-search-submit"
          type="button"
          disabled={submitting}
          aria-label={search.trim() ? '搜索' : '用当前示例提问'}
          title={search.trim() ? '搜索' : '发送示例问题'}
          onClick={() => {
            const q = search.trim() || SEARCH_PLACEHOLDERS[placeholderIndex];
            if (!search.trim()) setSearch(q);
            void onSearchSubmit(q);
          }}
        >
          {submitting ? (
            <span className="rh-search-spinner" aria-hidden="true" />
          ) : (
            <svg className="rh-search-arrow" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path fill="currentColor" d="M12.75 5.25a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 1 1-1.06-1.06L15.94 12H5.25a.75.75 0 0 1 0-1.5h10.69l-3.22-3.22a.75.75 0 0 1 0-1.06Z" />
            </svg>
          )}
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
            {visibleCards.map((item) => {
              const downloaded = isConnected(item);
              const readable = hasReadableMetrics(item);
              const isStarred = starredSet.has(item.code);
              const isCrawling = crawlingCodes.includes(item.code);
              if (!downloaded) {
                return (
                  <div
                    key={item.code}
                    className={`rh-company-card rh-company-card-empty ${isCrawling ? 'rh-crawling' : ''}`}
                  >
                    {isCrawling ? (
                      <span className="rh-crawling-badge" title="抓取中">抓取中</span>
                    ) : (
                      <button
                        type="button"
                        className="rh-crawl-now-btn"
                        aria-label={`立即抓取 ${item.name}`}
                        title="立即抓取"
                        onClick={(e) => void triggerHomeCrawl(item, e)}
                      >
                        立即抓取
                      </button>
                    )}
                    <Link
                      href={`/${item.code}`}
                      className="rh-empty-card-link"
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
                      <div className="rh-card-meta">{isCrawling ? '抓取中' : '等待抓取'}</div>
                    </Link>
                  </div>
                );
              }

              const previewMetrics = item.metrics.slice(0, 3);
              const periodTokens = recentPeriodTokens(item);
              const freshIso = freshnessAt(item);
              const parseFailed = !readable && (item.parseStatus === 'failed' || Boolean(item.parseError));
              const cardState = readable ? '' : parseFailed ? ' rh-company-card-failed' : ' rh-company-card-parsing';
              return (
                <div
                  key={item.code}
                  className={`rh-company-card rh-company-card-connected${cardState}`}
                >
                  {parseFailed ? (
                    <Link
                      href={`/sources?focus=${item.code}`}
                      className="rh-connected-badge rh-connected-badge-failed"
                      title="打开数据采集页处理解析失败"
                      onClick={(e) => e.stopPropagation()}
                    >
                      解析失败
                    </Link>
                  ) : (
                    <span className="rh-connected-badge" title="财报 PDF 已下载">
                      已接入
                    </span>
                  )}
                  <Link
                    href={`/${item.code}`}
                    className="rh-card-main"
                    aria-label={
                      readable
                        ? `查看${item.name}财报`
                        : parseFailed
                          ? `${item.name}财报解析失败`
                          : `${item.name}财报已下载，指标解析中`
                    }
                  >
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
                      {!readable ? (
                        <div className="rh-metric-empty">
                          <span>指标</span>
                          <strong>{parseFailed ? '解析失败' : '解析中'}</strong>
                          <small>{parseFailed ? shortParseError(item.parseError) : 'PDF 已下载，核心指标尚未就绪'}</small>
                        </div>
                      ) : null}
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
                  </Link>
                  <div className="rh-card-meta">
                    <div className="rh-periods">
                      {periodTokens.length ? (
                        periodTokens.map((token) => (
                          <Link
                            key={token}
                            href={`/${item.code}?period=${encodeURIComponent(token)}`}
                            className="rh-period-btn"
                            title={`打开 ${token} 报告`}
                          >
                            {token}
                          </Link>
                        ))
                      ) : (
                        <span className="rh-periods-empty">暂无期次</span>
                      )}
                    </div>
                    <span className="rh-freshness" title={freshnessTooltip(item)}>
                      {freshnessLabel(freshIso)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {hasMoreCards ? (
          <div ref={loadMoreRef} className="rh-load-more" aria-hidden="true">
            <span>加载更多…</span>
          </div>
        ) : null}

        {!filtered.length && !loading && (
          <div className="rh-empty">
            <b>没有符合条件的公司</b>
            {listedOutsidePool ? (
              <>
                <p>
                  已识别到「{listedOutsidePool.name}」（{listedOutsidePool.code}），但不在当前监控池。
                </p>
                <button
                  type="button"
                  onClick={() => setDialog({ kind: 'missing-company', listed: listedOutsidePool, query: search.trim() })}
                >
                  加入监控池
                </button>
              </>
            ) : (
              <>
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
              </>
            )}
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
                  未能从「{dialog.query}」匹配到 A 股公司。不会把自由文本当成公司名交给 AI。
                  若已知六位代码，可填写后加入监控池；也可上报管理员补全识别名录。
                </p>
                <div className="rh-dialog-fields">
                  <label>
                    <span>六位代码</span>
                    <input
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="例如 688802"
                      value={joinCode}
                      disabled={dialogBusy}
                      onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    />
                  </label>
                  <label>
                    <span>公司简称（可选）</span>
                    <input
                      placeholder="例如 沐曦股份"
                      value={joinName}
                      disabled={dialogBusy}
                      onChange={(e) => setJoinName(e.target.value)}
                    />
                  </label>
                </div>
                <div className="rh-dialog-actions rh-dialog-actions-wrap">
                  <button type="button" className="rh-dialog-cancel" disabled={dialogBusy} onClick={() => setDialog(null)}>
                    取消
                  </button>
                  <button type="button" className="rh-dialog-secondary" disabled={dialogBusy} onClick={() => void reportMissingToAdmin()}>
                    {dialogBusy ? '上报中…' : '上报管理员'}
                  </button>
                  <button
                    type="button"
                    className="rh-dialog-confirm"
                    disabled={dialogBusy || !/^\d{6}$/.test(joinCode.trim())}
                    onClick={() => void joinByCodeFromDialog()}
                  >
                    {dialogBusy ? '加入中…' : '填写代码加入'}
                  </button>
                </div>
              </>
            ) : dialog.kind === 'missing-company' ? (
              <>
                <h2 id="rh-dialog-title">加入监控池</h2>
                <p>
                  已识别到「{dialog.listed.name}」（{dialog.listed.code}），但不在当前监控池。
                </p>
                <div className="rh-dialog-actions">
                  <button type="button" className="rh-dialog-cancel" disabled={dialogBusy} onClick={() => setDialog(null)}>
                    取消
                  </button>
                  <button type="button" className="rh-dialog-confirm" disabled={dialogBusy} onClick={() => void confirmMissingCompany()}>
                    {dialogBusy ? '加入中…' : '加入监控池'}
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