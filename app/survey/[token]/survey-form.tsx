'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  B1_OPTIONS,
  B2_OPTIONS,
  B3_OPTIONS,
  B4_OPTIONS,
  B5_OPTIONS,
  D1_OPTIONS,
  D2_OPTIONS,
  D4_OPTIONS,
  isValidSurveyToken,
  randomSurveyNickname,
  type B1,
  type B2,
  type B3,
  type B4,
  type B5,
  type D1,
  type D2,
  type D4,
} from '@/lib/survey';

const wrap: CSSProperties = {
  maxWidth: 560, margin: '36px auto 64px', padding: '0 16px',
  fontFamily: 'system-ui, -apple-system, sans-serif', color: '#203047',
};
const muted: CSSProperties = { fontSize: 13, color: '#6b7a8d', lineHeight: 1.55, margin: 0 };
const h1: CSSProperties = { fontSize: 22, fontWeight: 650, margin: '14px 0 8px' };
const h2: CSSProperties = { fontSize: 15, fontWeight: 650, margin: '22px 0 10px' };
const err: CSSProperties = { color: '#b91c1c', fontSize: 13, margin: '0 0 12px' };
const btn: CSSProperties = {
  border: 0, borderRadius: 8, background: '#3064db', color: '#fff', padding: '9px 16px',
  fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
const btnGhost: CSSProperties = {
  border: '1px solid #d5dde8', borderRadius: 8, background: '#fff', color: '#3d5270',
  padding: '8px 12px', fontSize: 13, cursor: 'pointer', textDecoration: 'none', display: 'inline-block',
};
const chip: CSSProperties = {
  border: '1px solid #d5dde8', borderRadius: 999, background: '#fff', color: '#3d5270',
  padding: '7px 12px', fontSize: 13, cursor: 'pointer',
};
const chipOn: CSSProperties = {
  ...chip, borderColor: '#aec4ef', background: '#edf3ff', color: '#1f4fad', fontWeight: 600,
};
const cardOpt: CSSProperties = {
  border: '1px solid #e5eaf1', borderRadius: 10, background: '#fff', padding: '10px 12px',
  fontSize: 13, color: '#3a4d66', cursor: 'pointer', textAlign: 'left', width: '100%',
};
const cardOptOn: CSSProperties = {
  ...cardOpt, borderColor: '#aec4ef', background: '#edf3ff', color: '#1f4fad', fontWeight: 600,
};
const input: CSSProperties = {
  border: '1px solid #d5dde8', borderRadius: 8, padding: '8px 10px', fontSize: 14,
  color: '#203047', background: '#fff', width: '100%', boxSizing: 'border-box',
};
const label: CSSProperties = { fontSize: 13, color: '#516379', margin: '0 0 8px', fontWeight: 600 };
const qBlock: CSSProperties = { marginBottom: 18 };

function ChipGroup<T extends string>({
  options, value, onChange, disabled,
}: {
  options: readonly T[];
  value: T | '';
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          disabled={disabled}
          style={value === opt ? chipOn : chip}
          onClick={() => onChange(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function Question({ title, children, required }: { title: string; children: ReactNode; required?: boolean }) {
  return (
    <div style={qBlock}>
      <p style={label}>
        {required ? <span style={{ color: '#dc2626', marginRight: 4 }}>*</span> : null}
        {title}
      </p>
      {children}
    </div>
  );
}

export function SurveyForm({ token }: { token: string }) {
  const [ready, setReady] = useState(false);
  const [gateError, setGateError] = useState('');
  const [active, setActive] = useState(false);

  const [nickname, setNickname] = useState('');
  const [b1, setB1] = useState<B1 | ''>('');
  const [b2, setB2] = useState<B2 | ''>('');
  const [b3, setB3] = useState<B3 | ''>('');
  const [b4, setB4] = useState<B4 | ''>('');
  const [b5, setB5] = useState<B5 | ''>('');

  const [deepEnabled, setDeepEnabled] = useState(false);
  const [d1, setD1] = useState<D1[]>([]);
  const [d2, setD2] = useState<D2 | ''>('');
  const [d2Note, setD2Note] = useState('');
  const [d3, setD3] = useState(3);
  const [d3Touched, setD3Touched] = useState(false);
  const [d4, setD4] = useState<D4[]>([]);
  const [d4Other, setD4Other] = useState('');
  const [d5, setD5] = useState('');

  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function gate() {
      if (!isValidSurveyToken(token)) {
        setGateError('链接无效或已失效');
        setReady(true);
        return;
      }
      try {
        const res = await fetch(`/api/survey/${encodeURIComponent(token)}`, { cache: 'no-store' });
        const body = await res.json().catch(() => ({})) as { error?: string; active?: boolean; ok?: boolean };
        if (cancelled) return;
        if (!res.ok || !body.ok) {
          setGateError(body.error || (res.status === 410 ? '此调研链接已关闭' : '链接无效或已失效'));
          setActive(false);
        } else {
          setActive(true);
        }
      } catch {
        if (!cancelled) setGateError('暂时无法打开问卷，请稍后重试');
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    void gate();
    return () => { cancelled = true; };
  }, [token]);

  const basicReady = Boolean(b1 && b2 && b3 && b4 && b5);

  const d1Hint = useMemo(() => {
    if (!d1.length) return '点击选项，按顺序排出前三';
    return `已选：${d1.map((x, i) => `${i + 1}.${x}`).join('  ')}`;
  }, [d1]);

  function toggleD1(opt: D1) {
    setD1((prev) => {
      if (prev.includes(opt)) return prev.filter((x) => x !== opt);
      if (prev.length >= 3) return prev;
      return [...prev, opt];
    });
  }

  function toggleD4(opt: D4) {
    setD4((prev) => {
      if (prev.includes(opt)) return prev.filter((x) => x !== opt);
      if (prev.length >= 3) return prev;
      return [...prev, opt];
    });
  }

  async function submit() {
    if (!basicReady) {
      setError('请先完成基础 5 题');
      return;
    }
    setSending(true);
    setError('');
    try {
      const deep = deepEnabled ? {
        ...(d1.length ? { d1 } : {}),
        ...(d2 ? { d2: { choice: d2, ...(d2Note.trim() ? { note: d2Note.trim() } : {}) } } : {}),
        ...(d3Touched ? { d3 } : {}),
        ...((d4.length || d4Other.trim()) ? {
          d4: {
            choices: d4,
            ...(d4Other.trim() ? { other: d4Other.trim() } : {}),
          },
        } : {}),
        ...(d5.trim() ? { d5: d5.trim() } : {}),
      } : undefined;

      const res = await fetch(`/api/survey/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nickname: nickname.trim() || undefined,
          basic: { b1, b2, b3, b4, b5 },
          deepEnabled,
          ...(deepEnabled ? { deep } : {}),
        }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(body.error || '提交失败');
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败');
    } finally {
      setSending(false);
    }
  }

  if (!ready) {
    return <main style={wrap}><p style={muted}>加载中…</p></main>;
  }

  if (!active) {
    return (
      <main style={wrap}>
        <Link href="/" style={{ ...btnGhost, marginBottom: 16 }}>打开 Eva 首页</Link>
        <h1 style={h1}>无法打开问卷</h1>
        <p style={muted}>{gateError || '链接无效或已失效'}</p>
      </main>
    );
  }

  if (done) {
    return (
      <main style={wrap}>
        <h1 style={h1}>感谢反馈</h1>
        <p style={muted}>已收到。你的回答会帮助 Eva 把主路径做得更清楚、更可核对。</p>
        <p style={{ marginTop: 18 }}>
          <Link href="/" target="_blank" rel="noreferrer" style={btnGhost}>再打开 Eva</Link>
        </p>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Link href="/" target="_blank" rel="noreferrer" style={btnGhost}>打开 Eva 体验</Link>
      </div>

      <h1 style={h1}>Eva 体验调研</h1>
      <p style={muted}>
        Eva · 极简、易懂、可核对。希望用几分钟确认：主路径好不好上手、结论敢不敢信。
      </p>
      <p style={{ ...muted, marginTop: 8 }}>
        建议先点上方打开首页体验，再回到本页填写。约 2 分钟；深入反馈可关可开。
      </p>

      <h2 style={h2}>你是谁（选填）</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          style={{ ...input, flex: 1 }}
          value={nickname}
          maxLength={32}
          disabled={sending}
          placeholder="昵称，可不填"
          onChange={(e) => setNickname(e.target.value)}
        />
        <button
          type="button"
          style={btnGhost}
          disabled={sending}
          onClick={() => setNickname(randomSurveyNickname())}
        >
          随机一个
        </button>
      </div>

      <h2 style={h2}>基础问题</h2>
      <Question title="打开页面前，你平时怎么接触财报？" required>
        <ChipGroup options={B1_OPTIONS} value={b1} onChange={setB1} disabled={sending} />
      </Question>
      <Question title="从进站到打开一份公司，费劲吗？" required>
        <ChipGroup options={B2_OPTIONS} value={b2} onChange={setB2} disabled={sending} />
      </Question>
      <Question title="「事实 / 结论 / 追问」三栏，分得清吗？" required>
        <ChipGroup options={B3_OPTIONS} value={b3} onChange={setB3} disabled={sending} />
      </Question>
      <Question title="点过角标回原文核对吗？感觉如何？" required>
        <ChipGroup options={B4_OPTIONS} value={b4} onChange={setB4} disabled={sending} />
      </Question>
      <Question title="若下次再看财报，还会打开 Eva 吗？" required>
        <ChipGroup options={B5_OPTIONS} value={b5} onChange={setB5} disabled={sending} />
      </Question>

      <div style={{
        border: '1px solid #e5eaf1', borderRadius: 12, background: '#f8fafc',
        padding: '12px 14px', margin: '8px 0 6px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}
      >
        <div>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#203047' }}>愿意再花约 2 分钟做深入反馈</p>
          <p style={{ ...muted, marginTop: 4 }}>默认关闭；打开后可不答完。</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={deepEnabled}
          disabled={sending}
          onClick={() => setDeepEnabled((v) => !v)}
          style={{
            width: 48, height: 28, borderRadius: 999, border: 0, cursor: 'pointer', flexShrink: 0,
            background: deepEnabled ? '#3064db' : '#c9d3e2', position: 'relative',
          }}
        >
          <span style={{
            position: 'absolute', top: 3, left: deepEnabled ? 23 : 3,
            width: 22, height: 22, borderRadius: '50%', background: '#fff',
            transition: 'left 120ms ease',
          }}
          />
        </button>
      </div>

      {deepEnabled ? (
        <section style={{ marginTop: 8 }}>
          <h2 style={h2}>深入反馈</h2>
          <Question title="对你最有价值的一块？（点击排出前三）">
            <p style={{ ...muted, marginBottom: 8 }}>{d1Hint}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {D1_OPTIONS.map((opt) => {
                const rank = d1.indexOf(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    disabled={sending || (rank < 0 && d1.length >= 3)}
                    style={rank >= 0 ? cardOptOn : cardOpt}
                    onClick={() => toggleD1(opt)}
                  >
                    {rank >= 0 ? `${rank + 1}. ${opt}` : opt}
                  </button>
                );
              })}
            </div>
          </Question>

          <Question title="最卡住的一步是？">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {D2_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  disabled={sending}
                  style={d2 === opt ? cardOptOn : cardOpt}
                  onClick={() => setD2(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
            <input
              style={{ ...input, marginTop: 8 }}
              value={d2Note}
              disabled={sending}
              maxLength={200}
              placeholder="可选：补一句具体卡点"
              onChange={(e) => setD2Note(e.target.value)}
            />
          </Question>

          <Question title="「敢不敢信」打几分？">
            <div style={{ display: 'flex', justifyContent: 'space-between', ...muted, marginBottom: 6 }}>
              <span>完全不信</span>
              <span style={{ fontWeight: 650, color: '#1f4fad' }}>{d3}</span>
              <span>可以当核对入口</span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={d3}
              disabled={sending}
              style={{ width: '100%' }}
              onChange={(e) => {
                setD3(Number(e.target.value));
                setD3Touched(true);
              }}
            />
          </Question>

          <Question title="怎样会更愿意再用？（最多 3 项）">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {D4_OPTIONS.map((opt) => {
                const on = d4.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    disabled={sending || (!on && d4.length >= 3)}
                    style={on ? chipOn : chip}
                    onClick={() => toggleD4(opt)}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            {(d4.includes('其它短填') || d4Other) ? (
              <input
                style={{ ...input, marginTop: 8 }}
                value={d4Other}
                disabled={sending}
                maxLength={200}
                placeholder="其它：写一句"
                onChange={(e) => setD4Other(e.target.value)}
              />
            ) : null}
          </Question>

          <Question title="用一句话形容这次体验，或留下最想改的一点">
            <textarea
              style={{ ...input, minHeight: 84, resize: 'vertical' }}
              value={d5}
              disabled={sending}
              maxLength={500}
              placeholder="选填"
              onChange={(e) => setD5(e.target.value)}
            />
          </Question>
        </section>
      ) : null}

      {error ? <p style={err}>{error}</p> : null}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
        <button type="button" style={btn} disabled={sending || !basicReady} onClick={() => void submit()}>
          {sending ? '提交中…' : '提交'}
        </button>
        {!basicReady ? <span style={muted}>基础 5 题都选完才能提交</span> : null}
      </div>
    </main>
  );
}
