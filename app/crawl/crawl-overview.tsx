'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type AnimationEvent, type CSSProperties, type ReactNode, type RefObject } from 'react';
import {
  canBatchParseFiling,
  canFillVerdict,
  flattenCrawlFilings,
  filingToPeriodStatus,
  formatQueueLastError,
  METRIC_LABELS,
  periodPrefixMatches,
  periodStateLabel,
  uniquePeriodTokens,
  type CrawlCompanyCoverage,
  type CrawlFilingRow,
  type CrawlPeriodStatus,
  type CrawlSourceKind,
  type CrawlStats,
} from '@/lib/crawl-display';
import { parseHomeQuery, queryMatchesCompany } from '@/lib/home-search';
import { formatParseElapsed } from '@/lib/parse-queue';
import { requestReportVerdict } from '@/lib/request-report-verdict';
import { Icon } from '../ui-icons';
import './crawl-overview.css';

type SourceFilter = 'all' | CrawlSourceKind;
type SortState = 'default' | 'asc' | 'desc';
type TimeCol = 'discovered' | 'downloaded' | 'parsed' | 'verdict';
type QueueItem = {
  code: string;
  name: string;
  label?: string;
  period?: string;
  status: string;
  stage: 'download' | 'parse' | 'verdict';
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
  lastError?: string | null;
};

type LivePayload = {
  running: boolean;
  autoCrawlEnabled?: boolean;
  autoVerdictEnabled?: boolean;
  downloadPaused?: boolean;
  coverageBootstrap?: {
    mode: 'bootstrap' | 'steady';
    missingPeriods: number;
    missingCompanies: number;
    hunted: number;
    completedAt: string | null;
  };
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
    downloading?: number;
  };
  downloadSlots: { used: number; max: number };
  parseSlots: { used: number; max: number };
  queueItems?: QueueItem[];
  activeItems?: QueueItem[];
  activeParseItems?: QueueItem[];
  pendingParseItems?: QueueItem[];
  verdictQueueItems?: QueueItem[];
  verdictQueue?: {
    enabled: boolean;
    status: string;
    pending: number;
    due?: number;
    note: string;
    nextAt: string | null;
    current: { code: string; name: string; period: string; title: string; startedAt?: string } | null;
    last: { code: string; name: string; period: string; ok?: boolean; reason?: string; at?: string; elapsedMs?: number } | null;
  };
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
    lookbackDays?: number;
    pollIntervalMin?: number;
    maxPages?: number;
    downloadTimeoutMs?: number;
    parseTimeoutMs?: number;
    queueMax?: number | null;
  };
};

function formatCrawlTime(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

function cycleSort(current: SortState): SortState {
  if (current === 'default') return 'asc';
  if (current === 'asc') return 'desc';
  return 'default';
}

type SettingsDraft = {
  downloadPauseSec: string;
  downloadLimit: string;
  parseLimit: string;
  lookbackDays: string;
  pollIntervalMin: string;
};

const SETTINGS_BOUNDS = {
  downloadPauseSec: { min: 1, max: 9999, fallback: 20 },
  downloadLimit: { min: 1, max: 99, fallback: 5 },
  parseLimit: { min: 1, max: 9, fallback: 2 },
  lookbackDays: { min: 1, max: 99, fallback: 2 },
  pollIntervalMin: { min: 1, max: 60, fallback: 2 },
} as const;

const SETTINGS_FIELDS: Array<{
  key: keyof SettingsDraft;
  label: string;
  unit: string;
  hint: string;
  prefix?: string;
}> = [
  { key: 'downloadPauseSec', label: '排队下载间隔', unit: '秒', hint: '排队任务领取下载之间的等待时间，用于降低封控风险。' },
  { key: 'downloadLimit', label: '并发下载数量', unit: '个', hint: '同时下载 PDF 的最大数量。' },
  { key: 'parseLimit', label: '并发解析数量', unit: '个', hint: '闲时自动解析的并发上限，默认 1（单队列）。采集页手动解析会插到队首；详情页打开会额外并发解析，不占这支队列。' },
  { key: 'lookbackDays', label: '采集窗口', unit: '天', prefix: '最近', hint: '初始化完成后，增量扫描只看最近这些天的公告。' },
  { key: 'pollIntervalMin', label: '抓取轮询间隔', unit: '分钟', hint: '扫描新公告和财报缺口的时间间隔。保存后 Worker 会按新间隔执行。' },
];

function clampSetting(key: keyof SettingsDraft, raw: string): number {
  const bounds = SETTINGS_BOUNDS[key];
  const trimmed = String(raw).trim();
  if (!trimmed) return bounds.fallback;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return bounds.fallback;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(n)));
}

function settingMaxDigits(max: number) {
  return String(max).length;
}

function sanitizeSettingInput(raw: string, max: number): string {
  return raw.replace(/\D/g, '').slice(0, settingMaxDigits(max));
}

function settingsDraftFromLive(live: LivePayload | null): SettingsDraft {
  return {
    downloadPauseSec: String(Math.max(1, Math.round((live?.limits.downloadPauseMs ?? 20_000) / 1000))),
    downloadLimit: String(live?.limits.downloadLimit ?? live?.downloadSlots.max ?? 5),
    parseLimit: String(live?.limits.parseLimit ?? live?.parseSlots.max ?? 2),
    lookbackDays: String(live?.limits.lookbackDays ?? 2),
    pollIntervalMin: String(live?.limits.pollIntervalMin ?? Math.max(1, Math.round((live?.limits.intervalMs ?? 120_000) / 60_000))),
  };
}

type ControlSettingsPayload = {
  downloadPauseSec?: number;
  downloadLimit?: number;
  parseLimit?: number;
    lookbackDays?: number;
    pollIntervalMin?: number;
    settings?: {
      downloadPauseSec?: number;
      downloadLimit?: number;
      parseLimit?: number;
      lookbackDays?: number;
      pollIntervalMin?: number;
    };
  };

function settingsDraftFromControl(payload: ControlSettingsPayload | null, live: LivePayload | null): SettingsDraft {
  const source = payload?.settings ?? payload;
  if (source && Number.isFinite(Number(source.downloadPauseSec))) {
    return {
      downloadPauseSec: String(source.downloadPauseSec),
      downloadLimit: String(source.downloadLimit ?? 5),
      parseLimit: String(source.parseLimit ?? 2),
      lookbackDays: String(source.lookbackDays ?? 2),
      pollIntervalMin: String(source.pollIntervalMin ?? 2),
    };
  }
  return settingsDraftFromLive(live);
}

function filingTimeValue(row: CrawlFilingRow, col: TimeCol) {
  if (col === 'discovered') return row.discoveredAt ?? row.publishedAt ?? '';
  if (col === 'downloaded') return row.downloadedAt ?? '';
  if (col === 'verdict') return row.verdictStatus === 'ready' ? row.verdictGeneratedAt ?? '' : '';
  return row.parsedAt ?? '';
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
        return (
          <span key={item.source} className="co-sb-src">
            <a
              className="co-sb-src-label"
              href={meta.url}
              target="_blank"
              rel="noopener noreferrer"
              title={meta.name}
              aria-label={meta.name}
            >
              {meta.short} <i className={`co-sb-dot ${cls}`} aria-hidden="true" />
            </a>
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

function PulseDot({ on }: { on: boolean }) {
  if (!on) return null;
  return <span className="co-pulse-dot" aria-hidden="true" />;
}

type OptimisticJob = {
  key: string;
  code: string;
  name: string;
  label: string;
  period?: string;
  stage: 'download' | 'parse';
  bucket: 'queue' | 'active';
};

function jobCovered(
  job: OptimisticJob,
  items: Array<{ code: string; period?: string }>,
) {
  return items.some((item) => item.code === job.code && (!job.period || !item.period || item.period === job.period));
}

function holdOptimistic(startedAt: number, minMs = 1800) {
  const remain = minMs - (Date.now() - startedAt);
  if (remain <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => window.setTimeout(resolve, remain));
}

function renderQueueReason(text: string, lastError?: string | null) {
  const errorTip = lastError ? (formatQueueLastError(lastError) ?? lastError) : null;
  const marker = '上次失败';
  if (!errorTip || !text.includes(marker)) return text;
  const idx = text.indexOf(marker);
  return (
    <>
      {text.slice(0, idx)}
      <span className="co-sb-pop-fail" tabIndex={0}>
        {marker}
        <span className="co-sb-pop-fail-tip" role="tooltip">{errorTip}</span>
      </span>
      {text.slice(idx + marker.length)}
    </>
  );
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
    lastError?: string | null;
  }>;
  empty: string;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  note?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    function place() {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(380, window.innerWidth - 24);
      let left = r.left;
      if (left + width > window.innerWidth - 12) left = Math.max(12, window.innerWidth - width - 12);
      setPos({ top: r.bottom + 8, left });
    }
    const raf = window.requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.cancelAnimationFrame(raf);
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

  if (!open) return null;
  if (!pos) return null;
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
              <div className="co-sb-pop-reason">
                {renderQueueReason(item.progress || item.reason || '', item.lastError)}
              </div>
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
  if (p.verdictStatus === 'ready' && p.verdictGeneratedAt) lines.push(`智析：${formatCrawlTime(p.verdictGeneratedAt)}`);
  if (p.title) lines.push(p.title.replace(/\s+/g, ' ').slice(0, 48));
  return lines.join('\n');
}


function IndustryTag({ item }: { item: { industry?: string; industryGroup?: string } }) {
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

function queueDisplayName(item: Pick<QueueItem, 'name' | 'label' | 'period' | 'title'>) {
  if (item.label) return item.label;
  if (item.period) return `${item.name} ${item.period}`;
  return item.name;
}


export default function CrawlOverview() {
  const searchParams = useSearchParams();
  const focusParam = (searchParams.get('focus') ?? '').trim();
  const focusCode = /^\d{6}$/.test(focusParam) ? focusParam : '';
  const [all, setAll] = useState<CrawlCompanyCoverage[]>([]);
  const [stats, setStats] = useState<CrawlStats | null>(null);
  const [live, setLive] = useState<LivePayload | null>(null);
  const [sourceProbes, setSourceProbes] = useState<SourceProbe[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(focusCode);
  const [source, setSource] = useState<SourceFilter>('all');
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [onlyParsing, setOnlyParsing] = useState(false);
  const [timeCol, setTimeCol] = useState<TimeCol | null>(null);
  const [timeSort, setTimeSort] = useState<SortState>('default');
  const [queuePopover, setQueuePopover] = useState<null | 'download' | 'parse' | 'downloading' | 'parsing' | 'verdict'>(null);
  const [queueWaitTick, setQueueWaitTick] = useState(0);
  const [parseElapsedTick, setParseElapsedTick] = useState(0);
  const dlQueueBtnRef = useRef<HTMLButtonElement>(null);
  const dlActiveBtnRef = useRef<HTMLButtonElement>(null);
  const parseQueueBtnRef = useRef<HTMLButtonElement>(null);
  const parseActiveBtnRef = useRef<HTMLButtonElement>(null);
  const verdictBtnRef = useRef<HTMLButtonElement>(null);
  const [autoCrawlEnabled, setAutoCrawlEnabled] = useState(true);
  const [autoCrawlSaving, setAutoCrawlSaving] = useState(false);
  const [autoVerdictEnabled, setAutoVerdictEnabled] = useState(true);
  const [autoVerdictSaving, setAutoVerdictSaving] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState('');
  const [optimisticJobs, setOptimisticJobs] = useState<OptimisticJob[]>([]);
  const [rowBusy, setRowBusy] = useState<Record<string, Partial<Record<'crawl' | 'parse' | 'verdict', true>>>>({});
  const [actionConfirm, setActionConfirm] = useState<null | {
    mode: 'crawl' | 'parse' | 'verdict';
    code: string;
    name: string;
    period?: string;
    periodStatus?: CrawlPeriodStatus;
    title: string;
    body: ReactNode;
    okLabel: string;
  }>(null);
  const [periodPrefix, setPeriodPrefix] = useState('');
  const [onlyMissingAi, setOnlyMissingAi] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [tableRefreshing, setTableRefreshing] = useState(false);
  const [settingsMounted, setSettingsMounted] = useState(false);
  const [settingsClosing, setSettingsClosing] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>(() => settingsDraftFromLive(null));
  const [llmProbeBusy, setLlmProbeBusy] = useState(false);
  const [llmProbeResults, setLlmProbeResults] = useState<Array<{
    id: string;
    model: string;
    host: string;
    ok: boolean;
    latencyMs: number;
    reply?: string;
    error?: string;
  }> | null>(null);
  const [llmProbeError, setLlmProbeError] = useState('');
  const settingsOpenGen = useRef(0);

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
      if (typeof payload.autoVerdictEnabled === 'boolean') {
        setAutoVerdictEnabled(payload.autoVerdictEnabled);
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
    const kick = window.setTimeout(() => {
      void refreshCoverage();
      void refreshLive();
      void probeSources();
    }, 0);
    const coverageTimer = window.setInterval(() => void refreshCoverage(), 5 * 60 * 1000);
    const liveTimer = window.setInterval(() => void refreshLive(), 15_000);
    return () => {
      window.clearTimeout(kick);
      window.clearInterval(coverageTimer);
      window.clearInterval(liveTimer);
    };
  }, [refreshCoverage, refreshLive, probeSources]);


  // 采集页打开时每 20s 软消化一轮积压（不替代 worker）。
  // 自动关时 API 只解析已下载 PDF，不从排队领取新下载。
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
    const kick = window.setTimeout(() => { void tick(); }, 0);
    const id = window.setInterval(() => void tick(), 20_000);
    return () => { cancelled = true; window.clearTimeout(kick); window.clearInterval(id); };
  }, [refreshLive]);


  // Popover open on 排队下载 → tick countdown every 1s from live.waitSec baseline.
  const downloadGateAt = live?.downloadGate?.nextAt ?? '';
  const [waitTickFor, setWaitTickFor] = useState(downloadGateAt);
  if (queuePopover !== 'download') {
    if (queueWaitTick !== 0) setQueueWaitTick(0);
  } else if (waitTickFor !== downloadGateAt) {
    setWaitTickFor(downloadGateAt);
    setQueueWaitTick(0);
  }
  useEffect(() => {
    if (queuePopover !== 'download') return;
    const id = window.setInterval(() => setQueueWaitTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [queuePopover, live?.downloadGate?.nextAt]);

  useEffect(() => {
    const parsing = queuePopover === 'parsing' || (live?.parseSlots.used ?? 0) > 0;
    if (!parsing) return;
    const id = window.setInterval(() => setParseElapsedTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [queuePopover, live?.parseSlots.used]);

  // Queue / in-flight non-empty → 5s partial live refresh (not full page reload).
  const queueBusy = Boolean(
    live?.running
    || (live?.queueItems?.length ?? 0) > 0
    || (live?.activeItems?.length ?? 0) > 0
    || (live?.counts.pending_download ?? 0) > 0
    || (live?.counts.pending_parse ?? 0) > 0
    || (live?.downloadSlots.used ?? 0) > 0
    || (live?.parseSlots.used ?? 0) > 0
    || optimisticJobs.length > 0
    || Object.keys(rowBusy).length > 0,
  );
  useEffect(() => {
    if (!queueBusy) return;
    const ms = optimisticJobs.length
      || (live?.counts.pending_download ?? 0) > 0
      || (live?.counts.pending_parse ?? 0) > 0
      || (live?.downloadSlots.used ?? 0) > 0
      || (live?.parseSlots.used ?? 0) > 0
      ? 1_200
      : 5_000;
    const timer = window.setInterval(() => {
      void refreshLive();
      void refreshCoverage();
    }, ms);
    return () => window.clearInterval(timer);
  }, [queueBusy, refreshLive, refreshCoverage, live?.counts.pending_download, live?.downloadSlots.used, optimisticJobs.length]);

  const [appliedFocus, setAppliedFocus] = useState(focusCode);
  if (focusCode && focusCode !== appliedFocus && !search) {
    setAppliedFocus(focusCode);
    setSearch(focusCode);
  }

  useEffect(() => {
    if (!settingsClosing) return;
    const timer = window.setTimeout(() => {
      setSettingsMounted(false);
      setSettingsClosing(false);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [settingsClosing]);

  useEffect(() => {
    if (!settingsMounted) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        settingsOpenGen.current += 1;
        setSettingsClosing(true);
        setSettingsSaving(false);
      }
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [settingsMounted]);

  const allFilings = useMemo(() => flattenCrawlFilings(all), [all]);

  const periodOptions = useMemo(() => uniquePeriodTokens(allFilings), [allFilings]);

  const filings = useMemo(() => {
    const keyword = search.trim();
    const parsed = parseHomeQuery(keyword);
    const needle = parsed.companyQuery || keyword;
    let list = allFilings.filter((item) => {
      if (source !== 'all' && item.source !== source) return false;
      if (onlyFailed && item.state !== 'failed') return false;
      if (onlyParsing && item.state !== 'downloaded') return false;
      if (onlyMissingAi && item.verdictStatus === 'ready') return false;
      if (!periodPrefixMatches(item.period, periodPrefix)) return false;
      if (!keyword) return true;
      return queryMatchesCompany(needle, item) || queryMatchesCompany(keyword, item);
    });
    if (timeCol && timeSort !== 'default') {
      list = [...list].sort((a, b) => {
        const av = filingTimeValue(a, timeCol);
        const bv = filingTimeValue(b, timeCol);
        const cmp = av.localeCompare(bv) || a.code.localeCompare(b.code) || a.period.localeCompare(b.period);
        return timeSort === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  }, [allFilings, search, source, onlyFailed, onlyParsing, onlyMissingAi, periodPrefix, timeCol, timeSort]);

  const selectedFilings = useMemo(
    () => filings.filter((row) => selectedIds.has(row.key)),
    [filings, selectedIds],
  );
  const allVisibleSelected = filings.length > 0 && filings.every((row) => selectedIds.has(row.key));

  const downloadMax = live?.downloadSlots.max ?? live?.limits.downloadLimit ?? 5;
  const parseMax = live?.parseSlots.max ?? live?.limits.parseLimit ?? 2;
  const lookbackDays = live?.limits.lookbackDays ?? 2;
  const pollIntervalMin = live?.limits.pollIntervalMin ?? Math.max(1, Math.round((live?.limits.intervalMs ?? 120_000) / 60_000));
  const downloadPauseSec = Math.max(1, Math.round((live?.limits.downloadPauseMs ?? 20_000) / 1000));
  const ingested = live
    ? (live.counts.ingested ?? ((live.counts.review ?? 0) + (live.counts.online ?? 0)))
    : (stats?.covered ?? all.filter((c) => c.parseStatus === 'completed').length);
  const covered = stats?.covered ?? all.filter((c) => c.covered || c.parseStatus === 'completed').length;
  const universe = stats?.universe ?? live?.counts.target_companies ?? (all.length || 60);
  const paused = !autoCrawlEnabled;
  const coverageReady = live?.coverageBootstrap?.mode === 'steady';


  function companyHref(item: { code: string }, period?: string) {
    return period ? `/${item.code}?period=${encodeURIComponent(period)}` : `/${item.code}`;
  }

  function toggleFiling(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleSelectVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const row of filings) next.delete(row.key);
      } else {
        for (const row of filings) next.add(row.key);
      }
      return next;
    });
  }

  async function runBatchJobs(
    jobs: CrawlFilingRow[],
    mode: 'crawl' | 'parse' | 'verdict',
    confirmText: string,
  ) {
    if (!jobs.length) {
      setTriggerMsg(mode === 'parse' ? '所选财报尚未下载，请先批量抓取。' : mode === 'verdict' ? '所选财报尚未解析，或智析已生成。' : '请先勾选要处理的财报。');
      window.setTimeout(() => setTriggerMsg(''), 6000);
      return;
    }
    if (!window.confirm(confirmText)) return;
    setBatchBusy(true);
    for (const item of jobs) patchRowBusy(item.key, mode, true);
    let done = 0;
    let failed = 0;
    try {
      for (const item of jobs) {
        try {
          if (mode === 'verdict') {
            await requestReportVerdict(item.announcementId!, { fill: true });
          } else {
            const response = await fetch('/api/crawl/trigger', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(mode === 'crawl'
                ? {
                    mode: 'manual',
                    codes: [item.code],
                    fullHistory: false,
                    periods: [item.period],
                    ...(item.announcementId ? { announcementIds: [item.announcementId] } : {}),
                  }
                : {
                    mode: 'parse',
                    codes: [item.code],
                    parseOnly: true,
                    periods: [item.period],
                    ...(item.announcementId ? { announcementIds: [item.announcementId] } : {}),
                  }),
            });
            const payload = await response.json() as { ok?: boolean; error?: string };
            if (!response.ok || payload.ok === false) throw new Error(payload.error ?? String(response.status));
          }
          done += 1;
        } catch {
          failed += 1;
        } finally {
          patchRowBusy(item.key, mode, false);
        }
        void refreshLive();
      }
    } finally {
      for (const item of jobs) patchRowBusy(item.key, mode, false);
      setBatchBusy(false);
    }
    setTriggerMsg(`完成。成功 ${done}，失败 ${failed}`);
    window.setTimeout(() => setTriggerMsg(''), 6000);
    void refreshCoverage();
    void refreshLive();
  }

  function runBatchCrawl() {
    const jobs = selectedFilings;
    void runBatchJobs(jobs, 'crawl', `将批量抓取 ${jobs.length} 份财报，已抓取过的会重新下载。继续？`);
  }

  function runBatchParse() {
    const jobs = selectedFilings.filter((row) => canBatchParseFiling(row));
    const skipped = selectedFilings.length - jobs.length;
    void runBatchJobs(
      jobs,
      'parse',
      skipped
        ? `将解析 ${jobs.length} 份已下载财报（跳过 ${skipped} 份未下载），已解析的会重新抽取。继续？`
        : `将批量解析 ${jobs.length} 份财报，已解析的会重新抽取指标。继续？`,
    );
  }

  function runBatchVerdict() {
    const jobs = selectedFilings.filter((row) => canFillVerdict(row) && row.verdictStatus !== 'ready');
    const skipped = selectedFilings.length - jobs.length;
    void runBatchJobs(
      jobs,
      'verdict',
      skipped
        ? `将为 ${jobs.length} 份尚未智析的财报调用 AI（跳过 ${skipped} 份）。继续？`
        : `将为 ${jobs.length} 份财报生成智析。已有结果的不会重算。继续？`,
    );
  }

  function onTimeSort(col: TimeCol) {
    if (timeCol !== col) {
      setTimeCol(col);
      setTimeSort('asc');
      return;
    }
    const next = cycleSort(timeSort);
    setTimeSort(next);
    if (next === 'default') setTimeCol(null);
  }

  function filterByCompany(name: string) {
    setSearch(name);
  }


  function closeSettings() {
    settingsOpenGen.current += 1;
    setSettingsClosing(true);
    setSettingsSaving(false);
  }

  function finishSettingsClose(event: AnimationEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.animationName !== 'co-settings-slide-out' && event.animationName !== 'co-settings-fade-out') return;
    setSettingsMounted(false);
    setSettingsClosing(false);
  }

  async function openSettings() {
    const gen = ++settingsOpenGen.current;
    setQueuePopover(null);
    setSettingsDraft(settingsDraftFromLive(live));
    setSettingsClosing(false);
    setSettingsMounted(true);
    try {
      const response = await fetch('/api/crawl/control', { cache: 'no-store' });
      if (!response.ok || gen !== settingsOpenGen.current) return;
      const payload = await response.json() as ControlSettingsPayload;
      if (gen !== settingsOpenGen.current) return;
      setSettingsDraft(settingsDraftFromControl(payload, live));
    } catch {
      /* keep live snapshot */
    }
  }

  async function saveSettings() {
    const next = {
      downloadPauseSec: clampSetting('downloadPauseSec', settingsDraft.downloadPauseSec),
      downloadLimit: clampSetting('downloadLimit', settingsDraft.downloadLimit),
      parseLimit: clampSetting('parseLimit', settingsDraft.parseLimit),
      lookbackDays: clampSetting('lookbackDays', settingsDraft.lookbackDays),
      pollIntervalMin: clampSetting('pollIntervalMin', settingsDraft.pollIntervalMin),
    };
    setSettingsDraft({
      downloadPauseSec: String(next.downloadPauseSec),
      downloadLimit: String(next.downloadLimit),
      parseLimit: String(next.parseLimit),
      lookbackDays: String(next.lookbackDays),
      pollIntervalMin: String(next.pollIntervalMin),
    });
    setSettingsSaving(true);
    setTriggerMsg('');
    try {
      const response = await fetch('/api/crawl/control', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; note?: string; settings?: ControlSettingsPayload['settings'] } & ControlSettingsPayload;
      if (!response.ok) {
        setTriggerMsg(payload.error ?? '保存采集参数失败');
        return;
      }
      setSettingsDraft(settingsDraftFromControl(payload, live));
      closeSettings();
      setTriggerMsg(payload.note ?? '已保存采集参数');
      await refreshLive();
    } catch (err) {
      setTriggerMsg(`网络异常：${String(err)}`);
    } finally {
      setSettingsSaving(false);
      window.setTimeout(() => setTriggerMsg(''), 4000);
    }
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
      setTriggerMsg(payload.note ?? (next ? '已开启自动抓取' : '已关闭自动抓取'));
      await refreshLive();
    } catch (err) {
      setTriggerMsg(`网络异常：${String(err)}`);
    } finally {
      setAutoCrawlSaving(false);
      window.setTimeout(() => setTriggerMsg(''), 4000);
    }
  }

  async function toggleAutoVerdict() {
    const next = !autoVerdictEnabled;
    setAutoVerdictSaving(true);
    setTriggerMsg('');
    try {
      const response = await fetch('/api/crawl/control', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ autoVerdictEnabled: next }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; autoVerdictEnabled?: boolean; note?: string };
      if (!response.ok) {
        setTriggerMsg(payload.error ?? '切换自动智析失败');
        return;
      }
      setAutoVerdictEnabled(payload.autoVerdictEnabled ?? next);
      setTriggerMsg(payload.note ?? (next ? '已开启自动智析' : '已关闭自动智析'));
      await refreshLive();
    } catch (err) {
      setTriggerMsg(`网络异常：${String(err)}`);
    } finally {
      setAutoVerdictSaving(false);
      window.setTimeout(() => setTriggerMsg(''), 4000);
    }
  }

  async function probeLlm() {
    setLlmProbeBusy(true);
    setLlmProbeError('');
    try {
      const response = await fetch('/api/crawl/llm-probe', { method: 'POST', cache: 'no-store' });
      const payload = await response.json() as {
        ok?: boolean;
        error?: string;
        results?: Array<{
          id: string;
          model: string;
          host: string;
          ok: boolean;
          latencyMs: number;
          reply?: string;
          error?: string;
        }>;
      };
      if (!response.ok) {
        setLlmProbeError(payload.error ?? '检测失败');
        setLlmProbeResults(null);
        return;
      }
      if (payload.error && !payload.results?.length) {
        setLlmProbeError(payload.error);
        setLlmProbeResults([]);
        return;
      }
      setLlmProbeResults(payload.results ?? []);
    } catch (err) {
      setLlmProbeError(`网络异常：${String(err)}`);
      setLlmProbeResults(null);
    } finally {
      setLlmProbeBusy(false);
    }
  }

  function triggerKey(mode: 'crawl' | 'parse' | 'verdict', code: string, period?: string, announcementId?: string | null) {
    if (mode === 'parse') return `parse:${code}:${announcementId || period || 'all'}`;
    if (mode === 'verdict') return `verdict:${code}:${announcementId || period || 'all'}`;
    return `crawl:${code}:${period || 'all'}`;
  }

  function rowBusyId(code: string, period?: string, announcementId?: string | null) {
    return announcementId || `${code}:${period || 'all'}`;
  }

  function patchRowBusy(id: string, mode: 'crawl' | 'parse' | 'verdict', on: boolean) {
    setRowBusy((prev) => {
      const cur = { ...prev[id] };
      if (on) cur[mode] = true;
      else delete cur[mode];
      const next = { ...prev };
      if (Object.keys(cur).length) next[id] = cur;
      else delete next[id];
      return next;
    });
  }

  function isRowBusy(id: string, mode: 'crawl' | 'parse' | 'verdict') {
    return Boolean(rowBusy[id]?.[mode]);
  }

  async function refreshTable() {
    if (tableRefreshing) return;
    setTableRefreshing(true);
    try {
      await Promise.all([refreshCoverage(), refreshLive()]);
    } finally {
      setTableRefreshing(false);
    }
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
            <p>该期次已解析过。重新解析会再次抽取指标，并重新生成概览（结论、关键变化、归因）后覆盖已入库结果。</p>
          ) : p.state === 'downloaded' || p.downloadedAt ? (
            <p>将解析已下载的 PDF，生成概览全文后一并入库。</p>
          ) : (
            <p>将解析该期财报 PDF，生成概览全文后一并入库。</p>
          )}
          {p.title ? <p className="co-confirm-muted">{p.title.replace(/\s+/g, ' ').slice(0, 80)}</p> : null}
        </>
      ),
    });
  }

  function askVerdict(code: string, name: string, p: CrawlPeriodStatus) {
    if (!canFillVerdict(p)) {
      window.alert(`${name} ${p.period} 尚未解析，请先解析`);
      return;
    }
    const already = p.verdictStatus === 'ready';
    setActionConfirm({
      mode: 'verdict',
      code,
      name,
      period: p.period,
      periodStatus: p,
      title: already ? '确认重新智析？' : '确认智析？',
      okLabel: already ? '重新智析' : '开始智析',
      body: (
        <>
          <p><b>{name}</b>（{code}）· <b>{p.period}</b></p>
          {already ? (
            <p>该期次已有智析结果。重新智析会覆盖已入库的结论、关键变化和归因。</p>
          ) : (
            <p>将根据已解析指标和原文生成智析（结论、关键变化、归因）并落库。</p>
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
    if (mode === 'crawl') await runCrawlCompany(code, name, period, periodStatus?.announcementId);
    else if (mode === 'parse') await runParseCompany(code, name, periodStatus);
    else await runVerdictCompany(code, name, periodStatus);
  }

  async function runCrawlCompany(code: string, name: string, period?: string, announcementId?: string | null) {
    const key = triggerKey('crawl', code, period);
    const busyId = rowBusyId(code, period, announcementId);
    if (isRowBusy(busyId, 'crawl')) return;
    const label = period ? `${name} ${period}` : `${name}（${code}）`;
    const job: OptimisticJob = {
      key,
      code,
      name,
      label,
      period,
      stage: 'download',
      bucket: 'active',
    };
    patchRowBusy(busyId, 'crawl', true);
    setOptimisticJobs((prev) => [job, ...prev.filter((item) => item.key !== key)].slice(0, 12));
    setTriggerMsg(`正在抓取 ${label}…`);
    void refreshLive();
    try {
      const response = await fetch('/api/crawl/trigger', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'manual',
          codes: [code],
          fullHistory: !period,
          ...(period ? { periods: [period] } : {}),
          ...(announcementId ? { announcementIds: [announcementId] } : {}),
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
      await holdOptimistic(Date.now(), 1400);
      setOptimisticJobs((prev) => prev.filter((item) => item.key !== key));
      patchRowBusy(busyId, 'crawl', false);
      window.setTimeout(() => setTriggerMsg(''), 6000);
    }
  }

  async function runParseCompany(
    code: string,
    name: string,
    chosen?: import('@/lib/crawl-display').CrawlPeriodStatus,
  ) {
    const key = triggerKey('parse', code, chosen?.period, chosen?.announcementId);
    const busyId = rowBusyId(code, chosen?.period, chosen?.announcementId);
    if (isRowBusy(busyId, 'parse')) return;
    const label = chosen?.period ? `${name} ${chosen.period}` : `${name}（${code}）`;
    const job: OptimisticJob = {
      key,
      code,
      name,
      label,
      period: chosen?.period,
      stage: 'parse',
      bucket: 'queue',
    };
    patchRowBusy(busyId, 'parse', true);
    setOptimisticJobs((prev) => [job, ...prev.filter((item) => item.key !== key)].slice(0, 12));
    setTriggerMsg(`已插到解析队首 ${label}`);
    void refreshLive();
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
      await holdOptimistic(Date.now(), 1400);
      setOptimisticJobs((prev) => prev.filter((item) => item.key !== key));
      patchRowBusy(busyId, 'parse', false);
      window.setTimeout(() => setTriggerMsg(''), 6000);
    }
  }

  async function runVerdictCompany(
    code: string,
    name: string,
    chosen?: import('@/lib/crawl-display').CrawlPeriodStatus,
  ) {
    if (!chosen?.announcementId) {
      window.alert(`${name} ${chosen?.period ?? ''} 尚未解析，请先解析`);
      return;
    }
    const busyId = rowBusyId(code, chosen.period, chosen.announcementId);
    if (isRowBusy(busyId, 'verdict')) return;
    const label = `${name} ${chosen.period}`;
    const refresh = chosen.verdictStatus === 'ready';
    patchRowBusy(busyId, 'verdict', true);
    setTriggerMsg(`正在智析 ${label}…`);
    try {
      await requestReportVerdict(chosen.announcementId, refresh ? { refresh: true } : { fill: true });
      setTriggerMsg(`已完成智析 ${label}`);
      await refreshCoverage();
      await refreshLive();
    } catch (error) {
      setTriggerMsg(String(error));
    } finally {
      patchRowBusy(busyId, 'verdict', false);
      window.setTimeout(() => setTriggerMsg(''), 6000);
    }
  }

  const downloadQueueItems = useMemo(() => {
    const rest = (live?.queueItems ?? [])
      .filter((q) => q.stage === 'download')
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
          reason: waitSec > 0
            ? (q.status === 'retry' ? `上次失败，${waitSec}s 后重试` : `约 ${waitSec}s 后可下载`)
            : q.reason,
          lastError: q.lastError || q.parseError || undefined,
          waitSec: waitSec > 0 ? waitSec : undefined,
        };
      });
    const extra = optimisticJobs
      .filter((job) => job.stage === 'download' && job.bucket === 'queue' && !jobCovered(job, rest))
      .map((job, i) => ({
        code: job.code,
        name: job.name,
        label: job.label,
        period: job.period,
        position: i + 1,
        status: 'queued',
        reason: '刚加入排队，等待领取',
      }));
    return [...extra, ...rest.map((item, i) => ({ ...item, position: extra.length + i + 1 }))];
  }, [optimisticJobs, live?.queueItems, queueWaitTick]);

  const parseQueueItems = useMemo(() => {
    const list = live?.pendingParseItems ?? live?.queueItems?.filter((q) => q.stage === 'parse') ?? [];
    const rest = list.map((q) => ({
      code: q.code,
      name: q.name,
      label: queueDisplayName(q),
      period: q.period,
      position: q.position,
      status: q.status,
      source: q.source,
      reason: q.reason,
    }));
    const extra = optimisticJobs
      .filter((job) => job.stage === 'parse' && job.bucket === 'queue' && !jobCovered(job, rest))
      .map((job, i) => ({
        code: job.code,
        name: job.name,
        label: job.label,
        period: job.period,
        position: i + 1,
        status: 'queued',
        reason: '已插到解析队首，空闲时优先',
      }));
    return [...extra, ...rest.map((item, i) => ({ ...item, position: extra.length + i + 1 }))];
  }, [optimisticJobs, live?.pendingParseItems, live?.queueItems]);

  const downloadingItems = useMemo(() => {
    const rest = (live?.activeItems ?? [])
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
    const extra = optimisticJobs
      .filter((job) => job.stage === 'download' && job.bucket === 'active' && !jobCovered(job, [...rest, ...downloadQueueItems]))
      .map((job, i) => ({
        code: job.code,
        name: job.name,
        label: job.label,
        period: job.period,
        position: i + 1,
        status: 'downloading',
        reason: '正在下载指定财报…',
      }));
    return [...extra, ...rest.map((item, i) => ({ ...item, position: extra.length + i + 1 }))];
  }, [optimisticJobs, live?.activeItems, downloadQueueItems]);

  const parsingItems = useMemo(() => {
    void parseElapsedTick;
    const list = live?.activeParseItems ?? (live?.activeItems ?? []).filter((q) => q.stage === 'parse');
    const rest = list.map((q) => {
      const startedAt = q.startedAt;
      const ageMs = startedAt ? Math.max(0, Date.now() - Date.parse(startedAt)) : (q.ageMs ?? 0);
      const progress = startedAt
        ? `正在解析 · 已 ${formatParseElapsed(ageMs)} / 限 5分钟`
        : q.progress;
      return {
        code: q.code,
        name: q.name,
        label: queueDisplayName(q),
        period: q.period,
        position: q.position,
        status: q.status,
        source: q.source,
        reason: q.reason,
        progress,
        startedAt,
      };
    });
    const extra = optimisticJobs
      .filter((job) => job.stage === 'parse' && job.bucket === 'active' && !jobCovered(job, rest))
      .map((job, i) => ({
        code: job.code,
        name: job.name,
        label: job.label,
        period: job.period,
        position: i + 1,
        status: 'parsing',
        reason: '正在解析指定财报…',
        progress: '正在解析指定财报…',
        startedAt: undefined as string | undefined,
      }));
    return [...extra, ...rest.map((item, i) => ({ ...item, position: extra.length + i + 1 }))];
  }, [optimisticJobs, live?.activeParseItems, live?.activeItems, parseElapsedTick]);

  const queueCount = Math.max(live?.counts.pending_download ?? 0, downloadQueueItems.length);
  const downloadUsed = Math.max(live?.downloadSlots.used ?? 0, downloadingItems.length);
  const parseUsed = Math.max(
    live?.parseSlots.used ?? 0,
    parsingItems.length,
    all.filter((c) => c.parseStatus === 'parsing').length,
  );
  const parseQueueCount = Math.max(live?.counts.pending_parse ?? 0, parseQueueItems.length);

  return (
    <main className="app-shell co-shell">
      <section className="co-page">
        <div className="co-title-row">
          <Link href="/" className="co-back-home" aria-label="返回首页"><Icon name="arrowLeft" size={14} /> 返回首页</Link>
          <h1>数据源采集</h1>
          <span className="co-title-meta">
            {loading ? '加载中' : ''}
          </span>
          <div className="co-title-actions">
            <label className={`co-auto-toggle ${!autoCrawlEnabled ? 'paused' : ''}`} title={autoCrawlEnabled ? (coverageReady ? `已开启：初始化完成，每 ${pollIntervalMin} 分钟只扫最近 ${lookbackDays} 天公告；排队下载与解析继续。` : `已开启：先全量补齐 2025Q1 及之后缺口，完成后再只扫最近 ${lookbackDays} 天公告。`) : '已关闭：下载中任务会完成，排队不再自动开始下载；仍会定时扫描新公告与缺口'}>
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
            <label className={`co-auto-toggle ${!autoVerdictEnabled ? 'paused' : ''}`} title={autoVerdictEnabled ? '已开启：空闲时单线程补齐未智析财报。单份首字 30 秒、整段 5 分钟；抢不到模型则让路；失败跳过，连续失败会冷却。' : '已关闭：不再自动领取未智析财报。详情页和批量智析仍可手动生成。'}>
              <span>自动智析</span>
              <button
                type="button"
                role="switch"
                aria-checked={autoVerdictEnabled}
                aria-label={autoVerdictEnabled ? '自动智析：开' : '自动智析：关'}
                className={`co-switch ${autoVerdictEnabled ? 'on' : ''}`}
                disabled={autoVerdictSaving}
                onClick={() => void toggleAutoVerdict()}
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
                <p className="co-ops-tip-lead">先全量补齐 2025Q1 及之后缺口：找到下载源进入排队下载，下完自动排队解析。全部扫过且不再缺可补期次后进入已初始化，默认只扫最近 {lookbackDays} 天公告。关闭后仍扫描公告，但排队不再自动开始下载。</p>
                <ul>
                  <li><em>自动抓取</em><span>{autoCrawlEnabled ? '开' : '关'}</span></li>
                  <li><em>自动智析</em><span>{autoVerdictEnabled ? '开' : '关'}</span></li>
                  <li><em>覆盖状态</em><span>{coverageReady ? '已初始化' : '全量补齐中'}</span></li>
                  <li><em>下载并发</em><span>{downloadMax}</span></li>
                  <li><em>解析并发</em><span>{parseMax}（闲时单队列；详情页可额外并发）</span></li>
                  <li><em>下载间隔</em><span>{downloadPauseSec} 秒</span></li>
                  <li><em>轮询间隔</em><span>{pollIntervalMin} 分钟</span></li>
                  <li><em>超时</em><span>下载/解析各 5 分钟 · 智析首字 30 秒 / 整段 5 分钟</span></li>
                  <li><em>采集窗口</em><span>{coverageReady ? `近 ${lookbackDays} 天公告` : '最早 2025Q1'}</span></li>
                </ul>
              </span>
            </span>
          </div>
        </div>

        <div className="co-pipebar" role="status" aria-label="采集监控">
          <SourceDots health={sourceProbes ?? live?.health} />
          <span className="co-sb-arrow co-sb-flow" aria-hidden="true"><Icon name="arrowRight" size={12} /></span>
          <div className="co-sb-pipeline">
            <span className="co-sb-node-wrap">
              <button
                type="button"
                ref={dlQueueBtnRef}
                className={`co-sb-node clickable ${queuePopover === 'download' ? 'open' : ''}`}
                aria-expanded={queuePopover === 'download'}
                onClick={() => setQueuePopover((v) => (v === 'download' ? null : 'download'))}
              >
                <PulseDot on={queueCount > 0} />
                排队下载(<b>{queueCount}</b>)
              </button>
              <QueuePopover
                open={queuePopover === 'download'}
                title="排队下载"
                items={downloadQueueItems}
                empty="暂无排队下载"
                note={!autoCrawlEnabled
                  ? '自动抓取已关：排队任务暂不开始下载；下载中的会完成。仍会定时扫描新公告。'
                  : (queueCount > 0 && downloadUsed === 0
                    ? '下载槽空闲：下方倒计时为防封控间隔，到点后领取下载。'
                    : undefined)}
                onClose={() => setQueuePopover(null)}
                anchorRef={dlQueueBtnRef}
              />
            </span>
            <span className="co-sb-arrow" aria-hidden="true"><Icon name="arrowRight" size={12} /></span>
            <span className="co-sb-node-wrap">
              <button
                type="button"
                ref={dlActiveBtnRef}
                className={`co-sb-node clickable ${queuePopover === 'downloading' ? 'open' : ''}`}
                aria-expanded={queuePopover === 'downloading'}
                title="点击查看下载中任务与来源"
                onClick={() => setQueuePopover((v) => (v === 'downloading' ? null : 'downloading'))}
              >
                <PulseDot on={downloadUsed > 0} />
                下载中(<b>{downloadUsed}/{downloadMax}</b>)
              </button>
              <QueuePopover
                open={queuePopover === 'downloading'}
                title="下载中"
                items={downloadingItems}
                empty={queueCount > 0 ? `槽位空闲，排队等待 Worker 领取（约 ${downloadPauseSec}s 一轮）` : '当前无下载任务'}
                note={paused
                  ? '自动抓取已关：下载中的任务会完成，排队不再自动进入下载槽。'
                  : (queueCount > 0 && downloadUsed === 0 ? '有排队但下载槽空闲：等待 Worker 或本页软触发领取。' : undefined)}
                onClose={() => setQueuePopover(null)}
                anchorRef={dlActiveBtnRef}
              />
            </span>
            <span className="co-sb-arrow" aria-hidden="true"><Icon name="arrowRight" size={12} /></span>
            <span className="co-sb-node-wrap">
              <button
                type="button"
                ref={parseQueueBtnRef}
                className={`co-sb-node clickable ${queuePopover === 'parse' ? 'open' : ''}`}
                aria-expanded={queuePopover === 'parse'}
                onClick={() => setQueuePopover((v) => (v === 'parse' ? null : 'parse'))}
              >
                <PulseDot on={parseQueueCount > 0} />
                排队解析(<b>{parseQueueCount}</b>)
              </button>
              <QueuePopover
                open={queuePopover === 'parse'}
                title="排队解析"
                items={parseQueueItems}
                empty="暂无排队解析"
                note="闲时单队列。手动点「解析」插到队首；超时或失败会记下错误并排到队尾。详情页打开会立即并发解析，不进这支队列。"
                onClose={() => setQueuePopover(null)}
                anchorRef={parseQueueBtnRef}
              />
            </span>
            <span className="co-sb-arrow" aria-hidden="true"><Icon name="arrowRight" size={12} /></span>
            <span className="co-sb-node-wrap">
              <button
                type="button"
                ref={parseActiveBtnRef}
                className={`co-sb-node clickable ${queuePopover === 'parsing' ? 'open' : ''}`}
                aria-expanded={queuePopover === 'parsing'}
                title="点击查看解析中任务"
                onClick={() => setQueuePopover((v) => (v === 'parsing' ? null : 'parsing'))}
              >
                <PulseDot on={parseUsed > 0} />
                解析中(<b>{parseUsed}/{parseMax}</b>)
              </button>
              <QueuePopover
                open={queuePopover === 'parsing'}
                title="解析中"
                items={parsingItems}
                empty={parseQueueCount > 0 ? '解析槽空闲，排队等待领取' : '当前无解析任务'}
                note={parsingItems[0]
                  ? `当前：${parsingItems[0].label} · ${parsingItems[0].progress ?? '计时中'}`
                  : (paused ? '自动抓取已关：已下载 PDF 仍会继续解析。' : undefined)}
                onClose={() => setQueuePopover(null)}
                anchorRef={parseActiveBtnRef}
              />
            </span>
            <span className="co-sb-arrow" aria-hidden="true"><Icon name="arrowRight" size={12} /></span>
            <span className="co-sb-node static">已入库(<b>{ingested}</b>)</span>
            <span className="co-sb-arrow" aria-hidden="true"><Icon name="arrowRight" size={12} /></span>
            <span className="co-sb-node-wrap">
              <button
                type="button"
                ref={verdictBtnRef}
                className={`co-sb-node clickable ${queuePopover === 'verdict' ? 'open' : ''}`}
                aria-expanded={queuePopover === 'verdict'}
                title="点击查看自动智析队列"
                onClick={() => setQueuePopover((v) => (v === 'verdict' ? null : 'verdict'))}
              >
                <PulseDot on={autoVerdictEnabled && (Boolean(live?.verdictQueue?.current) || live?.verdictQueue?.status === 'running' || (live?.verdictQueue?.pending ?? 0) > 0)} />
                自动智析(<b>{live?.verdictQueue?.pending ?? 0}</b>)
              </button>
              <QueuePopover
                open={queuePopover === 'verdict'}
                title="自动智析"
                items={live?.verdictQueueItems ?? []}
                empty={autoVerdictEnabled ? ((live?.verdictQueue?.pending ?? 0) > 0 ? '待补项正在冷却或等待 Worker' : '暂无待智析任务') : '自动智析已关'}
                note={live?.verdictQueue?.note || (autoVerdictEnabled ? '空闲时单线程补齐，首字 30 秒，整段 5 分钟。' : '已关闭：详情页打开或批量智析仍可手动生成。')}
                onClose={() => setQueuePopover(null)}
                anchorRef={verdictBtnRef}
              />
            </span>
          </div>
          <button
            type="button"
            className="co-pipebar-settings"
            aria-label="采集设置"
            aria-expanded={settingsMounted && !settingsClosing}
            title="采集设置"
            onClick={() => { if (settingsMounted && !settingsClosing) closeSettings(); else void openSettings(); }}
          >
            <Icon name="settings" size={18} />
          </button>
        </div>
        <p className="co-stage-msg" role="status" aria-live="polite">{triggerMsg || ''}</p>

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
            <Icon name="search" size={14} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="公司 / 代码"
              aria-label="搜索公司或代码"
            />
            {search ? (
              <button
                type="button"
                className="co-search-clear"
                aria-label="清空检索"
                onClick={() => setSearch('')}
              >
                ×
              </button>
            ) : null}
          </label>
          <select value={source} onChange={(e) => setSource(e.target.value as SourceFilter)} aria-label="来源筛选">
            <option value="all">全部来源</option>
            <option value="exchange">交易所直连</option>
            <option value="cninfo">巨潮资讯</option>
          </select>
          <select
            value={periodOptions.includes(periodPrefix.trim().toUpperCase()) ? periodPrefix.trim().toUpperCase() : periodPrefix}
            onChange={(e) => setPeriodPrefix(e.target.value)}
            aria-label="选择报告期"
          >
            <option value="">全部期次</option>
            {periodOptions.map((token) => <option key={token} value={token}>{token}</option>)}
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
              失败
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
              解析中
            </button>
            <button
              type="button"
              className={`co-toggle ${onlyMissingAi ? 'on' : ''}`}
              aria-pressed={onlyMissingAi}
              onClick={() => setOnlyMissingAi((v) => !v)}
            >
              未智析
            </button>
          </div>
          <div className="co-batch-acts" role="group" aria-label="批量操作">
            <button
              type="button"
              className="co-batch-run"
              disabled={batchBusy || !selectedFilings.length}
              onClick={() => runBatchCrawl()}
            >
              批量抓取
            </button>
            <button
              type="button"
              className="co-batch-run"
              disabled={batchBusy || !selectedFilings.length}
              onClick={() => runBatchParse()}
            >
              批量解析
            </button>
            <button
              type="button"
              className="co-batch-run"
              disabled={batchBusy || !selectedFilings.length}
              onClick={() => runBatchVerdict()}
            >
              批量智析
            </button>
            {selectedFilings.length ? <span className="co-batch-count">已选 {selectedFilings.length}</span> : null}
          </div>
          <div className="co-toolbar-right">
            <button
              type="button"
              className="co-table-refresh"
              aria-label="刷新列表"
              title="刷新"
              disabled={tableRefreshing}
              onClick={() => void refreshTable()}
            >
              <Icon name="refresh" size={14} className={tableRefreshing ? 'co-spin' : undefined} />
            </button>
            <span className="co-sort-hint" aria-live="polite">
              {loading ? '…' : `${filings.length} 份`}
            </span>
          </div>
        </div>

        <div className="co-table-wrap is-filings" role="region" aria-label="全量财报列表">
          <table className="co-table co-table-compact">
            <thead>
              <tr>
                <th className="co-check-col">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    disabled={!filings.length}
                    onChange={toggleSelectVisible}
                    aria-label="全选当前列表中的财报"
                  />
                </th>
                <th className="co-col-company">公司 / 代码</th>
                <th className="co-col-period">期次</th>
                <th className="co-col-source">来源</th>
                <th className="co-col-time">
                  <SortHeader label="发现" state={timeCol === 'discovered' ? timeSort : 'default'} onCycle={() => onTimeSort('discovered')} />
                </th>
                <th className="co-col-time">
                  <SortHeader label="抓取" state={timeCol === 'downloaded' ? timeSort : 'default'} onCycle={() => onTimeSort('downloaded')} />
                </th>
                <th className="co-col-time">
                  <SortHeader label="解析" state={timeCol === 'parsed' ? timeSort : 'default'} onCycle={() => onTimeSort('parsed')} />
                </th>
                <th className="co-col-time">
                  <SortHeader label="智析" state={timeCol === 'verdict' ? timeSort : 'default'} onCycle={() => onTimeSort('verdict')} />
                </th>
                <th className="co-col-ops">操作</th>
              </tr>
            </thead>
            <tbody>
              {filings.map((item) => {
                const checked = selectedIds.has(item.key);
                const period = filingToPeriodStatus(item);
                const crawlBusy = isRowBusy(item.key, 'crawl');
                const parseBusy = isRowBusy(item.key, 'parse');
                const verdictBusy = isRowBusy(item.key, 'verdict');
                return (
                  <tr key={item.key} className={item.state === 'failed' ? 'is-fail' : ''}>
                    <td className="co-check-col">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => toggleFiling(item.key, e.target.checked)}
                        aria-label={`${item.name} ${item.period}`}
                      />
                    </td>
                    <td className="co-col-company">
                      <span className="co-company-cell">
                        <button
                          type="button"
                          className="co-company-btn"
                          onClick={() => filterByCompany(item.name)}
                        >
                          {item.name}
                        </button>
                        <span className="co-code">{item.code}</span>
                      </span>
                      <IndustryTag item={item} />
                    </td>
                    <td className="co-col-period">
                      <Link
                        href={companyHref(item, item.period)}
                        className="co-period-link"
                        data-tip={periodChipTitle(period)}
                      >
                        {item.period}
                      </Link>
                    </td>
                    <td className="co-col-source">{sourceApiShort(item.sourceApi)}</td>
                    <td className="co-col-time"><span className="co-time">{formatCrawlTime(item.discoveredAt ?? item.publishedAt ?? null)}</span></td>
                    <td className="co-col-time"><span className="co-time">{formatCrawlTime(item.downloadedAt ?? null)}</span></td>
                    <td className="co-col-time">
                      <span className="co-time">{formatCrawlTime(item.parsedAt ?? null)}</span>
                    </td>
                    <td className="co-col-time">
                      <span className="co-time">{formatCrawlTime(item.verdictStatus === 'ready' ? item.verdictGeneratedAt : null)}</span>
                    </td>
                    <td className="co-col-ops">
                      <div className="co-actions">
                        <button
                          type="button"
                          className="co-text-act"
                          disabled={crawlBusy}
                          onClick={() => askCrawl(item.code, item.name, period)}
                        >{crawlBusy ? '抓取中' : '抓取'}</button>
                        <button
                          type="button"
                          className="co-text-act"
                          disabled={parseBusy || (item.state === 'expected' && !item.announcementId)}
                          onClick={() => askParse(item.code, item.name, period)}
                        >{parseBusy ? '解析中' : '解析'}</button>
                        <button
                          type="button"
                          className="co-text-act"
                          disabled={verdictBusy || (!canFillVerdict(item) && !parseBusy)}
                          onClick={() => askVerdict(item.code, item.name, period)}
                        >{verdictBusy ? '智析中' : '智析'}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!filings.length && (
                <tr>
                  <td colSpan={9}>
                    <div className={`co-empty ${loading ? 'co-loading' : ''}`} role="status" aria-live="polite">
                      {loading ? (
                        <>
                          <span className="co-loading-spin" aria-hidden="true" />
                          正在加载…
                        </>
                      ) : '没有符合条件的财报'}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {settingsMounted ? (
        <div
          className={`co-settings-backdrop${settingsClosing ? ' closing' : ''}`}
          role="presentation"
          onClick={closeSettings}
          onAnimationEnd={finishSettingsClose}
        >
          <aside
            className="co-settings-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="co-settings-title"
            onClick={(event) => event.stopPropagation()}
            onAnimationEnd={finishSettingsClose}
          >
            <header className="co-settings-head">
              <h2 id="co-settings-title">采集设置</h2>
              <button type="button" className="co-settings-close" aria-label="关闭设置" onClick={closeSettings}>
                <Icon name="x" size={14} />
              </button>
            </header>
            <div className="co-settings-body">
              {SETTINGS_FIELDS.map((field) => {
                const bounds = SETTINGS_BOUNDS[field.key];
                const maxLength = settingMaxDigits(bounds.max);
                return (
                  <div key={field.key} className="co-settings-field">
                    <span className="co-settings-label" tabIndex={0}>
                      {field.label}
                      <span className="co-settings-tip" role="tooltip">
                        {field.hint} 范围 {bounds.min}–{bounds.max}{field.unit}，默认 {bounds.fallback}{field.unit}。
                      </span>
                    </span>
                    <span className="co-settings-prefix">{field.prefix ?? ''}</span>
                    <span className="co-settings-input">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={maxLength}
                        aria-label={field.prefix ? `${field.prefix}${settingsDraft[field.key] || ''}${field.unit}` : field.label}
                        value={settingsDraft[field.key]}
                        disabled={settingsSaving}
                        onChange={(event) => setSettingsDraft((draft) => ({
                          ...draft,
                          [field.key]: sanitizeSettingInput(event.target.value, bounds.max),
                        }))}
                      />
                      <b>{field.unit}</b>
                    </span>
                  </div>
                );
              })}
              <section className="co-llm-probe" aria-label="AI 连接性">
                <div className="co-llm-probe-head">
                  <strong>AI 连接性</strong>
                  <button type="button" className="co-llm-probe-run" onClick={() => void probeLlm()} disabled={llmProbeBusy}>
                    {llmProbeBusy ? '检测中…' : '检测连接'}
                  </button>
                </div>
                <p className="co-llm-probe-lead">向已配置模型发送「直接回复ok」，逐个检查连通性。</p>
                {llmProbeError ? <p className="co-llm-probe-error" role="status">{llmProbeError}</p> : null}
                {llmProbeResults ? (
                  <ul className="co-llm-probe-list">
                    {llmProbeResults.length ? llmProbeResults.map((item) => (
                      <li key={`${item.id}-${item.model}`} className={item.ok ? 'ok' : 'bad'}>
                        <b>{item.model}</b>
                        <span className="co-llm-probe-host">{item.host}</span>
                        <em>{item.ok ? `正常 · ${item.latencyMs}ms${item.reply ? ` · ${item.reply}` : ''}` : (item.error || '异常')}</em>
                      </li>
                    )) : <li className="bad">未配置可用模型</li>}
                  </ul>
                ) : null}
              </section>
            </div>
            <footer className="co-settings-foot">
              <button type="button" className="co-confirm-cancel" onClick={closeSettings} disabled={settingsSaving}>取消</button>
              <button type="button" className="co-confirm-ok" onClick={() => void saveSettings()} disabled={settingsSaving}>
                {settingsSaving ? '保存中…' : '确认'}
              </button>
            </footer>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
