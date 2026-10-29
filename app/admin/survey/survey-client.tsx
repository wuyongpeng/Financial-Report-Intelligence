'use client';

import { useCallback, useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AdminHeader,
  AdminLoginForm,
  adminStyles as s,
  useAdminSession,
} from '../_components/admin-shell';
import '../../docs/docs.css';

export function SurveyAdminClient() {
  const session = useAdminSession();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/survey', { cache: 'no-store', credentials: 'same-origin' });
      if (res.status === 401) {
        session.setAdmin(false);
        setError('管理员登录已失效，请重新登录');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || '加载失败');
      }
      const body = await res.json() as { content: string };
      setContent(body.content);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (session.admin) void load();
  }, [session.admin]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session.ready) {
    return <main style={s.wrap}><p style={{ color: '#6b7a8d' }}>加载中…</p></main>;
  }

  if (!session.admin) {
    return (
      <AdminLoginForm
        title="用户调研"
        hint="需要管理员密码后才能查看调研材料。"
        password={session.password}
        setPassword={session.setPassword}
        loginError={session.loginError}
        loggingIn={session.loggingIn}
        onSubmit={() => { void session.submitLogin(); }}
      />
    );
  }

  return (
    <main style={s.wrapWide}>
      <AdminHeader
        title="用户调研"
        subtitle="/admin/survey · 来自 docs/用户调研.md"
        activeHref="/admin/survey"
        onLogout={() => { void session.logout(); }}
      />
      {error ? <p style={s.err}>{error}</p> : null}
      {loading && !content ? <p style={s.muted}>加载中…</p> : null}
      {content ? (
        <article className="eva-docs-content" aria-label="用户调研" style={{ marginTop: 4 }}>
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              table: ({ children }) => <div className="eva-docs-table"><table>{children}</table></div>,
            }}
          >
            {content}
          </Markdown>
        </article>
      ) : null}
      <p style={{ ...s.muted, marginTop: 14 }}>
        仅展示已记录发现与方法；不虚构外部 POC / 准确率问卷结论。
      </p>
    </main>
  );
}
