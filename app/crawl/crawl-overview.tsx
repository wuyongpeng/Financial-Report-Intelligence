'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import {
  freshnessLabel,
  METRIC_LABELS,
  periodStateLabel,
  reportTypeLabel,
  hasDownloadedPdf,
  type CrawlCompanyCoverage,
  type CrawlPeriodStatus,
  type CrawlSourceKind,
  type CrawlStats,
  type ParseStatus,
} from '@/lib/crawl-display';
import { matchesCompanyQuery } from '@/lib/company-query';
import { periodMeetsAutoCutoff } from '@/lib/ingest-lookback';
import './crawl-overview.css';

type SourceFilter = 'all' | CrawlSourceKind;
type SortState = 'default' | 'asc' | 'desc';
type QueueItem = {
  code: string;
  name: string;
  label?: string;
  period?: string;
  status: string;
  stage: 'download' | 'parse';
  position: number;
  title?: string;
  parseError?: string | null;
  pdfKey?: string | null;
  reason?: string;
  rawStatus?: string;
  source?: string;
  progress?: string;
  startedAt?: string;
  ageMs?: number;
  waitSec?: number;
};

type LivePayload = {
  running: boolean;
  autoCrawlEnabled?: boolean;
  downloadPaused?: boolean;
  downloadGate?: { nextAt: string | null; pauseMs: number; mode: string };
  lastPollAt: string | null;
  counts: {
    discovered: number;
    downloaded: number;
    pending_download: number;
    pending_parse: number;
    parsing?: number;
    parse_parked?: number;
    review: number;
    online: number;
    ingested?: number;
    target_companies: number;
    download_failed: number;
  };
  downloadSlots: { used: number; max: number };
  parseSlots: { used: number; max: number };
  queueItems?: QueueItem[];
  activeItems?: QueueItem[];
  activeParseItems?: QueueItem[];
  pendingParseItems?: QueueItem[];
  recentDownloads?: QueueItem[];
  queueTotal?: number;
  queueShown?: number;
  stages?: Array<{ id: string; label: string; count: number; capacity?: number; active?: boolean }>;
  health?: Array<{
    source: string;
    ok: boolean | null;
    lastCount: number;
    consecutiveFailures: number;
    lastError: string | null;
  }>;
  limits: {
    intervalMs: number;
    downloadLimit: number;
    parseLimit: number;
    pagePauseMs: number;
    downloadPauseMs: number;
    maxPages?: number;
    downloadTimeoutMs?: number;
    parseTimeoutMs?: number;
    queueMax?: number | null;
  };
};

function formatCrawlTime(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function statusClass(status: ParseStatus) {
  if (status === 'completed') return 'ok';
  if (status === 'parsing') return 'busy';
  if (status === 'queued') return 'pending';
  if (status === 'pending') return 'pending';
  return 'fail';
}

function metricLabel(name: string) {
  const map: Record<string, string> = { revenue: '营收', net_profit: '净利', eps: 'EPS', roe: 'ROE' };
  return map[name] ?? name;
}

function cycleSort(current: SortState): SortState {
  if (current === 'default') return 'asc';
  if (current === 'asc') return 'desc';
  return 'default';
}


function sourceApiLabel(item: CrawlCompanyCoverage) {
  if (item.sourceApi) {
    if (item.sourceApi === 'CNINFO') return '巨潮资讯 CNINFO';
    if (item.sourceApi === 'SSE') return '上交所 SSE';
    if (item.sourceApi === 'SZSE') return '深交所 SZSE';
    return item.sourceApi;
  }
  if (item.source === 'exchange') return item.exchange === 'SSE' ? '上交所 SSE' : '深交所 SZSE';
  if (item.source === 'cninfo') return '巨潮资讯 CNINFO';
  return '尚未命中';
}

type SourceProbe = {
  source: string;
  ok: boolean | null;
  lastError?: string | null;
  latencyMs?: number | null;
  detail?: string | null;
};

const SOURCE_META: Record<string, { short: string; name: string; url: string }> = {
  SSE: { short: 'SSE', name: '上海证券交易所', url: 'https://www.sse.com.cn/' },
  SZSE: { short: 'SZSE', name: '深圳证券交易所', url: 'https://www.szse.cn/' },
  BSE: { short: 'BSE', name: '北京证券交易所', url: 'https://www.bse.cn/' },
  CNINFO: { short: '巨潮', name: '巨潮资讯网', url: 'https://www.cninfo.com.cn/' },
};

function SourceDots({ health }: { health: SourceProbe[] | undefined }) {
  const rows: SourceProbe[] = health?.length
    ? health
    : [
        { source: 'SSE', ok: null },
        { source: 'SZSE', ok: null },
        { source: 'BSE', ok: null },
        { source: 'CNINFO', ok: null },
      ];
  return (
    <span className="co-sb-sources" aria-label="数据源连通性">
      <span className="co-sb-label">数据源</span>
      {rows.map((item) => {
        const meta = SOURCE_META[item.source] ?? { short: item.source, name: item.source, url: '#' };
        const ok = item.ok;
        const cls = ok === null ? 'unknown' : ok ? 'ok' : 'fail';
        const status = ok === null ? '未检测' : ok ? '连通正常' : `异常${item.lastError ? ` · ${item.lastError}` : ''}`;
        return (
          <span key={item.source} className="co-sb-src">
            <span className="co-sb-src-label">
              {meta.short} <i className={`co-sb-dot ${cls}`} aria-hidden="true" />
            </span>
            <span className="co-sb-src-tip" role="tooltip">
              <strong>{meta.name}</strong>
              <em>{status}</em>
              <a href={meta.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                打开官网 ↗
              </a>
            </span>
          </span>
        );
      })}
    </span>
  );
}

function sourceShort(source?: string | null) {
  if (!source) return '';
  if (source === 'CNINFO') return '巨潮';
  if (source === 'SSE') return '上交所';
  if (source === 'SZSE') return '深交所';
  if (source === 'BSE') return '北交所';
  return source;
}

function QueuePopover({
  open,
  title,
  items,
  empty,
  onClose,
  anchorRef,
  note,
}: {
  open: boolean;
  title: string;
  items: Array<{
    code: string;
    name: string;
    label?: string;
    period?: string;
    position: number;
    status?: string;
    source?: string;
    reason?: string;
    progress?: string;
    waitSec?: number;
  }>;
  empty: string;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  note?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function place() {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(380, window.innerWidth - 24);
      let left = r.left;
      if (left + width > window.innerWidth - 12) left = Math.max(12, window.innerWidth - width - 12);
      setPos({ top: r.bottom + 8, left });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !pos) return null;
  const style: CSSProperties = {
    position: 'fixed',
    top: pos.top,
    left: pos.left,
    zIndex: 400,
  };
  return (
    <div className="co-sb-pop" ref={panelRef} role="dialog" aria-label={title} style={style}>
      <header>
        <strong>{title}</strong>
        <span>{items.length} 项</span>
      </header>
      {note ? <p className="co-sb-pop-note">{note}</p> : null}
      <ul>
        {items.length ? items.map((item) => (
          <li key={`${item.code}-${item.position}-${item.period ?? ''}-${item.source ?? ''}`}>
            <div className="co-sb-pop-main">
              <b>{item.label || (item.period ? `${item.name} ${item.period}` : item.name)}</b>
              <span className="co-sb-pop-meta">
                {typeof item.waitSec === 'number' && item.waitSec > 0 ? (
                  <em className="co-sb-pop-wait">{item.waitSec}s</em>
                ) : null}
                <em className="co-sb-pop-code">{item.code}</em>
                {item.source ? <em className="co-sb-pop-src">{sourceShort(item.source)}</em> : null}
                <em>#{item.position}</em>
              </span>
            </div>
            {(item.reason || item.progress) ? (
              <div className="co-sb-pop-reason">{item.progress || item.reason}</div>
            ) : null}
          </li>
        )) : (
          <li className="co-sb-pop-empty">{empty}</li>
        )}
      </ul>
    </div>
  );
}

function SortHeader({
  label,
  state,
  onCycle,
}: {
  label: string;
  state: SortState;
  onCycle: () => void;
}) {
  return (
    <button
      type="button"
      className={`co-sort-btn ${state !== 'default' ? 'active' : ''} ${state === 'asc' ? 'asc' : ''} ${state === 'desc' ? 'desc' : ''}`}
      onClick={onCycle}
      aria-label={`${label}排序，当前${state === 'default' ? '默认' : state === 'asc' ? '升序' : '降序'}`}
    >
      <span>{label}</span>
      <span className="co-sort-caret" aria-hidden="true">
        <i className="co-caret-top" />
        <i className="co-caret-bottom" />
      </span>
    </button>
  );
}


function sourceApiShort(api?: string | null) {
  if (!api) return '尚未抓取';
  if (api === 'CNINFO') return '巨潮资讯';
  if (api === 'SSE') return '上交所';
  if (api === 'SZSE') return '深交所';
  if (api === 'BSE') return '北交所';
  return api;
}

function periodPipelineLabel(p: CrawlPeriodStatus) {
  if (p.state === 'parsed') return '已解析 · 指标完整';
  if (p.state === 'parsed_partial') {
    const miss = (p.missingMetrics ?? []).map((m) => METRIC_LABELS[m] ?? m).join('、');
    return miss ? `已解析 · 指标不完整，缺少 ${miss}` : '已解析 · 指标不完整';
  }
  if (p.state === 'failed') return p.parseError ? `解析失败 · ${p.parseError}` : '解析失败';
  if (p.state === 'downloaded') return '已下载 · 待解析';
  if (p.state === 'discovered') return '已发现 · 待下载';
  return '待抓取';
}

function periodChipTitle(p: CrawlPeriodStatus) {
  const lines = [
    `${p.period} · ${periodStateLabel(p.state)}`,
    `来源：${sourceApiShort(p.sourceApi)}`,
    periodPipelineLabel(p),
  ];
  if (p.discoveredAt) lines.push(`发现：${formatCrawlTime(p.discoveredAt ?? null)}`);
  if (p.downloadedAt) lines.push(`抓取：${formatCrawlTime(p.downloadedAt ?? null)}`);
  if (p.parsedAt) lines.push(`解析：${formatCrawlTime(p.parsedAt ?? null)}`);
  if (p.title) lines.push(p.title.replace(/\s+/g, ' ').slice(0, 48));
  return lines.join('\n');
}


function IndustryTag({ item }: { item: Pick<CrawlCompanyCoverage, 'industry' | 'industryGroup'> }) {
  const l1 = (item.industryGroup || '').trim();
  const l2 = (item.industry || '').trim();
  if (!l1 && !l2) return null;
  if (l1 && l2 && l1 !== l2) {
    return (
      <div className="co-industry">
        <span>{l1}</span>
        <i aria-hidden="true">/</i>
        <span>{l2}</span>
      </div>
    );
  }
  return <div className="co-industry"><span>{l2 || l1}</span></div>;
}

function PeriodChips({ periods }: { periods?: CrawlPeriodStatus[] }) {
  // Exactly 2 rows × up to 3 chips (newest first from API).
  const list = (periods ?? []).filter((p) => !p.period || p.period === '最新' || periodMeetsAutoCutoff(p.period)).slice(0, 6);
  if (!list.length) return <div className="co-sub">暂无报告期</div>;
  const row1 = list.slice(0, 3);
  const row2 = list.slice(3, 6);
  const chip = (p: CrawlPeriodStatus) => (
    <span key={p.period} className={`co-period ${p.state}`} data-tip={periodChipTitle(p)}>
      {p.period}
      <i>{periodStateLabel(p.state)}</i>
      {p.sourceApi ? <em className="co-period-src">{sourceApiShort(p.sourceApi)}</em> : null}
    </span>
  );
  return (
    <div className="co-period-chips" aria-label="公告期次">
      <div className="co-period-row">{row1.map(chip)}</div>
      {row2.length > 0 ? <div className="co-period-row">{row2.map(chip)}</div> : null}
    </div>
  );
}

function queueDisplayName(item: Pick<QueueItem, 'name' | 'label' | 'period' | 'title'>) {
  if (item.label) return item.label;
  if (item.period) return `${item.name} ${item.period}`;
  return item.name;
}


export default function CrawlOverview() {
  const searchParams = useSearchParams();
  const focusParam = (searchParams.get('focus') ?? '').trim();
  const focusCode = /^\d{6}$/.test(focusParam) ? focusParam : '';
  const focusHandled = useRef<string | null>(null);
  const [all, setAll] = useState<CrawlCompanyCoverage[]>([]);
  const [stats, setStats] = useState<CrawlStats | null>(null);
  const [live, setLive] = useState<LivePayload | null>(null);
  const [sourceProbes, setSourceProbes] = useState<SourceProbe[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<SourceFilter>('all');
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [onlyParsing, setOnlyParsing] = useState(false);
  const [timeSort, setTimeSort] = useState<SortState>('default');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [queuePopover, setQueuePopover] = useState<null | 'download' | 'parse' | 'downloading' | 'parsing'>(null);
  const [queueWaitTick, setQueueWaitTick] = useState(0);
  const dlQueueBtnRef = useRef<HTMLButtonElement>(null);
  const dlActiveBtnRef = useRef<HTMLButtonElement>(null);
  const parseQueueBtnRef = useRef<HTMLButtonElement>(null);
  const parseActiveBtnRef = useRef<HTMLButtonElement>(null);
  const [autoCrawlEnabled, setAutoCrawlEnabled] = useState(true);
  const [downloadPaused, setDownloadPaused] = useState(false);
  const [autoCrawlSaving, setAutoCrawlSaving] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState('');
  const [priorityCodes, setPriorityCodes] = useState<string[]>([]);
  const [rowTriggering, setRowTriggering] = useState<string | null>(null);
  const [actionConfirm, setActionConfirm] = useState<null | {
    mode: 'crawl' | 'parse';
    code: string;
    name: string;
    period?: string;
    periodStatus?: CrawlPeriodStatus;
    title: string;
    body: ReactNode;
    okLabel: string;
  }>(null);
  const [periodPicker, setPeriodPicker] = useState<null | {
    mode: 'crawl' | 'parse';
    code: string;
    name: string;
    options: import('@/lib/crawl-display').CrawlPeriodStatus[];
  }>(null);
  const [pickedPeriod, setPickedPeriod] = useState<string>('');

  const refreshCoverage = useCallback(async () => {
    try {
      const response = await fetch('/api/crawl', { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json() as {
        source?: string;
        stats: CrawlStats;
        companies: CrawlCompanyCoverage[];
      };
      setAll(payload.companies ?? []);
      setStats(payload.stats ?? null);
    } catch {
      /* coverage fetch failed; keep last good snapshot */
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshLive = useCallback(async () => {
    try {
      const response = await fetch('/api/crawl/live', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json() as LivePayload;
      setLive(payload);
      if (typeof payload.autoCrawlEnabled === 'boolean') {
        setAutoCrawlEnabled(payload.autoCrawlEnabled);
      }
      if (typeof payload.downloadPaused === 'boolean') {
        setDownloadPaused(payload.downloadPaused);
      }
    } catch {
      /* live bar is optional; coverage table still works */
    }
  }, []);

  const probeSources = useCallback(async () => {
    try {
      const response = await fetch('/api/crawl/sources-health', { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json() as {
        sources?: Array<{ source: string; ok: boolean; latencyMs: number | null; detail: string; lastError: string | null }>;
      };
      setSourceProbes((payload.sources ?? []).map((row) => ({
        source: row.source,
        ok: row.ok,
        latencyMs: row.latencyMs,
        detail: row.detail,
        lastError: row.lastError,
      })));
      void refreshLive();
    } catch {
      setTriggerMsg('来源连通检测失败，请稍后重试');
      window.setTimeout(() => setTriggerMsg(''), 4000);
    } finally {
    }
  }, [refreshLive]);


  useEffect(() => {
    void refreshCoverage();
    void refreshLive();
    void probeSources();
    const coverageTimer = window.setInterval(() => void refreshCoverage(), 5 * 60 * 1000);
    const liveTimer = window.setInterval(() => void refreshLive(), 15_000);
    return () => {
      window.clearInterval(coverageTimer);
      window.clearInterval(liveTimer);
    };
  }, [refreshCoverage, refreshLive, probeSources]);


  // 采集页打开时每 20s 软消化一轮积压（不替代 worker）。
  // 自动关时 API 仍消化已有排队，但不补发现/缺口。
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        await fetch('/api/crawl/trigger', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'backlog' }),
        });
        if (!cancelled) void refreshLive();
      } catch { /* ignore */ }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 20_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [refreshLive]);


  // Popover open on 排队下载 → tick countdown every 1s from live.waitSec baseline.
  useEffect(() => {
    if (queuePopover !== 'download') return;
    setQueueWaitTick(0);
    const id = window.setInterval(() => setQueueWaitTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [queuePopover, live?.downloadGate?.nextAt]);

  // Queue / in-flight non-empty → 5s partial live refresh (not full page reload).
  const queueBusy = Boolean(
    live?.running
    || (live?.queueItems?.length ?? 0) > 0
    || (live?.activeItems?.length ?? 0) > 0
    || (live?.counts.pending_download ?? 0) > 0
    || (live?.counts.pending_parse ?? 0) > 0
    || priorityCodes.length > 0,
  );
  useEffect(() => {
    if (!queueBusy) return;
    // 有待下载时更勤快刷新，避免「抓取中」一闪而过看不见
    const ms = (live?.counts.pending_download ?? 0) > 0 || (live?.downloadSlots.used ?? 0) > 0 ? 2_500 : 5_000;
    const timer = window.setInterval(() => {
      void refreshLive();
      void refreshCoverage();
    }, ms);
    return () => window.clearInterval(timer);
  }, [queueBusy, refreshLive, refreshCoverage, live?.counts.pending_download, live?.downloadSlots.used]);

  useEffect(() => {
    if (!focusCode) return;
    setPriorityCodes((prev) => [focusCode, ...prev.filter((c) => c !== focusCode)].slice(0, 12));
    setSearch((prev) => prev || focusCode);
    setExpanded(focusCode);
  }, [focusCode]);

  useEffect(() => {
    if (!focusCode || loading || !all.length) return;
    if (focusHandled.current === focusCode) return;
    const timer = window.setTimeout(() => {
      const node = document.getElementById(`co-row-${focusCode}`);
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        focusHandled.current = focusCode;
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [focusCode, loading, all.length]);

  const rows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    let list = all.filter((item) => {
      if (source !== 'all' && item.source !== source) return false;
      if (onlyFailed && item.parseStatus !== 'failed') return false;
      if (onlyParsing && item.parseStatus !== 'parsing' && item.parseStatus !== 'queued') return false;
      if (!keyword) return true;
      return matchesCompanyQuery(keyword, item);
    });
    list = [...list];
    if (timeSort !== 'default') {
      list.sort((a, b) => {
        const av = a.lastCrawlAt ?? '';
        const bv = b.lastCrawlAt ?? '';
        const cmp = av.localeCompare(bv) || a.rank - b.rank;
        return timeSort === 'asc' ? cmp : -cmp;
      });
    } else {
      list.sort((a, b) => a.rank - b.rank || a.code.localeCompare(b.code));
    }
    return list;
  }, [all, search, source, onlyFailed, onlyParsing, timeSort]);

  const queueCount = live?.counts.pending_download
    ?? stats?.pending
    ?? all.filter((c) => c.parseStatus === 'pending').length;
  const downloadUsed = live?.downloadSlots.used ?? 0;
  const downloadMax = live?.downloadSlots.max ?? 2;
  const parseUsed = live?.parseSlots.used
    ?? all.filter((c) => c.parseStatus === 'parsing').length;
  const parseMax = live?.parseSlots.max ?? 1;
  const ingested = live
    ? (live.counts.ingested ?? ((live.counts.review ?? 0) + (live.counts.online ?? 0)))
    : (stats?.covered ?? all.filter((c) => c.parseStatus === 'completed').length);
  const covered = stats?.covered ?? all.filter((c) => c.covered || c.parseStatus === 'completed').length;
  const universe = stats?.universe ?? live?.counts.target_companies ?? (all.length || 60);
  const paused = !autoCrawlEnabled;


  function companyHref(item: CrawlCompanyCoverage) {
    return `/${item.code}`;
  }

  function onTimeSort() {
    setTimeSort((s) => cycleSort(s));
  }


  function toggleExpand(code: string) {
    setExpanded((prev) => (prev === code ? null : code));
  }


  async function toggleAutoCrawl() {
    const next = !autoCrawlEnabled;
    setAutoCrawlSaving(true);
    setTriggerMsg('');
    try {
      const response = await fetch('/api/crawl/control', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ autoCrawlEnabled: next }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; autoCrawlEnabled?: boolean; downloadPaused?: boolean; note?: string };
      if (!response.ok) {
        setTriggerMsg(payload.error ?? '切换自动抓取失败');
        return;
      }
      setAutoCrawlEnabled(payload.autoCrawlEnabled ?? next);
      if (typeof payload.downloadPaused === 'boolean') setDownloadPaused(payload.downloadPaused);
      setTriggerMsg(payload.note ?? (next ? '已开启自动抓取' : '已关闭自动抓取'));
      await refreshLive();
    } catch (err) {
      setTriggerMsg(`网络异常：${String(err)}`);
    } finally {
      setAutoCrawlSaving(false);
      window.setTimeout(() => setTriggerMsg(''), 4000);
    }
  }

  async function toggleDownloadPause() {
    const next = !downloadPaused;
    setAutoCrawlSaving(true);
    setTriggerMsg('');
    try {
      const response = await fetch('/api/crawl/control', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ downloadPaused: next }),
      });
      const payload = await response.json() as {
        ok?: boolean; error?: string; downloadPaused?: boolean; autoCrawlEnabled?: boolean; note?: string;
      };
      if (!response.ok) {
        setTriggerMsg(payload.error ?? '切换暂停抓取失败');
        return;
      }
      setDownloadPaused(payload.downloadPaused ?? next);
      if (typeof payload.autoCrawlEnabled === 'boolean') {
        setAutoCrawlEnabled(payload.autoCrawlEnabled);
      }
      setTriggerMsg(payload.note ?? (next ? '已暂停抓取' : '已恢复下载'));
      await refreshLive();
    } catch (err) {
      setTriggerMsg(`网络异常：${String(err)}`);
    } finally {
      setAutoCrawlSaving(false);
      window.setTimeout(() => setTriggerMsg(''), 4000);
    }
  }




  function openPeriodPicker(mode: 'crawl' | 'parse', item: CrawlCompanyCoverage) {
    const all = item.periodStatuses ?? [];
    const list = (mode === 'crawl'
      ? all
      : all.filter((p) => p.state === 'downloaded' || p.state === 'parsed' || Boolean(p.announcementId))
    ).filter((p) => p.period && (p.period === '最新' || periodMeetsAutoCutoff(p.period)));
    if (!list.length) {
      window.alert(mode === 'crawl'
        ? `${item.name}（${item.code}）暂无可选期次，将按默认窗口抓取`
        : `${item.name}（${item.code}）没有已下载可解析的期次，请先抓取`);
      if (mode === 'crawl') {
        setPeriodPicker({ mode, code: item.code, name: item.name, options: [{ period: item.latestExpectedPeriod || '最新', state: 'expected' }] });
        setPickedPeriod(item.latestExpectedPeriod || '最新');
      }
      return;
    }
    const preferred = mode === 'parse'
      ? (list.find((p) => p.state === 'downloaded') ?? list[0])
      : (list.find((p) => p.state === 'expected' || p.state === 'discovered') ?? list[0]);
    setPickedPeriod(preferred.period);
    setPeriodPicker({ mode, code: item.code, name: item.name, options: list });
  }

  async function confirmPeriodPicker() {
    if (!periodPicker || !pickedPeriod) return;
    const { mode, code, name, options } = periodPicker;
    const chosen = options.find((p) => p.period === pickedPeriod) ?? options[0];
    setPeriodPicker(null);
    if (mode === 'crawl') {
      await runCrawlCompany(code, name, chosen?.period === '最新' ? undefined : chosen?.period);
    } else {
      if (!chosen?.announcementId && chosen?.state === 'expected') {
        window.alert(`${name} ${chosen.period} 尚未下载，请先抓取`);
        return;
      }
      await runParseCompany(code, name, chosen);
    }
  }


  function triggerKey(mode: 'crawl' | 'parse', code: string, period?: string, announcementId?: string | null) {
    if (mode === 'parse') return `parse:${code}:${announcementId || period || 'all'}`;
    return `crawl:${code}:${period || 'all'}`;
  }

  function isTriggering(mode: 'crawl' | 'parse', code: string, period?: string, announcementId?: string | null) {
    return rowTriggering === triggerKey(mode, code, period, announcementId);
  }

  function askCrawl(code: string, name: string, p: CrawlPeriodStatus) {
    const period = p.period === '最新' ? undefined : p.period;
    const already = p.state === 'downloaded' || p.state === 'parsed' || p.state === 'parsed_partial' || Boolean(p.downloadedAt);
    setActionConfirm({
      mode: 'crawl',
      code,
      name,
      period,
      periodStatus: p,
      title: already ? '确认重新抓取？' : '确认抓取？',
      okLabel: already ? '重新抓取' : '开始抓取',
      body: (
        <>
          <p><b>{name}</b>（{code}）· <b>{p.period}</b></p>
          {already ? (
            <p>该期次已{p.state === 'parsed' || p.state === 'parsed_partial' ? '解析' : '下载'}过。重新抓取会再次下载 PDF，并可能覆盖本地文件。</p>
          ) : (
            <p>将从交易所/巨潮发现并下载该期财报 PDF（采集窗口最早 2025Q1）。</p>
          )}
          {p.title ? <p className="co-confirm-muted">{p.title.replace(/\s+/g, ' ').slice(0, 80)}</p> : null}
        </>
      ),
    });
  }

  function askParse(code: string, name: string, p: CrawlPeriodStatus) {
    if (p.state === 'expected' && !p.announcementId) {
      window.alert(`${name} ${p.period} 尚未下载，请先抓取`);
      return;
    }
    const already = p.state === 'parsed' || p.state === 'parsed_partial' || Boolean(p.parsedAt);
    setActionConfirm({
      mode: 'parse',
      code,
      name,
      period: p.period,
      periodStatus: p,
      title: already ? '确认重新解析？' : '确认解析？',
      okLabel: already ? '重新解析' : '开始解析',
      body: (
        <>
          <p><b>{name}</b>（{code}）· <b>{p.period}</b></p>
          {already ? (
            <p>该期次已解析过。重新解析会再次抽取指标，可能覆盖已有结果。</p>
          ) : p.state === 'downloaded' || p.downloadedAt ? (
            <p>将解析已下载的 PDF 并入库指标。</p>
          ) : (
            <p>将解析该期财报 PDF 并入库指标。</p>
          )}
          {p.title ? <p className="co-confirm-muted">{p.title.replace(/\s+/g, ' ').slice(0, 80)}</p> : null}
        </>
      ),
    });
  }

  async function confirmAction() {
    if (!actionConfirm) return;
    const { mode, code, name, period, periodStatus } = actionConfirm;
    setActionConfirm(null);
    if (mode === 'crawl') await runCrawlCompany(code, name, period);
    else await runParseCompany(code, name, periodStatus);
  }

  async function runCrawlCompany(code: string, name: string, period?: string) {
    const key = triggerKey('crawl', code, period);
    if (rowTriggering === key) return;
    const label = period ? `${name} ${period}` : `${name}（${code}）`;
    setRowTriggering(key);
    setPriorityCodes((prev) => (prev.includes(code) ? prev : [code, ...prev].slice(0, 8)));
    setTriggerMsg(`正在抓取 ${label}…`);
    try {
      const response = await fetch('/api/crawl/trigger', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'manual',
          codes: [code],
          fullHistory: !period,
          ...(period ? { periods: [period] } : {}),
        }),
      });
      const payload = await response.json() as {
        ok?: boolean;
        error?: string;
        note?: string;
        downloaded?: number;
        parsed?: number;
      };
      if (!response.ok || payload.ok === false) {
        setTriggerMsg(payload.error ?? '抓取失败');
      } else {
        setTriggerMsg(
          payload.note
          ?? `已抓取 ${label}：下载 ${payload.downloaded ?? 0} · 解析 ${payload.parsed ?? 0}`,
        );
      }
      await refreshCoverage();
      await refreshLive();
    } catch (error) {
      setTriggerMsg(String(error));
    } finally {
      setRowTriggering(null);
      window.setTimeout(() => setTriggerMsg(''), 6000);
    }
  }

  async function runParseCompany(
    code: string,
    name: string,
    chosen?: import('@/lib/crawl-display').CrawlPeriodStatus,
  ) {
    const key = triggerKey('parse', code, chosen?.period, chosen?.announcementId);
    if (rowTriggering === key) return;
    const label = chosen?.period ? `${name} ${chosen.period}` : `${name}（${code}）`;
    setRowTriggering(key);
    setTriggerMsg(`正在解析 ${label}…`);
    try {
      const response = await fetch('/api/crawl/trigger', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'parse',
          codes: [code],
          parseOnly: true,
          ...(chosen?.announcementId ? { announcementIds: [chosen.announcementId] } : {}),
          ...(chosen?.period ? { periods: [chosen.period] } : {}),
        }),
      });
      const payload = await response.json() as {
        ok?: boolean;
        error?: string;
        note?: string;
        parsed?: number;
      };
      if (!response.ok || payload.ok === false) {
        setTriggerMsg(payload.error ?? '解析失败');
      } else {
        setTriggerMsg(payload.note ?? `已触发解析 ${label}：解析 ${payload.parsed ?? 0}`);
      }
      await refreshCoverage();
      await refreshLive();
    } catch (error) {
      setTriggerMsg(String(error));
    } finally {
      setRowTriggering(null);
      window.setTimeout(() => setTriggerMsg(''), 6000);
    }
  }

  async function crawlCompany(code: string, name: string, item: CrawlCompanyCoverage) {
    openPeriodPicker('crawl', item);
  }

  async function parseCompany(code: string, name: string, item: CrawlCompanyCoverage) {
    const hasPdf = Boolean(item.downloadedAt) || item.parseStatus === 'parsing' || item.parseStatus === 'queued' || item.parseStatus === 'failed' || item.parseStatus === 'completed' || hasDownloadedPdf(item)
      || (item.periodStatuses ?? []).some((p) => p.state === 'downloaded' || p.state === 'parsed');
    if (!hasPdf && item.parseStatus === 'pending' && !item.source) {
      window.alert(`${name}（${code}）尚未抓取，请先点「抓取」`);
      return;
    }
    openPeriodPicker('parse', item);
  }

  const downloadQueueItems = useMemo(() => {
    const priority = priorityCodes.map((code, i) => {
      const hit = all.find((c) => c.code === code);
      return {
        code,
        name: hit?.name ?? code,
        label: hit?.name ?? code,
        position: i + 1,
        status: 'priority',
      };
    });
    const rest = (live?.queueItems ?? [])
      .filter((q) => q.stage === 'download' && !priorityCodes.includes(q.code))
      .map((q) => {
        const raw = typeof q.waitSec === 'number' ? q.waitSec : 0;
        const waitSec = Math.max(0, raw - queueWaitTick);
        return {
          code: q.code,
          name: q.name,
          label: queueDisplayName(q),
          period: q.period,
          position: q.position,
          status: q.status,
          source: q.source,
          reason: waitSec > 0 ? `约 ${waitSec}s 后可下载` : q.reason,
          waitSec: waitSec > 0 ? waitSec : undefined,
        };
      });
    return [...priority, ...rest];
  }, [priorityCodes, all, live?.queueItems, queueWaitTick]);

  const parseQueueItems = useMemo(() => {
    const list = live?.pendingParseItems ?? live?.queueItems?.filter((q) => q.stage === 'parse') ?? [];
    return list.map((q) => ({
      code: q.code,
      name: q.name,
      label: queueDisplayName(q),
      period: q.period,
      position: q.position,
      status: q.status,
      source: q.source,
      reason: q.reason,
    }));
  }, [live?.pendingParseItems, live?.queueItems]);

  const downloadingItems = useMemo(() => {
    return (live?.activeItems ?? [])
      .filter((q) => q.stage === 'download')
      .map((q) => ({
        code: q.code,
        name: q.name,
        label: queueDisplayName(q),
        period: q.period,
        position: q.position,
        status: q.status,
        source: q.source,
        reason: q.reason,
        progress: q.progress,
      }));
  }, [live?.activeItems]);

  const parsingItems = useMemo(() => {
    const list = live?.activeParseItems ?? (live?.activeItems ?? []).filter((q) => q.stage === 'parse');
    return list.map((q) => ({
      code: q.code,
      name: q.name,
      label: queueDisplayName(q),
      period: q.period,
      position: q.position,
      status: q.status,
      source: q.source,
      reason: q.reason,
      progress: q.progress,
    }));
  }, [live?.activeParseItems, live?.activeItems]);

  const parseQueueCount = live?.counts.pending_parse ?? parseQueueItems.length;

  return (
    <main className="app-shell co-shell">
      <section className="co-page">
        <div className="co-title-row">
          <Link href="/" className="co-back-home" aria-label="返回首页">← 返回首页</Link>
          <h1>数据源采集</h1>
          <span className="co-title-meta">
            {loading ? '加载中' : ''}
          </span>
          <div className="co-title-actions">
            <label className={`co-auto-toggle ${!autoCrawlEnabled ? 'paused' : ''}`} title={autoCrawlEnabled ? '已开启：自动发现新公告并加入排队下载' : '已关闭：不再发现新公告/补缺口；已有排队仍会下载（除非暂停抓取）'}>
              <span>自动抓取</span>
              <button
                type="button"
                role="switch"
                aria-checked={autoCrawlEnabled}
                aria-label={autoCrawlEnabled ? '自动抓取：开' : '自动抓取：关'}
                className={`co-switch ${autoCrawlEnabled ? 'on' : ''}`}
                disabled={autoCrawlSaving || downloadPaused}
                onClick={() => void toggleAutoCrawl()}
              >
                <span className="co-switch-knob" aria-hidden="true" />
              </button>
            </label>
            <label className={`co-auto-toggle ${downloadPaused ? 'paused danger' : ''}`} title={downloadPaused ? '已暂停：停止新下载，排队不变也不再新增' : '关闭时正常下载排队任务'}>
              <span>暂停抓取</span>
              <button
                type="button"
                role="switch"
                aria-checked={downloadPaused}
                aria-label={downloadPaused ? '暂停抓取：开' : '暂停抓取：关'}
                className={`co-switch ${downloadPaused ? 'on danger' : ''}`}
                disabled={autoCrawlSaving}
                onClick={() => void toggleDownloadPause()}
              >
                <span className="co-switch-knob" aria-hidden="true" />
              </button>
            </label>
            <span className="co-coverage">{covered}/{universe} 家已覆盖</span>
            <span className="co-ops-help" tabIndex={0} aria-label="采集参数说明">
              <svg className="co-ops-help-ico" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z" />
              </svg>
              <span className="co-ops-tip" role="tooltip">
                <strong>采集说明</strong>
                <p className="co-ops-tip-lead">自动抓取=发现新公告并入排队。暂停抓取=立刻停下载（排队不动）；开启暂停会顺带关掉自动抓取。</p>
                <ul>
                  <li><em>自动抓取</em><span>{autoCrawlEnabled ? '开' : '关'}</span></li>
                  <li><em>暂停抓取</em><span>{downloadPaused ? '开' : '关'}</span></li>
                  <li><em>下载并发</em><span>{downloadMax}</span></li>
                  <li><em>解析并发</em><span>{parseMax}</span></li>
                  <li><em>轮询间隔</em><span>约 {Math.round((live?.limits?.intervalMs ?? 600_000) / 60000)} 分钟</span></li>
                  <li><em>超时</em><span>下载/解析各 5 分钟</span></li>
                  <li><em>采集窗口</em><span>最早 2025Q1</span></li>
                </ul>
              </span>
            </span>
          </div>
        </div>

        <div className="co-pipebar" role="status" aria-label="采集监控">
          <SourceDots health={sourceProbes ?? live?.health} />
          <span className="co-sb-arrow co-sb-flow" aria-hidden="true">→</span>
          <div className="co-sb-pipeline">
            <span className="co-sb-node-wrap">
              <button
                type="button"
                ref={dlQueueBtnRef}
                className={`co-sb-node clickable ${queuePopover === 'download' ? 'open' : ''}`}
                aria-expanded={queuePopover === 'download'}
                onClick={() => setQueuePopover((v) => (v === 'download' ? null : 'download'))}
              >
                排队下载(<b>{queueCount}</b>)
              </button>
              <QueuePopover
                open={queuePopover === 'download'}
                title="排队下载"
                items={downloadQueueItems}
                empty="暂无排队下载"
                note={downloadPaused
                  ? '下载已暂停：排队保持不变，不会进入下载中。'
                  : (!autoCrawlEnabled
                    ? '自动抓取已关：不再发现新公告；下列已有任务仍会进入「下载中」（看右侧倒计时）。'
                    : (queueCount > 0 && downloadUsed === 0
                      ? '下载槽空闲：下方倒计时为防封控间隔，到点后领取下载。'
                      : undefined))}
                onClose={() => setQueuePopover(null)}
                anchorRef={dlQueueBtnRef}
              />
            </span>
            <span className="co-sb-arrow" aria-hidden="true">→</span>
            <span className="co-sb-node-wrap">
              <button
                type="button"
                ref={dlActiveBtnRef}
                className={`co-sb-node clickable ${queuePopover === 'downloading' ? 'open' : ''}`}
                aria-expanded={queuePopover === 'downloading'}
                title="点击查看下载中任务与来源"
                onClick={() => setQueuePopover((v) => (v === 'downloading' ? null : 'downloading'))}
              >
                下载中(<b>{downloadUsed}/{downloadMax}</b>)
              </button>
              <QueuePopover
                open={queuePopover === 'downloading'}
                title="下载中"
                items={downloadingItems}
                empty={queueCount > 0 ? '槽位空闲，排队等待 Worker 领取（约 20s/45s 一轮）' : '当前无下载任务'}
                note={paused
                  ? '自动抓取已关：不发现新公告，已有排队仍会进入下载槽。'
                  : (queueCount > 0 && downloadUsed === 0 ? '有排队但下载槽空闲：等待 Worker 或本页软触发领取。' : undefined)}
                onClose={() => setQueuePopover(null)}
                anchorRef={dlActiveBtnRef}
              />
            </span>
            <span className="co-sb-arrow" aria-hidden="true">→</span>
            <span className="co-sb-node-wrap">
              <button
                type="button"
                ref={parseQueueBtnRef}
                className={`co-sb-node clickable ${queuePopover === 'parse' ? 'open' : ''}`}
                aria-expanded={queuePopover === 'parse'}
                onClick={() => setQueuePopover((v) => (v === 'parse' ? null : 'parse'))}
              >
                排队解析(<b>{parseQueueCount}</b>)
              </button>
              <QueuePopover
                open={queuePopover === 'parse'}
                title="排队解析"
                items={parseQueueItems}
                empty="暂无排队解析"
                note={paused ? '自动抓取已关：已下载 PDF 仍会继续解析。' : undefined}
                onClose={() => setQueuePopover(null)}
                anchorRef={parseQueueBtnRef}
              />
            </span>
            <span className="co-sb-arrow" aria-hidden="true">→</span>
            <span className="co-sb-node-wrap">
              <button
                type="button"
                ref={parseActiveBtnRef}
                className={`co-sb-node clickable ${queuePopover === 'parsing' ? 'open' : ''}`}
                aria-expanded={queuePopover === 'parsing'}
                title="点击查看解析中任务"
                onClick={() => setQueuePopover((v) => (v === 'parsing' ? null : 'parsing'))}
              >
                解析中(<b>{Math.min(parseUsed, parseMax)}/{parseMax}</b>)
              </button>
              <QueuePopover
                open={queuePopover === 'parsing'}
                title="解析中"
                items={parsingItems}
                empty={parseQueueCount > 0 ? '解析槽空闲，排队等待领取' : '当前无解析任务'}
                note={paused ? '自动抓取已关：已下载 PDF 仍会继续解析。' : undefined}
                onClose={() => setQueuePopover(null)}
                anchorRef={parseActiveBtnRef}
              />
            </span>
            <span className="co-sb-arrow" aria-hidden="true">→</span>
            <span className="co-sb-node static">已入库(<b>{ingested}</b>)</span>
          </div>
        </div>
        <p className="co-stage-msg" role="status" aria-live="polite">{triggerMsg || ''}</p>

      {periodPicker ? (
        <div className="co-period-modal" role="dialog" aria-modal="true" aria-label={periodPicker.mode === 'crawl' ? '选择要抓取的财报' : '选择要解析的财报'}>
          <div className="co-period-modal-card">
            <header>
              <h3>{periodPicker.mode === 'crawl' ? '选择要抓取的财报' : '选择要解析的财报'}</h3>
              <p>{periodPicker.name}（{periodPicker.code}）</p>
            </header>
            <div className="co-period-modal-list" role="radiogroup">
              {periodPicker.options.map((opt) => (
                <label key={opt.period} className={pickedPeriod === opt.period ? 'on' : ''}>
                  <input
                    type="radio"
                    name="co-period-pick"
                    checked={pickedPeriod === opt.period}
                    onChange={() => setPickedPeriod(opt.period)}
                  />
                  <span>
                    <b>{opt.period}</b>
                    <em>{periodStateLabel(opt.state)}</em>
                    {opt.title ? <small>{opt.title}</small> : null}
                  </span>
                </label>
              ))}
            </div>
            <footer>
              <button type="button" className="co-period-cancel" onClick={() => setPeriodPicker(null)}>取消</button>
              <button type="button" className="co-period-ok" onClick={() => void confirmPeriodPicker()}>确定</button>
            </footer>
          </div>
        </div>
      ) : null}

      {actionConfirm ? (
        <div className="co-confirm-backdrop" role="dialog" aria-modal="true" aria-label={actionConfirm.title}>
          <div className="co-confirm-dialog">
            <h3>{actionConfirm.title}</h3>
            <div className="co-confirm-body">{actionConfirm.body}</div>
            <div className="co-confirm-actions">
              <button type="button" className="co-confirm-cancel" onClick={() => setActionConfirm(null)}>取消</button>
              <button type="button" className="co-confirm-ok" onClick={() => void confirmAction()}>{actionConfirm.okLabel}</button>
            </div>
          </div>
        </div>
      ) : null}

        <div className="co-toolbar">
          <label className="co-search">
            <span aria-hidden="true">⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="公司 / 代码"
              aria-label="搜索公司或代码"
            />
          </label>
          <select value={source} onChange={(e) => setSource(e.target.value as SourceFilter)} aria-label="来源筛选">
            <option value="all">全部来源</option>
            <option value="exchange">交易所直连</option>
            <option value="cninfo">巨潮资讯</option>
          </select>
          <div className="co-toggles" role="group" aria-label="快速筛选">
            <button
              type="button"
              className={`co-toggle ${onlyFailed ? 'on' : ''}`}
              aria-pressed={onlyFailed}
              onClick={() => {
                setOnlyFailed((v) => !v);
                if (!onlyFailed) setOnlyParsing(false);
              }}
            >
              仅看失败
            </button>
            <button
              type="button"
              className={`co-toggle ${onlyParsing ? 'on' : ''}`}
              aria-pressed={onlyParsing}
              onClick={() => {
                setOnlyParsing((v) => !v);
                if (!onlyParsing) setOnlyFailed(false);
              }}
            >
              仅看解析中
            </button>
          </div>
          <span className="co-sort-hint" aria-live="polite">
            {loading ? '加载中…' : `共 ${rows.length} 家`}
            {timeSort !== 'default' ? ` · 按抓取时间${timeSort === 'asc' ? '升序' : '降序'}` : ''}
            
          </span>
        </div>

        <div className="co-table-wrap" role="region" aria-label="抓取记录表">
          <table className="co-table">
            <thead>
              <tr>
                <th>公司 / 代码</th>
                <th>
                  <SortHeader label="最近抓取" state={timeSort} onCycle={onTimeSort} />
                </th>
                <th>公告期次</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const open = expanded === item.code;
                return (
                  <Fragment key={item.code}>
                    <tr
                      id={`co-row-${item.code}`}
                      className={`co-row ${open ? 'open' : ''} ${item.parseStatus === 'failed' ? 'is-fail' : ''} ${focusCode === item.code ? 'co-row-focus' : ''}`}
                      onClick={() => toggleExpand(item.code)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleExpand(item.code);
                        }
                      }}
                      tabIndex={0}
                      aria-expanded={open}
                    >
                      <td>
                        <Link href={companyHref(item)} onClick={(e) => e.stopPropagation()}>
                          {item.name}
                          <span className="co-code">{item.code}</span>
                        </Link>
                        <IndustryTag item={item} />
                      </td>
                      <td>
                        <div>{formatCrawlTime(item.lastCrawlAt)}</div>
                        <div className="co-sub">{freshnessLabel(item.lastCrawlAt)}</div>
                      </td>
                      <td>
                        <PeriodChips periods={item.periodStatuses} />
                      </td>
                    </tr>
                    {open && (
                      <tr key={`${item.code}-detail`} className="co-detail-row">
                        <td colSpan={3} onClick={(e) => e.stopPropagation()}>
                          <div className="co-ann-panel">
                            <div className="co-ann-head">
                              <strong>公告列表</strong>
                              <Link href={companyHref(item)}>打开公司详情 →</Link>
                            </div>
                            <table className="co-ann-table">
                              <thead>
                                <tr>
                                  <th>期次</th>
                                  <th>状态</th>
                                  <th>来源</th>
                                  <th>发现</th>
                                  <th>抓取</th>
                                  <th>解析</th>
                                  <th>操作</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(item.periodStatuses ?? []).filter((p) => p.period === '最新' || periodMeetsAutoCutoff(p.period)).map((p) => (
                                  <tr key={`${item.code}-${p.period}-${p.announcementId ?? 'x'}`}>
                                    <td className="co-ann-period">
                                      {p.state === 'parsed' || p.state === 'parsed_partial' ? (
                                        <Link
                                          href={`/${item.code}?period=${encodeURIComponent(p.period)}`}
                                          className="co-ann-period-link"
                                          title={`打开 ${p.period} 详情`}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <b>{p.period}</b>
                                        </Link>
                                      ) : (
                                        <b>{p.period}</b>
                                      )}
                                      {p.title ? <div className="co-sub" title={p.title}>{p.title.replace(/\s+/g, ' ').slice(0, 36)}</div> : null}
                                    </td>
                                    <td><span className={`co-period ${p.state}`}>{periodStateLabel(p.state)}</span></td>
                                    <td>{sourceApiShort(p.sourceApi)}</td>
                                    <td>{formatCrawlTime(p.discoveredAt ?? p.publishedAt ?? null)}</td>
                                    <td>{formatCrawlTime(p.downloadedAt ?? null)}</td>
                                    <td>{formatCrawlTime(p.parsedAt ?? null)}</td>
                                    <td>
                                      <div className="co-actions">
                                        <button
                                          type="button"
                                          className="co-text-act co-act-crawl"
                                          disabled={isTriggering('crawl', item.code, p.period === '最新' ? undefined : p.period)}
                                          onClick={() => askCrawl(item.code, item.name, p)}
                                        >{isTriggering('crawl', item.code, p.period === '最新' ? undefined : p.period) ? '抓取中…' : '抓取'}</button>
                                        <button
                                          type="button"
                                          className="co-text-act co-act-parse"
                                          disabled={isTriggering('parse', item.code, p.period, p.announcementId) || (p.state === 'expected' && !p.announcementId)}
                                          onClick={() => askParse(item.code, item.name, p)}
                                        >{isTriggering('parse', item.code, p.period, p.announcementId) ? '解析中…' : '解析'}</button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                                {!(item.periodStatuses ?? []).some((p) => p.period === '最新' || periodMeetsAutoCutoff(p.period)) && (
                                  <tr><td colSpan={7} className="co-sub">暂无公告（采集窗口最早 2025Q1）</td></tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={3}>
                    <div className="co-empty">没有符合条件的抓取记录</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="co-mobile" aria-label="抓取记录（移动端）">
          <div className="co-mobile-sort">
            <SortHeader label="最近抓取" state={timeSort} onCycle={onTimeSort} />
          </div>
          {rows.map((item) => (
            <article className={`co-card ${focusCode === item.code ? 'co-row-focus' : ''}`} id={`co-card-${item.code}`} key={item.code}>
              <div className="co-card-top">
                <div>
                  <h3>
                    <Link href={companyHref(item)}>{item.name}</Link>
                  </h3>
                  <p>{item.code} · {formatCrawlTime(item.lastCrawlAt)}</p>
                </div>
              </div>
              <div className="co-card-meta">
                <PeriodChips periods={item.periodStatuses} />
              </div>
              <details>
                <summary>展开详情</summary>
                <div className="co-card-detail">
                  <div className="co-actions">
                    <button type="button" className="co-text-act" disabled={isTriggering('crawl', item.code)} onClick={() => void crawlCompany(item.code, item.name, item)}>抓取</button>
                    <button type="button" className="co-text-act" disabled={isTriggering('parse', item.code)} onClick={() => void parseCompany(item.code, item.name, item)}>解析</button>
                  </div>
                  <div>行业：{(item.industryGroup && item.industry && item.industryGroup !== item.industry) ? `${item.industryGroup} / ${item.industry}` : (item.industry || item.industryGroup || "—")}</div>
                  <div>公告：{item.announcementTitle ?? '—'}</div>
                  <div>命中 API：{sourceApiLabel(item)}</div>
                  <div>发现：{formatCrawlTime(item.discoveredAt ?? item.lastCrawlAt)}</div>
                  <div>下载：{formatCrawlTime(item.downloadedAt)}</div>
                  <div>解析：{formatCrawlTime(item.parsedAt)}</div>
                  {item.parseError && <div>说明：{item.parseError}</div>}
                  {!item.metricsComplete && item.missingMetrics.length > 0 && (
                    <div>缺少指标：{item.missingMetrics.map(metricLabel).join(' / ')}</div>
                  )}
                  <div>
                    <Link href={companyHref(item)}>打开公司详情 →</Link>
                  </div>
                </div>
              </details>
            </article>
          ))}
          {!rows.length && <div className="co-empty">没有符合条件的抓取记录</div>}
        </div>
      </section>
    </main>
  );
}
