'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '@/app/ui-icons';
import {
  B1_OPTIONS,
  B2_OPTIONS,
  B3_OPTIONS,
  B4_OPTIONS,
  B5_OPTIONS,
  B6_CHOICES,
  D1_OPTIONS,
  D2_OPTIONS,
  D4_OPTIONS,
  D6_OPTIONS,
  D7_OPTIONS,
  D8_OPTIONS,
  D10_OPTIONS,
  isValidSurveyToken,
  randomSurveyNickname,
  type B1,
  type B2,
  type B3,
  type B4,
  type B5,
  type B6Choice,
  type D1,
  type D2,
  type D4,
  type D6,
  type D7,
  type D8,
  type D10,
  type SurveyBasic,
  type SurveyDeep,
} from '@/lib/survey';

const wrap: CSSProperties = {
  maxWidth: 920, margin: '28px auto 64px', padding: '0 24px',
  fontFamily: 'system-ui, -apple-system, sans-serif', color: '#203047',
};
const muted: CSSProperties = { fontSize: 13, color: '#6b7a8d', lineHeight: 1.55, margin: 0 };
const h1: CSSProperties = { fontSize: 24, fontWeight: 700, margin: '8px 0 8px' };
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
const input: CSSProperties = {
  border: '1px solid #d5dde8', borderRadius: 8, padding: '8px 10px', fontSize: 14,
  color: '#203047', background: '#fff', width: '100%', boxSizing: 'border-box',
};
const label: CSSProperties = { fontSize: 13, color: '#516379', margin: '0 0 8px', fontWeight: 600 };
const qBlock: CSSProperties = { marginBottom: 14 };
const deepGrid: CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 28px', alignItems: 'start',
};
const deepFull: CSSProperties = { gridColumn: '1 / -1' };
const stepCard: CSSProperties = {
  border: '1px solid #e5eaf1', borderRadius: 12, background: '#f8fafc',
  padding: '16px 18px', margin: '14px 0 8px',
};

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

function MultiChipGroup<T extends string>({
  options, values, onToggle, disabled,
}: {
  options: readonly T[];
  values: T[];
  onToggle: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map((opt) => {
        const on = values.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            style={on ? chipOn : chip}
            onClick={() => onToggle(opt)}
          >
            {opt}
          </button>
        );
      })}
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

type SavedSubmission = {
  nickname: string | null;
  basic: SurveyBasic | Record<string, unknown>;
  deep: SurveyDeep | null;
  createdAt?: string;
};

function applySavedBasic(
  basic: Record<string, unknown>,
  setters: {
    setB1: (v: B1[]) => void;
    setB2: (v: B2 | '') => void;
    setB3: (v: B3 | '') => void;
    setB4: (v: B4 | '') => void;
    setB5: (v: B5 | '') => void;
    setB6: (v: B6Choice | '') => void;
    setB6Product: (v: string) => void;
    setBasicNote: (v: string) => void;
  },
) {
  const b1 = basic.b1;
  if (Array.isArray(b1)) {
    setters.setB1(b1.filter((x): x is B1 => typeof x === 'string' && (B1_OPTIONS as readonly string[]).includes(x)));
  } else if (typeof b1 === 'string' && (B1_OPTIONS as readonly string[]).includes(b1)) {
    setters.setB1([b1 as B1]);
  }
  if (typeof basic.b2 === 'string' && (B2_OPTIONS as readonly string[]).includes(basic.b2)) {
    setters.setB2(basic.b2 as B2);
  }
  if (typeof basic.b3 === 'string' && (B3_OPTIONS as readonly string[]).includes(basic.b3)) {
    setters.setB3(basic.b3 as B3);
  }
  if (typeof basic.b4 === 'string' && (B4_OPTIONS as readonly string[]).includes(basic.b4)) {
    setters.setB4(basic.b4 as B4);
  }
  if (typeof basic.b5 === 'string' && (B5_OPTIONS as readonly string[]).includes(basic.b5)) {
    setters.setB5(basic.b5 as B5);
  }
  const b6 = basic.b6;
  if (b6 && typeof b6 === 'object' && !Array.isArray(b6)) {
    const choice = (b6 as Record<string, unknown>).choice;
    const product = (b6 as Record<string, unknown>).product;
    if (typeof choice === 'string' && (B6_CHOICES as readonly string[]).includes(choice)) {
      setters.setB6(choice as B6Choice);
    }
    if (typeof product === 'string') setters.setB6Product(product);
  }
  if (typeof basic.note === 'string') setters.setBasicNote(basic.note);
}

function applySavedDeep(
  deep: SurveyDeep | null,
  setters: {
    setDeepEnabled: (v: boolean) => void;
    setD1: (v: D1[]) => void;
    setD2: (v: D2 | '') => void;
    setD2Note: (v: string) => void;
    setD3: (v: number) => void;
    setD3Touched: (v: boolean) => void;
    setD4: (v: D4[]) => void;
    setD4Other: (v: string) => void;
    setD5: (v: string) => void;
    setD6: (v: D6 | '') => void;
    setD7: (v: D7 | '') => void;
    setD8: (v: D8[]) => void;
    setD9: (v: number) => void;
    setD9Touched: (v: boolean) => void;
    setD10: (v: D10 | '') => void;
    setD10Note: (v: string) => void;
  },
) {
  if (!deep) {
    setters.setDeepEnabled(false);
    return;
  }
  setters.setDeepEnabled(true);
  if (deep.d1?.length) setters.setD1(deep.d1);
  if (deep.d2?.choice) {
    setters.setD2(deep.d2.choice);
    if (deep.d2.note) setters.setD2Note(deep.d2.note);
  }
  if (typeof deep.d3 === 'number') {
    setters.setD3(deep.d3);
    setters.setD3Touched(true);
  }
  if (deep.d4) {
    if (deep.d4.choices?.length) setters.setD4(deep.d4.choices);
    if (deep.d4.other) setters.setD4Other(deep.d4.other);
  }
  if (deep.d5) setters.setD5(deep.d5);
  if (deep.d6) setters.setD6(deep.d6);
  if (deep.d7) setters.setD7(deep.d7);
  if (deep.d8?.length) setters.setD8(deep.d8);
  if (typeof deep.d9 === 'number') {
    setters.setD9(deep.d9);
    setters.setD9Touched(true);
  }
  if (deep.d10?.choice) {
    setters.setD10(deep.d10.choice);
    if (deep.d10.note) setters.setD10Note(deep.d10.note);
  }
}

export function SurveyForm({ token }: { token: string }) {
  const [ready, setReady] = useState(false);
  const [gateError, setGateError] = useState('');
  const [active, setActive] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [view, setView] = useState<'form' | 'success'>('form');

  const [nickname, setNickname] = useState('');
  const [b1, setB1] = useState<B1[]>([]);
  const [b2, setB2] = useState<B2 | ''>('');
  const [b3, setB3] = useState<B3 | ''>('');
  const [b4, setB4] = useState<B4 | ''>('');
  const [b5, setB5] = useState<B5 | ''>('');
  const [b6, setB6] = useState<B6Choice | ''>('');
  const [b6Product, setB6Product] = useState('');
  const [basicNote, setBasicNote] = useState('');

  const [deepEnabled, setDeepEnabled] = useState(false);
  const [d1, setD1] = useState<D1[]>([]);
  const [d2, setD2] = useState<D2 | ''>('');
  const [d2Note, setD2Note] = useState('');
  const [d3, setD3] = useState(3);
  const [d3Touched, setD3Touched] = useState(false);
  const [d4, setD4] = useState<D4[]>([]);
  const [d4Other, setD4Other] = useState('');
  const [d5, setD5] = useState('');
  const [d6, setD6] = useState<D6 | ''>('');
  const [d7, setD7] = useState<D7 | ''>('');
  const [d8, setD8] = useState<D8[]>([]);
  const [d9, setD9] = useState(3);
  const [d9Touched, setD9Touched] = useState(false);
  const [d10, setD10] = useState<D10 | ''>('');
  const [d10Note, setD10Note] = useState('');

  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

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
        const body = await res.json().catch(() => ({})) as {
          error?: string;
          active?: boolean;
          ok?: boolean;
          submitted?: boolean;
          submission?: SavedSubmission;
        };
        if (cancelled) return;
        if (!res.ok || !body.ok) {
          setGateError(body.error || (res.status === 410 ? '此调研链接已关闭' : '链接无效或已失效'));
          setActive(false);
        } else {
          setActive(true);
          if (body.submitted && body.submission) {
            setSubmitted(true);
            setView('success');
            if (body.submission.nickname) setNickname(body.submission.nickname);
            applySavedBasic(body.submission.basic as Record<string, unknown>, {
              setB1, setB2, setB3, setB4, setB5, setB6, setB6Product, setBasicNote,
            });
            applySavedDeep(body.submission.deep, {
              setDeepEnabled, setD1, setD2, setD2Note, setD3, setD3Touched,
              setD4, setD4Other, setD5, setD6, setD7, setD8, setD9, setD9Touched, setD10, setD10Note,
            });
          }
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

  const basicReady = Boolean(b1.length && b2 && b3 && b4 && b5 && b6);

  const d1Hint = useMemo(() => {
    if (!d1.length) return '点击选项，按顺序排出前三';
    return `已选：${d1.map((x, i) => `${i + 1}.${x}`).join('  ')}`;
  }, [d1]);

  function toggleB1(opt: B1) {
    setB1((prev) => (prev.includes(opt) ? prev.filter((x) => x !== opt) : [...prev, opt]));
  }

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

  function toggleD8(opt: D8) {
    setD8((prev) => {
      if (prev.includes(opt)) return prev.filter((x) => x !== opt);
      if (prev.length >= 3) return prev;
      return [...prev, opt];
    });
  }

  async function submit() {
    if (!basicReady) {
      setError('请先完成基础必答题');
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
        ...(d6 ? { d6 } : {}),
        ...(d7 ? { d7 } : {}),
        ...(d8.length ? { d8 } : {}),
        ...(d9Touched ? { d9 } : {}),
        ...(d10 ? { d10: { choice: d10, ...(d10Note.trim() ? { note: d10Note.trim() } : {}) } } : {}),
      } : undefined;

      const res = await fetch(`/api/survey/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nickname: nickname.trim() || undefined,
          basic: {
            b1,
            b2,
            b3,
            b4,
            b5,
            b6: {
              choice: b6,
              ...(b6 === '用过' && b6Product.trim() ? { product: b6Product.trim() } : {}),
            },
            ...(basicNote.trim() ? { note: basicNote.trim() } : {}),
          },
          deepEnabled,
          ...(deepEnabled ? { deep } : {}),
        }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(body.error || '提交失败');
      setSubmitted(true);
      setView('success');
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

  if (view === 'success') {
    return (
      <main style={{ ...wrap, textAlign: 'center', paddingTop: 72 }}>
        <h1 style={{ ...h1, marginBottom: 28 }}>提交成功，感谢参与!</h1>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" style={btnGhost} onClick={() => setView('form')}>
            查看问卷
          </button>
          <Link href="/" target="_blank" rel="noreferrer" style={{ ...btn, textDecoration: 'none' }}>
            返回 Eva
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <h1 style={h1}>Eva 用户问卷</h1>
      <p style={muted}>Hi, 欢迎体验财报智能分析助手Eva,帮你快速读懂 A 股财报</p>

      <section style={stepCard}>
        <p style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 650 }}>第 1 步 · 体验Eva</p>
        <p style={{ ...muted, marginBottom: 14 }}>
          挑一家你关心的公司,看看财报,提一个问题,再点一下回答里的角标试试
        </p>
        <Link href="/" target="_blank" rel="noreferrer" style={{ ...btn, textDecoration: 'none', display: 'inline-block' }}>
          打开 Eva
        </Link>
      </section>

      <h2 style={{ ...h2, marginTop: 18 }}>第 2 步 · 问卷(约 2 分钟)</h2>
      <div style={{ borderTop: '1px solid #e5eaf1', marginBottom: 14 }} />

      <div style={deepGrid}>
        <div style={deepFull}>
          <Question title="1. 打开页面前,你平时怎么接触财报?(多选)" required>
            <MultiChipGroup options={B1_OPTIONS} values={b1} onToggle={toggleB1} disabled={sending} />
          </Question>
        </div>

        <Question title="2. 从打开 Eva 到看到一家公司的财报,过程如何?" required>
          <ChipGroup options={B2_OPTIONS} value={b2} onChange={setB2} disabled={sending} />
        </Question>

        <Question title="3. 详情页的左、中、右三栏布局合理吗?" required>
          <ChipGroup options={B3_OPTIONS} value={b3} onChange={setB3} disabled={sending} />
        </Question>

        <Question title="4. 体验后,你对这家公司的财报有没有更清楚的认识?" required>
          <ChipGroup options={B4_OPTIONS} value={b4} onChange={setB4} disabled={sending} />
        </Question>

        <Question title="5. 回答里的角标,你用过吗?" required>
          <ChipGroup options={B5_OPTIONS} value={b5} onChange={setB5} disabled={sending} />
        </Question>

        <div style={deepFull}>
          <Question title="6. 你用过类似 Eva 的产品吗?" required>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <ChipGroup
                options={B6_CHOICES}
                value={b6}
                onChange={(v) => {
                  setB6(v);
                  if (v !== '用过') setB6Product('');
                }}
                disabled={sending}
              />
              {b6 === '用过' ? (
                <input
                  style={{ ...input, maxWidth: 280, width: 'auto', flex: '1 1 180px' }}
                  value={b6Product}
                  disabled={sending}
                  maxLength={80}
                  placeholder="输入具体产品名称"
                  onChange={(e) => setB6Product(e.target.value)}
                />
              ) : null}
            </div>
          </Question>
        </div>

        <div style={deepFull}>
          <Question title="7. 还有什么想说的?(选填)">
            <textarea
              style={{ ...input, minHeight: 64, resize: 'vertical' }}
              value={basicNote}
              disabled={sending}
              maxLength={200}
              placeholder="选填"
              onChange={(e) => setBasicNote(e.target.value)}
            />
          </Question>
        </div>
      </div>

      <div style={{
        border: '1px solid #e5eaf1', borderRadius: 12, background: '#f8fafc',
        padding: '12px 14px', margin: '8px 0 6px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}
      >
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#203047' }}>继续深入反馈</p>
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
          <div style={deepGrid}>
            <div style={deepFull}>
              <Question title="对你最有价值的一块？（点选排出前三）">
                <p style={{ ...muted, marginBottom: 8 }}>{d1Hint}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {D1_OPTIONS.map((opt) => {
                    const rank = d1.indexOf(opt);
                    return (
                      <button
                        key={opt}
                        type="button"
                        disabled={sending || (rank < 0 && d1.length >= 3)}
                        style={rank >= 0 ? chipOn : chip}
                        onClick={() => toggleD1(opt)}
                      >
                        {rank >= 0 ? `${rank + 1}. ${opt}` : opt}
                      </button>
                    );
                  })}
                </div>
              </Question>
            </div>

            <Question title="最卡住的一步？">
              <ChipGroup options={D2_OPTIONS} value={d2} onChange={setD2} disabled={sending} />
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
                <span>可当核对入口</span>
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

            <div style={deepFull}>
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
            </div>

            <div style={deepFull}>
              <Question title="用一句话形容这次体验，或留下最想改的一点">
                <textarea
                  style={{ ...input, minHeight: 64, resize: 'vertical' }}
                  value={d5}
                  disabled={sending}
                  maxLength={500}
                  placeholder="选填"
                  onChange={(e) => setD5(e.target.value)}
                />
              </Question>
            </div>

            <Question title="信息密度感觉？">
              <ChipGroup options={D6_OPTIONS} value={d6} onChange={setD6} disabled={sending} />
            </Question>

            <Question title="首次找到结论大概要多久？">
              <ChipGroup options={D7_OPTIONS} value={d7} onChange={setD7} disabled={sending} />
            </Question>

            <div style={deepFull}>
              <Question title="最想优先加强？（最多 3 项）">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {D8_OPTIONS.map((opt) => {
                    const on = d8.includes(opt);
                    return (
                      <button
                        key={opt}
                        type="button"
                        disabled={sending || (!on && d8.length >= 3)}
                        style={on ? chipOn : chip}
                        onClick={() => toggleD8(opt)}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </Question>
            </div>

            <Question title="会推荐同事试用吗？">
              <div style={{ display: 'flex', justifyContent: 'space-between', ...muted, marginBottom: 6 }}>
                <span>不会</span>
                <span style={{ fontWeight: 650, color: '#1f4fad' }}>{d9}</span>
                <span>会强烈推荐</span>
              </div>
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={d9}
                disabled={sending}
                style={{ width: '100%' }}
                onChange={(e) => {
                  setD9(Number(e.target.value));
                  setD9Touched(true);
                }}
              />
            </Question>

            <Question title="下次最想先试的场景？">
              <ChipGroup options={D10_OPTIONS} value={d10} onChange={setD10} disabled={sending} />
              {(d10 === '其它' || d10Note) ? (
                <input
                  style={{ ...input, marginTop: 8 }}
                  value={d10Note}
                  disabled={sending}
                  maxLength={200}
                  placeholder="其它：写一句"
                  onChange={(e) => setD10Note(e.target.value)}
                />
              ) : null}
            </Question>
          </div>
        </section>
      ) : null}

      <h2 style={h2}>怎么称呼(选填)</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          style={{ ...input, flex: 1 }}
          value={nickname}
          maxLength={32}
          disabled={sending}
          placeholder="选填"
          onChange={(e) => setNickname(e.target.value)}
        />
        <button
          type="button"
          style={{ ...btnGhost, padding: '8px 10px', display: 'inline-flex', alignItems: 'center' }}
          disabled={sending}
          aria-label="随机昵称"
          title="随机昵称"
          onClick={() => setNickname(randomSurveyNickname())}
        >
          <Icon name="refresh" size={14} />
        </button>
      </div>

      {error ? <p style={err}>{error}</p> : null}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16 }}>
        <button type="button" style={btn} disabled={sending || !basicReady} onClick={() => void submit()}>
          {sending ? '提交中…' : (submitted ? '再次提交' : '提交')}
        </button>
        {!basicReady ? <span style={muted}>基础必答题选完才能提交</span> : null}
      </div>
    </main>
  );
}
