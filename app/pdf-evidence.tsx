'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

const normalized = (s: string) => s.replace(/\s/g, '');
const SCALE = 1.5;
const BUFFER = 4; // pages above/below viewport to keep rendered

type TextBox = { str: string; left: number; top: number; width: number; height: number };
type PageSlot = {
  page: number;
  width: number;
  height: number;
  boxes: TextBox[];
  rendered: boolean;
  error?: string;
};

type PdfProxy = Awaited<ReturnType<typeof import('unpdf').getDocumentProxy>>;

function PageCanvas({
  pdf,
  slot,
  highlightQuote,
  highlightPage,
  onHighlightY,
  onReady,
}: {
  pdf: PdfProxy;
  slot: PageSlot;
  highlightQuote: string;
  highlightPage: number;
  onHighlightY: (page: number, y: number | null) => void;
  onReady: (page: number, patch: Partial<PageSlot>) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<TextBox[]>(slot.boxes);
  const [busy, setBusy] = useState(!slot.rendered);
  const [error, setError] = useState(slot.error ?? '');

  useEffect(() => {
    let active = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Already painted this slot once — keep canvas via remount avoidance; re-draw if needed.
    void (async () => {
      try {
        setBusy(true);
        setError('');
        const source = await pdf.getPage(slot.page);
        if (!active) return;
        const viewport = source.getViewport({ scale: SCALE });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d');
        await source.render({ canvas, canvasContext: ctx, viewport }).promise;
        if (!active) return;
        const content = await source.getTextContent();
        if (!active) return;
        const items = content.items.filter((item): item is Extract<typeof item, { str: string }> => 'str' in item);
        const nextBoxes: TextBox[] = [];
        for (const item of items) {
          if (!item.str) continue;
          const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
          const h = Math.max(Math.abs(item.height) * viewport.scale, 8);
          const w = Math.max(Math.abs(item.width) * viewport.scale, 4);
          nextBoxes.push({ str: item.str, left: x, top: y - h, width: w, height: h * 1.25 });
        }
        let firstHighlightY: number | null = null;
        if (highlightQuote && slot.page === highlightPage) {
          const full = items.map((item) => normalized(item.str)).join('');
          const needle = normalized(highlightQuote);
          const at = full.indexOf(needle);
          let offset = 0;
          ctx.fillStyle = 'rgba(255, 194, 38, 0.35)';
          for (const item of items) {
            const str = normalized(item.str);
            const hit = at >= 0
              ? offset < at + needle.length && offset + str.length > at
              : str.length >= 2 && needle.includes(str);
            offset += str.length;
            if (!hit) continue;
            const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
            const h = Math.max(Math.abs(item.height) * viewport.scale, 8);
            const top = y - h;
            if (firstHighlightY === null || top < firstHighlightY) firstHighlightY = top;
            ctx.fillRect(x, top, Math.max(Math.abs(item.width) * viewport.scale, 6), h * 1.25);
          }
        }
        if (!active) return;
        setBoxes(nextBoxes);
        onHighlightY(slot.page, firstHighlightY);
        onReady(slot.page, {
          width: viewport.width,
          height: viewport.height,
          boxes: nextBoxes,
          rendered: true,
          error: undefined,
        });
        setBusy(false);
      } catch {
        if (!active) return;
        setError('本页暂时无法渲染');
        setBusy(false);
        onReady(slot.page, { rendered: true, error: '本页暂时无法渲染' });
      }
    })();
    return () => { active = false; };
    // Re-render when this page's cite highlight changes — not when the toolbar page follows scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, slot.page, highlightQuote, highlightQuote ? highlightPage : 0]);

  const w = slot.width > 0 ? slot.width : 1;
  const h = slot.height > 0 ? slot.height : 1;

  return (
    <div className="cd-pdf-page cd-pdf-page-continuous" data-pdf-page={slot.page} aria-busy={busy}>
      {busy && !slot.rendered && <p className="cd-pdf-page-status">正在渲染 PDF 第 {slot.page} 页…</p>}
      {error && <p className="cd-pdf-page-status" role="status">{error}</p>}
      <div className="cd-pdf-stage" style={{ width: '100%', display: error && !slot.rendered ? 'none' : 'block' }}>
        <canvas
          ref={canvasRef}
          className="cd-pdf-canvas"
          aria-label={`PDF 第 ${slot.page} 页${highlightQuote && slot.page === highlightPage ? '，黄色区域为引用原文' : ''}`}
        />
        <div
          ref={layerRef}
          className="cd-pdf-textlayer"
          data-pdf-page={slot.page}
          style={{ aspectRatio: `${w} / ${h}` }}
        >
          {boxes.map((box, i) => (
            <span
              key={i}
              style={{
                left: `${(box.left / w) * 100}%`,
                top: `${(box.top / h) * 100}%`,
                width: `${(box.width / w) * 100}%`,
                height: `${(box.height / h) * 100}%`,
              }}
            >{box.str}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Continuous multi-page PDF viewer (NotebookLM-like vertical scroll). */
export default function PdfEvidence({ reportId, page, quote, jumpNonce = 0, onResolvePage, onTextPick, onVisiblePage }: {
  reportId: string; page: number; quote: string;
  /** Bumped only on cite / toolbar jump — scroll-follow must NOT bump this or the viewport yanks back. */
  jumpNonce?: number;
  onResolvePage?: (resolved: number) => void;
  onTextPick?: (text: string, page: number) => void;
  /** Fired when continuous scroll changes the page under the reading line (not during cite jumps). */
  onVisiblePage?: (page: number) => void;
}) {
  const stackRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [pdf, setPdf] = useState<PdfProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [slots, setSlots] = useState<PageSlot[]>([]);
  const [visible, setVisible] = useState<Set<number>>(() => new Set([page]));
  const [shifted, setShifted] = useState<number | null>(null);
  const highlightY = useRef<{ page: number; y: number } | null>(null);
  const resolveRef = useRef(onResolvePage);
  const pickRef = useRef(onTextPick);
  const visiblePageRef = useRef(onVisiblePage);
  const pageRef = useRef(page);
  const shiftedRef = useRef(shifted);
  const citeKey = useRef('');
  const suppressVisibleUntil = useRef(0);
  const lastReportedPage = useRef<number | null>(null);
  const lockedCitePage = useRef(page);
  const jumpSigRef = useRef(`${jumpNonce}::${quote}::${shifted ?? 'none'}`);
  pageRef.current = page;
  shiftedRef.current = shifted;
  const jumpSig = `${jumpNonce}::${quote}::${shifted ?? 'none'}`;
  if (jumpSigRef.current !== jumpSig) {
    jumpSigRef.current = jumpSig;
    lockedCitePage.current = shifted ?? page;
  }
  const [docKey, setDocKey] = useState(reportId);
  if (reportId !== docKey) {
    setDocKey(reportId);
    setBusy(true);
    setError('');
    setShifted(null);
    setPdf(null);
    setSlots([]);
    setNumPages(0);
    setVisible(new Set([page]));
  }
  useEffect(() => { resolveRef.current = onResolvePage; }, [onResolvePage]);
  useEffect(() => { pickRef.current = onTextPick; }, [onTextPick]);
  useEffect(() => { visiblePageRef.current = onVisiblePage; }, [onVisiblePage]);
  // Only mute follow-backs after an intentional jump (cite / 页码下拉), not scroll-follow page sync.
  useEffect(() => {
    suppressVisibleUntil.current = Date.now() + 800;
  }, [jumpNonce, quote]);

  // Load document once per reportId.
  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    const abort = new AbortController();
    highlightY.current = null;
    void (async () => {
      try {
        const { getDocumentProxy } = await import('unpdf');
        const response = await fetch(`/api/reports/${encodeURIComponent(reportId)}/pdf`, { signal: abort.signal });
        if (!response.ok) throw new Error('PDF 暂时无法读取');
        const proxy = await getDocumentProxy(new Uint8Array(await response.arrayBuffer()));
        dispose = () => { void proxy.loadingTask.destroy(); };
        if (!active) { dispose(); return; }
        const total = proxy.numPages;
        // Probe first page for default aspect; placeholders use A4-ish ratio until measured.
        let defaultW = 595 * SCALE;
        let defaultH = 842 * SCALE;
        try {
          const first = await proxy.getPage(1);
          if (!active) return;
          const vp = first.getViewport({ scale: SCALE });
          defaultW = vp.width;
          defaultH = vp.height;
        } catch { /* keep defaults */ }
        if (!active) return;
        const next: PageSlot[] = Array.from({ length: total }, (_, i) => ({
          page: i + 1,
          width: defaultW,
          height: defaultH,
          boxes: [],
          rendered: false,
        }));
        setNumPages(total);
        setSlots(next);
        setPdf(proxy);
        setBusy(false);
      } catch {
        if (active) {
          setError('原始版式暂时无法加载，可切换到「原文文本」划词。');
          setBusy(false);
        }
      }
    })();
    return () => { active = false; abort.abort(); dispose?.(); };
  }, [reportId]);

  // Resolve cite page by quote search near requested page; seed visibility.
  // Must not depend on `page`: scroll-follow updates the toolbar page and must not re-resolve or yank.
  useEffect(() => {
    if (!pdf || !numPages) return;
    let active = true;
    const requested = pageRef.current;
    const key = `${jumpNonce}::${quote}`;
    if (citeKey.current === key) {
      const around = shiftedRef.current ?? requested;
      const id = window.setTimeout(() => {
        if (!active) return;
        setVisible((prev) => {
          const next = new Set(prev);
          for (let p = Math.max(1, around - BUFFER); p <= Math.min(numPages, around + BUFFER); p++) next.add(p);
          return next;
        });
      }, 0);
      return () => { active = false; window.clearTimeout(id); };
    }
    citeKey.current = key;
    void (async () => {
      const needle = normalized(quote).slice(0, 40);
      const candidates = needle.length >= 4
        ? [requested, requested - 1, requested + 1, requested - 2, requested + 2].filter((p, i, all) => p >= 1 && p <= numPages && all.indexOf(p) === i)
        : [Math.min(Math.max(1, requested), numPages)];
      let target = Math.min(Math.max(1, requested), numPages);
      for (const candidate of candidates) {
        try {
          const source = await pdf.getPage(candidate);
          if (!active) return;
          const content = await source.getTextContent();
          const list = content.items.filter((item): item is Extract<typeof item, { str: string }> => 'str' in item);
          const full = list.map((item) => normalized(item.str)).join('');
          if (full.includes(needle) || candidates.length === 1) { target = candidate; break; }
        } catch { /* try next */ }
      }
      if (!active) return;
      if (target !== requested) {
        setShifted(target);
        resolveRef.current?.(target);
      } else {
        setShifted(null);
      }
      setVisible((prev) => {
        const next = new Set(prev);
        for (let p = Math.max(1, target - BUFFER); p <= Math.min(numPages, target + BUFFER); p++) next.add(p);
        return next;
      });
    })();
    return () => { active = false; };
  }, [pdf, numPages, quote, jumpNonce]);

  // Track ALL currently intersecting slots. IO only reports deltas — rebuilding from
  // the latest batch alone unmounts on-screen pages and paints the gray placeholders.
  const intersectingRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const root = stackRef.current?.closest('.cd-source-scroll');
    const stack = stackRef.current;
    if (!(root instanceof HTMLElement) || !stack || !numPages) return;
    const nodes = stack.querySelectorAll<HTMLElement>('.cd-pdf-slot[data-pdf-page]');
    intersectingRef.current = new Set();

    const reportVisible = () => {
      if (Date.now() < suppressVisibleUntil.current) return;
      const live = intersectingRef.current;
      if (!live.size) return;
      const rootRect = root.getBoundingClientRect();
      const readingY = rootRect.top + rootRect.height * 0.28;
      let best: number | null = null;
      let bestDist = Infinity;
      for (const p of live) {
        const node = stack.querySelector<HTMLElement>(`.cd-pdf-slot[data-pdf-page="${p}"]`);
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        const mid = (rect.top + rect.bottom) / 2;
        const dist = Math.abs(mid - readingY);
        // Prefer the page whose band covers the reading line.
        const covers = rect.top <= readingY && rect.bottom >= readingY;
        const score = covers ? dist - 10_000 : dist;
        if (score < bestDist) { bestDist = score; best = p; }
      }
      if (best == null || best === lastReportedPage.current) return;
      lastReportedPage.current = best;
      visiblePageRef.current?.(best);
    };

    const rebuild = () => {
      const live = intersectingRef.current;
      const cite = shiftedRef.current ?? pageRef.current;
      const next = new Set<number>();
      const centers = live.size ? [...live] : [cite];
      if (!live.has(cite)) centers.push(cite);
      for (const center of centers) {
        for (let i = Math.max(1, center - BUFFER); i <= Math.min(numPages, center + BUFFER); i++) next.add(i);
      }
      // Hold previously mounted pages a bit longer to avoid flicker while scrolling.
      setVisible((prev) => {
        for (const p of prev) {
          const nearLive = [...live].some((c) => Math.abs(p - c) <= BUFFER + 2);
          const nearCite = Math.abs(p - cite) <= BUFFER + 2;
          if (nearLive || nearCite) next.add(p);
        }
        if (next.size === prev.size && [...next].every((n) => prev.has(n))) return prev;
        return next;
      });
      reportVisible();
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const raw = entry.target.getAttribute('data-pdf-page');
          const p = raw ? Number(raw) : NaN;
          if (!Number.isFinite(p)) continue;
          if (entry.isIntersecting) intersectingRef.current.add(p);
          else intersectingRef.current.delete(p);
        }
        rebuild();
      },
      { root, rootMargin: '1200px 0px', threshold: 0 },
    );
    nodes.forEach((n) => observer.observe(n));
    // Seed once after observe — IO may not fire for already-visible nodes in some browsers.
    requestAnimationFrame(() => {
      for (const n of nodes) {
        const rect = n.getBoundingClientRect();
        const rootRect = root.getBoundingClientRect();
        const overlap = rect.bottom >= rootRect.top - 1200 && rect.top <= rootRect.bottom + 1200;
        const raw = n.getAttribute('data-pdf-page');
        const p = raw ? Number(raw) : NaN;
        if (overlap && Number.isFinite(p)) intersectingRef.current.add(p);
      }
      rebuild();
    });
    const onScroll = () => { reportVisible(); };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => { observer.disconnect(); root.removeEventListener('scroll', onScroll); };
    // Intentionally omit `page` / `shifted`: recreating the observer on toolbar page sync
    // unmounts offscreen pages and the viewport jumps up while the wheel is moving.
  }, [numPages, slots.length]);

  // Scroll into view only for intentional jumps / quote resolve — never when page came from onVisiblePage.
  useEffect(() => {
    if (busy || error || !slots.length) return;
    const focus = shifted ?? pageRef.current;
    const timer = window.setTimeout(() => {
      const stack = stackRef.current;
      const scroller = stack?.closest('.cd-source-scroll');
      if (!(scroller instanceof HTMLElement) || !stack) return;
      const node = stack.querySelector<HTMLElement>(`.cd-pdf-slot[data-pdf-page="${focus}"]`);
      if (!node) return;
      suppressVisibleUntil.current = Date.now() + 800;
      const hy = highlightY.current;
      if (hy && hy.page === focus && hy.y !== null) {
        const canvas = node.querySelector('canvas');
        if (canvas && canvas.height > 0) {
          const scale = canvas.clientHeight / canvas.height;
          const canvasTop = canvas.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
          const target = canvasTop + hy.y * scale - scroller.clientHeight * 0.32;
          scroller.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
          return;
        }
      }
      const top = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
      scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [busy, error, shifted, jumpNonce, quote, slots.length]);

  // Text-layer划词 → parent pick bar (delegation on stack).
  useEffect(() => {
    const root = stackRef.current;
    if (!root) return;
    function onUp(ev: MouseEvent) {
      if (!pickRef.current || !root) return;
      const t = ev.target;
      if (t instanceof Element && t.closest('.cd-pick-bar')) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      if (!root.contains(sel.anchorNode)) return;
      const layer = (sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement)?.closest('[data-pdf-page].cd-pdf-textlayer, .cd-pdf-textlayer[data-pdf-page]');
      const pageAttr = layer?.getAttribute('data-pdf-page')
        ?? (sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement)?.closest('[data-pdf-page]')?.getAttribute('data-pdf-page');
      const pickPage = pageAttr ? Number(pageAttr) : (shifted ?? page);
      if (!Number.isFinite(pickPage)) return;
      const text = sel.toString().replace(/\s+/g, ' ').trim();
      if (text.length < 4) return;
      pickRef.current(text, pickPage);
    }
    root.addEventListener('mouseup', onUp);
    root.addEventListener('pointerup', onUp);
    return () => {
      root.removeEventListener('mouseup', onUp);
      root.removeEventListener('pointerup', onUp);
    };
  }, [page, shifted, slots.length]);

  const onReady = useCallback((pageNo: number, patch: Partial<PageSlot>) => {
    setSlots((prev) => prev.map((s) => (s.page === pageNo ? { ...s, ...patch } : s)));
  }, []);

  const onHighlightY = useCallback((pageNo: number, y: number | null) => {
    if (y === null) return;
    highlightY.current = { page: pageNo, y };
  }, []);

  if (error) {
    return <div className="cd-pdf-page" role="status"><p>{error}</p></div>;
  }

  return (
    <div className="cd-pdf-stack" ref={stackRef} aria-busy={busy}>
      {shifted !== null && (
        <p className="cd-pdf-shift-note" role="status">已按引用原文校正至 PDF 第 {shifted} 页</p>
      )}
      {busy && <p className="cd-pdf-page-status">正在加载 PDF…</p>}
      {slots.map((slot) => {
        const shouldRender = Boolean(pdf) && visible.has(slot.page);
        return (
          <div
            key={slot.page}
            className="cd-pdf-slot"
            data-pdf-page={slot.page}
            style={{ minHeight: slot.height ? undefined : 480 }}
          >
            <div className="cd-pdf-page-label">PDF {slot.page}{numPages ? ` / ${numPages}` : ''}</div>
            {shouldRender && pdf ? (
              <PageCanvas
                pdf={pdf}
                slot={slot}
                highlightQuote={quote}
                highlightPage={quote ? (shifted ?? lockedCitePage.current) : 0}
                onHighlightY={onHighlightY}
                onReady={onReady}
              />
            ) : (
              <div
                className="cd-pdf-placeholder"
                style={{ aspectRatio: slot.width && slot.height ? `${slot.width} / ${slot.height}` : '210 / 297' }}
                aria-hidden="true"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
