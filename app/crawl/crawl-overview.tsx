'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  freshnessLabel,
  METRIC_LABELS,
  periodStateLabel,
  reportTypeLabel,
  reportTypeSortKey,
  hasDownloadedPdf,
  type CrawlCompanyCoverage,
  type CrawlPeriodStatus,
  type CrawlSourceKind,
  type CrawlStats,
  type ParseStatus,
} from '@/lib/crawl-display';
import { matchesCompanyQuery } from '@/lib/company-query';
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
};

type LivePayload = {
  running: boolean;
  autoCrawlEnabled?: boolean;
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

function formatCrawlTime(iso: string | null) {
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

function HealthLine({
  health,
  probing,
  onProbe,
}: {
  health: SourceProbe[] | undefined;
  probing?: boolean;
  onProbe?: () => void;
}) {
  const rows: SourceProbe[] = health?.length
    ? health
    : [
        { source: 'SSE', ok: null },
        { source: 'SZSE', ok: null },
        { source: 'BSE', ok: null },
        { source: 'CNINFO', ok: null },
      ];
  return (
    <span className="co-health-line">
      <span className="co-health-main">
        <span className="co-health-label">官网连通</span>
        <span className="co-health-dots">
          {rows.map((item) => {
            const name = item.source === 'CNINFO' ? '巨潮' : item.source;
            const ok = item.ok;
            const label = ok === null ? '未检测' : ok ? '通' : '断';
            const cls = ok === null ? 'co-health-unknown' : ok ? 'co-health-ok' : 'co-health-fail';
            const tip = [
              item.detail,
              item.latencyMs != null ? `${item.latencyMs}ms` : null,
              item.lastError,
            ].filter(Boolean).join(' · ') || undefined;
            return (
              <span key={item.source} className={`co-health-chip ${cls}`} title={tip}>
                {name}{label}
              </span>
            );
          })}
        </span>
      </span>
      {onProbe ? (
        <button
          type="button"
          className="co-health-probe"
          disabled={probing}
          onClick={onProbe}
          title="立刻检测上交所 / 深交所 / 北交所 / 巨潮是否能连上"
        >
          {probing ? '检测中…' : '检测连通'}
        </button>
      ) : null}
    </span>
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
  const arrow = state === 'asc' ? '↑' : state === 'desc' ? '↓' : '↕';
  return (
    <button
      type="button"
      className={`co-sort-btn ${state !== 'default' ? 'active' : ''}`}
      onClick={onCycle}
      aria-label={`${label}排序，当前${state === 'default' ? '默认' : state === 'asc' ? '升序' : '降序'}`}
    >
      <span>{label}</span>
      <span className="co-sort-arrow" aria-hidden="true">{arrow}</span>
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
  if (p.title) lines.push(p.title.replace(/\s+/g, ' ').slice(0, 48));
  return lines.join('\n');
}

function PeriodChips({ periods }: { periods?: CrawlPeriodStatus[] }) {
  // Exactly 2 rows × up to 3 chips (newest first from API).
  const list = (periods ?? []).slice(0, 6);
  if (!list.length) return <div className="co-sub">暂无报告期</div>;
  const row1 = list.slice(0, 3);
  const row2 = list.slice(3, 6);
  const chip = (p: CrawlPeriodStatus) => (
    <span key={p.period} className={`co-period ${p.state}`} title={periodChipTitle(p)}>
      {p.period}
      <i>{periodStateLabel(p.state)}</i>
      {p.sourceApi ? <em className="co-period-src">{sourceApiShort(p.sourceApi)}</em> : null}
    </span>
  );
  return (
    <div className="co-period-chips">
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

function ParseQueueHint({ item }: { item: QueueItem }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const progress =
    item.status === 'parsing' ? '解析中'
      : item.status === 'parked' ? '不排队（已搁置）'
        : item.status === 'blocked' || item.status === 'retry' ? '待重试'
          : item.position === 1 ? '排队首位'
            : `排队 #${item.position}`;
  const file = item.title ? item.title.replace(/\s+/g, '').slice(0, 40) : '';

  function place() {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const tipW = 280;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - tipW - 8);
    // Prefer below the name so top-of-list tips are not clipped; flip up if near bottom.
    const spaceBelow = window.innerHeight - r.bottom;
    const top = spaceBelow < 140 ? Math.max(8, r.top - 8) : r.bottom + 8;
    const transform = spaceBelow < 140 ? 'translateY(-100%)' : undefined;
    setStyle({ left, top, transform, position: 'fixed', display: 'grid' });
    setOpen(true);
  }

  return (
    <span
      className="co-q-name"
      ref={anchorRef}
      onMouseEnter={place}
      onMouseLeave={() => setOpen(false)}
      onFocus={place}
      onBlur={() => setOpen(false)}
    >
      <b>{queueDisplayName(item)}</b>
      {open ? (
        <div className="co-qtip co-qtip-fixed" style={style} role="tooltip">
          <div><b>{progress}</b>{item.period ? ` · ${item.period}` : ''}</div>
          {file ? <div>文件：{file}{item.title && item.title.length > 40 ? '…' : ''}</div> : null}
          <div>状态：{item.rawStatus ?? item.status}</div>
          {item.source ? <div>来源：{item.source}</div> : null}
          {item.reason ? <div>原因：{item.reason}</div> : null}
          {item.parseError ? <div className="co-qtip-err">parseError：{item.parseError}</div> : null}
          {!item.pdfKey && item.rawStatus === 'downloaded' ? <div>缺少 PDF 对象</div> : null}
        </div>
      ) : null}
    </span>
  );
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
  const [probingSources, setProbingSources] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<SourceFilter>('all');
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [onlyParsing, setOnlyParsing] = useState(false);
  const [timeSort, setTimeSort] = useState<SortState>('default');
  const [typeSort, setTypeSort] = useState<SortState>('default');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [autoCrawlEnabled, setAutoCrawlEnabled] = useState(true);
  const [autoCrawlSaving, setAutoCrawlSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState('');
  const [priorityCodes, setPriorityCodes] = useState<string[]>([]);
  const [rowTriggering, setRowTriggering] = useState<string | null>(null);
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
    } catch {
      /* live bar is optional; coverage table still works */
    }
  }, []);

  const probeSources = useCallback(async () => {
    setProbingSources(true);
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
      setProbingSources(false);
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


  // 采集页打开且自动抓取开启时，每 20s 软消化一轮积压（不替代 worker）
  useEffect(() => {
    if (!autoCrawlEnabled) return;
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
    const id = window.setInterval(() => void tick(), 20_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [autoCrawlEnabled, refreshLive]);

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
    } else if (typeSort !== 'default') {
      list.sort((a, b) => {
        const cmp = reportTypeSortKey(a.reportType, a.reportPeriod).localeCompare(
          reportTypeSortKey(b.reportType, b.reportPeriod),
        ) || a.rank - b.rank;
        return typeSort === 'asc' ? cmp : -cmp;
      });
    } else {
      list.sort((a, b) => a.rank - b.rank || a.code.localeCompare(b.code));
    }
    return list;
  }, [all, search, source, onlyFailed, onlyParsing, timeSort, typeSort]);

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
  const discoveredTotal = live?.stages?.find((s) => s.id === 'discover')?.count
    ?? (live
      ? live.counts.discovered
        + live.counts.download_failed
        + live.counts.pending_parse
        + live.counts.review
        + live.counts.online
      : covered);
  const pendingParse = live?.counts.pending_parse ?? all.filter((c) => c.parseStatus === 'parsing' || c.parseStatus === 'pending').length;
  const downloadFailed = live?.counts.download_failed ?? 0;
  const running = Boolean(live?.running);
  const paused = !autoCrawlEnabled;

  const currentFile = useMemo(() => {
    const parsing = all.find((c) => c.parseStatus === 'parsing' && c.announcementTitle);
    if (parsing?.announcementTitle) {
      const short = parsing.announcementTitle.replace(/\s+/g, '');
      return short.length > 18 ? `${short.slice(0, 16)}…` : short;
    }
    const anyParsing = all.find((c) => c.parseStatus === 'parsing');
    if (anyParsing) return `${anyParsing.name}.pdf`;
    if (downloadUsed > 0) {
      const pending = all.find((c) => c.parseStatus === 'pending' || c.parseStatus === 'failed');
      if (pending) return `${pending.name}.pdf`;
    }
    return '';
  }, [all, downloadUsed]);

  function companyHref(item: CrawlCompanyCoverage) {
    return `/${item.code}`;
  }

  function onTimeSort() {
    setTypeSort('default');
    setTimeSort((s) => cycleSort(s));
  }

  function onTypeSort() {
    setTimeSort('default');
    setTypeSort((s) => cycleSort(s));
  }

  function toggleExpand(code: string) {
    setExpanded((prev) => (prev === code ? null : code));
  }

  function rowProgress(item: CrawlCompanyCoverage) {
    if (item.parseStatus !== 'parsing') return undefined;
    const hit = (live?.activeParseItems ?? live?.activeItems ?? []).find(
      (a) => a.code === item.code && a.stage === 'parse',
    );
    return hit?.ageMs != null ? hit.ageMs / 1000 : undefined;
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
      const payload = await response.json() as { ok?: boolean; error?: string; autoCrawlEnabled?: boolean; note?: string };
      if (!response.ok) {
        setTriggerMsg(payload.error ?? '切换自动抓取失败');
        return;
      }
      setAutoCrawlEnabled(payload.autoCrawlEnabled ?? next);
      setTriggerMsg(payload.note ?? (next ? '已开启自动抓取' : '已关闭自动抓取'));
      await refreshLive();
    } catch (err) {
      setTriggerMsg(`网络异常：${String(err)}`);
    } finally {
      setAutoCrawlSaving(false);
      window.setTimeout(() => setTriggerMsg(''), 4000);
    }
  }

  async function runManualRound() {
    if (paused) {
      setTriggerMsg('自动抓取已关闭，请先开启后再手动跑一轮');
      window.setTimeout(() => setTriggerMsg(''), 3500);
      return;
    }
    setTriggering(true);
    setTriggerMsg('');
    try {
      const response = await fetch('/api/crawl/trigger', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'backlog' }),
      });
      const payload = await response.json() as {
        ok?: boolean;
        error?: string;
        note?: string;
        downloaded?: number;
        parsed?: number;
        backlog?: number;
      };
      if (!response.ok) {
        setTriggerMsg(payload.error ?? '触发失败（可能需要登录或 INTERNAL_INGEST_TOKEN）');
        return;
      }
      setTriggerMsg(payload.note ?? `已温和处理：下载 ${payload.downloaded ?? 0} · 解析 ${payload.parsed ?? 0}`);
      await refreshLive();
      await refreshCoverage();
    } catch (err) {
      setTriggerMsg(`网络异常：${String(err)}`);
    } finally {
      setTriggering(false);
      window.setTimeout(() => setTriggerMsg(''), 5000);
    }
  }


  function openPeriodPicker(mode: 'crawl' | 'parse', item: CrawlCompanyCoverage) {
    const all = item.periodStatuses ?? [];
    const list = (mode === 'crawl'
      ? all
      : all.filter((p) => p.state === 'downloaded' || p.state === 'parsed' || Boolean(p.announcementId))
    ).filter((p) => p.period);
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

  async function runCrawlCompany(code: string, name: string, period?: string) {
    if (rowTriggering) return;
    const label = period ? `${name} ${period}` : `${name}（${code}）`;
    const ok = window.confirm(period
      ? `确定抓取 ${label}？`
      : `${name}（${code}）确定立即抓取？`);
    if (!ok) return;
    setRowTriggering(`crawl:${code}`);
    setPriorityCodes((prev) => (prev.includes(code) ? prev : [code, ...prev].slice(0, 8)));
    setTriggerMsg(`正在抓取 ${label}…`);
    try {
      const response = await fetch('/api/crawl/trigger', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'manual',
          codes: [code],
          fullHistory: true,
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
    if (rowTriggering) return;
    const label = chosen?.period ? `${name} ${chosen.period}` : `${name}（${code}）`;
    const ok = window.confirm(`确定解析 ${label}？`);
    if (!ok) return;
    setRowTriggering(`parse:${code}`);
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
    if (rowTriggering) return;
    openPeriodPicker('crawl', item);
  }

  async function parseCompany(code: string, name: string, item: CrawlCompanyCoverage) {
    if (rowTriggering) return;
    const hasPdf = Boolean(item.downloadedAt) || item.parseStatus === 'parsing' || item.parseStatus === 'queued' || item.parseStatus === 'failed' || item.parseStatus === 'completed' || hasDownloadedPdf(item)
      || (item.periodStatuses ?? []).some((p) => p.state === 'downloaded' || p.state === 'parsed');
    if (!hasPdf && item.parseStatus === 'pending' && !item.source) {
      window.alert(`${name}（${code}）尚未抓取，请先点「抓取」`);
      return;
    }
    openPeriodPicker('parse', item);
  }

  const stageCards = [
    {
      id: 'discover',
      title: '发现公告',
      value: String(discoveredTotal),
      meta: running ? '本轮活跃' : '空闲',
      detail: `最近轮询 ${live?.lastPollAt ? formatCrawlTime(live.lastPollAt) : stats?.lastPollAt ? formatCrawlTime(stats.lastPollAt) : '暂无'}`,
      sub: <HealthLine health={sourceProbes ?? live?.health} probing={probingSources} onProbe={() => void probeSources()} />,
      active: running,
    },
    {
      id: 'queue',
      title: '排队下载',
      value: String(queueCount),
      meta: queueCount > 0 ? '等待下载（无上限）' : '队列清空',
      detail: downloadFailed > 0 ? `下载失败待重试 ${downloadFailed}` : '无失败积压',
      sub: `目标池 ${universe} 家 · 已覆盖 ${covered}`,
      active: queueCount > 0,
    },
    {
      id: 'download',
      title: '下载 PDF',
      value: `${downloadUsed}/${downloadMax}`,
      meta: downloadUsed > 0 ? '占用中' : '槽位空闲',
      detail: `待下载 ${live?.counts.pending_download ?? queueCount}`,
      sub: currentFile ? `当前：${currentFile}` : `限流 ≤${live?.limits.downloadLimit ?? downloadMax}`,
      active: downloadUsed > 0,
    },
    {
      id: 'parse',
      title: '解析入库',
      value: `${Math.min(parseUsed, parseMax)}/${parseMax}`,
      meta: parseUsed > 0 ? '解析中' : '槽位空闲',
      detail: `待解析 ${pendingParse} · 已入库 ${ingested}`,
      sub: `解析并发 ≤${live?.limits.parseLimit ?? parseMax}`,
      active: parseUsed > 0,
    },
  ];

  return (
    <main className="app-shell co-shell">
      <section className="co-page">
        <div className="co-title-row">
          <Link href="/" className="co-back-home" aria-label="返回首页">← 返回首页</Link>
          <h1>数据源采集</h1>
          <span className="co-title-meta">
            {loading ? '加载中' : ''}
          </span>
        </div>

        <div className="co-statusbar" role="status" aria-label="抓取管道状态">
          <div className="co-status-stats">
            <span className="co-stat-item" title="排队下载：已发现待下的公告份数，无最大数量上限；每轮按并发槽位消化">
              <i className="co-ico" aria-hidden="true">☰</i>
              排队下载 <b>{queueCount}</b>
            </span>
            <span className="co-stat-item" title={`抓取并发上限 ${downloadMax}（INGEST_DOWNLOAD_LIMIT）`}>
              <i className="co-ico" aria-hidden="true">↓</i>
              抓取中 <b>{downloadUsed}/{downloadMax}</b>
              {currentFile ? <em className="co-file-scroll" title={currentFile}>{currentFile}</em> : null}
            </span>
            <span className="co-stat-item" title={`AI 解析并发上限 ${parseMax}（INGEST_PARSE_LIMIT）`}>
              <i className="co-ico" aria-hidden="true">◇</i>
              AI解析中 <b>{Math.min(parseUsed, parseMax)}/{parseMax}</b>
            </span>
            <span className="co-stat-item" title="已成功解析并入库的财报份数（含 review / online）">
              <i className="co-ico" aria-hidden="true">✓</i>
              已入库 <b>{ingested}</b>
            </span>
          </div>
          <div className="co-status-right">
            <label className={`co-auto-toggle ${paused ? 'paused' : ''}`} title={paused ? '自动抓取已关闭' : '自动抓取已开启'}>
              <span>自动抓取</span>
              <button
                type="button"
                role="switch"
                aria-checked={autoCrawlEnabled}
                aria-label={autoCrawlEnabled ? '自动抓取：开' : '自动抓取：关'}
                className={`co-switch ${autoCrawlEnabled ? 'on' : ''}`}
                disabled={autoCrawlSaving}
                onClick={() => void toggleAutoCrawl()}
              >
                <span className="co-switch-knob" aria-hidden="true" />
              </button>
            </label>
            <span className="co-coverage">{covered}/{universe} 家已覆盖</span>
            <div
              className="co-config-wrap co-help-wrap"
              onMouseEnter={() => setConfigOpen(true)}
              onMouseLeave={() => setConfigOpen(false)}
            >
              <button
                type="button"
                className={`co-help-btn ${configOpen ? 'open' : ''}`}
                aria-expanded={configOpen}
                aria-controls="co-config-panel"
                onClick={() => setConfigOpen((v) => !v)}
                title="采集说明"
              >
                <svg className="co-help-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.75" />
                  <path d="M9.5 9a2.5 2.5 0 1 1 3.9 2.1c-.7.4-1.4 1-1.4 2.1" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                  <circle cx="12" cy="17" r="1" fill="currentColor" />
                </svg>
              </button>
              {configOpen && (
                <div id="co-config-panel" className="co-config-pop" role="tooltip" aria-label="采集说明">
                  <dl>
                    <div><dt>是否自动抓取</dt><dd>{autoCrawlEnabled ? '是' : '否'}</dd></div>
                    <div><dt>多久轮询一次</dt><dd>约 {Math.round((live?.limits.intervalMs ?? 600_000) / 60000)} 分钟</dd></div>
                    <div><dt>抓取并发</dt><dd>{live?.limits.downloadLimit ?? downloadMax}（上限）</dd></div>
                    <div><dt>解析并发</dt><dd>{live?.limits.parseLimit ?? parseMax}（上限）</dd></div>
                    <div><dt>排队下载上限</dt><dd>无（积压全部保留）</dd></div>
                    <div><dt>下载/解析超时</dt><dd>各 5 分钟后退回对应排队</dd></div>
                    <div><dt>自动回溯</dt><dd>去年 H1/Q2 起；更早请点行内「抓取」</dd></div>
                    <div><dt>列表页间隔</dt><dd>{live?.limits.pagePauseMs ?? 1000} 毫秒</dd></div>
                    <div><dt>PDF 下载间隔</dt><dd>{live?.limits.downloadPauseMs ?? 1200} 毫秒</dd></div>
                    <div><dt>最大翻页</dt><dd>{live?.limits.maxPages ?? 8} 页</dd></div>
                    <div><dt>最近轮询</dt><dd>{live?.lastPollAt ? formatCrawlTime(live.lastPollAt) : stats?.lastPollAt ? formatCrawlTime(stats.lastPollAt) : '暂无'}</dd></div>
                  </dl>
                </div>
              )}
            </div>
          </div>
        </div>

        <section className="co-concurrent" aria-label="并发采集">
          <div className="co-concurrent-head">
            <h2>并发采集</h2>
          </div>
          <div className="co-stage-grid">
            {stageCards.map((card) => (
              <article key={card.id} className={`co-stage-card ${card.active ? 'active' : ''}`}>
                <header>
                  <span>{card.title}</span>
                  <em className={card.active ? 'busy' : 'idle'}>{card.meta}</em>
                </header>
                <strong>{card.value}</strong>
                <p>{card.detail}</p>
                {typeof card.sub === 'string' || card.sub == null
                  ? <small>{card.sub}</small>
                  : <div className="co-stage-sub">{card.sub}</div>}
              </article>
            ))}
          </div>
          {triggerMsg ? <p className="co-stage-msg" role="status">{triggerMsg}</p> : null}
        </section>

        <section className="co-queues co-queues-4" aria-label="抓取队列">
          <div className="co-queue-col">
            <header>
              <h3>排队下载</h3>
              <span title="顶部状态栏与总数一致；列表最多展示 80 条便于滚动查看">
                {queueCount} 项
                {(live?.queueShown ?? 0) > 0 && (live?.queueShown ?? 0) < queueCount
                  ? ` · 列出 ${live?.queueShown}`
                  : ''}
              </span>
            </header>
            <ul className="co-queue-scroll">
              {(
                [
                  ...priorityCodes.map((code, i) => {
                    const hit = all.find((c) => c.code === code);
                    return {
                      code,
                      name: hit?.name ?? code,
                      status: 'priority',
                      stage: 'download' as const,
                      position: i + 1,
                    };
                  }),
                  ...(live?.queueItems ?? []).filter((q) => q.stage === 'download' && !priorityCodes.includes(q.code)),
                ]
              ).map((item) => (
                <li key={`q-${item.stage}-${item.code}-${item.position}`} title={'title' in item ? String((item as QueueItem).title ?? '') : ''}>
                  <b>{queueDisplayName(item as QueueItem)}</b>
                  <span>{item.code}</span>
                  <em>{item.status === 'priority' ? '优先' : item.status === 'retry' ? '重试' : `#${item.position}`}</em>
                </li>
              ))}
              {!priorityCodes.length && !(live?.queueItems ?? []).some((q) => q.stage === 'download') && (
                <li className="co-queue-empty">暂无排队下载</li>
              )}
            </ul>
          </div>
          <div className="co-queue-col">
            <header>
              <h3>抓取中</h3>
              <span>{downloadUsed} / {downloadMax}</span>
            </header>
            <ul className="co-queue-scroll">
              {(live?.activeItems ?? []).filter((a) => a.stage === 'download').map((item) => (
                <li key={`a-dl-${item.code}-${item.position}`} className="active" title={item.progress ?? item.title}>
                  <div className="co-q-active">
                    <b>{queueDisplayName(item)}</b>
                    <small>{item.progress ?? (item.source ? `来源 ${item.source}` : '下载中')}{item.ageMs != null ? ` · ${Math.round(item.ageMs / 1000)}s` : ''}</small>
                  </div>
                  <span>{item.code}</span>
                  <em>下载中</em>
                </li>
              ))}
              {!(live?.activeItems ?? []).some((a) => a.stage === 'download') && (live?.recentDownloads?.length ?? 0) > 0 && (
                <>
                  <li className="co-queue-empty">槽位空闲 · 近 3 分钟刚下完：</li>
                  {(live?.recentDownloads ?? []).slice(0, 6).map((item) => (
                    <li key={`rd-${item.code}-${item.position}`} className="co-q-recent" title={item.progress ?? item.title}>
                      <b>{queueDisplayName(item)}</b>
                      <span>{item.code}</span>
                      <em>刚完成</em>
                    </li>
                  ))}
                </>
              )}
              {!(live?.activeItems ?? []).some((a) => a.stage === 'download') && !(live?.recentDownloads?.length) && (
                <li className="co-queue-empty">
                  {queueCount > 0 ? '等待 worker 领取下载（约每 45s 一轮，本页也会软触发）' : '当前没有下载中的任务'}
                </li>
              )}
            </ul>
          </div>
          <div className="co-queue-col">
            <header>
              <h3>排队解析</h3>
              <span>{(live?.pendingParseItems ?? live?.queueItems?.filter((q) => q.stage === 'parse') ?? []).length}</span>
            </header>
            <ul>
              {(live?.pendingParseItems ?? live?.queueItems?.filter((q) => q.stage === 'parse') ?? []).map((item) => (
                <li key={`pq-${item.code}-${item.position}`} className={`co-q-parse ${item.status === 'parked' ? 'parked' : item.status === 'retry' ? 'blocked' : ''}`}>
                  <ParseQueueHint item={item} />
                  <span>{item.code}</span>
                  <em>{item.status === 'parked' ? '不排队' : item.status === 'retry' ? '重试' : `#${item.position}`}</em>
                </li>
              ))}
              {!(live?.pendingParseItems ?? live?.queueItems?.filter((q) => q.stage === 'parse') ?? []).length && (
                <li className="co-queue-empty">暂无排队解析</li>
              )}
            </ul>
          </div>
          <div className="co-queue-col">
            <header>
              <h3>待解析</h3>
              <span>{(live?.activeParseItems?.length ?? parseUsed) || 0} / {parseMax} · 限5min</span>
            </header>
            <ul>
              {(live?.activeParseItems
                ?? (live?.activeItems ?? []).filter((a) => a.stage === 'parse')
              ).slice(0, 8).map((item) => (
                <li key={`ap-${item.code}-${item.position}`} className="active co-q-parse" title={item.progress ?? item.title}>
                  <div className="co-q-active">
                    <b>{queueDisplayName(item)}</b>
                    <small>{item.progress ?? '解析中'}{item.ageMs != null ? ` · ${Math.round(item.ageMs / 1000)}s` : ''}</small>
                  </div>
                  <span>{item.code}</span>
                  <em>解析中</em>
                </li>
              ))}
              {!(live?.activeParseItems?.length
                || (live?.activeItems ?? []).some((a) => a.stage === 'parse')) && (
                <li className="co-queue-empty">当前没有解析中的任务</li>
              )}
            </ul>
          </div>
        </section>


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

        <div className="co-toolbar">
          <label className="co-search">
            <span aria-hidden="true">⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="公司 / 代码 / 拼音（如 hanwu）"
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
            {typeSort !== 'default' ? ` · 按报告类型${typeSort === 'asc' ? '升序' : '降序'}` : ''}
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
                <th>
                  <SortHeader label="公告期次" state={typeSort} onCycle={onTypeSort} />
                </th>
                <th>操作</th>
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
                        <div className="co-sub">{item.industry}</div>
                      </td>
                      <td>
                        <div>{formatCrawlTime(item.lastCrawlAt)}</div>
                        <div className="co-sub">{freshnessLabel(item.lastCrawlAt)}</div>
                      </td>
                      <td>
                        <PeriodChips periods={item.periodStatuses} />
                      </td>
                      <td className="co-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="co-text-act"
                          disabled={rowTriggering === `crawl:${item.code}` || rowTriggering === `parse:${item.code}`}
                          onClick={() => void crawlCompany(item.code, item.name, item)}
                        >
                          {rowTriggering === `crawl:${item.code}` ? '抓取中…' : '抓取'}
                        </button>
                        <button
                          type="button"
                          className="co-text-act"
                          disabled={rowTriggering === `crawl:${item.code}` || rowTriggering === `parse:${item.code}`}
                          onClick={() => void parseCompany(item.code, item.name, item)}
                        >
                          {rowTriggering === `parse:${item.code}` ? '解析中…' : '解析'}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr key={`${item.code}-detail`} className="co-detail-row">
                        <td colSpan={4}>
                          <div className="co-detail">
                            <div>
                              <span>公告标题</span>
                              <strong>{item.announcementTitle ?? '—'}</strong>
                            </div>
                            <div>
                              <span>最近一期来源</span>
                              <strong>{sourceApiLabel(item)}（各期次以来源芯片为准）</strong>
                            </div>
                            <div>
                              <span>发现时间</span>
                              <strong>{formatCrawlTime(item.discoveredAt ?? item.lastCrawlAt)}</strong>
                            </div>
                            <div>
                              <span>下载时间</span>
                              <strong>{formatCrawlTime(item.downloadedAt)}</strong>
                            </div>
                            <div>
                              <span>解析完成</span>
                              <strong>{formatCrawlTime(item.parsedAt)}</strong>
                            </div>
                            <div>
                              <span>管道状态</span>
                              <strong>{item.rawStatus ?? item.parseStatus}</strong>
                            </div>
                            {item.parseStatus === 'failed' && (
                              <div className="co-detail-fail">
                                <span>失败原因</span>
                                <strong>{item.parseError ?? '未知错误'}</strong>
                              </div>
                            )}
                            {item.parseStatus === 'parsing' && (
                              <div>
                                <span>解析进度</span>
                                <strong>{rowProgress(item) != null ? `已 ${Math.round(rowProgress(item)!)}s` : '进行中（无假百分比）'}</strong>
                              </div>
                            )}
                            {item.parseStatus === 'queued' && (
                              <div>
                                <span>解析进度</span>
                                <strong>排队等待解析槽（并发上限 1）</strong>
                              </div>
                            )}
                            {!item.metricsComplete && item.missingMetrics.length > 0 && (
                              <div>
                                <span>缺少指标</span>
                                <strong>{item.missingMetrics.map(metricLabel).join(' / ')}</strong>
                              </div>
                            )}
                            <div className="co-detail-link">
                              <Link href={companyHref(item)} onClick={(e) => e.stopPropagation()}>
                                打开公司详情 →
                              </Link>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={4}>
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
            <SortHeader label="公告" state={typeSort} onCycle={onTypeSort} />
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
                <div className="co-actions" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="co-text-act" disabled={Boolean(rowTriggering)} onClick={() => void crawlCompany(item.code, item.name, item)}>抓取</button>
                  <button type="button" className="co-text-act" disabled={Boolean(rowTriggering)} onClick={() => void parseCompany(item.code, item.name, item)}>解析</button>
                </div>
              </div>
              <details>
                <summary>展开详情</summary>
                <div className="co-card-detail">
                  <div>行业：{item.industry}</div>
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
