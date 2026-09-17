'use client';
import { useCallback, useEffect, useState } from 'react';
import './crawl-live-panel.css';

type LivePayload = {
  running: boolean;
  lastPollAt: string | null;
  counts: {
    discovered: number; downloaded: number; pending_download: number; pending_parse: number;
    review: number; online: number; target_companies: number; download_failed: number;
  };
  downloadSlots: { used: number; max: number };
  parseSlots: { used: number; max: number };
  stages: Array<{ id: string; label: string; count: number; capacity?: number; active?: boolean }>;
  health: Array<{ source: string; ok: boolean | null; lastCount: number; consecutiveFailures: number; lastError: string | null }>;
  ticks: Array<{ id: string; at: string; status: string; text: string }>;
  limits: { intervalMs: number; downloadLimit: number; parseLimit: number; pagePauseMs: number; downloadPauseMs: number };
};

function formatTime(iso: string | null) {
  if (!iso) return '尚无轮询记录';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CrawlLivePanel({ compact = false }: { compact?: boolean }) {
  const [live, setLive] = useState<LivePayload | null>(null);
  const [error, setError] = useState('');
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState('');

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/crawl/live', { cache: 'no-store' });
      if (!response.ok) throw new Error(`状态 ${response.status}`);
      const payload = await response.json() as LivePayload;
      setLive(payload);
      setError('');
    } catch (err) {
      setError(`实时状态暂不可用：${String(err)}`);
    }
  }, []);

  useEffect(() => {
    const kick = window.setTimeout(() => { void refresh(); }, 0);
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => {
      window.clearTimeout(kick);
      window.clearInterval(timer);
    };
  }, [refresh]);

  async function triggerGentle() {
    setTriggering(true);
    setTriggerMsg('');
    try {
      const response = await fetch('/api/crawl/trigger', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'backlog' }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; note?: string; downloaded?: number; parsed?: number; backlog?: number };
      if (!response.ok) {
        setTriggerMsg(payload.error ?? '触发失败（可能需要登录或 INTERNAL_INGEST_TOKEN）');
        return;
      }
      setTriggerMsg(payload.note ?? `已温和处理：下载 ${payload.downloaded ?? 0} · 解析 ${payload.parsed ?? 0}（积压 ${payload.backlog ?? 0}）`);
      await refresh();
    } catch (err) {
      setTriggerMsg(`网络异常：${String(err)}`);
    } finally {
      setTriggering(false);
    }
  }

  const stages = live?.stages ?? [
    { id: 'discover', label: '发现公告', count: 0 },
    { id: 'queue', label: '排队', count: 0 },
    { id: 'download', label: '下载 PDF', count: 0, capacity: 1 },
    { id: 'parse', label: '解析入库', count: 0 },
  ];

  return (
    <section className={`clp ${compact ? 'clp-compact' : ''}`} aria-label="温和抓取实时面板">
      <div className="clp-head">
        <div>
          <span className="clp-kicker">温和并发管线</span>
          <h2>抓取可视化</h2>
          <p>
            下载槽位 {live?.downloadSlots.used ?? 0}/{live?.downloadSlots.max ?? 1}
            · 解析槽位 {live?.parseSlots.used ?? 0}/{live?.parseSlots.max ?? 1}
            · 最近轮询 {formatTime(live?.lastPollAt ?? null)}
          </p>
        </div>
        <div className="clp-actions">
          <span className={`clp-pulse ${live?.running ? 'on' : ''}`}>{live?.running ? '运行中' : '空闲 / 显示最近库状态'}</span>
          <button type="button" className="clp-trigger" disabled={triggering} onClick={() => void triggerGentle()}>
            {triggering ? '触发中…' : '触发温和抓取'}
          </button>
        </div>
      </div>

      <ol className="clp-stages">
        {stages.map((stage, index) => (
          <li key={stage.id} className={stage.active ? 'active' : ''}>
            <span className="clp-stage-idx">{index + 1}</span>
            <div>
              <strong>{stage.label}</strong>
              <em>
                {stage.capacity != null ? `${stage.count}/${stage.capacity}` : stage.count}
              </em>
            </div>
          </li>
        ))}
      </ol>

      <div className="clp-health" aria-label="来源健康">
        {(live?.health ?? [
          { source: 'SSE', ok: null, lastCount: 0, consecutiveFailures: 0, lastError: null },
          { source: 'SZSE', ok: null, lastCount: 0, consecutiveFailures: 0, lastError: null },
          { source: 'CNINFO', ok: null, lastCount: 0, consecutiveFailures: 0, lastError: null },
        ]).map((item) => (
          <article key={item.source} className={item.ok === false ? 'bad' : item.ok ? 'good' : ''}>
            <span>{item.source === 'CNINFO' ? '巨潮' : item.source}</span>
            <strong>{item.ok === null ? '尚无记录' : item.ok ? '正常' : '异常'}</strong>
            <small>最近 {item.lastCount} 条{item.lastError ? ` · ${item.lastError}` : ''}</small>
          </article>
        ))}
      </div>

      {!compact && (
        <ul className="clp-ticks" aria-live="polite">
          {(live?.ticks ?? []).length ? live!.ticks.map((tick) => (
            <li key={tick.id}>
              <time>{formatTime(tick.at)}</time>
              <span className={`clp-tick-status ${tick.status}`}>{tick.status}</span>
              <span>{tick.text}</span>
            </li>
          )) : <li className="clp-empty-tick">尚无 ingest_runs 记录。可点击「触发温和抓取」处理已发现积压，或启动 worker。</li>}
        </ul>
      )}

      {(error || triggerMsg) && <p className="clp-msg" role="status">{triggerMsg || error}</p>}
      {live?.limits && (
        <p className="clp-limits">
          限流：间隔 {Math.round(live.limits.intervalMs / 60000)} 分钟 · 下载≤{live.limits.downloadLimit} · 解析≤{live.limits.parseLimit}
          · 页暂停 {live.limits.pagePauseMs}ms · PDF 暂停 {live.limits.downloadPauseMs}ms
        </p>
      )}
    </section>
  );
}
