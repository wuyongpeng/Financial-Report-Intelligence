'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type LiveLimits = {
  intervalMs?: number;
  downloadLimit?: number;
  parseLimit?: number;
  pagePauseMs?: number;
  downloadPauseMs?: number;
  maxPages?: number;
};

type LivePayload = {
  autoCrawlEnabled?: boolean;
  lastPollAt?: string | null;
  limits?: LiveLimits;
  downloadSlots?: { used: number; max: number };
  parseSlots?: { used: number; max: number };
};

function formatTime(iso: string | null | undefined) {
  if (!iso) return '暂无';
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

export default function OpsPage() {
  const [live, setLive] = useState<LivePayload | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/crawl/live', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setLive(await res.json() as LivePayload);
      setError('');
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function toggleAuto() {
    if (!live) return;
    setSaving(true);
    try {
      const res = await fetch('/api/crawl/control', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ autoCrawlEnabled: !live.autoCrawlEnabled }),
      });
      const payload = await res.json() as { note?: string; error?: string; autoCrawlEnabled?: boolean };
      if (!res.ok) {
        setNote(payload.error ?? '切换失败');
      } else {
        setNote(payload.note ?? '已更新');
        await refresh();
      }
    } catch (err) {
      setNote(String(err));
    } finally {
      setSaving(false);
    }
  }

  const limits = live?.limits ?? {};

  return (
    <main className="app-shell" style={{ minHeight: '100dvh', background: '#f5f7fb' }}>
      <section style={{ width: 'min(720px, calc(100% - 40px))', margin: '0 auto', padding: '24px 0 40px', color: '#203047' }}>
        <p style={{ margin: '0 0 8px' }}>
          <Link href="/sources" style={{ color: '#3064db', textDecoration: 'none', fontWeight: 600 }}>← 返回数据采集</Link>
        </p>
        <h1 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 650 }}>采集运维参数</h1>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#78869a' }}>
          隐藏入口 `/ops`，不在主导航展示。数值来自 `/api/crawl/live`，与采集页 Status Bar 同源。
        </p>
        {error ? <p style={{ color: '#a86a5c', fontSize: 13 }}>{error}</p> : null}
        {note ? <p style={{ color: '#5d7190', fontSize: 13 }}>{note}</p> : null}
        <div style={{ background: '#fff', border: '1px solid #e5eaf1', borderRadius: 10, padding: '14px 16px' }}>
          <dl style={{ margin: 0, display: 'grid', gap: 8, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <dt style={{ color: '#8090a6', margin: 0 }}>自动抓取</dt>
              <dd style={{ margin: 0 }}>
                <button
                  type="button"
                  disabled={saving || !live}
                  onClick={() => void toggleAuto()}
                  style={{ border: '1px solid #d7e1f0', background: '#f7f9fc', borderRadius: 6, padding: '2px 10px', cursor: 'pointer' }}
                >
                  {live?.autoCrawlEnabled ? '开' : '关'}（点击切换）
                </button>
              </dd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <dt style={{ color: '#8090a6', margin: 0 }}>轮询间隔</dt>
              <dd style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>约 {Math.round((limits.intervalMs ?? 600_000) / 60000)} 分钟</dd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <dt style={{ color: '#8090a6', margin: 0 }}>抓取并发上限</dt>
              <dd style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>{limits.downloadLimit ?? live?.downloadSlots?.max ?? 2}</dd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <dt style={{ color: '#8090a6', margin: 0 }}>解析并发上限</dt>
              <dd style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>{limits.parseLimit ?? live?.parseSlots?.max ?? 1}</dd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <dt style={{ color: '#8090a6', margin: 0 }}>列表页间隔</dt>
              <dd style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>{limits.pagePauseMs ?? 1000} ms</dd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <dt style={{ color: '#8090a6', margin: 0 }}>PDF 下载间隔</dt>
              <dd style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>{limits.downloadPauseMs ?? 1200} ms</dd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <dt style={{ color: '#8090a6', margin: 0 }}>最大翻页</dt>
              <dd style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>{limits.maxPages ?? 8}</dd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <dt style={{ color: '#8090a6', margin: 0 }}>最近轮询</dt>
              <dd style={{ margin: 0 }}>{formatTime(live?.lastPollAt)}</dd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <dt style={{ color: '#8090a6', margin: 0 }}>下载/解析超时</dt>
              <dd style={{ margin: 0 }}>各 5 分钟后退回对应排队</dd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <dt style={{ color: '#8090a6', margin: 0 }}>自动回溯</dt>
              <dd style={{ margin: 0 }}>最早 2025Q1；更早不采集</dd>
            </div>
          </dl>
        </div>
      </section>
    </main>
  );
}
