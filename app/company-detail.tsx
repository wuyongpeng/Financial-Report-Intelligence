'use client';

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { amount, anomaliesConclusion, attributionConclusion, cashConversion, change, comparableHistory, sequentialHistory, debtRatio, filingType, format, grossMargin, historyConclusion, keyFindings, labels, metricNames, moduleForQuestion, peersConclusion, period, periodKey, pickCanonicalReports, priorYear, profitBridge, sourceRange, unitOf, value, type Citation, type HeadlineMetric, type MetricName, type Report } from '@/lib/detail-model';
import { changeTone, verdictTone, type ChangeDirection, type ReportVerdict } from '@/lib/report-verdict';
import { requestReportVerdict } from '@/lib/request-report-verdict';
import { parsePeriodHints, reportMatchesPeriod } from '@/lib/home-search';
import { assembleFocusPrompt, displayFocusPrompt, FOCUS_MAX_ITEMS, FOCUS_QUOTE_MAX, type FocusItem, type FocusKind } from '@/lib/focus-prompt';
import { citeFilingLabel, citeHoverText, filingPageHref, matchAnswerCitation, parseFilingHref, tokenizeAnswerCites, uniqueAnswerSources } from '@/lib/answer-cite';
import { type PdfPageLabel } from '@/lib/pdf-pages';
import AnswerMarkdown from './answer-markdown';
import { AnswerFeedback } from './answer-feedback';
import PdfEvidence from './pdf-evidence';
import { Icon } from './ui-icons';
import { clientUuid } from '@/lib/client-uuid';
import { isCanonicalPeriod } from '@/lib/ingest-period';
import { reportIsParsed, reportNeedsDownload, reportNeedsParse, reportParseInFlight } from '@/lib/detail-auto';
import './company-detail.css';

type Outline = { pageLabels?: PdfPageLabel[]; indexedPages: number; pages: { page: number; content: string }[]; outline: { id: string; title: string; page: number; highlight: string }[] };
type Peer = { code: string; company_name: string; metric: string; value: number; unit: string };
type Analysis = { peers?: Peer[]; industry?: string };
// Follow-ups belong to the answer that produced them, so they travel on the message
// itself and survive a period switch together with the conversation.
type Message = {
  role: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
  followups?: string[];
  followupBusy?: boolean;
  feedback?: 'up' | 'down';
  feedbackDone?: boolean;
  ask?: { question: string; focus?: FocusItem[] };
};
type Clip = { id: string; kind: FocusKind; quote: string; page?: number; title?: string };
const emptyOutline: Outline = { indexedPages: 0, pages: [], outline: [] };
const moduleLabels = { business: '主营业务', attribution: '净利润变动', anomalies: '异常指标提示', history: '历史趋势详情', peers: '同业对比' };
const compactModuleIds = new Set(['business', 'attribution', 'anomalies']);
const starterAsks = [
  { label: '营收增长主因', question: '营业收入变动的主要原因是什么？请引用原文。' },
  { label: '净利润增长主因', question: '归母净利润变动的主要原因是什么？请引用原文。' },
  { label: '现金流变动', question: '经营现金流变动的主要原因是什么？请引用原文。' },
];
// Material Symbols "dock to left" / "dock to right", inlined to avoid a font request.
const dockPaths = {
  left: 'M120-120q-33 0-56.5-23.5T40-200v-560q0-33 23.5-56.5T120-840h720q33 0 56.5 23.5T920-760v560q0 33-23.5 56.5T840-120H120Zm200-80h520v-560H320v560Zm-80 0v-560H120v560h120Z',
  right: 'M120-120q-33 0-56.5-23.5T40-200v-560q0-33 23.5-56.5T120-840h720q33 0 56.5 23.5T920-760v560q0 33-23.5 56.5T840-120H120Zm0-80h520v-560H120v560Zm600 0h120v-560H720v560Z',
};
function DockIcon({ side }: { side: 'left' | 'right' }) {
  return <svg className="cd-dock-icon" viewBox="0 -960 960 960" aria-hidden="true" focusable="false"><path d={dockPaths[side]} /></svg>;
}
function ActIcon({ children }: { children: ReactNode }) {
  return (
    <svg className="cd-act-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

function EvaAnalyzing({ phase }: { phase: 'retrieving' | 'reasoning' }) {
  const label = phase === 'reasoning' ? 'Eva正在推理' : 'Eva正在分析';
  return (
    <div className="cd-analyzing" role="status" aria-live="polite" aria-label={`${label}中`}>
      <span className="cd-analyzing-spark" aria-hidden="true">✧</span>
      <span className="cd-analyzing-copy">{label}</span>
      <span className="cd-analyzing-dots" aria-hidden="true">
        <span className="cd-analyzing-dot" />
        <span className="cd-analyzing-dot" />
        <span className="cd-analyzing-dot" />
      </span>
    </div>
  );
}
const pct = (n: number | undefined) => n === undefined ? '暂无同期数据' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
function changeDirectionIcon(direction: ChangeDirection): { name: 'arrowUp' | 'arrowDown' | 'warn' | 'minus'; label: string } | null {
  if (direction === '利好') return { name: 'arrowUp', label: '利好' };
  if (direction === '利空') return { name: 'arrowDown', label: '利空' };
  if (direction === '风险') return { name: 'warn', label: '风险' };
  return { name: 'minus', label: '中性' };
}
function reportTypeLabel(r: Report) {
  const kind = filingType(r);
  return kind === 'annual' ? '年报' : kind === 'semiannual' ? '中报' : '季报';
}

function polylinePath(xs: number[], ys: Array<number | undefined>) {
  const parts: string[] = [];
  let drawing = false;
  for (let i = 0; i < xs.length; i++) {
    const yv = ys[i];
    if (yv === undefined) {
      drawing = false;
      continue;
    }
    parts.push(`${drawing ? 'L' : 'M'}${xs[i]} ${yv}`);
    drawing = true;
  }
  return parts.join(' ');
}

function Trend({ reports, metric, compare, onSelect }: { reports: Report[]; metric: HeadlineMetric; compare: HeadlineMetric | null; onSelect: (r: Report) => void }) {
  const rows = reports.slice(-8);
  const primary = rows.map((r) => value(r, metric));
  const values = primary.filter((v): v is number => v !== undefined);
  if (values.length < 2) return <div className="cd-empty">至少需要两期同口径数据才能绘制趋势。已覆盖 {values.length} 期。</div>;
  const compareSeries = compare ? rows.map((r) => value(r, compare)) : [];
  const base = compareSeries.find((v): v is number => v !== undefined && v !== 0);
  const indexed = base ? compareSeries.map((v) => v === undefined ? undefined : v / base * (values[0] ?? 0)) : [];
  const overlayVals = indexed.filter((v): v is number => v !== undefined);
  const dataMin = Math.min(...values, ...overlayVals);
  const dataMax = Math.max(...values, ...overlayVals);
  const range = dataMax - dataMin;
  const pad = (range === 0 ? Math.abs(dataMax) || 1 : range) * 0.12;
  let min = dataMin - pad;
  let max = dataMax + pad;
  if (dataMin < 0 && dataMax > 0) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  const span = max - min || 1;
  const plot = { left: 36, right: 554, top: 28, bottom: 148 };
  const xs = rows.map((_, i) => plot.left + i * ((plot.right - plot.left) / Math.max(rows.length - 1, 1)));
  const yOf = (v: number) => plot.bottom - (v - min) / span * (plot.bottom - plot.top);
  const primaryYs = primary.map((v) => v === undefined ? undefined : yOf(v));
  const compareYs = indexed.map((v) => v === undefined ? undefined : yOf(v));
  const primaryPath = polylinePath(xs, primaryYs);
  const comparePath = polylinePath(xs, compareYs);
  const showZero = min < 0 && max > 0;
  return (
    <svg className="cd-trend" viewBox="0 0 590 190" role="img" aria-label={`${labels[metric]}近${rows.length}期趋势${compare ? `，并叠加指数化后的${labels[compare]}` : ''}`}>
      {[0, 0.5, 1].map((t) => (
        <line key={t} className="cd-trend-grid" x1={plot.left - 6} x2={plot.right + 6} y1={plot.top + (plot.bottom - plot.top) * t} y2={plot.top + (plot.bottom - plot.top) * t} />
      ))}
      {showZero ? <line className="cd-trend-zero" x1={plot.left - 6} x2={plot.right + 6} y1={yOf(0)} y2={yOf(0)} /> : null}
      {primaryPath ? <path className="cd-trend-line" d={primaryPath} /> : null}
      {comparePath ? <path className="cd-trend-line compare" d={comparePath} /> : null}
      {rows.map((r, i) => {
        const n = primary[i];
        const cy = primaryYs[i];
        return (
          <g key={r.id}>
            {n !== undefined && cy !== undefined ? (
              <text className="cd-trend-value" x={xs[i]} y={cy - 10} textAnchor="middle">{format(n, metric)}</text>
            ) : null}
            <text className="cd-trend-axis" x={xs[i]} y="176" textAnchor="middle" onClick={() => onSelect(r)}>{period(r)}</text>
          </g>
        );
      })}
      {compareYs.map((cy, i) => cy === undefined ? null : (
        <circle key={`c-${i}`} className="cd-trend-dot compare" cx={xs[i]} cy={cy} r="3.5">
          <title>{labels[compare!]}（指数化）：{format(value(rows[i], compare!), compare!)}</title>
        </circle>
      ))}
      {rows.map((r, i) => {
        const n = primary[i];
        const cy = primaryYs[i];
        if (n === undefined || cy === undefined) return null;
        return (
          <circle key={`p-${r.id}`} className="cd-trend-dot" cx={xs[i]} cy={cy} r="4">
            <title>{r.title}：{format(n, metric)}</title>
          </circle>
        );
      })}
    </svg>
  );
}

function jumpTargetLabel(label: string) {
  return <span className="cd-jump-target">{label}</span>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadCompanyReports(code: string): Promise<Report[]> {
  const response = await fetch(`/api/reports?code=${encodeURIComponent(code)}&limit=100`, { cache: 'no-store' });
  if (!response.ok) throw new Error('财报列表加载失败');
  const data = await response.json() as { reports: Report[] };
  const usable = (data.reports ?? []).filter((item) => item.id && !item.id.startsWith('pending:'));
  return pickCanonicalReports(usable);
}

async function waitForParsedReport(code: string, id: string, signal: AbortSignal, timeoutMs = 120_000): Promise<Report | null> {
  const started = Date.now();
  while (!signal.aborted && Date.now() - started < timeoutMs) {
    const reports = await loadCompanyReports(code).catch(() => [] as Report[]);
    const hit = reports.find((item) => item.id === id);
    if (hit && reportIsParsed(hit)) return hit;
    await sleep(2000);
  }
  if (signal.aborted) return null;
  const reports = await loadCompanyReports(code).catch(() => [] as Report[]);
  return reports.find((item) => item.id === id && reportIsParsed(item)) ?? null;
}

export default function CompanyDetail({ initialReport, onBack, onSelect, onApprove, autoAskQuestion = null, preferredPeriod = null, preferredCite = null }: { initialReport: Report; onBack: () => void; onSelect: (id: string) => void; onApprove?: (reportId: string) => void; autoAskQuestion?: string | null; preferredPeriod?: string | null; preferredCite?: { page: number; quote: string } | null }) {
  const [reports, setReports] = useState<Report[]>([initialReport]);
  const [selected, setSelected] = useState(initialReport);
  const [outline, setOutline] = useState<Outline>(emptyOutline);
  const [analysis, setAnalysis] = useState<Analysis>({});
  const [loading, setLoading] = useState(() => !initialReport.id.startsWith('pending:') && Boolean(initialReport.parsed_at || initialReport.metrics.length));
  const [error, setError] = useState('');
  const [sourcePage, setSourcePage] = useState(1);
  const [pdfJumpNonce, setPdfJumpNonce] = useState(0);
  const [highlight, setHighlight] = useState('');
  const [reportListOpen, setReportListOpen] = useState(false);
  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false);
  // Source pane starts expanded (NotebookLM-like), not the thin rail.
  const [sourceCollapsed, setSourceCollapsed] = useState(false);
  const [resolvedPage, setResolvedPage] = useState<number | null>(null);
  const [citedMetric, setCitedMetric] = useState<MetricName | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');
  const [chatCollapsed, setChatCollapsed] = useState(false);
  // Session column ratios (~25 / 48 / 25); gutters are fixed px outside the %.
  const SOURCE_DEFAULT = 25;
  const SOURCE_WIDE = 40;
  const [colRatios, setColRatios] = useState({ source: SOURCE_DEFAULT, middle: 48, chat: 25 });
  const scrollPageSync = useRef(false);
  const columnsRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ side: 'source' | 'chat'; startX: number; source: number; middle: number; chat: number } | null>(null);
  const sourcePaneRef = useRef<HTMLElement>(null);
  const readingPosition = useRef<{ key: string; top: number; left: number } | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const drawerTriggerRef = useRef<HTMLElement | null>(null);
  const [sourceMode, setSourceMode] = useState<'pdf' | 'text'>('pdf');
  const [metric, setMetric] = useState<HeadlineMetric>('revenue');
  const [overlay, setOverlay] = useState<HeadlineMetric | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [focused, setFocused] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [clips, setClips] = useState<Clip[]>([]);
  const [pick, setPick] = useState<{ quote: string; page: number; x: number; y: number } | null>(null);
  const [clipToast, setClipToast] = useState<string | null>(null);
  const [copiedSlot, setCopiedSlot] = useState<number | null>(null);
  const [clipsFlash, setClipsFlash] = useState(false);
  const pageEnter = useRef<'start' | 'next' | 'prev'>('start');
  const [asking, setAsking] = useState(false);
  const [regenMenu, setRegenMenu] = useState<number | null>(null);
  const [jumpAsk, setJumpAsk] = useState<null | { href: string; title: string; detail: ReactNode }>(null);
  const [jumpBlocked, setJumpBlocked] = useState(false);
  // A reasoning model thinks before it speaks; say so instead of showing dead air.
  const [thinking, setThinking] = useState(false);
  const [mobilePane, setMobilePane] = useState('dashboard');
  // Comparing two periods is the core job, so a period switch must not discard
  // the conversation the reader already built up.
  const conversationIds = useRef(new Map<string, string>());
  const memoryReady = useRef(false);
  const [memoryLoading, setMemoryLoading] = useState(true);
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const activeId = useRef(selected.id);
  const busyRef = useRef(false);
  const sourceRef = useRef<HTMLDivElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const autoAskedRef = useRef(false);
  const deepCitedRef = useRef(false);
  const askRef = useRef<(text: string) => Promise<void>>(async () => undefined);
  const [periodBootstrapDone, setPeriodBootstrapDone] = useState(!preferredPeriod);
  const [overviewPick, setOverviewPick] = useState<null | { quote: string; x: number; y: number; kind: FocusKind; page?: number; title?: string; cardId?: string }>(null);
  const [verdict, setVerdict] = useState<ReportVerdict | null>(null);
  const [verdictStatus, setVerdictStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [verdictRefreshing, setVerdictRefreshing] = useState(false);
  const [verdictError, setVerdictError] = useState('');
  const [quietToast, setQuietToast] = useState<{ text: string; at: number } | null>(null);
  const autoParsePosted = useRef(new Set<string>());

  function selectReport(report: Report) {
    setReportListOpen(false);
    if (report.id === activeId.current) return;
    requestRef.current?.abort(); busyRef.current = false;
    // Same-company period switch keeps the QA thread; only `newConversation` / `+` clears it.
    memoryReady.current = false; setMemoryLoading(true);
    activeId.current = report.id;
    setSelected(report); onSelect(report.id); setPick(null); setOverviewPick(null); setAsking(false); setBaselineId(null);
    setOutline(emptyOutline); setAnalysis({}); setSourcePage(1); setPdfJumpNonce(0); setHighlight(''); setCitedMetric(null); setExpanded([]); setFocused(null);
    setVerdict(null); setVerdictStatus('loading'); setVerdictRefreshing(false); setVerdictError('');
  }
  useEffect(() => {
    const abort = new AbortController();
    void loadCompanyReports(initialReport.code).then((all) => {
      if (abort.signal.aborted) return;
      if (!all.length) {
        setPeriodBootstrapDone(true);
        return;
      }
      setReports(all);
      const hint = preferredPeriod ? parsePeriodHints(preferredPeriod) : parsePeriodHints('');
      if (preferredPeriod && !hint.token && /^20\d{2}(FY|H1|Q[1-3])$/i.test(preferredPeriod)) {
        hint.token = preferredPeriod.toUpperCase();
      }
      const matched = preferredPeriod
        ? all.find(r => reportMatchesPeriod(r, hint) || r.metrics.some(m => m.period === preferredPeriod) || r.title.includes(preferredPeriod))
        : null;
      const latest = matched ?? all[0];
      if (latest) selectReport(latest);
      if (!abort.signal.aborted) setPeriodBootstrapDone(true);
    }).catch(() => {
      if (!abort.signal.aborted) {
        setError('多期财报暂时无法加载，当前仍可阅读已选报告。');
        setPeriodBootstrapDone(true);
      }
    });
    return () => { abort.abort(); requestRef.current?.abort(); };
    // One company owns this workspace; changing a period must not reload or reset the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialReport.code]);
  const canLoadReportData = !selected.id.startsWith('pending:') && reportIsParsed(selected);
  const reportDataKey = `${selected.id}:${selected.parsed_at ?? ''}`;
  const [loadedDataKey, setLoadedDataKey] = useState(reportDataKey);
  if (loadedDataKey !== reportDataKey) {
    setLoadedDataKey(reportDataKey);
    setOutline(emptyOutline);
    setAnalysis({});
    setLoading(canLoadReportData);
    setVerdict(null);
    setVerdictError('');
    setVerdictStatus('loading');
  }
  useEffect(() => {
    if (!canLoadReportData) return;
    const abort = new AbortController();
    void Promise.all([
      fetch(`/api/reports/${encodeURIComponent(selected.id)}/outline`, { signal: abort.signal }).then(async r => { if (!r.ok) throw new Error(); return r.json() as Promise<Outline>; }),
      fetch(`/api/reports/${encodeURIComponent(selected.id)}/analysis`, { signal: abort.signal }).then(async r => { if (!r.ok) throw new Error(); return r.json() as Promise<Analysis>; }),
    ]).then(([o,a]) => { if (!abort.signal.aborted) { setOutline(o); setAnalysis(a);  setError(''); } }).catch(() => { if (!abort.signal.aborted) setError('部分报告数据加载失败，请切换报告重试。'); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [selected.id, selected.parsed_at, canLoadReportData]);
  useEffect(() => {
    if (!quietToast) return;
    const timer = window.setTimeout(() => setQuietToast(null), 2000);
    return () => window.clearTimeout(timer);
  }, [quietToast]);
  useEffect(() => {
    if (!periodBootstrapDone) return;
    if (!reportNeedsParse(selected)) return;
    const id = selected.id;
    const code = selected.code;
    const abort = new AbortController();
    const token = period(selected);
    const periods = isCanonicalPeriod(token) ? [token] : [];
    const downloading = reportNeedsDownload(selected);
    const inFlight = reportParseInFlight(selected);
    const first = !autoParsePosted.current.has(id);
    if (first) {
      autoParsePosted.current.add(id);
    }
    const toastTimer = first ? window.setTimeout(() => {
      if (!abort.signal.aborted) {
        setQuietToast({ text: downloading ? '正在抓取并解析本期财报' : '正在解析本期财报', at: Date.now() });
      }
    }, 0) : 0;
    void (async () => {
      try {
        if (first && !inFlight) {
          const body = downloading
            ? {
                mode: 'manual',
                codes: [code],
                fullHistory: false,
                ...(periods.length ? { periods } : {}),
                announcementIds: [id],
              }
            : {
                mode: 'parse',
                codes: [code],
                parseOnly: true,
                ...(periods.length ? { periods } : {}),
                announcementIds: [id],
              };
          await fetch('/api/crawl/trigger', {
            method: 'POST',
            cache: 'no-store',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
        }
        const updated = await waitForParsedReport(code, id, abort.signal);
        if (abort.signal.aborted) return;
        if (updated) {
          setReports((prev) => {
            const next = prev.map((item) => item.id === updated.id ? updated : item);
            return next.some((item) => item.id === updated.id) ? pickCanonicalReports(next) : pickCanonicalReports([...next, updated]);
          });
          setSelected((prev) => prev.id === updated.id ? updated : prev);
        } else if (first) {
          setQuietToast({ text: '本期解析未完成，可稍后刷新', at: Date.now() });
        }
      } catch {
        if (abort.signal.aborted) return;
        autoParsePosted.current.delete(id);
        setQuietToast({ text: '本期解析未完成，可稍后刷新', at: Date.now() });
      }
    })();
    return () => {
      if (toastTimer) window.clearTimeout(toastTimer);
      abort.abort();
    };
  }, [periodBootstrapDone, selected]);
  useEffect(() => {
    if (!canLoadReportData) return;
    const abort = new AbortController();
    const toastTimer = window.setTimeout(() => {
      if (!abort.signal.aborted) setQuietToast({ text: '正在生成本期智析', at: Date.now() });
    }, 400);
    void requestReportVerdict(selected.id, { signal: abort.signal })
      .then((parsedVerdict) => {
        if (abort.signal.aborted) return;
        window.clearTimeout(toastTimer);
        setVerdict(parsedVerdict);
        setVerdictStatus('ready');
        setVerdictError('');
      })
      .catch((error) => {
        window.clearTimeout(toastTimer);
        if (abort.signal.aborted) return;
        setVerdict(null);
        setVerdictStatus('unavailable');
        setVerdictError(error instanceof Error ? error.message : '');
      });
    return () => {
      window.clearTimeout(toastTimer);
      abort.abort();
    };
  }, [selected.id, selected.parsed_at, selected.metrics.length, canLoadReportData]);
  async function refreshVerdict() {
    if (verdictRefreshing || verdictStatus === 'loading') return;
    setVerdictRefreshing(true);
    setVerdictError('');
    try {
      const parsed = await requestReportVerdict(selected.id, { refresh: true });
      setVerdict(parsed);
      setVerdictStatus('ready');
      setVerdictError('');
    } catch (error) {
      setVerdict(null);
      setVerdictStatus('unavailable');
      setVerdictError(error instanceof Error ? error.message : '');
    } finally {
      setVerdictRefreshing(false);
    }
  }
  useEffect(() => {
    const abort = new AbortController();
    memoryReady.current = false;
    void (async () => {
      try {
        const response = await fetch(`/api/conversations?reportId=${encodeURIComponent(selected.id)}`, { signal: abort.signal, cache: 'no-store' });
        if (!response.ok) throw new Error();
        const data = await response.json() as { conversations: Array<{ id: string }> };
        const id = conversationIds.current.get(selected.id) ?? data.conversations[0]?.id;
        // Empty / anonymous: keep in-memory company thread; never wipe on soft miss.
        if (!id) return;
        const detail = await fetch(`/api/conversations/${id}`, { signal: abort.signal, cache: 'no-store' });
        if (!detail.ok) throw new Error();
        const payload = await detail.json() as { messages: Array<{ role: 'user' | 'assistant'; content: string; evidence: Citation[]; status: string }> };
        if (abort.signal.aborted) return;
        conversationIds.current.set(selected.id, id);
        setMessages(payload.messages.map(m => ({ role: m.role, text: m.content || (m.role === 'assistant' ? '这次回答尚未完成，可重新提问。' : ''), citations: m.evidence })));
      } catch { /* Fail / 401 / empty: keep existing messages so period switches do not look like 新建对话. */ }
      finally { if (!abort.signal.aborted) { memoryReady.current = true; setMemoryLoading(false); } }
    })();
    return () => abort.abort();
  }, [selected.id]);
  useEffect(() => {
    const abort = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFeedback({});
    void fetch(`/api/reports/${encodeURIComponent(selected.id)}/feedback`, { signal: abort.signal, cache: 'no-store' })
      // Feedback is an optional enhancement; reading must never depend on it.
      .then(async r => { if (!r.ok) return; const p = await r.json() as { mine?: Record<string,string> }; if (!abort.signal.aborted && p.mine) setFeedback(p.mine); })
      .catch(() => undefined);
    return () => abort.abort();
  }, [selected.id]);
  useEffect(() => { if (messages.length) chatEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    if (regenMenu == null) return;
    function onDoc(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest('.cd-regen')) return;
      setRegenMenu(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setRegenMenu(null);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [regenMenu]);
  useEffect(() => {
    if (!jumpAsk) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { setJumpAsk(null); setJumpBlocked(false); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [jumpAsk]);
  useLayoutEffect(() => {
    const el = questionRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(180, Math.max(40, el.scrollHeight))}px`;
  }, [question]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const hit = sourceRef.current?.querySelector('mark');
      if (sourceMode === 'text' && hit) hit.scrollIntoView({ block: 'center', behavior: 'smooth' });
      else if (sourceMode === 'pdf') return; // Continuous PdfEvidence scrolls the cite page into view.
      else sourceRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [sourcePage, highlight, sourceMode]);

  useEffect(() => {
    const root = sourceRef.current;
    if (!root) return;
    function onUp(ev: MouseEvent) {
      const t = ev.target;
      // Never clear / reposition the pick bar when clicking its own buttons.
      if (t instanceof Element && t.closest('.cd-pick-bar')) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) { setPick(null); return; }
      const anchor = sel.anchorNode;
      if (!anchor || !root!.contains(anchor)) { setPick(null); return; }
      // PDF text-layer picks are handled inside PdfEvidence — do not clear its pick bar.
      if (anchor instanceof Element ? anchor.closest('.cd-pdf-textlayer') : anchor.parentElement?.closest('.cd-pdf-textlayer')) {
        return;
      }
      const raw = sel.toString().replace(/\s+/g, ' ').trim();
      if (raw.length < 4) { setPick(null); return; }
      const range = sel.getRangeAt(0).getBoundingClientRect();
      setOverviewPick(null);
      setPick({
        quote: raw,
        page: resolvedPage ?? sourcePage,
        x: range.left + range.width / 2,
        y: Math.max(8, range.top - 40),
      });
    }
    root.addEventListener('mouseup', onUp);
    return () => root.removeEventListener('mouseup', onUp);
  }, [sourcePage, resolvedPage, sourceMode, selected.id]);

  useEffect(() => {
    const root = sourceRef.current;
    if (!root) return;
    function onScroll() { setPick(null); }
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, [selected.id, sourceMode]);

  // Continuous PDF scroll: wheel page-flip removed — .cd-source-scroll owns vertical scrolling.


  const readingKey = `${selected.id}|${sourcePage}|${sourceMode}|${highlight}`;
  function openSource() {
    if (!sourceDrawerOpen) drawerTriggerRef.current = document.activeElement as HTMLElement;
    setSourceCollapsed(false);
    setSourceDrawerOpen(true);
  }
  function closeSource(restoreFocus = true) {
    if (sourceRef.current) readingPosition.current = { key: readingKey, top: sourceRef.current.scrollTop, left: sourceRef.current.scrollLeft };
    setSourceDrawerOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => {
      if (drawerTriggerRef.current?.isConnected) drawerTriggerRef.current.focus({ preventScroll: true });
    });
  }
  useLayoutEffect(() => {
    if (!sourceDrawerOpen) return;
    const saved = readingPosition.current;
    if (saved?.key === readingKey && sourceRef.current) {
      sourceRef.current.scrollTop = saved.top;
      sourceRef.current.scrollLeft = saved.left;
    }
  }, [sourceDrawerOpen, readingKey]);
  useEffect(() => {
    if (!sourceDrawerOpen) return;
    drawerCloseRef.current?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeSource(); }
    };
    const outside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || sourcePaneRef.current?.contains(target)) return;
      // A new citation should navigate directly, without closing the reader.
      if (target.closest('.cd-cite, [data-source-jump]')) return;
      closeSource(false);
    };
    document.addEventListener('keydown', escape);
    document.addEventListener('mousedown', outside);
    return () => { document.removeEventListener('keydown', escape); document.removeEventListener('mousedown', outside); };
    // The listeners need the current reading key when saving the scroll position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceDrawerOpen, readingKey]);

  useEffect(() => {
    if (!reportListOpen) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (!t.closest('.cd-period-wrap, .cd-period-switch, .cd-report-popover, .cd-report-list')) setReportListOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [reportListOpen]);
  const pageLabels = outline.pageLabels ?? [];
  // Printed numbering is what users see in the document, so it is the only
  // vocabulary shown inline; the physical page stays in the tooltip.
  const printedKnown = pageLabels.some(p => p.printed !== null);
  function pageLabel(page: number) {
    const item = pageLabels.find(p=>p.page===page);
    if (item?.printed != null) return `P${item.printed}`;
    return printedKnown && item ? item.label : `PDF ${page}`;
  }
  function pageDescription(page: number) {
    const item = pageLabels.find(p=>p.page===page);
    return item?.printed != null ? `正文第 ${item.printed} 页（PDF 第 ${page} 页）` : `${item?.label ?? `PDF ${page}`}（PDF 第 ${page} 页）`;
  }

  const history = comparableHistory(reports, selected);
  const trendHistory = sequentialHistory(reports, selected);
  const defaultPrevious = priorYear(reports, selected);
  const baselineOptions = reports.filter(r => r.id !== selected.id && filingType(r) === filingType(selected) && periodKey(r) < periodKey(selected) && r.metrics.length);
  const previous = (baselineId ? reports.find(r => r.id === baselineId) : undefined) ?? defaultPrevious;
  const baselineIsDefault = !baselineId || previous?.id === defaultPrevious?.id;
  const peers = analysis.peers ?? [];
  // A comparison inherits the weakest of the two parses; surface that on the pill.
  function confidenceOf(report: Report | undefined, m: MetricName) { return report?.metrics.find(x => x.metric === m)?.confidence; }
  const deltas = metricNames.map(m => {
    const current = confidenceOf(selected, m), prior = confidenceOf(previous, m);
    const weakest = [current, prior].filter((n): n is number => n !== undefined);
    return { metric: m, amount: change(value(selected,m),value(previous,m)), confidence: weakest.length ? Math.min(...weakest) : undefined };
  });
  const changes = deltas.filter(d => d.amount !== undefined).sort((a,b) => Math.abs(b.amount!) - Math.abs(a.amount!));
  const revenue = value(selected, 'revenue'), profit = value(selected, 'net_profit');
  const pr = value(previous,'revenue'), pp = value(previous,'net_profit');
  const bridge = revenue !== undefined && profit !== undefined && pr !== undefined && pp !== undefined ? profitBridge(revenue, profit, pr, pp) : null;
  const peerCodes = [...new Set(peers.map(p => p.code))];
  const profitRanks = peers.filter(p => p.metric === 'roe');
  const roe = value(selected,'roe');
  // Report the ordinal position inside the covered sample; a percentile reads as a grade.
  function standing(rows: Peer[], self: number | undefined) {
    if (self === undefined || rows.length < 2 || !rows.some(r => r.code === selected.code)) return undefined;
    return { rank: rows.filter(r => r.value > self).length + 1, total: rows.length };
  }
  const profitStanding = standing(profitRanks, roe);
  const growthRanks = peers.filter(p => p.metric === 'revenue_growth');
  const selfGrowth = growthRanks.find(p => p.code === selected.code)?.value;
  const growthStanding = standing(growthRanks, selfGrowth);
  const findings = keyFindings(reports, selected);
  const verdictChanges = verdict?.changes ?? [];
  const verdictGenerating = verdictStatus === 'loading' || verdictRefreshing;
  const flaggedMoves = changes.filter(d => Math.abs(d.amount!) >= 30);
  function aiModule(id: string) {
    const ai = verdict?.modules.find(m => m.id === id);
    return ai?.conclusion ? { text: ai.conclusion, sourceRef: ai.sourceRef } : { text: '', sourceRef: [] as Citation[] };
  }
  function computedHeadline(id: string) {
    if (id === 'attribution' && bridge) {
      const cite = metricCitation('net_profit');
      return { text: attributionConclusion(bridge), sourceRef: cite ? [cite] : [] };
    }
    if (id === 'anomalies') {
      const text = anomaliesConclusion(flaggedMoves.map(d => ({ metric: d.metric, amount: d.amount! })), changes.length);
      if (text) {
        const cites = flaggedMoves.flatMap(d => { const c = metricCitation(d.metric); return c ? [c] : []; });
        return { text, sourceRef: cites };
      }
    }
    if (id === 'history') {
      const text = historyConclusion(history);
      if (text) return { text, sourceRef: [] as Citation[] };
    }
    if (id === 'peers') {
      const text = peersConclusion([
        ...(profitStanding ? [{ ...profitStanding, label: 'ROE' }] : []),
        ...(growthStanding ? [{ ...growthStanding, label: '营收同比' }] : []),
      ]);
      if (text) return { text, sourceRef: [] as Citation[] };
    }
    return { text: '', sourceRef: [] as Citation[] };
  }
  function moduleHeadline(id: string) {
    const ai = aiModule(id);
    const computed = computedHeadline(id);
    if (compactModuleIds.has(id)) return ai.text ? ai : computed;
    return computed.text ? computed : ai;
  }
  function moduleHasBody(id: string) {
    if (id === 'history') return history.length >= 2;
    if (id === 'peers') return peerCodes.length > 0;
    return false;
  }
  function pickedCard(id: string) {
    return overviewPick?.cardId === id ? ' cd-focus-picked' : '';
  }
  const leverage = debtRatio(selected), conversion = cashConversion(selected), margin = grossMargin(selected);
  const ratioChips = [
    { key: '资产负债率', label: '资产负债率', value: leverage, suffix: '%', metric: 'total_liabilities' as MetricName },
    { key: '毛利率', label: '毛利率', value: margin, suffix: '%', metric: 'operating_cost' as MetricName },
    { key: '现金含利润比', label: '现金含利润比', value: conversion, suffix: '%', metric: 'operating_cash_flow' as MetricName },
  ].filter((chip): chip is typeof chip & { value: number } => chip.value !== undefined);

  // A single click only jumps inside the left column; enlarging stays explicit.
  /** Widen source pane for PDF reading (~40%). Gutters already allow manual tweak. */
  function widenSourceForPdf(targetPct = SOURCE_WIDE) {
    setSourceCollapsed(false);
    setMobilePane('sources');
    // Exit legacy drawer mode if somehow open — width resize replaces 展开/收起.
    if (sourceDrawerOpen) setSourceDrawerOpen(false);
    setColRatios((prev) => {
      const source = Math.min(52, Math.max(targetPct, prev.source));
      if (chatCollapsed) {
        return { source, middle: Math.max(28, 100 - source), chat: prev.chat };
      }
      const chat = Math.min(prev.chat, Math.max(18, 100 - source - 32));
      const middle = Math.max(28, 100 - source - chat);
      return { source, middle, chat: 100 - source - middle };
    });
  }

  function restoreSourceDefault() {
    setSourceCollapsed(false);
    if (sourceDrawerOpen) setSourceDrawerOpen(false);
    setColRatios((prev) => {
      const source = SOURCE_DEFAULT;
      if (chatCollapsed) {
        return { source, middle: Math.max(28, 100 - source), chat: prev.chat };
      }
      const chat = Math.min(Math.max(prev.chat, 18), Math.max(18, 100 - source - 32));
      const middle = Math.max(28, 100 - source - chat);
      return { source, middle, chat: 100 - source - middle };
    });
  }
  function toggleSourceWidth() {
    if (colRatios.source > SOURCE_DEFAULT + 2) restoreSourceDefault();
    else widenSourceForPdf(SOURCE_WIDE);
  }

  function cite(c: Citation, expand = false, metric: MetricName | null = null) {
    readingPosition.current = null; scrollPageSync.current = false;
    setSourcePage(c.page); setPdfJumpNonce((n) => n + 1); setHighlight(c.quote); setResolvedPage(null); setCitedMetric(metric);
    widenSourceForPdf(SOURCE_WIDE);
    if (sourceMode === 'text' || !c.quote) {
      window.setTimeout(() => sourceRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 40);
    }
  }
  function metricCitation(m: MetricName, report = selected) { const item = report.metrics.find(x => x.metric === m); return item?.source_page ? { page: item.source_page, quote: item.source_label ?? labels[m] } : null; }
  function footnote(m: MetricName) { const c = metricCitation(m); return c && <button className="cd-cite" onClick={(e) => { e.stopPropagation(); cite(c, false, m); }} onDoubleClick={(e) => { e.stopPropagation(); cite(c, true, m); }} title={`单击定位原文（来源栏加宽至约40%），${pageDescription(c.page)}`}>[{pageLabel(c.page)}]</button>; }
  const citedItem = citedMetric ? selected.metrics.find(m => m.metric === citedMetric) : undefined;
  // Low confidence or an unverified value must be visible before the reader trusts it.
  const citedCaveat = citedItem && (citedItem.confidence < 0.8 || !citedItem.verified)
    ? `${citedItem.confidence < 0.8 ? `解析置信度 ${(citedItem.confidence * 100).toFixed(0)}%，可能取到了相邻列或附注值。` : ''}${citedItem.verified ? '' : '该数值尚未经人工复核。'}`
    : '';
  async function sendFeedback(metric: MetricName, verdict: 'correct' | 'wrong') {
    if (feedbackBusy) return;
    setFeedbackBusy(true); setFeedbackError('');
    // Optimistic: the reader's own verdict is local state either way.
    setFeedback(prev => ({ ...prev, [metric]: verdict }));
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(selected.id)}/feedback`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ metric, verdict, note: verdict === 'wrong' ? `读者在${pageDescription(sourcePage)}标记有误` : null }),
      });
      if (!response.ok) throw new Error();
    } catch { setFeedback(prev => { const next = { ...prev }; delete next[metric]; return next; }); setError('核验反馈没能提交，请稍后再试。'); }
    finally { setFeedbackBusy(false); }
  }
  function printedPage(c: Citation) {
    return pageLabels.find(p => p.page === c.page)?.printed ?? c.page;
  }
  function citeSource(c: Citation) {
    return {
      companyName: c.companyName || selected.company_name,
      period: c.period || period(selected),
      page: printedPage(c),
    };
  }
  function askOpenFiling(href: string, detail: ReactNode) {
    setJumpBlocked(false);
    setJumpAsk({ href, title: '在新标签页打开这份财报？', detail });
  }
  function filingTarget(c: Citation) {
    if (!c.reportId || c.reportId === selected.id) return null;
    const local = reports.find(r => r.id === c.reportId);
    const peer = analysis.peers?.find(p => p.company_name === c.companyName);
    const code = (c.code && /^\d{6}$/.test(c.code) ? c.code : '')
      || local?.code
      || peer?.code
      || ((!c.companyName || c.companyName === selected.company_name) ? selected.code : '');
    const token = local ? period(local) : c.period;
    const href = filingPageHref(code, token, { page: c.page, quote: c.quote });
    if (!href) return null;
    const name = local?.company_name ?? c.companyName ?? (code === selected.code ? selected.company_name : code);
    const who = code === selected.code ? '本公司' : name;
    const target = [who, token].filter(Boolean).join(' ');
    const detail = <>将打开{code === selected.code ? null : ' '}{jumpTargetLabel(target)} 财报。当前页面保持不变。</>;
    return { href, detail };
  }
  function jumpCitation(c: Citation, expand = false) {
    if (!c.reportId || c.reportId === selected.id) {
      cite(c, expand);
      return;
    }
    const target = filingTarget(c);
    if (target) {
      askOpenFiling(target.href, target.detail);
      return;
    }
    setJumpBlocked(false);
    setJumpAsk({
      href: '',
      title: '暂时无法打开这份财报',
      detail: <>还找不到 {jumpTargetLabel([c.companyName ?? '该公司', c.period].filter(Boolean).join(' '))} 的页面链接。当前页面保持不变。</>,
    });
  }
  function citationLink(c: Citation, key: string | number) {
    const otherId = c.reportId && c.reportId !== selected.id ? c.reportId : undefined;
    const hover = citeHoverText(citeSource(c));
    return (
      <button
        type="button"
        className={`cd-cite cd-answer-ref${otherId ? ' cd-cite-cross' : ''}`}
        key={key}
        aria-label={hover}
        onClick={() => jumpCitation(c)}
        onDoubleClick={() => jumpCitation(c, true)}
      >
        [{pageLabel(c.page)}]
        <span className="cd-cite-tip" role="tooltip">{hover}</span>
      </button>
    );
  }
  function confirmJumpAsk() {
    if (!jumpAsk?.href) {
      setJumpAsk(null);
      setJumpBlocked(false);
      return;
    }
    // Do not pass noopener/noreferrer as windowFeatures: browsers then return
    // null even when the tab opened, which falsely keeps this dialog open.
    const opened = window.open(jumpAsk.href, '_blank');
    if (!opened) {
      setJumpBlocked(true);
      return;
    }
    opened.opener = null;
    setJumpAsk(null);
    setJumpBlocked(false);
  }
  function renderCiteChunk(message: Message) {
    let prevCiteId: string | null = null;
    return (chunk: string) => tokenizeAnswerCites(chunk).map((token, i) => {
      if (token.kind === 'text') {
        if (!token.text.trim()) return token.text ? <Fragment key={i}>{token.text}</Fragment> : null;
        prevCiteId = null;
        return <Fragment key={i}>{token.text}</Fragment>;
      }
      const c = matchAnswerCitation(token, message.citations, pageLabel);
      if (!c) { prevCiteId = null; return <span className="cd-note" key={i}>{token.raw}（待核验）</span>; }
      const citeKey = `${c.reportId ?? ''}:${c.page}`;
      if (citeKey === prevCiteId) return null;
      prevCiteId = citeKey;
      return citationLink(c, i);
    });
  }
  function answerSources(message: Message) {
    return uniqueAnswerSources(message.text, message.citations, pageLabel);
  }
  function focusModule(id: string) { if (sourceDrawerOpen) closeSource(); setExpanded(e => e.includes(id) ? e : [...e,id]); setFocused(id); setMobilePane('dashboard'); window.setTimeout(() => document.getElementById(`cd-${id}`)?.scrollIntoView({ behavior:'smooth', block:'center' }), 80); }
  function resizeComposer() {
    const el = questionRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const min = 40;
    const max = 180;
    el.style.height = `${Math.min(max, Math.max(min, el.scrollHeight))}px`;
  }
  function draftAsk(text: string) {
    setQuestion(text);
    setChatCollapsed(false);
    setMobilePane('chat');
    window.requestAnimationFrame(() => {
      questionRef.current?.focus();
      resizeComposer();
    });
  }
  function trendFocusQuote() {
    const rows = trendHistory.slice(-8);
    const n = rows.length;
    const primary = rows.map(r => `${period(r)} ${format(value(r, metric), metric)}`).join('、');
    let quote = `指标趋势：${labels[metric]}近${n}期 ${primary}`;
    if (overlay && overlay !== metric) {
      const over = rows.map(r => `${period(r)} ${format(value(r, overlay), overlay)}`).join('、');
      quote += `；叠加${labels[overlay]} ${over}（指数化相对走势）`;
    }
    return quote;
  }
  function pinTrendFocus() {
    addFocus({ kind: 'metric', quote: trendFocusQuote(), title: '智析·趋势' });
  }
  function placeCardPick(e: { clientX: number; clientY: number }, item: { quote: string; kind: FocusKind; page?: number; title?: string; cardId?: string }) {
    const clean = item.quote.replace(/\s+/g, ' ').trim();
    if (clean.length < 4) return;
    window.getSelection()?.removeAllRanges();
    setPick(null);
    setOverviewPick({
      quote: clean,
      kind: item.kind,
      page: item.page,
      title: item.title,
      cardId: item.cardId,
      x: e.clientX,
      y: Math.max(8, e.clientY - 12),
    });
  }
  function onOverviewDblClick(e: ReactMouseEvent<HTMLElement>) {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest('a,select,input,textarea,button,.cd-pick-bar,.cd-cite')) return;
    const card = t.closest('[data-focus-card]');
    if (!(card instanceof HTMLElement)) return;
    e.preventDefault();
    const quote = (card.getAttribute('data-focus-quote') || card.innerText || '').replace(/\s+/g, ' ').trim();
    const kind = (card.getAttribute('data-focus-kind') || 'metric') as FocusKind;
    const title = card.getAttribute('data-focus-title') || undefined;
    const pageRaw = card.getAttribute('data-focus-page');
    const page = pageRaw ? Number(pageRaw) : undefined;
    const cardId = card.getAttribute('data-focus-id') || undefined;
    placeCardPick(e, { quote, kind, title, page: Number.isFinite(page) ? page : undefined, cardId });
  }
  // Suggest the next question instead of making the reader compose one; the list is
  // advisory, so any failure simply leaves the answer without buttons.
  function defaultFollowups(answer: string, asked: string[]) {
    const pool = [
      '本期营业收入同比怎么变化？',
      '归母净利润变化的主要原因是什么？',
      '和上年同期比，哪些指标最值得关注？',
      '同行公司在同一报告期表现如何？',
      '请给出支持上述结论的原文页码。',
    ];
    const lowerAsked = asked.map(q => q.replace(/\s+/g, ''));
    const picked = pool.filter(q => !lowerAsked.some(a => a.includes(q.replace(/\s+/g, '')) || q.replace(/\s+/g, '').includes(a))).slice(0, 3);
    if (picked.length) return picked;
    return pool.slice(0, 3);
  }
  async function loadFollowups(reportId: string, slot: number, question: string, answer: string, asked: string[]) {
    const patch = (value: Partial<Message>) => setMessages(m => activeId.current === reportId && m[slot]?.role === 'assistant' ? m.map((item,i) => i === slot ? { ...item, ...value } : item) : m);
    const fallback = defaultFollowups(answer, asked);
    patch({ followups: fallback, followupBusy: true });
    try {
      const response = await fetch('/api/chat/followups', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ reportId, question, answer, asked }) });
      if (!response.ok) throw new Error();
      const payload = await response.json() as { questions?: string[] };
      patch({ followups: payload.questions?.slice(0,3) ?? fallback, followupBusy: false });
    } catch { patch({ followups: fallback, followupBusy: false }); }
  }

  useEffect(() => {
    const root = overviewRef.current;
    if (!root) return;
    function onUp(e: globalThis.MouseEvent) {
      const t = e.target;
      if (e.detail >= 2) return;
      if (t instanceof Element && t.closest('button,a,select,input,textarea,.cd-pick-bar,.cd-cite')) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) { setOverviewPick(null); return; }
      const anchor = sel.anchorNode;
      if (!anchor || !root!.contains(anchor)) { setOverviewPick(null); return; }
      const raw = sel.toString().replace(/\s+/g, ' ').trim();
      if (raw.length < 4) { setOverviewPick(null); return; }
      const host = (anchor instanceof Element ? anchor : anchor.parentElement)?.closest('[data-metric]');
      const metricName = (host?.getAttribute('data-metric') || null) as MetricName | null;
      const finding = metricName ? findings.find(f => f.metric === metricName) : undefined;
      const cite = metricName ? metricCitation(metricName) : null;
      const range = sel.getRangeAt(0).getBoundingClientRect();
      setPick(null);
      setOverviewPick({
        quote: raw,
        kind: finding ? 'finding' : 'metric',
        page: cite?.page,
        title: finding?.headline ?? (metricName ? labels[metricName] : undefined),
        x: range.left + Math.min(range.width, 240) / 2,
        y: Math.max(8, range.top - 44),
      });
    }
    root.addEventListener('mouseup', onUp);
    return () => root.removeEventListener('mouseup', onUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mouseup reads latest findings/citations
  }, [selected.id]);

  useEffect(() => {
    function onScroll() { setOverviewPick(null); }
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [selected.id]);

  function flashClips(message: string) {
    setClipToast(message);
    setClipsFlash(true);
    window.setTimeout(() => setClipsFlash(false), 900);
    window.setTimeout(() => setClipToast(current => current === message ? null : current), 2200);
  }
  function makeClipId() {
    return clientUuid();
  }
  function addFocus(item: { kind: FocusKind; quote: string; page?: number; title?: string }) {
    const clean = item.quote.replace(/\s+/g, ' ').trim();
    if (clean.length < 4) return;
    const quote = clean.slice(0, FOCUS_QUOTE_MAX);
    let added = true;
    let capped = false;
    try {
      setClips(prev => {
        const dup = prev.some(c => c.kind === item.kind && c.quote === quote && c.page === item.page && c.title === item.title);
        if (dup) { added = false; return prev; }
        if (prev.length >= FOCUS_MAX_ITEMS) capped = true;
        return [...prev, { id: makeClipId(), kind: item.kind, quote, page: item.page, title: item.title }].slice(-FOCUS_MAX_ITEMS);
      });
    } catch (err) {
      console.error('addFocus failed', err);
      flashClips('加入AI分析失败，请重试');
      return;
    }
    setPick(null);
    setOverviewPick(null);
    setChatCollapsed(false);
    // Do not force-switch mobilePane here: unmounting the PDF pane mid-interaction
    // (display:none) has crashed the tab when pdf.js still held the canvas.
    window.getSelection()?.removeAllRanges();
    if (!added) flashClips('这项已在AI分析列表里');
    else if (capped) flashClips(`已加入AI分析；最多 ${FOCUS_MAX_ITEMS} 项，已去掉最早的一项`);
    else flashClips('已加入AI分析');
  }
  function addClip(quote: string, page = resolvedPage ?? sourcePage) {
    addFocus({ kind: sourceMode === 'text' ? 'text' : 'pdf', quote, page });
  }
  function removeClip(id: string) { setClips(prev => prev.filter(c => c.id !== id)); }
  function clipChipLabel(c: Clip) {
    if (c.kind === 'pdf' || c.kind === 'text') {
      const prefix = c.page ? pageLabel(c.page) : '原文';
      const q = c.quote.trim();
      if (q.startsWith(prefix + ' ') || q === prefix) return q;
      return `${prefix} ${q}`;
    }
    const q = c.quote.trim();
    return q.startsWith('概览 ') ? q : `概览 ${q}`;
  }
  function placePick(quote: string, page: number) {
    // .cd-pick-bar is position:fixed — use viewport coords, not scroll-container offsets.
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) { addClip(quote, page); return; }
    const range = sel.getRangeAt(0).getBoundingClientRect();
    if (range.width === 0 && range.height === 0) { addClip(quote, page); return; }
    setOverviewPick(null);
    setPick({
      quote,
      page,
      x: range.left + range.width / 2,
      y: Math.max(8, range.top - 8),
    });
  }
  function onSourceTextPick(text: string, page: number) { placePick(text, page); }

  function stopAsk() {
    requestRef.current?.abort();
  }

  function setAnswerVote(index: number, value: 'up' | 'down') {
    setMessages(m => m.map((item, i) => {
      if (i !== index || item.role !== 'assistant') return item;
      if (item.feedback === value) return { ...item, feedback: undefined, feedbackDone: false };
      return { ...item, feedback: value, feedbackDone: false };
    }));
  }

  function submitAnswerFeedback(index: number) {
    setMessages(m => m.map((item, i) => i === index && item.role === 'assistant' ? { ...item, feedbackDone: true } : item));
  }

  async function copyAnswer(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopiedSlot(index);
    window.setTimeout(() => setCopiedSlot(slot => slot === index ? null : slot), 1600);
  }

  function regenerate(index: number, rewrite: 'detailed' | 'brief' | 'retry') {
    const user = messages[index - 1];
    setRegenMenu(null);
    if (!user || user.role !== 'user' || busyRef.current) return;
    void ask(user.ask?.question ?? user.text, { replaceAt: index, focus: user.ask?.focus, rewrite });
  }

  async function ask(text: string, extra?: { replaceAt?: number; focus?: FocusItem[]; rewrite?: 'detailed' | 'brief' | 'retry' }) {
    const replacing = extra?.replaceAt;
    const typed = text.trim();
    if (replacing != null) {
      if (busyRef.current || !memoryReady.current) return;
    } else if ((!typed && !clips.length) || busyRef.current || !memoryReady.current) return;
    const focusPayload: FocusItem[] = extra?.focus ?? (replacing != null ? [] : clips.map(c => ({
      kind: c.kind,
      text: c.quote,
      ...(c.page !== undefined ? { page: c.page } : {}),
      ...(c.title ? { title: c.title } : {}),
    })));
    const question = typed || (focusPayload.length ? '怎么看待这些数据' : '');
    const assembled = assembleFocusPrompt(question, focusPayload);
    const display = displayFocusPrompt(question, focusPayload);
    setRegenMenu(null);
    const controller = new AbortController(); requestRef.current = controller; busyRef.current = true;
    const id = selected.id;
    const prior = replacing != null ? messages.slice(0, replacing - 1) : messages;
    const asked = prior.filter(m => m.role === 'user').map(m => m.text);
    const slot = replacing != null ? replacing : messages.length + 1;
    setAsking(true); setThinking(false);
    if (replacing == null) {
      setQuestion(''); setClips([]); setPick(null);
      setMessages(m => [...m, { role:'user', text:display, ask:{ question, ...(focusPayload.length ? { focus: focusPayload } : {}) } }, { role:'assistant', text:'' }]);
    } else {
      setMessages(m => [...m.slice(0, replacing), { role:'assistant', text:'' }]);
    }
    const targetModule = moduleForQuestion(assembled); if (targetModule) focusModule(targetModule);
    let answer = '';
    function update(citations?: Citation[]) { if (activeId.current !== id || controller.signal.aborted) return; setMessages(m => m.map((item,i) => i === m.length-1 ? { ...item, text:answer, ...(citations ? { citations } : {}) } : item)); }
    try {
      let conversationId = conversationIds.current.get(id);
      if (!conversationId) {
        try {
          const created = await fetch('/api/conversations', { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reportId: id }) });
          const payload = await created.json() as { conversation?: { id: string }; error?: string };
          if (created.ok && payload.conversation) {
            conversationId = payload.conversation.id; conversationIds.current.set(id, conversationId);
          }
        } catch { /* ignore — anonymous users can ask without persisted memory */ }
      }
      const response = await fetch('/api/chat', { method:'POST', signal:controller.signal, headers:{ 'content-type':'application/json' },body:JSON.stringify({ reportId:id, ...(conversationId ? { conversationId } : {}), requestId:clientUuid(), question, ...(focusPayload.length ? { focus: focusPayload } : {}), ...(extra?.rewrite ? { rewrite: extra.rewrite } : {}), stream:true }) });
      if (!response.ok || !response.body) { const failure = await response.json().catch(()=>({})); throw new Error(failure.error ?? '问答服务暂时不可用'); }
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      while (true) {
        const {done,value:chunk} = await reader.read(); buffer += decoder.decode(chunk ?? new Uint8Array(), {stream:!done});
        const events = buffer.split('\n\n'); buffer = events.pop() ?? '';
        for (const event of events) { const raw = event.split('\n').find(l=>l.startsWith('data: '))?.slice(6); if (!raw || raw==='[DONE]') continue; const p = JSON.parse(raw) as {content?:string;evidence?:Citation[];status?:string;error?:string;mode?:string;result?:{answer:string;evidence:Citation[];mode?:string}}; if(p.status==='reasoning') setThinking(true); if(p.content||p.result) setThinking(false); answer = p.result ? p.result.answer : answer + (p.content ?? ''); if(p.error) answer=p.error; update(p.result?.evidence ?? p.evidence); }
        if(done) break;
      }
      if (!answer && !controller.signal.aborted) { answer='暂无法回答：未返回足够证据。可尝试询问本期营业收入或净利润。'; update(); }
    } catch (error) {
      if (controller.signal.aborted) {
        if (activeId.current === id) {
          setMessages(m => m.map((item,i) => i === m.length-1 && item.role === 'assistant'
            ? { ...item, text: answer || '已停止生成' }
            : item));
        }
      } else {
        answer = error instanceof Error ? error.message : '问答服务暂时不可用，请稍后重试。';
        update();
      }
    }
    finally {
      if (activeId.current === id) { busyRef.current = false; setAsking(false); setThinking(false); }
    }
    if (activeId.current === id && !controller.signal.aborted && answer) void loadFollowups(id, slot, assembled, answer, asked);
  }
  useEffect(() => {
    askRef.current = ask;
  });

  // Home deep-link: fill + send once preferred period is resolved and chat memory is ready.
  useEffect(() => {
    if (!autoAskQuestion || autoAskedRef.current) return;
    if (!periodBootstrapDone || memoryLoading || loading || asking) return;
    if (!memoryReady.current || busyRef.current) return;
    if (preferredPeriod) {
      const hint = parsePeriodHints(preferredPeriod);
      if (!hint.token && /^20\d{2}(FY|H1|Q[1-3])$/i.test(preferredPeriod)) hint.token = preferredPeriod.toUpperCase();
      const ok = reportMatchesPeriod(selected, hint)
        || selected.metrics.some(m => m.period === preferredPeriod)
        || selected.title.includes(preferredPeriod);
      // If no report matched the hint, still ask against the best available period.
      if (!ok && selected.metrics.length === 0 && !selected.parsed_at) return;
    }
    const questionText = autoAskQuestion;
    const timer = window.setTimeout(() => {
      if (autoAskedRef.current) return;
      autoAskedRef.current = true;
      setChatCollapsed(false);
      setMobilePane('chat');
      setQuestion(questionText);
      void askRef.current(questionText);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autoAskQuestion, preferredPeriod, periodBootstrapDone, memoryLoading, loading, asking, selected]);

  useEffect(() => {
    if (!preferredCite || deepCitedRef.current) return;
    if (!periodBootstrapDone) return;
    if (preferredPeriod) {
      const hint = parsePeriodHints(preferredPeriod);
      if (!hint.token && /^20\d{2}(FY|H1|Q[1-3])$/i.test(preferredPeriod)) hint.token = preferredPeriod.toUpperCase();
      const ok = reportMatchesPeriod(selected, hint)
        || selected.metrics.some(m => m.period === preferredPeriod)
        || selected.title.includes(preferredPeriod);
      if (!ok) return;
    }
    const target = preferredCite;
    const timer = window.setTimeout(() => {
      if (deepCitedRef.current) return;
      deepCitedRef.current = true;
      setSourceMode('pdf');
      cite({ page: target.page, quote: target.quote });
    }, 0);
    return () => window.clearTimeout(timer);
    // Deep-link cite is one-shot after the target period is selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredCite, preferredPeriod, periodBootstrapDone, selected]);

  async function newConversation() {
    if (busyRef.current || !memoryReady.current) return;
    const id = selected.id;
    busyRef.current = true; setAsking(true);
    try {
      const response = await fetch('/api/conversations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reportId: id }) });
      const payload = await response.json() as { conversation?: { id: string }; error?: string };
      if (response.ok && payload.conversation) {
        conversationIds.current.set(id, payload.conversation.id);
        if (activeId.current === id) { setMessages([]); setQuestion(''); setClips([]); setPick(null); setOverviewPick(null); }
      } else if (activeId.current === id) {
        conversationIds.current.delete(id);
        setMessages([]); setQuestion(''); setClips([]); setPick(null); setOverviewPick(null);
      }
    } catch { if (activeId.current === id) { conversationIds.current.delete(id); setMessages([]); setQuestion(''); setClips([]); setPick(null); setOverviewPick(null); } }
    finally { if (activeId.current === id) { busyRef.current = false; setAsking(false); } }
  }

  function onGutterDown(side: 'source' | 'chat', e: import('react').PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!columnsRef.current) return;
    dragRef.current = { side, startX: e.clientX, source: colRatios.source, middle: colRatios.middle, chat: colRatios.chat };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onGutterMove(e: import('react').PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const el = columnsRef.current;
    if (!drag || !el) return;
    const gutter = 7, rail = 46, pad = 24;
    const nGutters = (!sourceCollapsed && !chatCollapsed) ? 2 : ((!sourceCollapsed || !chatCollapsed) ? 1 : 0);
    const rails = (sourceCollapsed ? rail : 0) + (chatCollapsed ? rail : 0);
    const usable = Math.max(el.clientWidth - pad - nGutters * gutter - rails, 1);
    const dxPct = (e.clientX - drag.startX) / usable * 100;
    const minS = Math.min(40, 200 / usable * 100), minC = Math.min(40, 220 / usable * 100), minM = Math.min(50, 360 / usable * 100);
    if (drag.side === 'source') {
      let source = drag.source + dxPct;
      let middle = drag.middle - dxPct;
      if (source < minS) { middle -= (minS - source); source = minS; }
      if (middle < minM) { source -= (minM - middle); middle = minM; }
      if (!chatCollapsed && source + middle + drag.chat > 100.01) {
        middle = 100 - source - drag.chat;
      }
      setColRatios({ source, middle, chat: drag.chat });
    } else {
      let chat = drag.chat - dxPct;
      let middle = drag.middle + dxPct;
      if (chat < minC) { middle -= (minC - chat); chat = minC; }
      if (middle < minM) { chat -= (minM - middle); middle = minM; }
      setColRatios({ source: drag.source, middle, chat });
    }
  }
  function onGutterUp() { dragRef.current = null; }

  const sourceText = outline.pages.find(p => p.page === sourcePage)?.content;
  const highlightRange = sourceText ? sourceRange(sourceText, highlight) : null;
  return <section className={`company-workspace ${sourceDrawerOpen?'cd-reading-open':''} ${chatCollapsed?'cd-chat-collapsed':''} ${sourceCollapsed&&!sourceDrawerOpen?'cd-source-collapsed':''}`} >
    <header className="cd-company-head"><div className="cd-company-identity"><button className="cd-back" onClick={onBack} aria-label="返回公司列表"><Icon name="arrowLeft" size={16} /></button><div className="cd-monogram">{selected.company_name.slice(0,1)}</div><div className="cd-company-meta"><h1>{selected.company_name}<span>{selected.code}</span></h1><p>{selected.industry}</p><div className="cd-period-wrap"><button type="button" className="cd-period-switch" aria-expanded={reportListOpen} aria-controls="cd-report-periods" onClick={()=>setReportListOpen(open=>!open)}>{period(selected)} {reportTypeLabel(selected)} <span className="cd-picker-chevron" aria-hidden="true"><Icon name={reportListOpen?'chevronUp':'chevronDown'} size={14} /></span></button>{reportListOpen && <div className="cd-report-list cd-report-popover" id="cd-report-periods" aria-label="选择报告期">{reports.map((r,i) => <button key={r.id} aria-pressed={r.id===selected.id} className={r.id===selected.id?'selected':''} onClick={()=>selectReport(r)}><span><b>{period(r)} {reportTypeLabel(r)}</b><small>{r.metrics.length} 项指标 · {r.parsed_at?'已解析':'解析中'}</small></span>{i===0 && <em>最新</em>}</button>)}</div>}</div></div></div>{onApprove && selected.status !== 'online' && <div className="cd-head-actions"><button className="cd-button" onClick={() => onApprove(selected.id)}>复核上线</button></div>}</header>
    {error && <div role="alert" className="cd-error">{error}</div>}
    <nav className="cd-mobile-tabs" aria-label="详情页分栏">{[['sources','来源'],['dashboard','数据概览'],['chat','对话']].map(([id,label]) => <button key={id} className={mobilePane===id?'active':''} onClick={()=>{setMobilePane(id);if(id==='chat')setChatCollapsed(false);if(id==='sources')setSourceCollapsed(false);}}>{label}</button>)}</nav>
    <div className="cd-columns" ref={columnsRef}>
      <div id="cd-source-panel" className={`cd-source-slot ${mobilePane==='sources'?'mobile-active':''}`} style={!sourceCollapsed ? { flex: `${colRatios.source} 1 0%`, minWidth: 200 } : undefined}>
      <aside className={`cd-sources cd-pane ${sourceDrawerOpen?'cd-source-drawer':''}`} role={sourceDrawerOpen?'dialog':undefined} aria-modal={sourceDrawerOpen?false:undefined} aria-label={sourceDrawerOpen?'财报原文阅读抽屉':'财报来源'} ref={sourcePaneRef}>
        <div className="cd-pane-head cd-source-head"><h2><span>◇</span> 来源</h2><div className="cd-pane-tools"><button type="button" className="cd-dock cd-source-width" aria-label={colRatios.source > SOURCE_DEFAULT + 2 ? '恢复默认宽度' : '加宽来源栏'} title={colRatios.source > SOURCE_DEFAULT + 2 ? '快速回到默认宽度（约25%）' : '加宽到来源阅读宽度（约40%）'} onClick={toggleSourceWidth}><Icon name={colRatios.source > SOURCE_DEFAULT + 2 ? 'chevronsLeft' : 'chevronsRight'} size={16} /></button><button className="cd-dock" aria-label="收起来源栏" title="收起来源栏（可用中间分隔条再调宽）" aria-controls="cd-source-panel" onClick={()=>{setSourceCollapsed(true);setMobilePane('dashboard');}}><DockIcon side="left" /></button></div></div>
        <details className="cd-outline"><summary><svg className="cd-outline-chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg><b>提纲导航</b><span>{outline.outline.length} 个章节</span></summary><nav>{outline.outline.map(o=><button key={o.id} onClick={()=>cite({page:o.page,quote:o.highlight})}><b>{o.title}</b><span className="cd-outline-page">{pageLabel(o.page)}</span></button>)}</nav></details>
        <div className="cd-source-toolbar">
          <label><select aria-label="原文模式" value={sourceMode} onChange={e=>{const m=e.target.value as 'pdf'|'text';setSourceMode(m);if(m==='pdf')pageEnter.current='start';}}><option value="pdf">原始PDF</option><option value="text">原文文本</option></select></label>
          <label><select aria-label="跳转原文页码" value={sourcePage} onChange={e=>{readingPosition.current=null;pageEnter.current='start';scrollPageSync.current=false;setSourcePage(Number(e.target.value));setPdfJumpNonce((n)=>n+1);setHighlight('');}}>{[...new Set([1,sourcePage,...(pageLabels.length?pageLabels:outline.pages).map(p=>p.page)])].sort((a,b)=>a-b).map(p=><option key={p} value={p}>{pageLabel(p)}</option>)}</select></label>
          <span className="cd-pdf-pick-hint" tabIndex={0}>
            划词智析
            <span className="cd-pdf-pick-tip" role="tooltip">
              在 PDF 中划选一段文字，点「加入AI分析」，即可针对原文做智能解读。
            </span>
          </span>
        </div>
        {!printedKnown && pageLabels.length>0 && <p className="cd-page-notice">这份 PDF 没能识别出正文页码，下面统一按 PDF 实际页数显示。</p>}
        <div className="cd-source-scroll" ref={sourceRef} aria-live="polite">
          {pick && <div className="cd-pick-bar" style={{ top: pick.y, left: pick.x }}>
            <div className="cd-pick-actions">
              <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => addClip(pick.quote, pick.page)}>加入AI分析</button>
              <button type="button" className="cd-pick-cancel" onMouseDown={e => e.preventDefault()} onClick={() => { setPick(null); window.getSelection()?.removeAllRanges(); }}>取消</button>
            </div>
          </div>}
          {highlight && <div className="cd-source-hit">已定位 · {pageDescription(sourcePage)}{resolvedPage!==null&&resolvedPage!==sourcePage?` · 已按引用原文校正至 PDF 第 ${resolvedPage} 页`:''}<small>{highlight.slice(0,100)}</small></div>}
          {citedMetric && <div className="cd-verify">
            <div><b>正在核验：{labels[citedMetric]}</b><small>{format(value(selected,citedMetric),citedMetric)}{citedCaveat?` · ${citedCaveat}`:' · 已通过人工复核'}</small></div>
            <div className="cd-verify-actions">
              <button className={feedback[citedMetric]==='correct'?'cd-verify-on':''} disabled={feedbackBusy} onClick={()=>void sendFeedback(citedMetric,'correct')}><Icon name="check" size={14} /> 与原文一致</button>
              <button className={feedback[citedMetric]==='wrong'?'cd-verify-off':''} disabled={feedbackBusy} onClick={()=>void sendFeedback(citedMetric,'wrong')}><Icon name="warn" size={14} /> 标记有误</button>
            </div>
            {feedbackError && <small className="cd-verify-hint cd-verify-error">{feedbackError}</small>}
            {feedback[citedMetric] && <small className="cd-verify-hint">{feedback[citedMetric]==='correct'?'已记录你的确认，累计确认会进入复核队列。':'已记录异议，该指标会被优先人工复核。'}</small>}
          </div>}
          {sourceMode==='pdf' ? <PdfEvidence key={selected.id} reportId={selected.id} page={sourcePage} quote={highlight} jumpNonce={pdfJumpNonce} onResolvePage={setResolvedPage} onTextPick={onSourceTextPick} onVisiblePage={(p)=>{ if (p === sourcePage) return; scrollPageSync.current = true; setSourcePage(p); setResolvedPage(null); /* toolbar only — jumpNonce unchanged so viewport stays put */ }} /> : <article className="cd-source-text"><div>{pageDescription(sourcePage)} · 划词智析</div>{sourceText ? <p>{highlightRange ? <>{sourceText.slice(0,highlightRange[0])}<mark>{sourceText.slice(...highlightRange)}</mark>{sourceText.slice(highlightRange[1])}</> : sourceText}</p> : <p>{loading?'正在读取原文…':'这一页没有可检索的文字（可能是扫描图片或表格）。'}</p>}</article>}
        </div><div className="cd-source-footer"><a href={`/api/reports/${encodeURIComponent(selected.id)}/pdf`} target="_blank" rel="noreferrer">打开原始 PDF <Icon name="external" size={12} /></a><button onClick={()=>{draftAsk(`请解释${pageDescription(sourcePage)}的核心信息。`);}} disabled={asking}>追问本页</button></div>
      </aside>
      </div>
      {!sourceCollapsed && <div className="cd-gutter" role="separator" aria-orientation="vertical" aria-label="调整来源栏宽度" onPointerDown={e=>onGutterDown('source', e)} onPointerMove={onGutterMove} onPointerUp={onGutterUp} onPointerCancel={onGutterUp} />}
      <main className={`cd-dashboard cd-pane ${mobilePane==='dashboard'?'mobile-active':''}`} aria-label="概览" style={{ flex: `${colRatios.middle} 1 0%`, minWidth: 360 }}>
        <div className="cd-pane-head"><h2><span>◫</span> 概览</h2><span>基于公开财报生成</span></div>
        <div className="cd-dashboard-scroll" ref={overviewRef} onDoubleClick={onOverviewDblClick}>
          <div className="cd-overview-top">
          {overviewPick && <div className="cd-pick-bar" style={{ top: overviewPick.y, left: overviewPick.x }}>
            {overviewPick.title && <span className="cd-pick-title">{overviewPick.title}</span>}
            <div className="cd-pick-actions">
              <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => addFocus({ kind: overviewPick.kind, quote: overviewPick.quote, page: overviewPick.page, title: overviewPick.title })}>加入AI分析</button>
              <button type="button" className="cd-pick-cancel" onMouseDown={e => e.preventDefault()} onClick={() => { setOverviewPick(null); window.getSelection()?.removeAllRanges(); }}>取消</button>
            </div>
          </div>}
          <section
            className={`cd-brief cd-verdict cd-focus-card${verdictStatus === 'ready' && verdict ? ` cd-verdict-${verdictTone(verdict.verdict.label)}` : ''}${pickedCard('verdict')}`}
            aria-label="财报速览"
            data-focus-card
            data-focus-id="verdict"
            data-focus-kind="finding"
            data-focus-title="财报速览"
            data-focus-quote={verdict ? `${verdict.verdict.label}。${verdict.verdict.summary}` : '财报速览暂未生成'}
          >
            <div className="cd-verdict-head">
              <p className="cd-brief-kicker">财报速览</p>
              <div className="cd-verdict-tools">
                <button
                  type="button"
                  className="cd-verdict-refresh"
                  aria-label="重新分析"
                  title="重新分析"
                  disabled={verdictStatus === 'loading' || verdictRefreshing}
                  onClick={() => void refreshVerdict()}
                >
                  <Icon name="refresh" size={14} className={verdictRefreshing ? 'cd-spin' : undefined} />
                </button>
              </div>
            </div>
            {verdictGenerating && <p className="cd-verdict-fallback">{reportIsParsed(selected) ? '正在生成本期概览…' : '正在解析本期财报…'}</p>}
            {!verdictGenerating && verdictStatus === 'unavailable' && (
              <p className="cd-verdict-fallback">
                {verdictError.trim() || 'AI 概览暂时无法生成，请稍后再试。'}
                <small className="cd-verdict-fallback-hint">可直接查看下方财务指标或使用右侧问答。</small>
              </p>
            )}
            {!verdictGenerating && verdictStatus === 'ready' && verdict && <>
              <h2 className="cd-brief-title"><i className="cd-verdict-dot" aria-hidden="true" />{verdict.verdict.label}</h2>
              <p className="cd-verdict-summary">{verdict.verdict.summary}</p>
            </>}
          </section>

          <div className="cd-metrics" aria-label="四项核心指标">{metricNames.map(m => {
            const d = deltas.find(x => x.metric === m)?.amount;
            const pill = d === undefined ? 'cd-pill-idle' : d < 0 ? 'cd-pill-down' : 'cd-pill-up';
            const delta = d === undefined ? '暂无同期比较' : `${baselineIsDefault ? '同比' : '较基准'} ${pct(d)}`;
            const f = findings.find(x => x.metric === m);
            const cite = metricCitation(m);
            const quote = [labels[m], `${amount(value(selected, m), m)}${unitOf(m)}`, delta, f?.detail].filter(Boolean).join(' · ');
            return <article
              key={m}
              data-metric={m}
              data-focus-card
              data-focus-id={m}
              data-focus-kind="metric"
              data-focus-title={labels[m]}
              data-focus-quote={quote}
              {...(cite?.page ? { 'data-focus-page': String(cite.page) } : {})}
              className={`cd-focusable-card cd-focus-card${pickedCard(m)}`}
              aria-label={labels[m]}
            >
              <div className="cd-metric-label">
                <span>{labels[m]}</span>
                <span className="cd-metric-tools">{footnote(m)}</span>
              </div>
              <strong>{amount(value(selected, m), m)}<i>{unitOf(m)}</i></strong>
              <span className={`cd-pill ${pill}`}>{delta}</span>
              {f && <small className="cd-metric-insight">{f.detail}</small>}
            </article>;
          })}</div>
          {baselineOptions.length>0 && <div className="cd-baseline-row"><label>对比基准 <select aria-label="选择同比对比基准" value={previous?.id ?? ''} onChange={e=>setBaselineId(e.target.value||null)}><option value="">{defaultPrevious?`${period(defaultPrevious)}（上年同期）`:'暂无上年同期'}</option>{baselineOptions.filter(r=>r.id!==defaultPrevious?.id).map(r=><option key={r.id} value={r.id}>{period(r)}</option>)}</select></label>{!baselineIsDefault && previous && <span className="cd-note">当前以 {period(previous)} 为基准，非上年同期。</span>}</div>}
          {!verdictGenerating && verdictStatus === 'ready' && verdictChanges.length > 0 && <section className="cd-key-changes" aria-label="关键变化">
            <h3>关键变化</h3>
            <ul>
              {verdictChanges.map((item, index) => {
                const icon = changeDirectionIcon(item.direction);
                const primary = item.sourceRef[0];
                return <li
                  key={`${item.title}-${index}`}
                  className={`cd-key-change cd-key-change-${changeTone(item.direction)} cd-focus-card${pickedCard(`change-${index}`)}`}
                  data-focus-card
                  data-focus-id={`change-${index}`}
                  data-focus-kind="finding"
                  data-focus-title={item.title}
                  data-focus-quote={`${item.title}：${item.description}`}
                  {...(primary?.page ? { 'data-focus-page': String(primary.page) } : {})}
                >
                  <div className="cd-key-change-main">
                    {icon && <span className="cd-key-change-icon" aria-label={icon.label}><Icon name={icon.name} size={16} /></span>}
                    <span>
                      <b>{item.title}</b>
                      <small>{item.description}</small>
                    </span>
                  </div>
                  <span className="cd-key-change-cites">{item.sourceRef.map((c, i) => citationLink(c, `${index}-${i}`))}</span>
                </li>;
              })}
            </ul>
          </section>}
          </div>

          <section
            className={`cd-card cd-trend-card cd-focus-card${pickedCard('trend')}`}
            id="cd-trend"
            data-focus-card
            data-focus-id="trend"
            data-focus-kind="metric"
            data-focus-title="指标趋势"
            data-focus-quote={trendFocusQuote()}
          >
            <div className="cd-card-head">
              <h3>指标趋势</h3>
              <span>近 {Math.min(trendHistory.length,8)} 期 · 按报告时序</span>
              <button type="button" className="cd-trend-spark" disabled={asking||memoryLoading} onClick={pinTrendFocus} aria-label="智析" title="智析">✧</button>
            </div>
            <div className="cd-chart-tabs">{metricNames.map(m=><button key={m} className={metric===m?'active':''} onClick={()=>setMetric(m)}>{labels[m].split(' ')[0]}</button>)}<label className="cd-overlay">叠加 <select aria-label="叠加第二个指标" value={overlay??''} onChange={e=>setOverlay((e.target.value||null) as HeadlineMetric|null)}><option value="">不叠加</option>{metricNames.filter(m=>m!==metric).map(m=><option key={m} value={m}>{labels[m].split(' ')[0]}</option>)}</select></label></div>
            <Trend reports={trendHistory} metric={metric} compare={overlay===metric?null:overlay} onSelect={selectReport}/>
            {overlay&&overlay!==metric&&<p className="cd-note">虚线为{labels[overlay]}，已按首期指数化到与{labels[metric]}同一刻度，只反映相对变化速度，不能读绝对值。</p>}
          </section>

          <section
            className={`cd-ratio-row cd-focus-card${pickedCard('ratio')}`}
            aria-label="关键比率"
            data-focus-card
            data-focus-id="ratio"
            data-focus-kind="metric"
            data-focus-title="关键比率"
            data-focus-quote={ratioChips.length
              ? `关键比率：${ratioChips.map(chip => `${chip.label} ${chip.value.toFixed(1)}${chip.suffix}`).join('，')}`
              : '关键比率缺必要科目，暂不计算'}
          >
            <b>关键比率</b>
            {ratioChips.length ? ratioChips.map(chip => (
              <span className="cd-ratio-chip" key={chip.key}>
                {chip.label}
                <strong>{chip.value.toFixed(1)}{chip.suffix}</strong>
                {footnote(chip.metric)}
              </span>
            )) : <span className="cd-ratio-empty">缺必要科目，暂不计算</span>}
          </section>

          <section className="cd-more-analysis" id="cd-more">
            <div className="cd-more-title">
              <div>
                <h3>深度归因</h3>
                <p className="cd-more-lead">解释营收、利润与异常指标为何变动</p>
              </div>
            </div>
            {Object.entries(moduleLabels).map(([id,label],index)=>{
              const headline = moduleHeadline(id);
              const hasBody = moduleHasBody(id);
              const compact = compactModuleIds.has(id);
              const open = !compact && expanded.includes(id);
              const moduleQuote = [label, headline.text].filter(Boolean).join('：') || label;
              return <section
                id={`cd-${id}`}
                className={`cd-module cd-focus-card ${focused===id?'cd-focused':''}${pickedCard(id)}${compact?' cd-module-compact':''}`}
                key={id}
                data-focus-card
                data-focus-id={id}
                data-focus-kind="finding"
                data-focus-title={label}
                data-focus-quote={moduleQuote}
              >
                {compact ? (
                  <div className="cd-module-static">
                    <span className="cd-module-number">0{index+1}</span>
                    <div>
                      <h3>{label}{headline.text ? <span className="cd-module-lead">{headline.text}</span> : null}</h3>
                      {headline.sourceRef.length > 0 && <div className="cd-module-cites">{headline.sourceRef.map((c, i) => citationLink(c, `${id}-${i}`))}</div>}
                      {!headline.text && <p className="cd-module-empty">暂无可靠结论</p>}
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className="cd-module-toggle"
                      role="button"
                      tabIndex={0}
                      aria-expanded={open}
                      aria-controls={`cd-content-${id}`}
                      onClick={(e) => {
                        if (e.detail > 1) return;
                        setExpanded(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setExpanded(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
                        }
                      }}
                    >
                      <span className="cd-module-number">0{index+1}</span>
                      <div>
                        <h3>{label}</h3>
                        {headline.text ? <p>{headline.text}</p> : null}
                      </div>
                    </div>
                    {open && <div className="cd-module-content" id={`cd-content-${id}`}>
                      {headline.sourceRef.length > 0 && <div className="cd-module-cites">{headline.sourceRef.map((c, i) => citationLink(c, `${id}-${i}`))}</div>}
                      {!hasBody && !headline.text && <p className="cd-module-empty">暂无可靠结论</p>}
                      {id==='history' && history.length >= 2 && <div className="cd-table-scroll"><table><thead><tr><th>报告期</th>{metricNames.map(m=><th key={m}>{labels[m]}</th>)}</tr></thead><tbody>{history.map(r=><tr key={r.id}><th><button onClick={()=>selectReport(r)}>{period(r)}</button></th>{metricNames.map(m=><td key={m}>{format(value(r,m),m)}</td>)}</tr>)}</tbody></table></div>}
                      {id==='peers' && peerCodes.length > 0 && <><p className="cd-note">仅比较 {period(selected)} 同类型已入库报告，不是完整行业排名。</p><div className="cd-table-scroll"><table><thead><tr><th>公司</th>{metricNames.map(m=><th key={m}>{labels[m]}</th>)}</tr></thead><tbody>{peerCodes.map(code=><tr key={code} className={code===selected.code?'cd-self':''}><th>{peers.find(p=>p.code===code)?.company_name}{code===selected.code?' · 本公司':''}</th>{metricNames.map(m=><td key={m}>{format(peers.find(p=>p.code===code&&p.metric===m)?.value,m)}</td>)}</tr>)}</tbody></table></div></>}
                    </div>}
                  </>
                )}
              </section>;
            })}
          </section>
          <p className="cd-data-note">数据来自已解析财报 · 数字旁角标可定位原文 · 未复核指标请结合 PDF 核验</p>
        </div>
      </main>
      {!chatCollapsed && <div className="cd-gutter" role="separator" aria-orientation="vertical" aria-label="调整对话栏宽度" onPointerDown={e=>onGutterDown('chat', e)} onPointerMove={onGutterMove} onPointerUp={onGutterUp} onPointerCancel={onGutterUp} />}
      <aside id="cd-chat-panel" className={`cd-chat cd-pane ${mobilePane==='chat'?'mobile-active':''}`} aria-label="财报对话" style={!chatCollapsed ? { flex: `${colRatios.chat} 1 0%`, minWidth: 220 } : undefined}>
        <div className="cd-pane-head"><h2><span>✧</span> 追问</h2><div className="cd-chat-actions"><button aria-label="新建对话" title="新建对话" disabled={asking||memoryLoading} onClick={()=>void newConversation()}><Icon name="plus" size={16} /></button><button className="cd-dock" aria-label="收起对话" title="收起对话" onClick={()=>{setChatCollapsed(true);setMobilePane('dashboard');}}><DockIcon side="right" /></button></div></div>
        <div className="cd-chat-scroll">
          {messages.length === 0 && <div className="cd-ask-empty">
            <aside className="cd-ask-tips">
              <div className="cd-ask-tips-head">
                <strong>💡 高效追问技巧</strong>
              </div>
              <ul>
                <li><b>PDF 划词</b>：在左侧原文选中文本，快速发起定点追问</li>
                <li><b>卡片双击</b>：双击中间栏的指标卡片或结论，快捷带入上下文</li>
              </ul>
            </aside>
            <div className="cd-ask-starters" aria-label="快捷追问">
              {starterAsks.map(item => (
                <button type="button" key={item.label} disabled={asking || memoryLoading} onClick={() => void ask(item.question)}>{item.label}</button>
              ))}
            </div>
          </div>}
          {messages.map((m,i)=>{
            const waiting = m.role==='assistant' && asking && !m.text.trim() && i===messages.length-1;
            const streaming = m.role==='assistant' && asking && i===messages.length-1;
            const sources = m.role==='assistant' ? answerSources(m) : [];
            return <div key={i} className={`cd-message cd-message-${m.role}`}>
              {waiting
                ? <EvaAnalyzing phase={thinking ? 'reasoning' : 'retrieving'} />
                : m.role==='assistant'
                  ? <>
                      <b className="cd-answer-label">✧ Eva</b>
                      <AnswerMarkdown
                        text={m.text}
                        renderCites={renderCiteChunk(m)}
                        onFilingJump={(target) => {
                          const parsed = parseFilingHref(target.href);
                          const href = parsed
                            ? filingPageHref(parsed.code, parsed.period, { page: parsed.page, quote: parsed.quote })
                            : target.href;
                          askOpenFiling(href, <>将打开 {jumpTargetLabel(target.label)}。当前页面保持不变。</>);
                        }}
                      />
                      {sources.length > 0 && (
                          <details className="cd-answer-refs">
                            <summary><Icon name="chevronRight" size={12} className="cd-answer-refs-chevron" />参考来源 <small>References · {sources.length}</small></summary>
                            <ol>
                              {sources.map((c, n) => (
                                <li key={`${c.reportId ?? ''}:${c.page}:${n}`}>
                                  <button type="button" onClick={() => jumpCitation(c)}>
                                    <span className="cd-answer-refs-n">[{n + 1}]</span>
                                    {citeFilingLabel(citeSource(c))}
                                  </button>
                                </li>
                              ))}
                            </ol>
                          </details>
                        )}
                    </>
                  : <p>{m.text}</p>}
              {m.role==='assistant' && m.text.trim() && !streaming && <div className="cd-answer-tools">
                <div className="cd-actions">
                <button type="button" className={m.feedback==='up'?'on':''} aria-label="满意" title="满意" aria-pressed={m.feedback==='up'} aria-expanded={m.feedback==='up' && !m.feedbackDone} onClick={()=>setAnswerVote(i,'up')}>
                  <ActIcon><path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" /></ActIcon>
                </button>
                <button type="button" className={m.feedback==='down'?'on':''} aria-label="不满意" title="不满意" aria-pressed={m.feedback==='down'} aria-expanded={m.feedback==='down' && !m.feedbackDone} onClick={()=>setAnswerVote(i,'down')}>
                  <ActIcon><path d="M17 14V2" /><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" /></ActIcon>
                </button>
                <div className={`cd-regen${regenMenu===i?' open':''}`}>
                  <button type="button" aria-label="重新回答" title="重新回答" aria-haspopup="menu" aria-expanded={regenMenu===i} disabled={asking} onClick={()=>setRegenMenu(n=>n===i?null:i)}>
                    <ActIcon><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></ActIcon>
                  </button>
                  {regenMenu===i && <div className="cd-regen-menu" role="menu">
                    <button type="button" role="menuitem" onClick={()=>regenerate(i,'detailed')}>详尽一点</button>
                    <button type="button" role="menuitem" onClick={()=>regenerate(i,'brief')}>简单一点</button>
                    <button type="button" role="menuitem" onClick={()=>regenerate(i,'retry')}>重试</button>
                  </div>}
                </div>
                <button type="button" aria-label="复制" title="复制" onClick={()=>void copyAnswer(m.text, i)}>
                  <ActIcon><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></ActIcon>
                </button>
                {copiedSlot===i && <span className="cd-copied" role="status">已复制</span>}
                </div>
                <AnswerFeedback
                  kind={m.feedback}
                  submitted={m.feedbackDone}
                  onSubmit={()=>submitAnswerFeedback(i)}
                />
                {m.followups && m.followups.length > 0 && (
                  <div className="cd-followups" aria-label="继续追问">
                    <div className="cd-followup-list">
                      {m.followups.slice(0, 3).map((q) => (
                        <button type="button" key={q} disabled={asking} onClick={() => void ask(q)}>{q}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>}
            </div>;
          })}<div ref={chatEnd}/>
        </div><form className="cd-chat-input" onSubmit={e=>{e.preventDefault(); if (!asking) void ask(question);}}>
          {clipToast && <div className="cd-clip-toast" role="status">{clipToast}</div>}
          {clips.length>0 && <div className={`cd-clips ${clipsFlash?'cd-clips-flash':''}`} aria-label="AI分析关注">
            <ul>{clips.map(c => <li key={c.id}><span>{clipChipLabel(c)}</span><button type="button" aria-label="移除" onClick={()=>removeClip(c.id)}><Icon name="x" size={14} /></button></li>)}</ul>
          </div>}
          <div className="cd-composer">
            <textarea ref={questionRef} aria-label="向 Eva 提问" placeholder="随意划词，灵活追问" rows={1} value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault(); if(!asking) void ask(question);}}}/>
            {asking
              ? <button type="button" className="cd-stop" aria-label="停止生成" title="停止生成" onClick={stopAsk}>
                  <svg className="cd-stop-icon" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false">
                    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                  </svg>
                </button>
              : <button aria-label="发送问题" disabled={memoryLoading||(!question.trim()&&!clips.length)} type="submit">
                  <svg className="cd-send-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 4l7 7h-4v9H9v-9H5z"/></svg>
                </button>}
          </div>
          {memoryLoading && <small>正在恢复历史会话…</small>}</form>
      </aside>
      {sourceCollapsed && <div className="cd-rail cd-rail-left"><button aria-label="展开来源栏" title="展开来源栏" aria-expanded={false} aria-controls="cd-source-panel" onClick={()=>{setSourceCollapsed(false);setMobilePane('sources');}}><DockIcon side="left" /></button><span>来源</span></div>}
      {chatCollapsed && <div className="cd-rail cd-rail-right"><button aria-label="展开对话" title="展开对话" aria-expanded={false} aria-controls="cd-chat-panel" onClick={()=>{setChatCollapsed(false);setMobilePane('chat');}}><DockIcon side="right" /></button><span>对话</span></div>}
    </div>
    {jumpAsk && (
      <div className="cd-jump-backdrop" role="presentation" onClick={() => { setJumpAsk(null); setJumpBlocked(false); }}>
        <div className="cd-jump-dialog" role="dialog" aria-modal="true" aria-labelledby="cd-jump-title" onClick={e => e.stopPropagation()}>
          <h3 id="cd-jump-title">{jumpAsk.title}</h3>
          <p>{jumpAsk.detail}</p>
          {jumpBlocked && <p className="cd-jump-warn">浏览器拦截了新标签页，请允许弹出窗口后重试。</p>}
          <div className="cd-jump-actions">
            <button type="button" className="cd-jump-cancel" onClick={() => { setJumpAsk(null); setJumpBlocked(false); }}>{jumpAsk.href ? '取消' : '知道了'}</button>
            {jumpAsk.href ? <button type="button" className="cd-jump-ok" onClick={confirmJumpAsk}>新标签页打开</button> : null}
          </div>
        </div>
      </div>
    )}
    {quietToast && (
      <div className="cd-quiet-toast" role="status" aria-live="polite">
        {quietToast.text}
      </div>
    )}
  </section>;
}
