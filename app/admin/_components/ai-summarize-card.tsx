'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { adminStyles as s } from './admin-shell';

export type AiSummarizeScope = 'survey' | 'feedback' | 'audit';

type Theme = { title: string; count: number };

type SummaryRecord = {
  scope: AiSummarizeScope;
  basedOnCount: number;
  fingerprint: string;
  generatedAt: string;
  themes: Theme[];
};

function formatStamp(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

const cardShell: CSSProperties = {
  border: '1px solid #e5eaf1',
  borderRadius: 12,
  background: '#fff',
  marginBottom: 12,
  overflow: 'hidden',
};

const titleBar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 12px',
  cursor: 'pointer',
  userSelect: 'none',
  fontSize: 13,
  color: '#3a4d66',
  background: '#f8fafc',
};

const newDot: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  color: '#b45309',
  fontSize: 12,
  fontWeight: 600,
};

const themeList: CSSProperties = {
  margin: 0,
  padding: '0 12px 4px',
  listStyle: 'none',
  fontSize: 13,
  color: '#3a4d66',
  lineHeight: 1.55,
};

const outlineBtn: CSSProperties = {
  ...s.btnGhost,
  padding: '5px 10px',
  fontSize: 12,
};

type Props = {
  scope: AiSummarizeScope;
  /** When false, skip fetch (e.g. survey invites tab). */
  active?: boolean;
  /** Sit beside filters: first-run button on that row; summary card (collapsed or expanded) always full width. */
  inline?: boolean;
};

export function AiSummarizePanel({ scope, active = true, inline = false }: Props) {
  const [summary, setSummary] = useState<SummaryRecord | null>(null);
  const [hasNewData, setHasNewData] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(true);

  const loadStatus = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/summarize?scope=${scope}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (res.status === 401) {
        setError('请求未授权，请刷新后重试');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || '加载归纳失败');
      }
      const body = await res.json() as {
        summary: SummaryRecord | null;
        hasNewData: boolean;
        configured?: boolean;
      };
      setSummary(body.summary);
      setHasNewData(Boolean(body.hasNewData));
      setConfigured(body.configured !== false);
      setExpanded(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载归纳失败');
    } finally {
      setLoading(false);
    }
  }, [active, scope]);

  useEffect(() => {
    if (active) void loadStatus();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const runSummarize = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError('');
    try {
      const res = await fetch('/api/admin/summarize', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope }),
      });
      if (res.status === 401) {
        setError('请求未授权，请刷新后重试');
        return;
      }
      const body = await res.json().catch(() => ({})) as {
        error?: string;
        summary?: SummaryRecord;
        hasNewData?: boolean;
      };
      if (!res.ok) {
        throw new Error(body.error || '归纳失败');
      }
      if (!body.summary) throw new Error('归纳失败');
      setSummary(body.summary);
      setHasNewData(false);
      setExpanded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '归纳失败');
    } finally {
      setRunning(false);
    }
  }, [running, scope]);

  if (!active) return null;

  if (!summary) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: inline ? 'flex-start' : 'flex-end',
          alignItems: 'center',
          gap: 10,
          marginBottom: inline ? 0 : 12,
          marginLeft: inline ? 'auto' : undefined,
          flex: inline ? '0 0 auto' : undefined,
        }}
      >
        {error ? <span style={{ ...s.err, margin: 0 }}>{error}</span> : null}
        <button
          type="button"
          style={{
            ...s.btn,
            opacity: running || loading || !configured ? 0.65 : 1,
            cursor: running || loading || !configured ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
          disabled={running || loading || !configured}
          title={!configured ? 'LLM 未配置' : undefined}
          onClick={() => { void runSummarize(); }}
        >
          {running ? '归纳中…' : 'AI 归纳'}
        </button>
      </div>
    );
  }

  const stamp = formatStamp(summary.generatedAt);
  // inline: first-run button stays on the filter row; once a summary exists,
  // collapsed and expanded both take a full-width row (same as feedback).
  const shellStyle: CSSProperties = inline
    ? {
        ...cardShell,
        marginBottom: 0,
        flex: '1 1 100%',
        maxWidth: '100%',
      }
    : cardShell;

  return (
    <div style={shellStyle}>
      <div
        role="button"
        tabIndex={0}
        style={titleBar}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        aria-expanded={expanded}
      >
        <span style={{ fontWeight: 600, color: '#203047' }}>
          AI 归纳 · 基于 {summary.basedOnCount} 条 · {stamp}
        </span>
        {hasNewData ? (
          <span style={newDot}>
            <span aria-hidden style={{ color: '#d97706' }}>●</span>
            有新数据
          </span>
        ) : null}
        <span style={{ marginLeft: 'auto', color: '#8b97a9', fontSize: 12 }} aria-hidden>
          {expanded ? '▴' : '▾'}
        </span>
      </div>

      {expanded ? (
        <div style={{ padding: '0 0 10px', borderTop: '1px solid #eef1f5' }}>
          <ul style={themeList}>
            {summary.themes.map((theme) => (
              <li key={`${theme.title}-${theme.count}`} style={{ padding: '4px 0' }}>
                · {theme.title}（{theme.count} 条）
              </li>
            ))}
            {!summary.themes.length ? (
              <li style={{ padding: '8px 0', color: '#8b97a9' }}>暂无主题</li>
            ) : null}
          </ul>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, padding: '4px 12px 0' }}>
            {error ? <span style={{ ...s.err, margin: 0, fontSize: 12 }}>{error}</span> : null}
            <button
              type="button"
              style={{
                ...outlineBtn,
                opacity: running ? 0.65 : 1,
                cursor: running ? 'not-allowed' : 'pointer',
              }}
              disabled={running}
              onClick={(e) => {
                e.stopPropagation();
                void runSummarize();
              }}
            >
              {running ? '归纳中…' : '重新归纳'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
