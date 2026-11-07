'use client';

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import './admin-shell.css';

/** Unified ops console: data loop (crawl/parse) + user loop (audit/survey/feedback). */
export const ADMIN_NAV_GROUPS = [
  {
    id: 'data',
    label: '数据管理',
    items: [
      { href: '/admin/sources', label: '数据采集' },
      { href: '/admin/metrics', label: '解析总览' },
      { href: '/admin/check', label: '指标核对' },
    ],
  },
  {
    id: 'user',
    label: '用户运营',
    items: [
      { href: '/admin/audit', label: '访问审计' },
      { href: '/admin/survey', label: '用户调研' },
      { href: '/admin/feedback', label: '反馈收集' },
    ],
  },
] as const;

export function AdminHeader({
  title,
  subtitle,
  activeHref,
  children,
}: {
  title: string;
  subtitle?: string;
  activeHref: string;
  children?: ReactNode;
}) {
  return (
    <header className="admin-header" style={headSticky} aria-label={title}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <h1 style={brand}>Eva 数据运营</h1>
        {subtitle ? <p style={{ ...muted, margin: '4px 0 0' }}>{subtitle}</p> : null}
        <nav className="admin-nav" style={nav} aria-label="数据运营">
          {ADMIN_NAV_GROUPS.map((group, gi) => (
            <span key={group.id} style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              {gi > 0 ? <span style={navDivider} aria-hidden="true" /> : null}
              <span style={navGroupLabel}>{group.label}</span>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="admin-nav-link"
                  aria-current={item.href === activeHref ? 'page' : undefined}
                  style={{
                    ...navLink,
                    ...(item.href === activeHref ? navLinkActive : null),
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </span>
          ))}
        </nav>
        {children}
      </div>
      <div style={{ display: 'flex', flexShrink: 0, gap: 8, alignItems: 'center' }}>
        <Link href="/" style={{ ...btnGhost, textDecoration: 'none', display: 'inline-block' }}>返回首页</Link>
      </div>
    </header>
  );
}


/** 不起眼小问号：悬停看说明，截图时不抢眼。 */
export function AdminHelpTip({ text }: { text: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 14,
        height: 14,
        borderRadius: '50%',
        border: '1px solid #c5d0de',
        color: '#8b97a9',
        fontSize: 10,
        fontWeight: 600,
        cursor: 'help',
        lineHeight: 1,
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      ?
    </span>
  );
}

export function AdminMain({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <main className="admin-page" style={{ ...wrapWide, ...style }}>
      {children}
    </main>
  );
}

const wrap: CSSProperties = {
  maxWidth: 480, margin: '48px auto', padding: '0 16px',
  fontFamily: 'system-ui, -apple-system, sans-serif', color: '#203047',
};
const wrapWide: CSSProperties = {
  maxWidth: 1400, width: '100%', margin: '8px auto 32px', padding: '0 16px',
  boxSizing: 'border-box',
  fontFamily: 'system-ui, -apple-system, sans-serif', color: '#203047',
};
const h1: CSSProperties = { fontSize: 22, fontWeight: 650, margin: '0 0 8px' };
const muted: CSSProperties = { fontSize: 13, color: '#6b7a8d', lineHeight: 1.5 };
const input: CSSProperties = {
  border: '1px solid #d5dde8', borderRadius: 8, padding: '8px 10px', fontSize: 14, color: '#203047', background: '#fff',
};
const btn: CSSProperties = {
  border: 0, borderRadius: 8, background: '#3064db', color: '#fff', padding: '8px 14px',
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const btnGhost: CSSProperties = {
  border: '1px solid #d5dde8', borderRadius: 8, background: '#fff', color: '#3d5270',
  padding: '7px 12px', fontSize: 13, cursor: 'pointer',
};
const btnDanger: CSSProperties = {
  border: 0, borderRadius: 4, background: 'transparent', color: '#b91c1c',
  padding: '2px 4px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
const btnAck: CSSProperties = {
  border: 0, borderRadius: 4, background: 'transparent', color: '#15803d',
  padding: '2px 4px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
const btnFlag: CSSProperties = {
  border: 0, borderRadius: 4, background: 'transparent', color: '#b45309',
  padding: '2px 4px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
const btnParse: CSSProperties = {
  border: 0, borderRadius: 4, background: 'transparent', color: '#1f4fad',
  padding: '2px 4px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
const err: CSSProperties = { color: '#b91c1c', fontSize: 13, margin: '0 0 12px' };
const head: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 };
/** Sticky admin chrome: brand + tabs (+ optional toast children) stay visible while tables scroll. */
const headSticky: CSSProperties = {
  ...head,
  position: 'sticky',
  top: 0,
  zIndex: 40,
  marginBottom: 8,
  marginLeft: -16,
  marginRight: -16,
  paddingTop: 6,
  paddingBottom: 6,
  paddingLeft: 16,
  paddingRight: 16,
  background: 'var(--bg, #f4f6f9)',
  borderBottom: '1px solid #e5eaf1',
  boxShadow: '0 8px 16px -12px rgba(32, 48, 71, 0.35)',
};
const filters: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' };
const tableWrap: CSSProperties = { overflow: 'auto', border: '1px solid #e5eaf1', borderRadius: 12, background: '#fff' };
const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const th: CSSProperties = {
  textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #e5eaf1',
  background: '#f6f8fc', color: '#5b6d86', fontWeight: 600, whiteSpace: 'nowrap',
};
const td: CSSProperties = {
  padding: '9px 12px', borderBottom: '1px solid #eef1f5', verticalAlign: 'top',
  color: '#3a4d66', overflowWrap: 'anywhere',
};
const brand: CSSProperties = {
  margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '0.01em', color: '#203047', lineHeight: 1.25,
};
const nav: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 6, alignItems: 'center' };
const navGroupLabel: CSSProperties = {
  fontSize: 12, color: '#3d5270', fontWeight: 600, letterSpacing: '0.04em', marginRight: 2,
};
const navDivider: CSSProperties = {
  width: 1, height: 24, background: '#d5dde8', margin: '0 4px',
};
const navLink: CSSProperties = {
  fontSize: 12, color: '#5b6d86', textDecoration: 'none',
  display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 12px',
  borderRadius: 6, border: '1px solid transparent', background: 'transparent', fontWeight: 400,
};
const navLinkActive: CSSProperties = {
  color: '#fff', borderColor: '#3064db', background: '#3064db', fontWeight: 600,
};
const cardRow: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 12,
};
/** Inline chip row: cards sit side-by-side at content width (metrics filters). */
const chipRow: CSSProperties = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12,
};
const card: CSSProperties = {
  border: '1px solid #e5eaf1', borderRadius: 10, background: '#fff', padding: '12px 14px',
};
/** Compact one-line summary / filter chips (metrics). */
const cardCompact: CSSProperties = {
  border: '1px solid #e5eaf1', borderRadius: 8, background: '#fff',
  padding: '5px 10px',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-start', gap: 8,
  width: 'fit-content', maxWidth: '100%',
  minHeight: 32,
};
const cardLabel: CSSProperties = { fontSize: 12, color: '#6b7a8d', margin: 0 };
const cardValue: CSSProperties = { fontSize: 18, fontWeight: 650, margin: '6px 0 0', fontVariantNumeric: 'tabular-nums' };
const cardValueCompact: CSSProperties = {
  fontSize: 15, fontWeight: 650, margin: 0, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2,
};

export const adminStyles = {
  wrap,
  wrapWide,
  h1,
  muted,
  input,
  btn,
  btnGhost,
  btnDanger,
  btnAck,
  btnFlag,
  btnParse,
  err,
  head,
  filters,
  tableWrap,
  table,
  th,
  td,
  cardRow,
  chipRow,
  card,
  cardCompact,
  cardLabel,
  cardValue,
  cardValueCompact,
} as const;
