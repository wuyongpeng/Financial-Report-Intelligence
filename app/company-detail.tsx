'use client';

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { amount, cashConversion, change, comparableHistory, debtRatio, format, grossMargin, keyFindings, labels, metricNames, moduleForQuestion, period, periodKey, priorYear, profitBridge, sourceRange, unitOf, value, type Citation, type HeadlineMetric, type MetricName, type Report } from '@/lib/detail-model';
import { assembleFocusPrompt, displayFocusPrompt, FOCUS_MAX_ITEMS, FOCUS_QUOTE_MAX, type FocusItem, type FocusKind } from '@/lib/focus-prompt';
import { type PdfPageLabel } from '@/lib/pdf-pages';
import PdfEvidence from './pdf-evidence';
import './company-detail.css';

type Outline = { pageLabels?: PdfPageLabel[]; indexedPages: number; pages: { page: number; content: string }[]; outline: { id: string; title: string; page: number; highlight: string }[] };
type Peer = { code: string; company_name: string; metric: string; value: number; unit: string };
type Analysis = { peers?: Peer[]; industry?: string };
// Follow-ups belong to the answer that produced them, so they travel on the message
// itself and survive a period switch together with the conversation.
type Message = { role: 'user' | 'assistant'; text: string; citations?: Citation[]; followups?: string[]; followupBusy?: boolean };
type Clip = { id: string; kind: FocusKind; quote: string; page?: number; title?: string };
const emptyOutline: Outline = { indexedPages: 0, pages: [], outline: [] };
const moduleLabels = { business: '主营业务构成', attribution: '净利润变动分解', anomalies: '异常指标提示', history: '历史趋势详情', peers: '同业对比表格' };
const suggestions = ['本期最值得关注的变化是什么？请给出原文页码。', '和上年同期比，营收与净利怎么变？', '管理层如何解释本期业绩？请引用原文。', '和已覆盖同行比，我们处在什么位置？'];
// Material Symbols "dock to left" / "dock to right", inlined to avoid a font request.
const dockPaths = {
  left: 'M120-120q-33 0-56.5-23.5T40-200v-560q0-33 23.5-56.5T120-840h720q33 0 56.5 23.5T920-760v560q0 33-23.5 56.5T840-120H120Zm200-80h520v-560H320v560Zm-80 0v-560H120v560h120Z',
  right: 'M120-120q-33 0-56.5-23.5T40-200v-560q0-33 23.5-56.5T120-840h720q33 0 56.5 23.5T920-760v560q0 33-23.5 56.5T840-120H120Zm0-80h520v-560H120v560Zm600 0h120v-560H720v560Z',
};
function DockIcon({ side }: { side: 'left' | 'right' }) {
  return <svg className="cd-dock-icon" viewBox="0 -960 960 960" aria-hidden="true" focusable="false"><path d={dockPaths[side]} /></svg>;
}
const pct = (n: number | undefined) => n === undefined ? '暂无同期数据' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
function reportTypeLabel(r: Report) { return r.report_type === 'annual' ? '年报' : r.report_type === 'semiannual' ? '中报' : '季报'; }

function Trend({ reports, metric, compare, onSelect }: { reports: Report[]; metric: HeadlineMetric; compare: HeadlineMetric | null; onSelect: (r: Report) => void }) {
  const rows = reports.slice(-5);
  const values = rows.map(r => value(r, metric)).filter((v): v is number => v !== undefined);
  if (values.length < 2) return <div className="cd-empty">至少需要两期同口径数据才能绘制趋势。已覆盖 {values.length} 期。</div>;
  const max = Math.max(...values, 0), min = Math.min(...values, 0), span = max - min || 1;
  const y = (v: number) => 145 - (v - min) / span * 110;
  const x = (i: number) => 52 + i * (480 / Math.max(rows.length - 1, 1));
  // A second metric is indexed to its own first period (=100) and mapped onto the
  // same axis, so no misleading dual scale is introduced.
  const compareSeries = compare ? rows.map(r => value(r, compare)) : [];
  const base = compareSeries.find((v): v is number => v !== undefined && v !== 0);
  const indexed = base ? compareSeries.map(v => v === undefined ? undefined : v / base * (values[0] ?? 0)) : [];
  return <svg className="cd-trend" viewBox="0 0 590 190" role="img" aria-label={`${labels[metric]}近${rows.length}期趋势${compare?`，并叠加指数化后的${labels[compare]}`:''}，柱线共用同一刻度`}>
    {[0, .5, 1].map(t => <g key={t}><line x1="30" x2="560" y1={35 + 110 * t} y2={35 + 110 * t} stroke="#e9eef4" strokeDasharray="3 4" /></g>)}
    <line x1="30" x2="560" y1={y(0)} y2={y(0)} stroke="#ccd8e5" />
    {rows.map((r,i) => { const n = value(r,metric); const next = rows[i+1] && value(rows[i+1], metric); return <g key={r.id}>
      {n !== undefined && <><rect x={x(i)-15} y={Math.min(y(n), y(0))} width="30" height={Math.max(Math.abs(y(n)-y(0)), 1)} rx="4" fill="#e0eafc" />{next !== undefined && <line x1={x(i)} y1={y(n)} x2={x(i+1)} y2={y(next)} stroke="#3064db" strokeWidth="2.5" />}<circle cx={x(i)} cy={y(n)} r="4" fill="#3064db" /><text x={x(i)} y={y(n)-12} textAnchor="middle">{format(n,metric)}</text></>}
      <text x={x(i)} y="176" textAnchor="middle" onClick={() => onSelect(r)} style={{ cursor: 'pointer' }}>{period(r)}</text><title>{r.title}：{format(n,metric)}</title>
    </g>; })}
    {indexed.map((v,i) => { const next = indexed[i+1]; return v === undefined ? null : <g key={`c-${i}`}>
      {next !== undefined && <line x1={x(i)} y1={y(v)} x2={x(i+1)} y2={y(next)} stroke="#c58b3d" strokeWidth="2" strokeDasharray="5 4" />}
      <circle cx={x(i)} cy={y(v)} r="3.5" fill="#c58b3d"><title>{labels[compare!]}（指数化）：{format(value(rows[i],compare!),compare!)}</title></circle>
    </g>; })}
  </svg>;
}

function Radar({ peers, code }: { peers: Peer[]; code: string }) {
  const axes = ['营收规模', '利润规模', '每股收益', 'ROE', '归母净利率', '营收成长'];
  const codes = [...new Set(peers.map(p => p.code))];
  const get = (c: string, i: number) => {
    if (i === 5) return peers.find(p => p.code === c && p.metric === 'revenue_growth')?.value;
    if (i === 4) { const r = peers.find(p => p.code === c && p.metric === 'revenue')?.value; const n = peers.find(p => p.code === c && p.metric === 'net_profit')?.value; return r && r > 0 && n !== undefined ? n / r * 100 : undefined; }
    return peers.find(p => p.code === c && p.metric === metricNames[i])?.value;
  };
  // Each axis is filtered independently, so its sample size must travel with it.
  const samples = axes.map((_, i) => codes.map(c => get(c, i)).filter((n): n is number => n !== undefined).length);
  const scores = axes.map((_, i) => {
    const self = get(code, i), all = codes.map(c => get(c, i)).filter((n): n is number => n !== undefined);
    return self === undefined || all.length < 2 ? undefined : all.filter(n => n < self).length / (all.length - 1) * 100;
  });
  const point = (i: number, score: number) => [155 + Math.sin(i * Math.PI / 3) * 78 * score / 100, 112 - Math.cos(i * Math.PI / 3) * 78 * score / 100];
  return <><svg className="cd-radar" viewBox="0 0 310 225" role="img" aria-label="固定六轴同业百分位，缺失维度不连线">
    {[25,50,75,100].map(s => <polygon key={s} points={axes.map((_,i) => point(i,s).join(',')).join(' ')} fill={s===100?'#f7faff':'none'} stroke="#e1e8f2" />)}
    {axes.map((axis,i) => { const p = point(i,100), l=point(i,132), score=scores[i]; return <g key={axis}><line x1="155" y1="112" x2={p[0]} y2={p[1]} stroke="#e1e8f2" /><text x={l[0]} y={l[1]} textAnchor="middle" dominantBaseline="middle">{axis}<tspan className="cd-axis-sample" x={l[0]} dy="13">{samples[i]} 家</tspan></text>{score !== undefined && <circle cx={point(i,score)[0]} cy={point(i,score)[1]} r="4" fill="#3064db"><title>{axis}：{samples[i]} 家样本内第 {(samples[i]-Math.round(score/100*(samples[i]-1))).toFixed(0)} 位</title></circle>}</g>; })}
    {scores.every(s => s !== undefined) && <polygon points={scores.map((s,i)=>point(i,s!).join(',')).join(' ')} fill="#3064db25" stroke="#3064db" strokeWidth="2" />}
  </svg><p className="cd-note"><i className="cd-dot" />同报告期 · 覆盖 {codes.length} 家 · 0–100 百分位</p><p className="cd-note">固定六轴；缺项不补零、不连线。每轴下方标注该轴实际样本量——不同轴的样本可能不同，跨轴比较需谨慎，且不代表完整行业排名。</p></>;
}

export default function CompanyDetail({ initialReport, onBack, onSelect, onApprove }: { initialReport: Report; onBack: () => void; onSelect: (id: string) => void; onApprove?: (reportId: string) => void }) {
  const [reports, setReports] = useState<Report[]>([initialReport]);
  const [selected, setSelected] = useState(initialReport);
  const [outline, setOutline] = useState<Outline>(emptyOutline);
  const [analysis, setAnalysis] = useState<Analysis>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sourcePage, setSourcePage] = useState(1);
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
  const [colRatios, setColRatios] = useState({ source: 25, middle: 48, chat: 25 });
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
  const [clipsFlash, setClipsFlash] = useState(false);
  const pageEnter = useRef<'start' | 'next' | 'prev'>('start');
  const [asking, setAsking] = useState(false);
  // A reasoning model thinks before it speaks; say so instead of showing dead air.
  const [thinking, setThinking] = useState(false);
  const [summary, setSummary] = useState<Message | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
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
  const [overviewPick, setOverviewPick] = useState<null | { quote: string; x: number; y: number; kind: FocusKind; page?: number; title?: string }>(null);

  function selectReport(report: Report) {
    setReportListOpen(false);
    if (report.id === activeId.current) return;
    requestRef.current?.abort(); busyRef.current = false;
    // Same-company period switch keeps the QA thread; only `newConversation` / `+` clears it.
    memoryReady.current = false; setMemoryLoading(true);
    activeId.current = report.id;
    setSelected(report); onSelect(report.id); setPick(null); setOverviewPick(null); setAsking(false); setSummary(null); setBaselineId(null);
    setOutline(emptyOutline); setAnalysis({}); setSourcePage(1); setHighlight(''); setCitedMetric(null); setExpanded([]); setFocused(null);
  }
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/reports?code=${initialReport.code}&limit=100`, { signal: abort.signal, cache: 'no-store' }).then(async r => {
      if (!r.ok) throw new Error('财报列表加载失败');
      const data = await r.json() as { reports: Report[] };
      if (abort.signal.aborted) return;
      const parsed = data.reports.filter(r => r.parsed_at || r.metrics.length).sort((a,b) => periodKey(b)-periodKey(a) || b.published_at.localeCompare(a.published_at));
      const all = parsed.length ? parsed : data.reports;
      setReports(all); const latest = all[0];
      if (latest) selectReport(latest);
    }).catch(() => { if (!abort.signal.aborted) setError('多期财报暂时无法加载，当前仍可阅读已选报告。'); });
    return () => { abort.abort(); requestRef.current?.abort(); };
    // One company owns this workspace; changing a period must not reload or reset the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialReport.code]);
  useEffect(() => {
    // Reset the view when the external report resource changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    const abort = new AbortController(); setLoading(true); setOutline(emptyOutline); setAnalysis({}); setSummary(null);
    void Promise.all([
      fetch(`/api/reports/${encodeURIComponent(selected.id)}/outline`, { signal: abort.signal }).then(async r => { if (!r.ok) throw new Error(); return r.json() as Promise<Outline>; }),
      fetch(`/api/reports/${encodeURIComponent(selected.id)}/analysis`, { signal: abort.signal }).then(async r => { if (!r.ok) throw new Error(); return r.json() as Promise<Analysis>; }),
    ]).then(([o,a]) => { if (!abort.signal.aborted) { setOutline(o); setAnalysis(a);  setError(''); } }).catch(() => { if (!abort.signal.aborted) setError('部分报告数据加载失败，请切换报告重试。'); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [selected.id]);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    const abort = new AbortController(); setSummaryBusy(true);
    void fetch('/api/chat', { method: 'POST', signal: abort.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reportId: selected.id, question: '请用3句话概览本期财报，指出最值得关注的1至2个变化。每个关键数据标注原文页码；缺少同期依据不要计算变化。', summary: true }) }).then(async r => {
      if (!r.ok) return; const p = await r.json() as { answer?: string; mode?: string; evidence?: Citation[] };
      if (!abort.signal.aborted && p.mode === 'llm-rag' && p.answer) setSummary({ role: 'assistant', text: p.answer, citations: p.evidence });
    }).catch(() => undefined).finally(() => { if (!abort.signal.aborted) setSummaryBusy(false); });
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
      else if (sourceMode === 'pdf' && highlight) return; // PdfEvidence scrolls to the yellow highlight line.
      else sourceRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [sourcePage, highlight, sourceMode]);

  useEffect(() => {
    const root = sourceRef.current;
    if (!root) return;
    function onUp() {
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
      const box = root!.getBoundingClientRect();
      setOverviewPick(null);
      setPick({
        quote: raw,
        page: resolvedPage ?? sourcePage,
        x: range.left - box.left + root!.scrollLeft + range.width / 2,
        y: Math.max(root!.scrollTop + 8, range.top - box.top + root!.scrollTop - 36),
      });
    }
    root.addEventListener('mouseup', onUp);
    return () => root.removeEventListener('mouseup', onUp);
  }, [sourcePage, resolvedPage, sourceMode, selected.id]);

  useEffect(() => {
    const root = sourceRef.current;
    if (!root || sourceMode !== 'pdf') return;
    let locked = false;
    const maxPage = Math.max(outline.indexedPages || 0, outline.pages.length || 0, sourcePage);
    function onWheel(event: WheelEvent) {
      if (locked || event.ctrlKey || event.metaKey) return;
      const el = root!;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 3;
      const atTop = el.scrollTop <= 2;
      if (event.deltaY > 8 && atBottom && sourcePage < maxPage) {
        event.preventDefault();
        locked = true;
        pageEnter.current = 'next';
        setHighlight('');
        setResolvedPage(null);
        setSourcePage(sourcePage + 1);
        window.setTimeout(() => { locked = false; }, 420);
      } else if (event.deltaY < -8 && atTop && sourcePage > 1) {
        event.preventDefault();
        locked = true;
        pageEnter.current = 'prev';
        setHighlight('');
        setResolvedPage(null);
        setSourcePage(sourcePage - 1);
        window.setTimeout(() => { locked = false; }, 420);
      }
    }
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [sourceMode, sourcePage, outline.indexedPages, outline.pages.length]);

  useEffect(() => {
    if (sourceMode !== 'pdf') return;
    const root = sourceRef.current;
    if (!root) return;
    const enter = pageEnter.current;
    pageEnter.current = 'start';
    const timer = window.setTimeout(() => {
      if (enter === 'next') root.scrollTop = 0;
      else if (enter === 'prev') root.scrollTop = root.scrollHeight;
    }, 60);
    return () => window.clearTimeout(timer);
  }, [sourcePage, sourceMode, selected.id]);



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
  const defaultPrevious = priorYear(reports, selected);
  const baselineOptions = reports.filter(r => r.id !== selected.id && r.report_type === selected.report_type && periodKey(r) < periodKey(selected) && r.metrics.length);
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
  const growthRanks = peers.filter(p => p.metric === 'revenue_growth');
  const selfGrowth = growthRanks.find(p => p.code === selected.code)?.value;
  // Report the ordinal position inside the covered sample; a percentile reads as a grade.
  function standing(rows: Peer[], self: number | undefined) {
    if (self === undefined || rows.length < 2 || !rows.some(r => r.code === selected.code)) return undefined;
    return { rank: rows.filter(r => r.value > self).length + 1, total: rows.length };
  }
  const profitStanding = standing(profitRanks, roe);
  const growthStanding = standing(growthRanks, selfGrowth);
  const findings = keyFindings(reports, selected);
  const shaky = deltas.filter(d => d.amount !== undefined && d.confidence !== undefined && d.confidence < 0.8).map(d => d.metric);
  const mdaSection = outline.outline.find(o => o.id === 'mda') ?? outline.outline.find(o => /管理层讨论与分析|经营情况讨论与分析/.test(o.title));
  const mdaExcerpt = mdaSection ? (outline.pages.find(p => p.page === mdaSection.page)?.content ?? '').slice(0, 420) : '';
  const topFinding = findings[0];
  const briefSignal = topFinding
    ? topFinding.headline
    : revenue !== undefined
      ? `${period(selected)} 营收 ${format(revenue, 'revenue')} · 净利 ${format(profit, 'net_profit')}`
      : `${period(selected)} 核心指标解析中`;
  function briefInsight() {
    const chars = (s: string) => [...s].slice(0, 30).join('');
    if (bridge) {
      const rev = bridge.revenueEffect, mar = bridge.marginEffect;
      if (Math.abs(mar) >= Math.abs(rev)) return chars(mar < 0 ? '利润承压，主因净利率走弱' : '利润改善，净利率是主因');
      return chars(rev < 0 ? '利润承压，主因营收下滑' : '利润改善，营收是主因');
    }
    if (findings.some(f => f.id === 'finding-cash')) return chars('经营现金流对利润覆盖偏弱');
    if (findings.some(f => f.id === 'finding-leverage')) return chars('资产负债率偏高，留意偿债');
    if (topFinding) {
      const d = deltas.find(x => x.metric === topFinding.metric)?.amount;
      if (d !== undefined && Math.abs(d) >= 30) return chars('波动偏大，建议核对原文口径');
      if (d !== undefined && d < 0) return chars('同比回落，宜对照管理层说明');
      if (d !== undefined) return chars('同比改善，可对照原文核验');
    }
    return chars(previous ? '暂无显著异常，先核核心指标' : '暂无同比，先核验本期数字');
  }
  const briefInsightText = briefInsight();
  const leverage = debtRatio(selected), conversion = cashConversion(selected), margin = grossMargin(selected);
  const absolutes = [
    { label: '资产负债率', value: leverage, suffix: '%', detail: leverage === undefined ? '需要资产总计与负债合计两行' : '负债合计 ÷ 资产总计', metric: 'total_liabilities' as MetricName },
    { label: '毛利率', value: margin, suffix: '%', detail: margin === undefined ? '需要营业收入与营业成本两行' : '(营业收入 − 营业成本) ÷ 营业收入', metric: 'operating_cost' as MetricName },
    { label: '现金含利润比', value: conversion, suffix: '%', detail: conversion === undefined ? '需要经营现金流净额，且归母净利润为正' : '经营现金流净额 ÷ 归母净利润', metric: 'operating_cash_flow' as MetricName },
  ];
  const relatives = [
    { label: '盈利能力（ROE）', standing: profitStanding, detail: profitStanding ? '同报告期可比公司内排序' : '待同报告期 ROE 样本' },
    { label: '成长性（营收同比）', standing: growthStanding, detail: growthStanding ? '同报告期可比公司内排序' : '待上年同期与可比同业数据' },
  ];
  // A single click only jumps inside the left column; enlarging stays explicit.
  function cite(c: Citation, expand = false, metric: MetricName | null = null) {
    readingPosition.current = null; setSourcePage(c.page); setHighlight(c.quote); setResolvedPage(null); setCitedMetric(metric);
    setSourceCollapsed(false); setMobilePane('sources');
    if (expand || sourceDrawerOpen) { openSource(); if (sourceMode === 'text' || !c.quote) sourceRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }
  }
  function metricCitation(m: MetricName, report = selected) { const item = report.metrics.find(x => x.metric === m); return item?.source_page ? { page: item.source_page, quote: item.source_label ?? labels[m] } : null; }
  function footnote(m: MetricName) { const c = metricCitation(m); return c && <button className="cd-cite" onClick={(e) => { e.stopPropagation(); cite(c, false, m); }} onDoubleClick={(e) => { e.stopPropagation(); cite(c, true, m); }} title={`单击预览${labels[m]}原文，双击展开原文，${pageDescription(c.page)}`}>[{pageLabel(c.page)}]</button>; }
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
  function citeRefLabel(c: Citation) {
    // Chip text is page-only (P5); period/company stay in the title tooltip.
    return pageLabel(c.page);
  }
  function jumpCitation(c: Citation, expand = false) {
    if (c.reportId && c.reportId !== selected.id) {
      const other = reports.find(r => r.id === c.reportId);
      if (!other) return;
      selectReport(other);
    }
    cite(c, expand);
  }
  function citationLink(c: Citation, key: string | number) {
    const otherId = c.reportId && c.reportId !== selected.id ? c.reportId : undefined;
    const loadable = !otherId || reports.some(r => r.id === otherId);
    const label = citeRefLabel(c);
    const title = `${c.companyName ? `${c.companyName} ` : ''}${c.period ? `${c.period} ` : ''}${pageDescription(c.page)}：${c.quote}`.trim();
    if (otherId && !loadable) return <span className="cd-cite cd-answer-ref" key={key} title={title}>{label}</span>;
    return <button type="button" className="cd-cite cd-answer-ref" key={key} title={title} onClick={() => jumpCitation(c)} onDoubleClick={() => jumpCitation(c, true)}>{label}</button>;
  }
  function renderAnswer(message: Message) {
    let prevCiteLabel: string | null = null;
    return message.text.split(/(【(?:E\d+|第\s*\d+\s*页)】|\[P\d+\])/g).map((part,i) => {
      const marked = part.match(/^【(?:E(\d+)|第\s*(\d+)\s*页)】$/);
      const bare = part.match(/^\[P(\d+)\]$/);
      if (!marked && !bare) { prevCiteLabel = null; return <Fragment key={i}>{part}</Fragment>; }
      const printed = bare?.[1];
      const c = marked
        ? message.citations?.find(c => marked[1] ? c.id === `E${marked[1]}` : c.page === Number(marked[2]))
        : printed
          ? message.citations?.find(c => pageLabel(c.page) === `P${printed}` || c.page === Number(printed))
          : undefined;
      if (!c) { prevCiteLabel = null; return <span className="cd-note" key={i}>{part}（待核验）</span>; }
      const label = citeRefLabel(c);
      if (label === prevCiteLabel) return <Fragment key={i} />;
      prevCiteLabel = label;
      return citationLink(c, i);
    });
  }
  function focusModule(id: string) { if (sourceDrawerOpen) closeSource(); setExpanded(e => e.includes(id) ? e : [...e,id]); setFocused(id); setMobilePane('dashboard'); const more = document.getElementById('cd-more'); if (more instanceof HTMLDetailsElement) more.open = true; window.setTimeout(() => document.getElementById(`cd-${id}`)?.scrollIntoView({ behavior:'smooth', block:'center' }), 80); }
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
  function pinTrendFocus() {
    const rows = history.slice(-5);
    const n = rows.length;
    const primary = rows.map(r => `${period(r)} ${format(value(r, metric), metric)}`).join('、');
    let quote = `比一比：${labels[metric]}近${n}期 ${primary}`;
    if (overlay && overlay !== metric) {
      const over = rows.map(r => `${period(r)} ${format(value(r, overlay), overlay)}`).join('、');
      quote += `；叠加${labels[overlay]} ${over}（指数化相对走势）`;
    }
    addFocus({ kind: 'metric', quote, title: '智析·趋势' });
  }
  function pinRatiosFocus() {
    const bits = absolutes.filter(a => a.value !== undefined).map(a => `${a.label} ${a.value!.toFixed(1)}${a.suffix}`);
    addFocus({ kind: 'metric', quote: bits.length ? `关键比率：${bits.join('、')}` : '关键比率：暂无可用比率', title: '智析·比率' });
  }
  function pinRadarFocus() {
    addFocus({ kind: 'metric', quote: `同业对比雷达：覆盖 ${peerCodes.length} 家同报告期公司`, title: '智析·雷达' });
  }
  // Suggest the next question instead of making the reader compose one; the list is
  // advisory, so any failure simply leaves the answer without buttons.
  async function loadFollowups(reportId: string, slot: number, question: string, answer: string, asked: string[]) {
    const patch = (value: Partial<Message>) => setMessages(m => activeId.current === reportId && m[slot]?.role === 'assistant' ? m.map((item,i) => i === slot ? { ...item, ...value } : item) : m);
    patch({ followupBusy: true });
    try {
      const response = await fetch('/api/chat/followups', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ reportId, question, answer, asked }) });
      if (!response.ok) throw new Error();
      const payload = await response.json() as { questions?: string[] };
      patch({ followups: payload.questions?.slice(0,3) ?? [], followupBusy: false });
    } catch { patch({ followupBusy: false }); }
  }

  useEffect(() => {
    const root = overviewRef.current;
    if (!root) return;
    function onUp(e: MouseEvent) {
      const t = e.target;
      if (t instanceof Element && t.closest('button,a,select,input,textarea,.cd-pick-bar')) return;
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
      const box = root!.getBoundingClientRect();
      setPick(null);
      setOverviewPick({
        quote: raw,
        kind: finding ? 'finding' : 'metric',
        page: cite?.page,
        title: finding?.headline ?? (metricName ? labels[metricName] : undefined),
        x: range.left - box.left + root!.scrollLeft + Math.min(range.width, 240) / 2,
        y: Math.max(root!.scrollTop + 8, range.top - box.top + root!.scrollTop - 40),
      });
    }
    root.addEventListener('mouseup', onUp);
    return () => root.removeEventListener('mouseup', onUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mouseup reads latest findings/citations
  }, [selected.id]);

  function flashClips(message: string) {
    setClipToast(message);
    setClipsFlash(true);
    window.setTimeout(() => setClipsFlash(false), 900);
    window.setTimeout(() => setClipToast(current => current === message ? null : current), 2200);
  }
  function addFocus(item: { kind: FocusKind; quote: string; page?: number; title?: string }) {
    const clean = item.quote.replace(/\s+/g, ' ').trim();
    if (clean.length < 4) return;
    const quote = clean.slice(0, FOCUS_QUOTE_MAX);
    let added = true;
    let capped = false;
    setClips(prev => {
      const dup = prev.some(c => c.kind === item.kind && c.quote === quote && c.page === item.page && c.title === item.title);
      if (dup) { added = false; return prev; }
      if (prev.length >= FOCUS_MAX_ITEMS) capped = true;
      return [...prev, { id: crypto.randomUUID(), kind: item.kind, quote, page: item.page, title: item.title }].slice(-FOCUS_MAX_ITEMS);
    });
    setPick(null);
    setOverviewPick(null);
    setChatCollapsed(false);
    setMobilePane('chat');
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
    const sel = window.getSelection();
    const root = sourceRef.current;
    if (!sel || !sel.rangeCount || !root) { addClip(quote, page); return; }
    const range = sel.getRangeAt(0).getBoundingClientRect();
    const box = root.getBoundingClientRect();
    setOverviewPick(null);
    setPick({
      quote,
      page,
      x: range.left - box.left + root.scrollLeft + Math.min(range.width, 240) / 2,
      y: Math.max(root.scrollTop + 8, range.top - box.top + root.scrollTop - 40),
    });
  }
  function onSourceTextPick(text: string, page: number) { placePick(text, page); }

  async function ask(text: string) {
    const typed = text.trim();
    if ((!typed && !clips.length) || busyRef.current || !memoryReady.current) return;
    const focusPayload: FocusItem[] = clips.map(c => ({
      kind: c.kind,
      text: c.quote,
      ...(c.page !== undefined ? { page: c.page } : {}),
      ...(c.title ? { title: c.title } : {}),
    }));
    const question = typed || (focusPayload.length ? '怎么看待这些数据' : '');
    const assembled = assembleFocusPrompt(question, focusPayload);
    const display = displayFocusPrompt(question, focusPayload);
    const controller = new AbortController(); requestRef.current = controller; busyRef.current = true;
    const id = selected.id;
    const asked = messages.filter(m => m.role === 'user').map(m => m.text);
    const slot = messages.length + 1;
    setAsking(true); setThinking(false); setQuestion(''); setClips([]); setPick(null); setMessages(m => [...m,{ role:'user',text:display },{ role:'assistant',text:'' }]);
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
      const response = await fetch('/api/chat', { method:'POST', signal:controller.signal, headers:{ 'content-type':'application/json' },body:JSON.stringify({ reportId:id, ...(conversationId ? { conversationId } : {}), requestId:crypto.randomUUID(), question, ...(focusPayload.length ? { focus: focusPayload } : {}), stream:true }) });
      if (!response.ok || !response.body) { const failure = await response.json().catch(()=>({})); throw new Error(failure.error ?? '问答服务暂时不可用'); }
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      while (true) {
        const {done,value:chunk} = await reader.read(); buffer += decoder.decode(chunk ?? new Uint8Array(), {stream:!done});
        const events = buffer.split('\n\n'); buffer = events.pop() ?? '';
        for (const event of events) { const raw = event.split('\n').find(l=>l.startsWith('data: '))?.slice(6); if (!raw || raw==='[DONE]') continue; const p = JSON.parse(raw) as {content?:string;evidence?:Citation[];status?:string;error?:string;result?:{answer:string;evidence:Citation[]}}; if(p.status==='reasoning') setThinking(true); if(p.content||p.result) setThinking(false); answer = p.result ? p.result.answer : answer + (p.content ?? ''); if(p.error) answer=p.error; update(p.result?.evidence ?? p.evidence); }
        if(done) break;
      }
      if (!answer) { answer='暂无法回答：未返回足够证据。可尝试询问本期营业收入或净利润。'; update(); }
    } catch (error) { if (!controller.signal.aborted) { answer = error instanceof Error ? error.message : '问答服务暂时不可用，请稍后重试。'; update(); } }
    finally { if (activeId.current === id && !controller.signal.aborted) { busyRef.current = false; setAsking(false); setThinking(false); } }
    if (activeId.current === id && !controller.signal.aborted && answer) void loadFollowups(id, slot, assembled, answer, asked);
  }
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
    <header className="cd-company-head"><div className="cd-company-identity"><button className="cd-back" onClick={onBack} aria-label="返回公司列表">←</button><div className="cd-monogram">{selected.company_name.slice(0,1)}</div><div className="cd-company-meta"><h1>{selected.company_name}<span>{selected.code}</span></h1><p>{selected.industry} <span>／</span> {selected.report_type === 'annual' ? '年度报告' : selected.report_type === 'semiannual' ? '半年度报告' : '季度报告'}</p><div className="cd-period-wrap"><button type="button" className="cd-period-switch" aria-expanded={reportListOpen} aria-controls="cd-report-periods" onClick={()=>setReportListOpen(open=>!open)}>{period(selected)} {reportTypeLabel(selected)} <span className="cd-picker-chevron" aria-hidden="true">{reportListOpen?'⌃':'⌄'}</span></button>{reportListOpen && <div className="cd-report-list cd-report-popover" id="cd-report-periods" aria-label="选择报告期">{reports.map((r,i) => <button key={r.id} aria-pressed={r.id===selected.id} className={r.id===selected.id?'selected':''} onClick={()=>selectReport(r)}><span><b>{period(r)} {reportTypeLabel(r)}</b><small>{r.metrics.length} 项指标 · {r.parsed_at?'已解析':'解析中'}</small></span>{i===0 && <em>最新</em>}</button>)}</div>}</div></div></div><div className="cd-head-actions"><span className="cd-status"><i />{selected.metrics.length} 项指标已解析</span>{onApprove && selected.status !== 'online' && <button className="cd-button" onClick={() => onApprove(selected.id)}>复核上线</button>}</div></header>
    {error && <div role="alert" className="cd-error">{error}</div>}
    <nav className="cd-mobile-tabs" aria-label="详情页分栏">{[['sources','来源'],['dashboard','数据概览'],['chat','对话']].map(([id,label]) => <button key={id} className={mobilePane===id?'active':''} onClick={()=>{setMobilePane(id);if(id==='chat')setChatCollapsed(false);if(id==='sources')setSourceCollapsed(false);}}>{label}</button>)}</nav>
    <div className="cd-columns" ref={columnsRef}>
      <div id="cd-source-panel" className={`cd-source-slot ${mobilePane==='sources'?'mobile-active':''}`} style={!sourceCollapsed ? { flex: `${colRatios.source} 1 0%`, minWidth: 200 } : undefined}>
      <aside className={`cd-sources cd-pane ${sourceDrawerOpen?'cd-source-drawer':''}`} role={sourceDrawerOpen?'dialog':undefined} aria-modal={sourceDrawerOpen?false:undefined} aria-label={sourceDrawerOpen?'财报原文阅读抽屉':'财报来源'} ref={sourcePaneRef}>
        <div className="cd-pane-head cd-source-head"><h2><span>◇</span> {sourceDrawerOpen?'财报原文':'来源'}</h2><div className="cd-pane-tools">{sourceDrawerOpen ? <button className="cd-source-expand" ref={drawerCloseRef} onClick={()=>closeSource()} aria-label="收起来源阅读区">收起</button> : <><button className="cd-source-expand" onClick={openSource} aria-haspopup="dialog" aria-label="展开来源阅读区">展开</button><button className="cd-dock" aria-label="收起来源栏" title="收起来源栏" aria-controls="cd-source-panel" onClick={()=>{setSourceCollapsed(true);setMobilePane('dashboard');}}><DockIcon side="left" /></button></>}</div></div>
        <details className="cd-outline"><summary><svg className="cd-outline-chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg><b>提纲导航</b><span>{outline.outline.length} 个章节</span></summary><nav>{outline.outline.map(o=><button key={o.id} onClick={()=>cite({page:o.page,quote:o.highlight})}><b>{o.title}</b><span className="cd-outline-page">{pageLabel(o.page)}</span></button>)}</nav></details>
        <div className="cd-source-toolbar">
          <label><select aria-label="原文模式" value={sourceMode} onChange={e=>{const m=e.target.value as 'pdf'|'text';setSourceMode(m);if(m==='pdf')pageEnter.current='start';}}><option value="pdf">原始PDF</option><option value="text">原文文本</option></select></label>
          <label><select aria-label="跳转原文页码" value={sourcePage} onChange={e=>{readingPosition.current=null;pageEnter.current='start';setSourcePage(Number(e.target.value));setHighlight('');}}>{[...new Set([1,sourcePage,...(pageLabels.length?pageLabels:outline.pages).map(p=>p.page)])].sort((a,b)=>a-b).map(p=><option key={p} value={p}>{pageLabel(p)}</option>)}</select></label>
          <span className="cd-pdf-pick-hint">划词智析</span>
        </div>
        {!printedKnown && pageLabels.length>0 && <p className="cd-page-notice">这份 PDF 没能识别出正文页码，下面统一按 PDF 实际页数显示。</p>}
        <div className="cd-source-scroll" ref={sourceRef} aria-live="polite">
          {pick && <div className="cd-pick-bar" style={{ top: pick.y, left: pick.x }}>
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => addClip(pick.quote, pick.page)}>加入AI分析</button>
            <button type="button" className="cd-pick-cancel" onMouseDown={e => e.preventDefault()} onClick={() => { setPick(null); window.getSelection()?.removeAllRanges(); }}>取消</button>
          </div>}
          {highlight && <div className="cd-source-hit">已定位 · {pageDescription(sourcePage)}{resolvedPage!==null&&resolvedPage!==sourcePage?` · 已按引用原文校正至 PDF 第 ${resolvedPage} 页`:''}<small>{highlight.slice(0,100)}</small></div>}
          {citedMetric && <div className="cd-verify">
            <div><b>正在核验：{labels[citedMetric]}</b><small>{format(value(selected,citedMetric),citedMetric)}{citedCaveat?` · ${citedCaveat}`:' · 已通过人工复核'}</small></div>
            <div className="cd-verify-actions">
              <button className={feedback[citedMetric]==='correct'?'cd-verify-on':''} disabled={feedbackBusy} onClick={()=>void sendFeedback(citedMetric,'correct')}>✓ 与原文一致</button>
              <button className={feedback[citedMetric]==='wrong'?'cd-verify-off':''} disabled={feedbackBusy} onClick={()=>void sendFeedback(citedMetric,'wrong')}>⚠ 标记有误</button>
            </div>
            {feedbackError && <small className="cd-verify-hint cd-verify-error">{feedbackError}</small>}
            {feedback[citedMetric] && <small className="cd-verify-hint">{feedback[citedMetric]==='correct'?'已记录你的确认，累计确认会进入复核队列。':'已记录异议，该指标会被优先人工复核。'}</small>}
          </div>}
          {sourceMode==='pdf' ? <PdfEvidence key={`${selected.id}-${sourcePage}-${highlight}`} reportId={selected.id} page={sourcePage} quote={highlight} onResolvePage={setResolvedPage} onTextPick={onSourceTextPick} /> : <article className="cd-source-text"><div>{pageDescription(sourcePage)} · 划词智析</div>{sourceText ? <p>{highlightRange ? <>{sourceText.slice(0,highlightRange[0])}<mark>{sourceText.slice(...highlightRange)}</mark>{sourceText.slice(highlightRange[1])}</> : sourceText}</p> : <p>{loading?'正在读取原文…':'这一页没有可检索的文字（可能是扫描图片或表格）。'}</p>}</article>}
        </div><div className="cd-source-footer"><a href={`/api/reports/${encodeURIComponent(selected.id)}/pdf`} target="_blank" rel="noreferrer">打开原始 PDF ↗</a><button onClick={()=>{if(sourceDrawerOpen) closeSource();draftAsk(`请解释${pageDescription(sourcePage)}的核心信息。`);}} disabled={asking}>追问本页</button></div>
      </aside>
      </div>
      {!sourceCollapsed && <div className="cd-gutter" role="separator" aria-orientation="vertical" aria-label="调整来源栏宽度" onPointerDown={e=>onGutterDown('source', e)} onPointerMove={onGutterMove} onPointerUp={onGutterUp} onPointerCancel={onGutterUp} />}
      <main className={`cd-dashboard cd-pane ${mobilePane==='dashboard'?'mobile-active':''}`} aria-label="概览" style={{ flex: `${colRatios.middle} 1 0%`, minWidth: 360 }}>
        <div className="cd-pane-head"><h2><span>◫</span> 概览</h2><span>{period(selected)} · {selected.metrics.length && selected.metrics.every(m=>m.verified)?'已复核':'机器解析'}</span></div>
        <div className="cd-dashboard-scroll">
          <div className="cd-overview-top" ref={overviewRef}>
          {overviewPick && <div className="cd-pick-bar" style={{ top: overviewPick.y, left: overviewPick.x }}>
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => addFocus({ kind: overviewPick.kind, quote: overviewPick.quote, page: overviewPick.page, title: overviewPick.title })}>加入AI分析</button>
            <button type="button" className="cd-pick-cancel" onMouseDown={e => e.preventDefault()} onClick={() => { setOverviewPick(null); window.getSelection()?.removeAllRanges(); }}>取消</button>
          </div>}
          <section className="cd-brief" aria-label="本期结论">
            <h2 className="cd-brief-title">{briefSignal}</h2>
            <p className="cd-brief-insight">{briefInsightText}</p>
            <div className="cd-brief-actions">
              <button type="button" disabled={asking||memoryLoading} onClick={()=>draftAsk(topFinding ? `为什么${topFinding.headline}？请引用原文说明。` : '本期最值得关注的变化是什么？请给出原文页码。')}>追问本期</button>
            </div>
          </section>

          <div className="cd-metrics" aria-label="四项核心指标">{metricNames.map(m => {
            const d = deltas.find(x => x.metric === m)?.amount;
            const pill = d === undefined ? 'cd-pill-idle' : d < 0 ? 'cd-pill-down' : 'cd-pill-up';
            const delta = d === undefined ? '暂无同期比较' : `${baselineIsDefault ? '同比' : '较基准'} ${pct(d)}`;
            const f = findings.find(x => x.metric === m);
            return <article key={m} data-metric={m} className={`cd-focusable-card${f?.severity==='watch'?' cd-metric-watch':''}`} aria-label={labels[m]}>
              <div className="cd-metric-label">
                <span>{labels[m]}</span>
                <span className="cd-metric-tools">{footnote(m)}</span>
              </div>
              <strong>{amount(value(selected, m), m)}<i>{unitOf(m)}</i></strong>
              <span className={`cd-pill ${pill}`}>{delta}</span>
              {f && <small className="cd-metric-insight">{f.detail}</small>}
              {shaky.includes(m) && <small className="cd-caveat" title="本期或上年同期的解析置信度偏低，建议点角标核对原文">⚠ 口径待核对</small>}
            </article>;
          })}</div>
          {baselineOptions.length>0 && <div className="cd-baseline-row"><label>对比基准 <select aria-label="选择同比对比基准" value={previous?.id ?? ''} onChange={e=>setBaselineId(e.target.value||null)}><option value="">{defaultPrevious?`${period(defaultPrevious)}（上年同期）`:'暂无上年同期'}</option>{baselineOptions.filter(r=>r.id!==defaultPrevious?.id).map(r=><option key={r.id} value={r.id}>{period(r)}</option>)}</select></label>{!baselineIsDefault && previous && <span className="cd-note">当前以 {period(previous)} 为基准，非上年同期。</span>}</div>}
          </div>

          <section className="cd-card cd-trend-card" id="cd-trend"><div className="cd-card-head"><h3>比一比：核心指标趋势</h3><span>近 {Math.min(history.length,5)} 期 · 同类型财报</span><button type="button" disabled={asking||memoryLoading} onClick={pinTrendFocus}>智析</button></div><div className="cd-chart-tabs">{metricNames.map(m=><button key={m} className={metric===m?'active':''} onClick={()=>setMetric(m)}>{labels[m].split(' ')[0]}</button>)}<label className="cd-overlay">叠加 <select aria-label="叠加第二个指标" value={overlay??''} onChange={e=>setOverlay((e.target.value||null) as HeadlineMetric|null)}><option value="">不叠加</option>{metricNames.filter(m=>m!==metric).map(m=><option key={m} value={m}>{labels[m].split(' ')[0]}</option>)}</select></label></div><Trend reports={history} metric={metric} compare={overlay===metric?null:overlay} onSelect={selectReport}/>{overlay&&overlay!==metric&&<p className="cd-note">虚线为{labels[overlay]}，已按首期指数化到与{labels[metric]}同一刻度，只反映相对变化速度，不能读绝对值。</p>}</section>

          <details className="cd-more-analysis" id="cd-more">
            <summary><span>更多分析</span><small>同业雷达、关键比率、归因与明细表（按需展开）</small></summary>
            <div className="cd-overview-grid">
              <section className="cd-card"><div className="cd-card-head"><h3>关键比率</h3><span>本期绝对值 · 无评分</span><button type="button" disabled={asking||memoryLoading} onClick={pinRatiosFocus}>智析</button></div><div className="cd-health-list">
                {absolutes.map(h=><div className={`cd-health-row ${h.value===undefined?'cd-health-pending':''}`} key={h.label}><div><b>{h.label}{h.value!==undefined&&footnote(h.metric)}</b><small>{h.detail}</small></div><strong>{h.value===undefined?'—':h.value.toFixed(1)}<small>{h.value===undefined?'待解析':h.suffix}</small></strong></div>)}
              </div><div className="cd-health-list cd-health-relative">
                {relatives.map(h=><div className={`cd-health-row ${h.standing?'':'cd-health-pending'}`} key={h.label}><div><b>{h.label}</b><small>{h.detail}</small></div><strong>{h.standing?`第 ${h.standing.rank}`:'—'}<small>{h.standing?` / ${h.standing.total} 家`:'样本不足'}</small></strong></div>)}
              </div><p className="cd-note">比率直接由已解析原文行计算，缺一行即不计算。排序仅覆盖同报告期已入库公司，不是完整行业排名，也不是信用评级。</p></section>
              <section className="cd-card" id="cd-radar"><div className="cd-card-head"><h3>同业对比雷达</h3><div className="cd-card-tools"><button type="button" disabled={asking||memoryLoading} onClick={pinRadarFocus}>智析</button><button onClick={()=>focusModule('peers')}>查看明细</button></div></div><Radar peers={peers} code={selected.code}/></section>
            </div>
            <div className="cd-more-title"><h3>深入模块</h3><span>空模块不编造数字</span></div>
            {Object.entries(moduleLabels).map(([id,label],index)=><section id={`cd-${id}`} className={`cd-module ${focused===id?'cd-focused':''}`} key={id}><button className="cd-module-toggle" aria-expanded={expanded.includes(id)} aria-controls={`cd-content-${id}`} onClick={()=>setExpanded(e=>e.includes(id)?e.filter(x=>x!==id):[...e,id])}><span className="cd-module-number">0{index+1}</span><div><h3>{label}</h3><p>{id==='business'?'按业务、产品与地区阅读收入构成':id==='attribution'?'恒等式分解 + 管理层原文自述':id==='anomalies'?`${changes.filter(d=>Math.abs(d.amount!)>=30).length} 项指标同比波动超过 30%`:id==='history'?`${history.length} 期同类型报告可供查看`:`${peerCodes.length} 家同报告期覆盖公司`}</p></div><span>{expanded.includes(id)?'−':'＋'}</span></button>
            {expanded.includes(id) && <div className="cd-module-content" id={`cd-content-${id}`}>
              {id==='business' && <><div className="cd-empty">还没有解析分部报表，所以暂时不画业务占比图——避免给出不可核验的比例。可以先从下面的原文章节直接读。</div>{outline.outline.filter(o=>/业务|经营|管理层/.test(o.title)).slice(0,4).map(o=><button className="cd-source-link" key={o.id} onClick={()=>cite({page:o.page,quote:o.highlight})}>{o.title} <span>原文 {pageLabel(o.page)}</span></button>)}</>}
              {id==='attribution' && (bridge ? <><p className="cd-note">与 {previous && period(previous)} 同比。采用“收入 × 归母净利率”两因素恒等分解，非因果推断。</p><div className="cd-waterfall" role="img" aria-label={`净利润变化：收入贡献${format(bridge.revenueEffect,'net_profit')}，归母净利率贡献${format(bridge.marginEffect,'net_profit')}`}>
                {(()=>{const bars=[{label:'上年同期',start:0,end:bridge.previousProfit,amount:bridge.previousProfit},{label:'收入贡献',start:bridge.previousProfit,end:bridge.previousProfit+bridge.revenueEffect,amount:bridge.revenueEffect},{label:'净利率贡献',start:bridge.previousProfit+bridge.revenueEffect,end:bridge.profit,amount:bridge.marginEffect},{label:'本期净利润',start:0,end:bridge.profit,amount:bridge.profit}];const low=Math.min(0,...bars.flatMap(b=>[b.start,b.end])),high=Math.max(0,...bars.flatMap(b=>[b.start,b.end])),span=high-low||1;return bars.map((b,i)=><div key={b.label}><span>{format(b.amount,'net_profit')}</span><div className="cd-waterfall-track"><i style={{bottom:`${(Math.min(b.start,b.end)-low)/span*100}%`,height:`${Math.max(Math.abs(b.end-b.start)/span*100,1)}%`,background:i===0||i===3?'#3064db':b.amount<0?'#da9561':'#239f8c'}}/></div><small>{b.label}{i===3&&footnote('net_profit')}</small></div>);})()}</div><p className="cd-note">归母净利率 = 归母净利润 ÷ 营业收入。成本、费用、税率与少数股东损益变动均包含于净利率贡献；缺少明细时不做额外分摊。</p>{mdaSection ? <div className="cd-mda"><div className="cd-mda-head"><b>公司自述（管理层讨论与分析）</b><button data-source-jump onClick={()=>cite({page:mdaSection.page,quote:mdaSection.highlight})}>读全文 {pageLabel(mdaSection.page)}</button></div><p>{mdaExcerpt}</p><small>以上为原文摘录，未经改写。数字分解与公司自述原因应分开看待。</small></div> : <p className="cd-note">该报告尚未识别到管理层讨论章节，暂无公司自述原因可对照。</p>}</> : <div className="cd-empty">缺少本期或上年同期的营收或归母净利润，没法做可核验的分解。可以直接读管理层讨论章节，或在右侧对话里追问。</div>)}
              {id==='anomalies' && (changes.length ? changes.map(d=><div className="cd-change-row" key={d.metric}><span>{labels[d.metric]}{footnote(d.metric)}</span><b className={Math.abs(d.amount!)>=30?'cd-negative':''}>{pct(d.amount)} 同比{Math.abs(d.amount!)>=30?' · 需关注':''}</b></div>) : <div className="cd-empty">还没有上年同期数据，所以暂不判定异常。规则是同比变化超过 30% 才提示，且只和同类型财报比较。</div>)}
              {id==='history' && <div className="cd-table-scroll"><table><thead><tr><th>报告期</th>{metricNames.map(m=><th key={m}>{labels[m]}</th>)}</tr></thead><tbody>{history.map(r=><tr key={r.id}><th><button onClick={()=>selectReport(r)}>{period(r)}</button></th>{metricNames.map(m=><td key={m}>{format(value(r,m),m)}</td>)}</tr>)}</tbody></table></div>}
              {id==='peers' && (peerCodes.length ? <><p className="cd-note">仅比较 {period(selected)} 同类型报告；绿色通道覆盖范围，非完整行业排名。</p><div className="cd-table-scroll"><table><thead><tr><th>公司</th>{metricNames.map(m=><th key={m}>{labels[m]}</th>)}</tr></thead><tbody>{peerCodes.map(code=><tr key={code} className={code===selected.code?'cd-self':''}><th>{peers.find(p=>p.code===code)?.company_name}{code===selected.code?' · 本公司':''}</th>{metricNames.map(m=><td key={m}>{format(peers.find(p=>p.code===code&&p.metric===m)?.value,m)}</td>)}</tr>)}</tbody></table></div></> : <div className="cd-empty">同报告期还没有其他公司入库，暂时无法对比。</div>)}
            </div>}</section>)}
          </details>
          <p className="cd-data-note">数据来自已解析财报 · 数字旁角标可定位原文 · 未复核指标请结合 PDF 核验</p>
        </div>
      </main>
      {!chatCollapsed && <div className="cd-gutter" role="separator" aria-orientation="vertical" aria-label="调整对话栏宽度" onPointerDown={e=>onGutterDown('chat', e)} onPointerMove={onGutterMove} onPointerUp={onGutterUp} onPointerCancel={onGutterUp} />}
      <aside id="cd-chat-panel" className={`cd-chat cd-pane ${mobilePane==='chat'?'mobile-active':''}`} aria-label="财报对话" style={!chatCollapsed ? { flex: `${colRatios.chat} 1 0%`, minWidth: 220 } : undefined}>
        <div className="cd-pane-head"><h2><span>✧</span> 追问</h2><div className="cd-chat-actions"><button aria-label="新建对话" title="新建对话" disabled={asking||memoryLoading} onClick={()=>void newConversation()}>+</button><button className="cd-dock" aria-label="收起对话" title="收起对话" onClick={()=>{setChatCollapsed(true);setMobilePane('dashboard');}}><DockIcon side="right" /></button></div></div>
        <div className="cd-chat-scroll"><div className="cd-assistant-label"><span>✧</span><b>追问本期</b><small>答案需带出处</small></div>
          <p className="cd-chat-lead">中间栏已经给出结论与发现。这里继续追问原因、对比或原文依据；没有证据时会明确说明。</p>
          <div className="cd-suggest-label">推荐追问</div><div className="cd-suggestions">{suggestions.map(q=><button key={q} disabled={asking} onClick={()=>draftAsk(q)}>{q}<span>↗</span></button>)}</div>
          {messages.length>0&&<div className="cd-conversation-label">围绕 {period(selected)} 的对话</div>}
          {messages.map((m,i)=><div key={i} className={`cd-message cd-message-${m.role}`}>{m.role==='assistant'&&<b className="cd-answer-label">✧ 财报助手</b>}<p>{m.role==='assistant'?renderAnswer(m):m.text}{!m.text&&asking?(thinking?'模型正在推理，请稍候…':'正在检索财报证据…'):''}</p>
            {m.role==='assistant'&&(m.followupBusy||m.followups?.length)?<div className="cd-followups"><small>{m.followupBusy?'正在生成相关追问…':'继续追问'}</small>{m.followups?.length?<div className="cd-followup-list">{m.followups.map(q=><button key={q} disabled={asking} onClick={()=>draftAsk(q)}>{q}<span>↗</span></button>)}</div>:null}</div>:null}</div>)}<div ref={chatEnd}/>
        </div><form className="cd-chat-input" onSubmit={e=>{e.preventDefault();void ask(question);}}>
          {clipToast && <div className="cd-clip-toast" role="status">{clipToast}</div>}
          {clips.length>0 && <div className={`cd-clips ${clipsFlash?'cd-clips-flash':''}`} aria-label="AI分析关注">
            <ul>{clips.map(c => <li key={c.id}><span>{clipChipLabel(c)}</span><button type="button" aria-label="移除" onClick={()=>removeClip(c.id)}>×</button></li>)}</ul>
          </div>}
          <div className="cd-composer"><textarea ref={questionRef} aria-label="向财报助手提问" placeholder="随意划词，灵活追问" rows={1} value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void ask(question);}}}/><button aria-label="发送问题" disabled={asking||memoryLoading||(!question.trim()&&!clips.length)} type="submit">{asking?'…':<svg className="cd-send-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 4l7 7h-4v9H9v-9H5z"/></svg>}</button></div>
          {memoryLoading && <small>正在恢复历史会话…</small>}</form>
      </aside>
      {sourceCollapsed && <div className="cd-rail cd-rail-left"><button aria-label="展开来源栏" title="展开来源栏" aria-expanded={false} aria-controls="cd-source-panel" onClick={()=>{setSourceCollapsed(false);setMobilePane('sources');}}><DockIcon side="left" /></button><span>来源</span></div>}
      {chatCollapsed && <div className="cd-rail cd-rail-right"><button aria-label="展开对话" title="展开对话" aria-expanded={false} aria-controls="cd-chat-panel" onClick={()=>{setChatCollapsed(false);setMobilePane('chat');}}><DockIcon side="right" /></button><span>对话</span></div>}
    </div>
  </section>;
}
