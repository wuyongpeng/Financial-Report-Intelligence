'use client';
import { useEffect, useRef, useState } from 'react';

const normalized = (s: string) => s.replace(/\s/g, '');

// Render the archived page itself, so citations highlight real PDF coordinates.
export default function PdfEvidence({ reportId, page, quote, onResolvePage }: { reportId: string; page: number; quote: string; onResolvePage?: (resolved: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [shifted, setShifted] = useState<number | null>(null);
  const resolveRef = useRef(onResolvePage);
  useEffect(() => { resolveRef.current = onResolvePage; }, [onResolvePage]);
  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    const abort = new AbortController();
    // Loading state follows the external PDF request lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(true); setError(''); setShifted(null);
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
        // A cover page shifts printed numbering, so the stored page can be off by
        // a page or two. Trust the quoted text and render the page that holds it.
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
        const source = await pdf.getPage(target);
        const viewport = source.getViewport({ scale: 1.5 });
        const target2d = canvas.current!;
        target2d.width = viewport.width; target2d.height = viewport.height;
        const ctx = target2d.getContext('2d')!;
        await source.render({ canvas: target2d, canvasContext: ctx, viewport }).promise;
        if (!active) return;
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
            const h = Math.max(item.height * viewport.scale, 10);
            ctx.fillRect(x, y - h, Math.max(item.width * viewport.scale, 6), h * 1.2);
          }
        }
        setBusy(false);
      } catch { if (active) { setError('原始版式暂时无法加载，可继续阅读下方已解析原文。'); setBusy(false); } }
    })();
    return () => { active = false; abort.abort(); dispose?.(); };
  }, [reportId, page, quote]);
  return <div className="cd-pdf-page" aria-busy={busy}>
    <label className="cd-pdf-zoom">缩放 <select aria-label="PDF 缩放" value={zoom} onChange={e => setZoom(Number(e.target.value))}>{[100,150,200,300].map(z => <option key={z} value={z}>{z === 100 ? '适合宽度' : `${z}%`}</option>)}</select>{shifted !== null && <span>已按引用原文校正至 PDF 第 {shifted} 页</span>}</label>
    {busy && <p>正在定位 PDF 第 {page} 页…</p>}
    {error && <p role="status">{error}</p>}
    <canvas ref={canvas} aria-label={`PDF 第 ${shifted ?? page} 页${quote ? '，黄色区域为引用原文' : ''}`} style={{ display: busy || error ? 'none' : 'block', width: `${zoom}%` }} />
  </div>;
}
