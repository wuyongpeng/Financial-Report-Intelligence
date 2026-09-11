'use client';
import { useEffect, useRef, useState } from 'react';

const normalized = (s: string) => s.replace(/\s/g, '');

type TextBox = { str: string; left: number; top: number; width: number; height: number };

// Canvas paints the page; an overlaid text layer receives selection.
export default function PdfEvidence({ reportId, page, quote, onResolvePage, onTextPick }: {
  reportId: string; page: number; quote: string;
  onResolvePage?: (resolved: number) => void;
  onTextPick?: (text: string, page: number) => void;
}) {
  const zoom = 100;
  const canvas = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const highlightY = useRef<number | null>(null);
  const pickPage = useRef(page);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [shifted, setShifted] = useState<number | null>(null);
  const [boxes, setBoxes] = useState<TextBox[]>([]);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const resolveRef = useRef(onResolvePage);
  const pickRef = useRef(onTextPick);
  useEffect(() => { resolveRef.current = onResolvePage; }, [onResolvePage]);
  useEffect(() => { pickRef.current = onTextPick; }, [onTextPick]);
  useEffect(() => { pickPage.current = shifted ?? page; }, [shifted, page]);

  function scrollToHighlight() {
    const node = canvas.current;
    const y = highlightY.current;
    if (!node || y === null || node.height <= 0) return;
    const scroller = node.closest('.cd-source-scroll');
    if (!(scroller instanceof HTMLElement)) return;
    const scale = node.clientHeight / node.height;
    const canvasTop = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const target = canvasTop + y * scale - scroller.clientHeight * 0.32;
    scroller.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }

  useEffect(() => {
    if (busy || error || highlightY.current === null) return;
    const timer = window.setTimeout(scrollToHighlight, 40);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, error, zoom, shifted, page, quote]);

  useEffect(() => {
    const root = layerRef.current;
    if (!root) return;
    function onUp() {
      if (!pickRef.current || !root) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      if (!root.contains(sel.anchorNode)) return;
      const text = sel.toString().replace(/\s+/g, ' ').trim();
      if (text.length < 4) return;
      pickRef.current(text, pickPage.current);
    }
    root.addEventListener('mouseup', onUp);
    return () => root.removeEventListener('mouseup', onUp);
  }, [boxes, busy]);

  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    const abort = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(true); setError(''); setShifted(null); highlightY.current = null; setBoxes([]);
    void (async () => {
      try {
        const { getDocumentProxy } = await import('unpdf');
        const response = await fetch(`/api/reports/${encodeURIComponent(reportId)}/pdf`, { signal: abort.signal });
        if (!response.ok) throw new Error('PDF 暂时无法读取');
        const pdf = await getDocumentProxy(new Uint8Array(await response.arrayBuffer()));
        dispose = () => { void pdf.loadingTask.destroy(); };
        if (!active) { dispose(); return; }
        if (page > pdf.numPages) throw new Error('引用页码超出 PDF 范围');
        const needle = normalized(quote).slice(0, 40);
        const candidates = needle.length >= 4
          ? [page, page - 1, page + 1, page - 2, page + 2].filter((p, i, all) => p >= 1 && p <= pdf.numPages && all.indexOf(p) === i)
          : [page];
        let target = page;
        let items: Extract<Awaited<ReturnType<Awaited<ReturnType<typeof pdf.getPage>>['getTextContent']>>['items'][number], { str: string }>[] = [];
        for (const candidate of candidates) {
          const source = await pdf.getPage(candidate);
          if (!active) return;
          const content = await source.getTextContent();
          const list = content.items.filter((item): item is Extract<typeof item, { str: string }> => 'str' in item);
          const full = list.map(item => normalized(item.str)).join('');
          if (candidate === page) items = list;
          if (full.includes(needle) || candidates.length === 1) { target = candidate; items = list; break; }
        }
        if (!active) return;
        if (target !== page) { setShifted(target); resolveRef.current?.(target); }
        pickPage.current = target;
        const source = await pdf.getPage(target);
        const viewport = source.getViewport({ scale: 1.5 });
        const target2d = canvas.current!;
        target2d.width = viewport.width; target2d.height = viewport.height;
        setCanvasSize({ w: viewport.width, h: viewport.height });
        const ctx = target2d.getContext('2d')!;
        await source.render({ canvas: target2d, canvasContext: ctx, viewport }).promise;
        if (!active) return;
        let firstHighlightY: number | null = null;
        const nextBoxes: TextBox[] = [];
        for (const item of items) {
          if (!item.str) continue;
          const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
          const h = Math.max(Math.abs(item.height) * viewport.scale, 8);
          const w = Math.max(Math.abs(item.width) * viewport.scale, 4);
          nextBoxes.push({ str: item.str, left: x, top: y - h, width: w, height: h * 1.25 });
        }
        if (quote) {
          const full = items.map(item => normalized(item.str)).join('');
          const at = full.indexOf(normalized(quote));
          let offset = 0;
          ctx.fillStyle = 'rgba(255, 194, 38, 0.35)';
          for (const item of items) {
            const str = normalized(item.str);
            const hit = at >= 0 ? offset < at + normalized(quote).length && offset + str.length > at : str.length >= 2 && normalized(quote).includes(str);
            offset += str.length;
            if (!hit) continue;
            const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
            const h = Math.max(Math.abs(item.height) * viewport.scale, 8);
            const top = y - h;
            if (firstHighlightY === null || top < firstHighlightY) firstHighlightY = top;
            ctx.fillRect(x, top, Math.max(Math.abs(item.width) * viewport.scale, 6), h * 1.25);
          }
        }
        highlightY.current = firstHighlightY;
        setBoxes(nextBoxes);
        setBusy(false);
      } catch { if (active) { setError('原始版式暂时无法加载，可切换到「原文文本」划词。'); setBusy(false); } }
    })();
    return () => { active = false; abort.abort(); dispose?.(); };
  }, [reportId, page, quote]);

  return <div className="cd-pdf-page" aria-busy={busy}>
    {shifted !== null && <p className="cd-pdf-shift-note" role="status">已按引用原文校正至 PDF 第 {shifted} 页</p>}
    {busy && <p>正在定位 PDF 第 {page} 页…</p>}
    {error && <p role="status">{error}</p>}
    <div ref={stageRef} className="cd-pdf-stage" style={{ width: `${zoom}%`, display: busy || error ? 'none' : 'block' }}>
      <canvas ref={canvas} className="cd-pdf-canvas" aria-label={`PDF 第 ${shifted ?? page} 页${quote ? '，黄色区域为引用原文' : ''}`} />
      <div
        ref={layerRef}
        className="cd-pdf-textlayer"
        style={canvasSize.w && canvasSize.h ? { aspectRatio: `${canvasSize.w} / ${canvasSize.h}` } : undefined}
      >
        {boxes.map((box, i) => (
          <span
            key={i}
            style={{
              left: `${(box.left / (canvasSize.w || 1)) * 100}%`,
              top: `${(box.top / (canvasSize.h || 1)) * 100}%`,
              width: `${(box.width / (canvasSize.w || 1)) * 100}%`,
              height: `${(box.height / (canvasSize.h || 1)) * 100}%`,
            }}
          >{box.str}</span>
        ))}
      </div>
    </div>
  </div>;
}
