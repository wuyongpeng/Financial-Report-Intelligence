'use client';
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  freshnessLabel,
  parseStatusLabel,
  reportTypeLabel,
  reportTypeSortKey,
  sourceBadgeLabel,
  type CrawlCompanyCoverage,
  type CrawlSourceKind,
  type CrawlStats,
  type ParseStatus,
} from '@/lib/crawl-display';
import './crawl-overview.css';

type SourceFilter = 'all' | CrawlSourceKind;
type SortState = 'default' | 'asc' | 'desc';
type LivePayload = {
  running: boolean;
  autoCrawlEnabled?: boolean;
  lastPollAt: string | null;
  counts: {
    discovered: number;
    downloaded: number;
    pending_download: number;
    pending_parse: number;
    review: number;
    online: number;
    target_companies: number;
    download_failed: number;
  };
  downloadSlots: { used: number; max: number };
  parseSlots: { used: number; max: number };
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

/** Stable demo progress 28–86 for parsing rows when API has no percent. */
function demoProgress(code: string) {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return 28 + (h % 59);
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

function healthSnippet(
  health: LivePayload['health'] | undefined,
): string {
  if (!health?.length) return '来源健康：暂无记录';
  const parts = health.map((item) => {
    const name = item.source === 'CNINFO' ? '巨潮' : item.source;
    const state = item.ok === null ? '尚无' : item.ok ? '正常' : '异常';
    return `${name}${state}`;
  });
  return `来源：${parts.join(' · ')}`;
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

function ParseStatusCell({
  status,
  progress,
}: {
  status: ParseStatus;
  progress?: number;
}) {
  if (status === 'parsing') {
    const pct = progress ?? 45;
    return (
      <span className="co-status-live" title={`解析中 ${pct}%`}>
        <i className="co-pulse-dot" aria-hidden="true" />
        <span>解析中 {pct}%</span>
      </span>
    );
  }
  return (
    <span className={`co-pill ${statusClass(status)}`}>{parseStatusLabel(status)}</span>
  );
}

export default function CrawlOverview() {
  const [all, setAll] = useState<CrawlCompanyCoverage[]>([]);
  const [stats, setStats] = useState<CrawlStats | null>(null);
  const [live, setLive] = useState<LivePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<SourceFilter>('all');
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [onlyParsing, setOnlyParsing] = useState(false);
  const [timeSort, setTimeSort] = useState<SortState>('default');
  const [typeSort, setTypeSort] = useState<SortState>('default');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [advancedConfig, setAdvancedConfig] = useState(false);
  const [autoCrawlEnabled, setAutoCrawlEnabled] = useState(true);
  const [autoCrawlSaving, setAutoCrawlSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState('');

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

  useEffect(() => {
    void refreshCoverage();
    void refreshLive();
    const coverageTimer = window.setInterval(() => void refreshCoverage(), 5 * 60 * 1000);
    const liveTimer = window.setInterval(() => void refreshLive(), 15_000);
    return () => {
      window.clearInterval(coverageTimer);
      window.clearInterval(liveTimer);
    };
  }, [refreshCoverage, refreshLive]);

  const rows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    let list = all.filter((item) => {
      if (source !== 'all' && item.source !== source) return false;
      if (onlyFailed && item.parseStatus !== 'failed') return false;
      if (onlyParsing && item.parseStatus !== 'parsing') return false;
      if (!keyword) return true;
      return `${item.name} ${item.code} ${item.industry}`.toLowerCase().includes(keyword);
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
  const ingested = live?.counts.online
    ?? stats?.covered
    ?? all.filter((c) => c.parseStatus === 'completed').length;
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
    if (item.parseStatus === 'parsing') return demoProgress(item.code);
    return undefined;
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

  const stageCards = [
    {
      id: 'discover',
      title: '发现公告',
      value: String(discoveredTotal),
      meta: running ? '本轮活跃' : '空闲',
      detail: `最近轮询 ${live?.lastPollAt ? formatCrawlTime(live.lastPollAt) : stats?.lastPollAt ? formatCrawlTime(stats.lastPollAt) : '暂无'}`,
      sub: healthSnippet(live?.health),
      active: running,
    },
    {
      id: 'queue',
      title: '排队',
      value: String(queueCount),
      meta: queueCount > 0 ? '等待下载' : '队列清空',
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
      <header className="co-topbar">
        <Link href="/" className="co-brand">
          <span className="co-brand-mark">财</span>
          <strong>财报智析 Eva</strong>
        </Link>
        <nav className="co-top-nav">
          <Link href="/" className="co-back" aria-label="返回首页">← 返回首页</Link>
        </nav>
      </header>

      <section className="co-page">
        <div className="co-title-row">
          <h1>数据源采集</h1>
          <span className="co-title-meta">
            {loading ? '加载中' : ''}
          </span>
        </div>

        <div className="co-statusbar" role="status" aria-label="抓取管道状态">
          <div className="co-status-stats">
            <span className="co-stat-item">
              <i className="co-ico" aria-hidden="true">☰</i>
              队列中 <b>{queueCount}</b>
            </span>
            <span className="co-stat-item">
              <i className="co-ico" aria-hidden="true">↓</i>
              抓取中 <b>{downloadUsed}/{downloadMax}</b>
              {currentFile ? <em className="co-file-scroll" title={currentFile}>{currentFile}</em> : null}
            </span>
            <span className="co-stat-item">
              <i className="co-ico" aria-hidden="true">◇</i>
              AI解析中 <b>{Math.min(parseUsed, parseMax)}/{parseMax}</b>
            </span>
            <span className="co-stat-item">
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
            <div className="co-config-wrap">
              <button
                type="button"
                className={`co-config-btn ${configOpen ? 'open' : ''}`}
                aria-expanded={configOpen}
                aria-controls="co-config-panel"
                onClick={() => setConfigOpen((v) => !v)}
                title="采集设置"
              >
                ⚙ 设置
              </button>
              {configOpen && (
                <div id="co-config-panel" className="co-config-pop" role="dialog" aria-label="采集设置">
                  <header>
                    <strong>采集设置</strong>
                    <button type="button" onClick={() => { setConfigOpen(false); setAdvancedConfig(false); }} aria-label="关闭">×</button>
                  </header>
                  <dl>
                    <div><dt>是否自动抓取</dt><dd>{autoCrawlEnabled ? '是' : '否'}</dd></div>
                    <div><dt>多久轮询一次</dt><dd>约 {Math.round((live?.limits.intervalMs ?? 600_000) / 60000)} 分钟</dd></div>
                    <div><dt>一次最多下几份</dt><dd>{live?.limits.downloadLimit ?? downloadMax} 份</dd></div>
                    <div><dt>一次最多解析几份</dt><dd>{live?.limits.parseLimit ?? parseMax} 份</dd></div>
                    <div><dt>最近轮询</dt><dd>{live?.lastPollAt ? formatCrawlTime(live.lastPollAt) : stats?.lastPollAt ? formatCrawlTime(stats.lastPollAt) : '暂无'}</dd></div>
                  </dl>
                  <button
                    type="button"
                    className="co-advanced-toggle"
                    aria-expanded={advancedConfig}
                    onClick={() => setAdvancedConfig((v) => !v)}
                  >
                    {advancedConfig ? '收起高级' : '高级'}
                  </button>
                  {advancedConfig ? (
                    <dl className="co-config-advanced">
                      <div><dt>列表页间隔</dt><dd>{live?.limits.pagePauseMs ?? 1000} 毫秒</dd></div>
                      <div><dt>PDF 下载间隔</dt><dd>{live?.limits.downloadPauseMs ?? 1200} 毫秒</dd></div>
                      <div><dt>最大翻页</dt><dd>{live?.limits.maxPages ?? 8} 页</dd></div>
                    </dl>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>

        <section className="co-concurrent" aria-label="并发采集">
          <div className="co-concurrent-head">
            <h2>并发采集</h2>
            <button
              type="button"
              className="co-manual-btn"
              disabled={triggering || paused}
              onClick={() => void runManualRound()}
              title={paused ? '请先开启自动抓取' : '温和处理一轮积压'}
            >
              {triggering ? '触发中…' : '手动跑一轮'}
            </button>
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
                <small>{card.sub}</small>
              </article>
            ))}
          </div>
          {triggerMsg ? <p className="co-stage-msg" role="status">{triggerMsg}</p> : null}
        </section>

        <div className="co-toolbar">
          <label className="co-search">
            <span aria-hidden="true">⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索公司 / 代码"
              aria-label="搜索公司或代码"
            />
          </label>
          <select value={source} onChange={(e) => setSource(e.target.value as SourceFilter)} aria-label="来源筛选">
            <option value="all">全部来源</option>
            <option value="exchange">交易所直连</option>
            <option value="cninfo">巨潮兜底</option>
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
                <th>来源</th>
                <th>
                  <SortHeader label="公告类型" state={typeSort} onCycle={onTypeSort} />
                </th>
                <th>解析状态</th>
                <th>指标完整度</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const open = expanded === item.code;
                return (
                  <Fragment key={item.code}>
                    <tr
                      className={`co-row ${open ? 'open' : ''} ${item.parseStatus === 'failed' ? 'is-fail' : ''}`}
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
                        {item.source ? (
                          <span className={`co-pill ${item.source}`}>{sourceBadgeLabel(item.source)}</span>
                        ) : (
                          <span className="co-pill pending">尚未抓取</span>
                        )}
                      </td>
                      <td>
                        {reportTypeLabel(item.reportType)}
                        <div className="co-sub">{item.reportPeriod ?? '—'}</div>
                      </td>
                      <td>
                        <ParseStatusCell status={item.parseStatus} progress={rowProgress(item)} />
                      </td>
                      <td>
                        {item.metricsComplete ? (
                          <span className="co-pill ok">完整</span>
                        ) : item.metrics.length ? (
                          <>
                            <span className="co-pill warn">缺项</span>
                            {item.missingMetrics.length > 0 && (
                              <span className="co-missing">缺少 {item.missingMetrics.map(metricLabel).join(' / ')}</span>
                            )}
                          </>
                        ) : (
                          <span className="co-pill pending">暂无指标</span>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr key={`${item.code}-detail`} className="co-detail-row">
                        <td colSpan={6}>
                          <div className="co-detail">
                            <div>
                              <span>公告标题</span>
                              <strong>{item.announcementTitle ?? '—'}</strong>
                            </div>
                            <div>
                              <span>命中来源 API</span>
                              <strong>{sourceApiLabel(item)}</strong>
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
                                <strong>{rowProgress(item)}%</strong>
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
                  <td colSpan={6}>
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
            <SortHeader label="公告类型" state={typeSort} onCycle={onTypeSort} />
          </div>
          {rows.map((item) => (
            <article className="co-card" key={item.code}>
              <div className="co-card-top">
                <div>
                  <h3>
                    <Link href={companyHref(item)}>{item.name}</Link>
                  </h3>
                  <p>{item.code} · {formatCrawlTime(item.lastCrawlAt)}</p>
                </div>
                <ParseStatusCell status={item.parseStatus} progress={rowProgress(item)} />
              </div>
              <div className="co-card-meta">
                {item.source ? <span className={`co-pill ${item.source}`}>{sourceBadgeLabel(item.source)}</span> : <span className="co-pill pending">尚未抓取</span>}
                <span>{reportTypeLabel(item.reportType)}</span>
                <span>{item.metricsComplete ? '指标完整' : item.metrics.length ? '指标缺项' : '暂无指标'}</span>
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
