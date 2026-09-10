'use client';

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { amount, cashConversion, change, comparableHistory, debtRatio, format, grossMargin, keyFindings, labels, metricNames, moduleForQuestion, period, periodKey, priorYear, profitBridge, sourceRange, unitOf, value, type Citation, type HeadlineMetric, type MetricName, type Report } from '@/lib/detail-model';
import { type PdfPageLabel } from '@/lib/pdf-pages';
import PdfEvidence from './pdf-evidence';
import './company-detail.css';

type Outline = { pageLabels?: PdfPageLabel[]; indexedPages: number; pages: { page: number; content: string }[]; outline: { id: string; title: string; page: number; highlight: string }[] };
type Peer = { code: string; company_name: string; metric: string; value: number; unit: string };
type Analysis = { peers?: Peer[]; industry?: string };
// Follow-ups belong to the answer that produced them, so they travel on the message
// itself and survive a period switch together with the conversation.
type Message = { role: 'user' | 'assistant'; text: string; citations?: Citation[]; followups?: string[]; followupBusy?: boolean };
const emptyOutline: Outline = { indexedPages: 0, pages: [], outline: [] };
const moduleLabels = { business: '主营业务构成', attribution: '净利润变动分解', anomalies: '异常指标提示', history: '历史趋势详情', peers: '同业对比表格' };
const suggestions = ['净利润变化的主要原因是什么？', '和同行比处于什么水位？', '主营业务收入如何构成？', '本期有哪些异常指标？'];
// Material Symbols "dock to left" / "dock to right", inlined to avoid a font request.
const dockPaths = {
  left: 'M120-120q-33 0-56.5-23.5T40-200v-560q0-33 23.5-56.5T120-840h720q33 0 56.5 23.5T920-760v560q0 33-23.5 56.5T840-120H120Zm200-80h520v-560H320v560Zm-80 0v-560H120v560h120Z',
  right: 'M120-120q-33 0-56.5-23.5T40-200v-560q0-33 23.5-56.5T120-840h720q33 0 56.5 23.5T920-760v560q0 33-23.5 56.5T840-120H120Zm0-80h520v-560H120v560Zm600 0h120v-560H720v560Z',
};
function DockIcon({ side }: { side: 'left' | 'right' }) {
  return <svg className="cd-dock-icon" viewBox="0 -960 960 960" aria-hidden="true" focusable="false"><path d={dockPaths[side]} /></svg>;
}
const pct = (n: number | undefined) => n === undefined ? '暂无同期数据' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

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
  // The briefing column is the primary view, so the source rail starts docked.
  const [sourceCollapsed, setSourceCollapsed] = useState(true);
  const [resolvedPage, setResolvedPage] = useState<number | null>(null);
  const [citedMetric, setCitedMetric] = useState<MetricName | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');
  const [chatCollapsed, setChatCollapsed] = useState(false);
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

  function selectReport(report: Report) {
    setReportListOpen(false);
    if (report.id === activeId.current) return;
    requestRef.current?.abort(); busyRef.current = false;
    memoryReady.current = false; setMessages([]); setMemoryLoading(true);
    activeId.current = report.id;
    setSelected(report); onSelect(report.id); setQuestion(''); setAsking(false); setSummary(null); setBaselineId(null);
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
        if (!id) return;
        const detail = await fetch(`/api/conversations/${id}`, { signal: abort.signal, cache: 'no-store' });
        if (!detail.ok) throw new Error();
        const payload = await detail.json() as { messages: Array<{ role: 'user' | 'assistant'; content: string; evidence: Citation[]; status: string }> };
        if (abort.signal.aborted) return;
        conversationIds.current.set(selected.id, id);
        setMessages(payload.messages.map(m => ({ role: m.role, text: m.content || (m.role === 'assistant' ? '这次回答尚未完成，可重新提问。' : ''), citations: m.evidence })));
      } catch { if (!abort.signal.aborted) setError('历史会话暂未加载。首次启用会话记忆时，请退出并重新登录。'); }
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
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const hit = sourceRef.current?.querySelector('mark');
      if (sourceMode === 'text' && hit) hit.scrollIntoView({ block: 'center', behavior: 'smooth' });
      else sourceRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [sourcePage, highlight, sourceMode]);

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
  const mdaSection = outline.outline.find(o => o.id === 'mda');
  const mdaExcerpt = mdaSection ? (outline.pages.find(p => p.page === mdaSection.page)?.content ?? '').slice(0, 420) : '';
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
    if (expand || sourceDrawerOpen) { openSource(); sourceRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }
  }
  function metricCitation(m: MetricName, report = selected) { const item = report.metrics.find(x => x.metric === m); return item?.source_page ? { page: item.source_page, quote: item.source_label ?? labels[m] } : null; }
  function footnote(m: MetricName) { const c = metricCitation(m); return c && <button className="cd-cite" onClick={() => cite(c, false, m)} onDoubleClick={() => cite(c, true, m)} title={`单击预览${labels[m]}原文，双击展开原文，${pageDescription(c.page)}`}>[{pageLabel(c.page)}]</button>; }
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
  function citationLink(c: Citation, key: string | number) {
    return c.reportId && c.reportId !== selected.id
      ? <a className="cd-cite" key={key} href={`/api/reports/${encodeURIComponent(c.reportId)}/pdf#page=${c.page}`} target="_blank" rel="noreferrer" title={c.quote}>[{c.companyName} {c.period} PDF {c.page}]</a>
      : <button className="cd-cite" key={key} title={`${pageDescription(c.page)}：${c.quote}`} onClick={() => cite(c)} onDoubleClick={() => cite(c, true)}>[{pageLabel(c.page)}]</button>;
  }
  function renderAnswer(message: Message) {
    return message.text.split(/(【(?:E\d+|第\s*\d+\s*页)】)/g).map((part,i) => {
      const p = part.match(/^【(?:E(\d+)|第\s*(\d+)\s*页)】$/); if (!p) return <Fragment key={i}>{part}</Fragment>;
      const c = message.citations?.find(c => p[1] ? c.id === `E${p[1]}` : c.page === Number(p[2]));
      return c ? citationLink(c, i) : <span className="cd-note" key={i}>{part}（待核验）</span>;
    });
  }
  function focusModule(id: string) { if (sourceDrawerOpen) closeSource(); setExpanded(e => e.includes(id) ? e : [...e,id]); setFocused(id); setMobilePane('dashboard'); window.setTimeout(() => document.getElementById(`cd-${id}`)?.scrollIntoView({ behavior:'smooth', block:'center' }), 80); }
  function askAbout(topic: string, context: string) {
    setChatCollapsed(false); setMobilePane('chat');
    void ask(`${topic}（当前数据：${context}）`);
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
  async function ask(text: string) {
    const clean = text.trim(); if (!clean || busyRef.current || !memoryReady.current) return;
    const controller = new AbortController(); requestRef.current = controller; busyRef.current = true;
    const id = selected.id;
    const asked = messages.filter(m => m.role === 'user').map(m => m.text);
    const slot = messages.length + 1;
    setAsking(true); setThinking(false); setQuestion(''); setMessages(m => [...m,{ role:'user',text:clean },{ role:'assistant',text:'' }]);
    const targetModule = moduleForQuestion(clean); if (targetModule) focusModule(targetModule);
    let answer = '';
    function update(citations?: Citation[]) { if (activeId.current !== id || controller.signal.aborted) return; setMessages(m => m.map((item,i) => i === m.length-1 ? { ...item, text:answer, ...(citations ? { citations } : {}) } : item)); }
    try {
      let conversationId = conversationIds.current.get(id);
      if (!conversationId) {
        const created = await fetch('/api/conversations', { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reportId: id }) });
        const payload = await created.json() as { conversation?: { id: string }; error?: string };
        if (!created.ok || !payload.conversation) throw new Error(payload.error ?? '会话创建失败');
        conversationId = payload.conversation.id; conversationIds.current.set(id, conversationId);
      }
      const response = await fetch('/api/chat', { method:'POST', signal:controller.signal, headers:{ 'content-type':'application/json' },body:JSON.stringify({ reportId:id,conversationId,requestId:crypto.randomUUID(),question:clean,stream:true }) });
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
    if (activeId.current === id && !controller.signal.aborted && answer) void loadFollowups(id, slot, clean, answer, asked);
  }
  async function newConversation() {
    if (busyRef.current || !memoryReady.current) return;
    const id = selected.id;
    busyRef.current = true; setAsking(true);
    try {
      const response = await fetch('/api/conversations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reportId: id }) });
      const payload = await response.json() as { conversation?: { id: string }; error?: string };
      if (!response.ok || !payload.conversation) throw new Error(payload.error ?? '新建会话失败');
      conversationIds.current.set(id, payload.conversation.id);
      if (activeId.current === id) setMessages([]);
    } catch (error) { if (activeId.current === id) setError(error instanceof Error ? error.message : '新建会话失败'); }
    finally { if (activeId.current === id) { busyRef.current = false; setAsking(false); } }
  }
  const sourceText = outline.pages.find(p => p.page === sourcePage)?.content;
  const highlightRange = sourceText ? sourceRange(sourceText, highlight) : null;
  return <section className={`company-workspace ${sourceDrawerOpen?'cd-reading-open':''} ${chatCollapsed?'cd-chat-collapsed':''} ${sourceCollapsed&&!sourceDrawerOpen?'cd-source-collapsed':''}`} >
    <header className="cd-company-head"><div className="cd-company-identity"><button className="cd-back" onClick={onBack} aria-label="返回公司列表">←</button><div className="cd-monogram">{selected.company_name.slice(0,1)}</div><div className="cd-company-meta"><h1>{selected.company_name}<span>{selected.code}</span></h1><p>{selected.industry} <span>／</span> {period(selected)} <span>／</span> {selected.report_type === 'annual' ? '年度报告' : selected.report_type === 'semiannual' ? '半年度报告' : '季度报告'}</p></div></div><div className="cd-head-actions"><span className="cd-status"><i />{selected.metrics.length} 项指标已解析</span>{onApprove && selected.status !== 'online' && <button className="cd-button" onClick={() => onApprove(selected.id)}>复核上线</button>}</div></header>
    {error && <div role="alert" className="cd-error">{error}</div>}
    <nav className="cd-mobile-tabs" aria-label="详情页分栏">{[['sources','来源'],['dashboard','数据概览'],['chat','对话']].map(([id,label]) => <button key={id} className={mobilePane===id?'active':''} onClick={()=>{setMobilePane(id);if(id==='chat')setChatCollapsed(false);if(id==='sources')setSourceCollapsed(false);}}>{label}</button>)}</nav>
    <div className="cd-columns">
      <div id="cd-source-panel" className={`cd-source-slot ${mobilePane==='sources'?'mobile-active':''}`}>
      <aside className={`cd-sources cd-pane ${sourceDrawerOpen?'cd-source-drawer':''}`} role={sourceDrawerOpen?'dialog':undefined} aria-modal={sourceDrawerOpen?false:undefined} aria-label={sourceDrawerOpen?'财报原文阅读抽屉':'财报来源'} ref={sourcePaneRef}>
        <div className="cd-pane-head"><h2><span>▤</span> {sourceDrawerOpen?'财报原文':'来源'}</h2><div className="cd-pane-tools">{sourceDrawerOpen ? <button className="cd-source-expand" ref={drawerCloseRef} onClick={()=>closeSource()} aria-label="收起原文抽屉">← 收起原文</button> : <><button className="cd-source-expand" onClick={openSource} aria-haspopup="dialog">展开原文 ↗</button><button className="cd-dock" aria-label="收起来源栏" title="收起来源栏" aria-controls="cd-source-panel" onClick={()=>{setSourceCollapsed(true);setMobilePane('dashboard');}}><DockIcon side="left" /></button></>}</div></div>
        <button className="cd-report-picker" aria-expanded={reportListOpen} aria-controls="cd-report-periods" onClick={()=>setReportListOpen(open=>!open)}><span className="cd-file-icon">PDF</span><span><b>{period(selected)} {selected.report_type==='annual'?'年报':selected.report_type==='semiannual'?'中报':'季报'}</b><small>{selected.id===reports[0]?.id?'最新财报':'当前报告'} · 共 {reports.length} 份</small></span><span className="cd-picker-chevron" aria-hidden="true">{reportListOpen?'⌃':'⌄'}</span></button>
        {reportListOpen && <div className="cd-report-list" id="cd-report-periods" aria-label="选择报告期">{reports.map((r,i) => <button key={r.id} aria-pressed={r.id===selected.id} className={r.id===selected.id?'selected':''} onClick={()=>selectReport(r)}><span className="cd-file-icon">PDF</span><span><b>{period(r)} {r.report_type==='annual'?'年报':r.report_type==='semiannual'?'中报':'季报'}</b><small>{r.metrics.length} 项指标 · {r.parsed_at?'已解析':'解析中'}</small></span>{i===0 && <em>最新</em>}</button>)}</div>}
        <details className="cd-outline"><summary>提纲导航 <span>{outline.outline.length} 个章节</span></summary><nav>{outline.outline.map(o=><button key={o.id} onClick={()=>cite({page:o.page,quote:o.highlight})}>{o.title}<span>{pageLabel(o.page)}</span></button>)}</nav></details>
        <div className="cd-source-toolbar"><div className="cd-segment"><button className={sourceMode==='pdf'?'active':''} onClick={()=>setSourceMode('pdf')}>PDF</button><button className={sourceMode==='text'?'active':''} onClick={()=>setSourceMode('text')}>原文文本</button></div><label>{printedKnown?'正文页':'PDF 页'} <select aria-label="跳转原文页码" value={sourcePage} onChange={e=>{readingPosition.current=null;setSourcePage(Number(e.target.value));setHighlight('');}}>{[...new Set([1,sourcePage,...(pageLabels.length?pageLabels:outline.pages).map(p=>p.page)])].sort((a,b)=>a-b).map(p=><option key={p} value={p}>{pageLabel(p)}</option>)}</select></label></div>
        {!printedKnown && pageLabels.length>0 && <p className="cd-page-notice">这份 PDF 没能识别出正文页码，下面统一按 PDF 实际页数显示。</p>}
        <div className="cd-source-scroll" ref={sourceRef} aria-live="polite">
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
          {sourceMode==='pdf' && <PdfEvidence key={`${selected.id}-${sourcePage}-${highlight}`} reportId={selected.id} page={sourcePage} quote={highlight} onResolvePage={setResolvedPage} />}
          <article className="cd-source-text"><div>{pageDescription(sourcePage)} · 原文索引</div>{sourceText ? <p>{highlightRange ? <>{sourceText.slice(0,highlightRange[0])}<mark>{sourceText.slice(...highlightRange)}</mark>{sourceText.slice(highlightRange[1])}</> : sourceText}</p> : <p>{loading?'正在读取原文…':'这一页没有可检索的文字（可能是扫描图片或表格），请直接看上方 PDF 原版。'}</p>}</article>
        </div><div className="cd-source-footer"><a href={`/api/reports/${encodeURIComponent(selected.id)}/pdf`} target="_blank" rel="noreferrer">打开原始 PDF ↗</a><button onClick={()=>{if(sourceDrawerOpen) closeSource();setMobilePane('chat');setChatCollapsed(false);void ask(`请解释${pageDescription(sourcePage)}的核心信息。`);}} disabled={asking}>追问本页 ↗</button></div>
      </aside>
      </div>
      <main className={`cd-dashboard cd-pane ${mobilePane==='dashboard'?'mobile-active':''}`} aria-label="公司数据仪表盘">
        <div className="cd-pane-head"><h2><span>◫</span> 数据概览</h2><span>{period(selected)} · {selected.metrics.length && selected.metrics.every(m=>m.verified)?'已复核':'机器解析'}</span></div>
        <div className="cd-dashboard-scroll">
          <div className="cd-section-intro"><div><span className="cd-eyebrow">PERFORMANCE SNAPSHOT</span><h2>本期经营，一眼看清</h2></div><div className="cd-baseline"><span className="cd-muted">金额单位：人民币亿元 · 比率为 %</span>{baselineOptions.length>0 && <label>对比基准 <select aria-label="选择同比对比基准" value={previous?.id ?? ''} onChange={e=>setBaselineId(e.target.value||null)}><option value="">{defaultPrevious?`${period(defaultPrevious)}（上年同期）`:'暂无上年同期'}</option>{baselineOptions.filter(r=>r.id!==defaultPrevious?.id).map(r=><option key={r.id} value={r.id}>{period(r)}</option>)}</select></label>}</div></div>
          {!baselineIsDefault && previous && <p className="cd-note cd-baseline-note">当前同比以 {period(previous)} 为基准，非上年同期，请注意口径差异。</p>}
          <section className="cd-findings" aria-label="本期关键发现">
            <div className="cd-findings-head"><h3>本期关键发现</h3><span>{findings.length?`按变化幅度排序 · 共 ${findings.length} 条`:'暂无可比结论'}</span></div>
            {findings.length ? <ol>{findings.map(f=>{const c=metricCitation(f.metric);return <li key={f.id} className={f.severity==='watch'?'cd-finding-watch':''}>
              <div><b>{f.headline}</b><small>{f.detail}</small></div>
              <div className="cd-finding-actions"><button onClick={()=>focusModule(f.module)}>看分析 ↗</button>{c && <button data-source-jump onClick={()=>cite(c)} title={pageDescription(c.page)}>看原文 {pageLabel(c.page)} ↗</button>}</div>
            </li>;})}</ol> : <p className="cd-empty">还没有上年同期数据，所以这里先不给结论。等同期财报入库后会自动生成。</p>}
          </section>
          <div className="cd-metrics">{metricNames.map(m => { const d=deltas.find(x=>x.metric===m)?.amount;return <article key={m}><div className="cd-metric-label"><span>{labels[m]}</span>{footnote(m)}</div><strong>{amount(value(selected,m),m)}<i>{unitOf(m)}</i></strong><span className={`cd-pill ${d===undefined?'cd-pill-idle':d<0?'cd-pill-down':'cd-pill-up'}`}>{d===undefined?'暂无同期比较':`同比 ${pct(d)}`}</span>{shaky.includes(m)&&<small className="cd-caveat" title="本期或上年同期的解析置信度偏低，建议点角标核对原文">⚠ 口径待核对</small>}</article>; })}</div>
          <section className="cd-card cd-trend-card"><div className="cd-card-head"><h3>核心指标趋势</h3><span>近 {Math.min(history.length,5)} 期 · 同类型财报</span><button onClick={()=>askAbout(`请解读${labels[metric]}近${Math.min(history.length,5)}期的走势`,history.slice(-5).map(r=>`${period(r)} ${format(value(r,metric),metric)}`).join('、'))}>问这张图 ↗</button></div><div className="cd-chart-tabs">{metricNames.map(m=><button key={m} className={metric===m?'active':''} onClick={()=>setMetric(m)}>{labels[m].split(' ')[0]}</button>)}<label className="cd-overlay">叠加 <select aria-label="叠加第二个指标" value={overlay??''} onChange={e=>setOverlay((e.target.value||null) as HeadlineMetric|null)}><option value="">不叠加</option>{metricNames.filter(m=>m!==metric).map(m=><option key={m} value={m}>{labels[m].split(' ')[0]}</option>)}</select></label></div><Trend reports={history} metric={metric} compare={overlay===metric?null:overlay} onSelect={selectReport}/>{overlay&&overlay!==metric&&<p className="cd-note">虚线为{labels[overlay]}，已按首期指数化到与{labels[metric]}同一刻度，只反映相对变化速度，不能读绝对值。</p>}</section>
          <div className="cd-overview-grid">
            <section className="cd-card"><div className="cd-card-head"><h3>关键比率</h3><span>本期绝对值 · 无评分</span><button onClick={()=>askAbout('请结合原文解释这些比率的合理性',absolutes.filter(a=>a.value!==undefined).map(a=>`${a.label} ${a.value!.toFixed(1)}${a.suffix}`).join('、')||'暂无可用比率')}>问这张卡 ↗</button></div><div className="cd-health-list">
              {absolutes.map(h=><div className={`cd-health-row ${h.value===undefined?'cd-health-pending':''}`} key={h.label}><div><b>{h.label}{h.value!==undefined&&footnote(h.metric)}</b><small>{h.detail}</small></div><strong>{h.value===undefined?'—':h.value.toFixed(1)}<small>{h.value===undefined?'待解析':h.suffix}</small></strong></div>)}
            </div><div className="cd-health-list cd-health-relative">
              {relatives.map(h=><div className={`cd-health-row ${h.standing?'':'cd-health-pending'}`} key={h.label}><div><b>{h.label}</b><small>{h.detail}</small></div><strong>{h.standing?`第 ${h.standing.rank}`:'—'}<small>{h.standing?` / ${h.standing.total} 家`:'样本不足'}</small></strong></div>)}
            </div><p className="cd-note">比率直接由已解析原文行计算，缺一行即不计算。排序仅覆盖同报告期已入库公司，不是完整行业排名，也不是信用评级。</p></section>
            <section className="cd-card" id="cd-radar"><div className="cd-card-head"><h3>同业对比雷达</h3><div className="cd-card-tools"><button onClick={()=>askAbout('请说明本公司在这些同业维度上的相对位置',`覆盖 ${peerCodes.length} 家同报告期公司`)}>问这张图 ↗</button><button onClick={()=>focusModule('peers')}>查看明细 ↗</button></div></div><Radar peers={peers} code={selected.code}/></section>
          </div>
          <div className="cd-more-title"><h3>深入分析</h3><span>按需展开，或让助手带你看</span></div>
          {Object.entries(moduleLabels).map(([id,label],index)=><section id={`cd-${id}`} className={`cd-module ${focused===id?'cd-focused':''}`} key={id}><button className="cd-module-toggle" aria-expanded={expanded.includes(id)} aria-controls={`cd-content-${id}`} onClick={()=>setExpanded(e=>e.includes(id)?e.filter(x=>x!==id):[...e,id])}><span className="cd-module-number">0{index+1}</span><div><h3>{label}</h3><p>{id==='business'?'按业务、产品与地区阅读收入构成':id==='attribution'?'恒等式分解 + 管理层原文自述':id==='anomalies'?`${changes.filter(d=>Math.abs(d.amount!)>=30).length} 项指标同比波动超过 30%`:id==='history'?`${history.length} 期同类型报告可供查看`:`${peerCodes.length} 家同报告期覆盖公司`}</p></div><span>{expanded.includes(id)?'−':'＋'}</span></button>
          {expanded.includes(id) && <div className="cd-module-content" id={`cd-content-${id}`}>
            {id==='business' && <><div className="cd-empty">还没有解析分部报表，所以暂时不画业务占比图——避免给出不可核验的比例。可以先从下面的原文章节直接读。</div>{outline.outline.filter(o=>/业务|经营|管理层/.test(o.title)).slice(0,4).map(o=><button className="cd-source-link" key={o.id} onClick={()=>cite({page:o.page,quote:o.highlight})}>{o.title} <span>原文 {pageLabel(o.page)} ↗</span></button>)}</>}
            {id==='attribution' && (bridge ? <><p className="cd-note">与 {previous && period(previous)} 同比。采用“收入 × 归母净利率”两因素恒等分解，非因果推断。</p><div className="cd-waterfall" role="img" aria-label={`净利润变化：收入贡献${format(bridge.revenueEffect,'net_profit')}，归母净利率贡献${format(bridge.marginEffect,'net_profit')}`}>
              {(()=>{const bars=[{label:'上年同期',start:0,end:bridge.previousProfit,amount:bridge.previousProfit},{label:'收入贡献',start:bridge.previousProfit,end:bridge.previousProfit+bridge.revenueEffect,amount:bridge.revenueEffect},{label:'净利率贡献',start:bridge.previousProfit+bridge.revenueEffect,end:bridge.profit,amount:bridge.marginEffect},{label:'本期净利润',start:0,end:bridge.profit,amount:bridge.profit}];const low=Math.min(0,...bars.flatMap(b=>[b.start,b.end])),high=Math.max(0,...bars.flatMap(b=>[b.start,b.end])),span=high-low||1;return bars.map((b,i)=><div key={b.label}><span>{format(b.amount,'net_profit')}</span><div className="cd-waterfall-track"><i style={{bottom:`${(Math.min(b.start,b.end)-low)/span*100}%`,height:`${Math.max(Math.abs(b.end-b.start)/span*100,1)}%`,background:i===0||i===3?'#3064db':b.amount<0?'#da9561':'#239f8c'}}/></div><small>{b.label}{i===3&&footnote('net_profit')}</small></div>);})()}</div><p className="cd-note">归母净利率 = 归母净利润 ÷ 营业收入。成本、费用、税率与少数股东损益变动均包含于净利率贡献；缺少明细时不做额外分摊。</p>{mdaSection ? <div className="cd-mda"><div className="cd-mda-head"><b>公司自述（管理层讨论与分析）</b><button data-source-jump onClick={()=>cite({page:mdaSection.page,quote:mdaSection.highlight})}>读全文 {pageLabel(mdaSection.page)} ↗</button></div><p>{mdaExcerpt}</p><small>以上为原文摘录，未经改写。数字分解与公司自述原因应分开看待。</small></div> : <p className="cd-note">该报告尚未识别到管理层讨论章节，暂无公司自述原因可对照。</p>}</> : <div className="cd-empty">缺少本期或上年同期的营收或归母净利润，没法做可核验的分解。可以直接读管理层讨论章节，或在右侧对话里追问。</div>)}
            {id==='anomalies' && (changes.length ? changes.map(d=><div className="cd-change-row" key={d.metric}><span>{labels[d.metric]}{footnote(d.metric)}</span><b className={Math.abs(d.amount!)>=30?'cd-negative':''}>{pct(d.amount)} 同比{Math.abs(d.amount!)>=30?' · 需关注':''}</b></div>) : <div className="cd-empty">还没有上年同期数据，所以暂不判定异常。规则是同比变化超过 30% 才提示，且只和同类型财报比较。</div>)}
            {id==='history' && <div className="cd-table-scroll"><table><thead><tr><th>报告期</th>{metricNames.map(m=><th key={m}>{labels[m]}</th>)}</tr></thead><tbody>{history.map(r=><tr key={r.id}><th><button onClick={()=>selectReport(r)}>{period(r)} ↗</button></th>{metricNames.map(m=><td key={m}>{format(value(r,m),m)}</td>)}</tr>)}</tbody></table></div>}
            {id==='peers' && (peerCodes.length ? <><p className="cd-note">仅比较 {period(selected)} 同类型报告；绿色通道覆盖范围，非完整行业排名。</p><div className="cd-table-scroll"><table><thead><tr><th>公司</th>{metricNames.map(m=><th key={m}>{labels[m]}</th>)}</tr></thead><tbody>{peerCodes.map(code=><tr key={code} className={code===selected.code?'cd-self':''}><th>{peers.find(p=>p.code===code)?.company_name}{code===selected.code?' · 本公司':''}</th>{metricNames.map(m=><td key={m}>{format(peers.find(p=>p.code===code&&p.metric===m)?.value,m)}</td>)}</tr>)}</tbody></table></div></> : <div className="cd-empty">同报告期还没有其他公司入库，暂时无法对比。</div>)}
          </div>}</section>)}
          <p className="cd-data-note">数据来自已解析财报 · 数字旁的角标可直接定位原文 · 未复核指标请结合 PDF 核验</p>
        </div>
      </main>
      <aside id="cd-chat-panel" className={`cd-chat cd-pane ${mobilePane==='chat'?'mobile-active':''}`} aria-label="财报对话">
        <div className="cd-pane-head"><h2><span>✧</span> 对话</h2><div className="cd-chat-actions"><button aria-label="新建对话" title="新建对话" disabled={asking||memoryLoading} onClick={()=>void newConversation()}>↻</button><button className="cd-dock" aria-label="收起对话" title="收起对话" onClick={()=>{setChatCollapsed(true);setMobilePane('dashboard');}}><DockIcon side="right" /></button></div></div>
        <div className="cd-chat-scroll"><div className="cd-assistant-label"><span>✧</span><b>本期财报速读</b><small>{summary?'AI 概览':summaryBusy?'正在生成概览':'数据摘要'}</small></div>
          <div className="cd-summary">{summary ? <p>{renderAnswer(summary)}</p> : <><p>本期营业收入 {format(revenue,'revenue')}{footnote('revenue')}，归母净利润 {format(profit,'net_profit')}{footnote('net_profit')}。</p><p>{changes[0]?<>{labels[changes[0].metric]}同比 {pct(changes[0].amount)}{footnote(changes[0].metric)}，是当前已解析指标中变化最明显的一项。</>:'尚无完整同期比较依据，暂不判断经营变化。'}</p><p>可从下方问题继续查看变化原因与原文依据。</p></>}</div>
          <div className="cd-insight-cards">{(changes.length?changes.slice(0,2):deltas.slice(0,2)).map(d=><button key={d.metric} onClick={()=>focusModule('anomalies')}><span>{labels[d.metric]}</span><strong>{d.amount===undefined?format(value(selected,d.metric),d.metric):pct(d.amount)}</strong><small>{d.amount===undefined?'本期数据':'同比变化'} <span>查看分析 ↗</span></small></button>)}</div>
          <div className="cd-suggest-label">继续探索</div><div className="cd-suggestions">{suggestions.map(q=><button key={q} disabled={asking} onClick={()=>void ask(q)}>{q}<span>↗</span></button>)}</div>
          {messages.length>0&&<div className="cd-conversation-label">围绕 {period(selected)} 的对话</div>}
          {messages.map((m,i)=><div key={i} className={`cd-message cd-message-${m.role}`}>{m.role==='assistant'&&<b className="cd-answer-label">✧ 财报助手</b>}<p>{m.role==='assistant'?renderAnswer(m):m.text}{!m.text&&asking?(thinking?'模型正在推理，请稍候…':'正在检索财报证据…'):''}</p>{m.citations?.length ? <div className="cd-answer-citations">{m.citations.filter(c=>m.text.includes(c.id?`【${c.id}】`:`【第${c.page}页】`)).map(c=>citationLink(c,c.id??c.page))}</div>:null}
            {m.role==='assistant'&&(m.followupBusy||m.followups?.length)?<div className="cd-followups"><small>{m.followupBusy?'正在生成相关追问…':'继续追问'}</small>{m.followups?.length?<div className="cd-followup-list">{m.followups.map(q=><button key={q} disabled={asking} onClick={()=>void ask(q)}>{q}<span>↗</span></button>)}</div>:null}</div>:null}</div>)}<div ref={chatEnd}/>
        </div><form className="cd-chat-input" onSubmit={e=>{e.preventDefault();void ask(question);}}><div><textarea aria-label="向财报助手提问" placeholder="基于这份财报，继续追问…" rows={2} value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void ask(question);}}}/><button aria-label="发送问题" disabled={asking||memoryLoading||!question.trim()} type="submit">{asking?'…':'↑'}</button></div><small>{memoryLoading?'正在恢复历史会话…':'同一会话连续追问 · 事实依据本轮原文检索'}</small></form>
      </aside>
      {sourceCollapsed && <div className="cd-rail cd-rail-left"><button aria-label="展开来源栏" title="展开来源栏" aria-expanded={false} aria-controls="cd-source-panel" onClick={()=>{setSourceCollapsed(false);setMobilePane('sources');}}><DockIcon side="left" /></button><span>来源</span></div>}
      {chatCollapsed && <div className="cd-rail cd-rail-right"><button aria-label="展开对话" title="展开对话" aria-expanded={false} aria-controls="cd-chat-panel" onClick={()=>{setChatCollapsed(false);setMobilePane('chat');}}><DockIcon side="right" /></button><span>对话</span></div>}
    </div>
  </section>;
}
