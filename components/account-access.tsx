'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { PasswordInput } from '@/components/password-input';
import {
  closeAccountDialog,
  dismissGuestBanner,
  getAccountView,
  openAccountDialog,
  refreshAccount,
  requestLoginForRestricted,
  submitLogin,
  submitLogout,
  submitRegister,
  subscribeAccount,
  type AccountView,
} from '@/lib/account-client';
import { requestHomeMenuAction } from '@/lib/home-menu-actions';
import './account-access.css';

function useAccountView() {
  const [state, setState] = useState<AccountView>(getAccountView());
  useEffect(() => subscribeAccount(() => setState(getAccountView())), []);
  return state;
}

function isAdminPath(pathname: string | null) {
  return Boolean(pathname?.startsWith('/admin'));
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hidden = isAdminPath(pathname);
  const account = useAccountView();

  useEffect(() => {
    if (hidden) return;
    void refreshAccount();
  }, [hidden]);

  return (
    <>
      {!hidden && account.ready && account.role === 'guest' && !account.bannerDismissed ? (
        <div className="acc-banner" role="status">
          <p>当前为访客，数据仅本地 / 会话有效，关闭页面会丢失</p>
          <button type="button" className="acc-banner-close" aria-label="关闭提示" onClick={() => dismissGuestBanner()}>×</button>
        </div>
      ) : null}
      {children}
      {!hidden ? <AccountDialogs account={account} /> : null}
    </>
  );
}

function quotaCaption(account: AccountView, guest: boolean) {
  if (account.quota?.unlimited) return '对话次数不限';
  if (account.quota?.remaining != null) {
    return guest
      ? `今日剩余对话 ${account.quota.remaining} 次`
      : `剩余对话 ${account.quota.remaining} 次`;
  }
  return guest ? '今日可对话 9 次' : '注册后可对话 100 次';
}

export function AccountMenu() {
  const pathname = usePathname();
  const account = useAccountView();
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const moreId = useId();
  const hidden = isAdminPath(pathname);
  const guest = account.role !== 'user';

  useEffect(() => {
    if (!open) {
      setMoreOpen(false);
      return;
    }
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (moreOpen) {
        setMoreOpen(false);
        return;
      }
      setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, moreOpen]);

  if (hidden) return null;

  const remaining = quotaCaption(account, guest);

  function closeMenu() {
    setMoreOpen(false);
    setOpen(false);
  }

  return (
    <div className="acc-menu" ref={rootRef}>
      <button
        type="button"
        className={`acc-avatar ${guest ? 'is-guest' : 'is-user'}`}
        aria-label={guest ? '访客模式' : account.username || '已登录'}
        title={guest ? '访客模式' : account.username || '已登录'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        {guest ? <GuestAvatarIcon /> : <span>{(account.username || '用').slice(0, 1)}</span>}
      </button>
      {open ? (
        <div className="acc-panel" id={menuId} role="menu" aria-label={guest ? '访客模式' : '账户'}>
          <div className="acc-panel-head">
            <h2>{guest ? '访客模式' : account.username}</h2>
            <p>{remaining}</p>
          </div>
          <button type="button" role="menuitem" className="acc-item" onClick={() => { closeMenu(); requestHomeMenuAction('prefs'); }}>账号设置</button>
          <button type="button" role="menuitem" className="acc-item" onClick={() => { closeMenu(); requestHomeMenuAction('feedback'); }}>发送反馈</button>
          <button
            type="button"
            role="menuitem"
            className={`acc-item acc-item-more${moreOpen ? ' is-open' : ''}`}
            aria-expanded={moreOpen}
            aria-controls={moreId}
            onClick={() => setMoreOpen((value) => !value)}
          >
            <span>了解更多</span>
            <span className={`acc-item-chevron${moreOpen ? ' is-open' : ''}`} aria-hidden="true">&gt;</span>
          </button>
          {moreOpen ? (
            <div className="acc-more-group" id={moreId} role="group" aria-label="了解更多">
              <Link role="menuitem" className="acc-item" href="/docs" target="_blank" rel="noopener noreferrer" onClick={closeMenu}>帮助中心</Link>
              <Link role="menuitem" className="acc-item" href="/legal" onClick={closeMenu}>服务条款</Link>
              <button type="button" role="menuitem" className="acc-item" onClick={() => { closeMenu(); requestHomeMenuAction('about'); }}>关于Eva</button>
            </div>
          ) : null}
          {guest ? (
            <div className="acc-panel-auth">
              <button type="button" role="menuitem" className="acc-item" onClick={() => { closeMenu(); openAccountDialog('login'); }}>登录</button>
            </div>
          ) : (
            <div className="acc-panel-auth">
              <button type="button" role="menuitem" className="acc-item" onClick={() => { closeMenu(); void submitLogout(); }}>退出登录</button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}


type HistoryItem = {
  id: string;
  report_id: string;
  title: string;
  code: string | null;
  company_name: string | null;
  period: string | null;
};

export function AccountWorkspace({ panel, onClose }: { panel: 'history' | 'delete' | 'password'; onClose: () => void }) {
  const router = useRouter();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(panel === 'history');
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let active = true;
    if (panel === 'history') {
      void (async () => {
        try {
          const response = await fetch('/api/me/conversations', { cache: 'no-store', credentials: 'same-origin' });
          const payload = await response.json().catch(() => ({})) as { conversations?: HistoryItem[]; error?: string };
          if (!active) return;
          if (!response.ok) {
            setError(payload.error || '对话历史暂时无法读取');
            setLoading(false);
            return;
          }
          setItems(payload.conversations ?? []);
        } catch {
          if (active) setError('对话历史暂时无法读取');
        } finally {
          if (active) setLoading(false);
        }
      })();
    }
    return () => { active = false; };
  }, [panel]);

  async function deleteAccount() {
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/auth/account', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(payload.error || '注销失败');
        return;
      }
      await refreshAccount();
      onClose();
    } catch {
      setError('注销失败，请稍后重试');
    } finally {
      setPending(false);
    }
  }

  async function changePassword() {
    setPending(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch('/api/auth/account', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
      if (!response.ok) {
        setError(payload.error || '密码未能更新');
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess(payload.message || '密码已更新');
    } catch {
      setError('密码未能更新，请稍后重试');
    } finally {
      setPending(false);
    }
  }

  const title = panel === 'history' ? '对话历史' : panel === 'password' ? '修改密码' : '注销账号';

  return (
    <div className="acc-backdrop" onClick={() => { if (!pending) onClose(); }}>
      <div className="acc-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        {panel === 'history' ? (
          <>
            <p>换设备后也可以继续查看已保存的追问。</p>
            {loading ? <p>正在读取…</p> : null}
            {error ? <p className="acc-error">{error}</p> : null}
            {!loading && !error && items.length === 0 ? <p>还没有保存的对话。</p> : null}
            {items.length ? (
              <ul className="acc-history">
                {items.map((item) => {
                  const href = item.code
                    ? `/${item.code}?${new URLSearchParams({
                        ...(item.period ? { period: item.period } : {}),
                        ...(item.report_id ? { report: item.report_id } : {}),
                        conversation: item.id,
                      }).toString()}`
                    : `/`;
                  const label = [item.company_name, item.code, item.period].filter(Boolean).join(' · ') || '未关联报告';
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="acc-history-item"
                        onClick={() => { onClose(); router.push(href); }}
                      >
                        <strong>{item.title || '未命名对话'}</strong>
                        <span>{label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <div className="acc-dialog-actions">
              <button type="button" className="acc-btn-ghost" onClick={onClose}>关闭</button>
            </div>
          </>
        ) : null}
        {panel === 'password' ? (
          <>
            <p>请输入当前密码，并设置新密码。</p>
            <label className="acc-label" htmlFor="acc-password-current">当前密码</label>
            <PasswordInput id="acc-password-current" className="acc-input" value={currentPassword} autoComplete="current-password" disabled={pending} onChange={(event) => setCurrentPassword(event.target.value)} />
            <label className="acc-label" htmlFor="acc-password-new">新密码</label>
            <PasswordInput id="acc-password-new" className="acc-input" value={newPassword} autoComplete="new-password" disabled={pending} onChange={(event) => setNewPassword(event.target.value)} />
            <label className="acc-label" htmlFor="acc-password-new-confirm">再次输入新密码</label>
            <PasswordInput id="acc-password-new-confirm" className="acc-input" value={confirmPassword} autoComplete="new-password" disabled={pending} onChange={(event) => setConfirmPassword(event.target.value)} />
            {error ? <p className="acc-error">{error}</p> : null}
            {success ? <p className="acc-error">{success}</p> : null}
            <div className="acc-dialog-actions">
              <button type="button" className="acc-btn-ghost" disabled={pending} onClick={onClose}>关闭</button>
              <button type="button" className="acc-btn-primary" disabled={pending || !currentPassword || !newPassword || !confirmPassword} onClick={() => void changePassword()}>{pending ? '提交中…' : '更新密码'}</button>
            </div>
          </>
        ) : null}
        {panel === 'delete' ? (
          <>
            <p>注销后将删除该账号的自选、对话、通知和账号本身，已公开分享的答案也会移除。公开公告数据不会删除。此操作不可恢复。</p>
            <label className="acc-label" htmlFor="acc-delete-password">输入密码以确认</label>
            <PasswordInput id="acc-delete-password" className="acc-input" value={password} autoComplete="current-password" disabled={pending} onChange={(event) => setPassword(event.target.value)} />
            {error ? <p className="acc-error">{error}</p> : null}
            <div className="acc-dialog-actions">
              <button type="button" className="acc-btn-ghost" disabled={pending} onClick={onClose}>取消</button>
              <button type="button" className="acc-btn-secondary" disabled={pending || !password} onClick={() => void deleteAccount()}>{pending ? '注销中…' : '确认注销'}</button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function AccountDialogs({ account }: { account: AccountView }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (account.dialog === 'login' || account.dialog === 'register') {
      setUsername('');
      setPassword('');
      setConfirmPassword('');
      setSuccess('');
    }
  }, [account.dialog]);

  if (!account.dialog && !success) return null;

  async function onLogin() {
    setPending(true);
    try { await submitLogin(username, password); }
    finally { setPending(false); }
  }

  async function onRegister() {
    setPending(true);
    try {
      const message = await submitRegister(username, password, confirmPassword);
      if (message) setSuccess(typeof message === 'string' ? message : '注册成功');
    } finally { setPending(false); }
  }

  const title = success
    ? '注册成功'
    : account.dialog === 'login'
      ? '登录'
      : account.dialog === 'register'
        ? '注册'
        : account.dialog === 'suggest'
          ? '建议注册'
          : account.dialog === 'quota'
            ? '超过限额'
            : '请先登录';

  return (
    <div className="acc-backdrop" onClick={() => { if (!pending && !success) closeAccountDialog(); }}>
      <div className="acc-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        {success ? (
          <>
            <h2>注册成功</h2>
            <p>账号已创建，正在以该账号继续使用。</p>
            <div className="acc-dialog-actions">
              <button type="button" className="acc-btn-primary" onClick={() => { setSuccess(''); closeAccountDialog(); }}>好的</button>
            </div>
          </>
        ) : account.dialog === 'login' || account.dialog === 'register' || account.dialog === 'restricted' ? (
          <>
            <h2>{account.dialog === 'restricted' ? '请先登录' : title}</h2>
            {account.dialog === 'restricted' ? <p>该操作需要登录后使用。也可以直接注册一个账号。</p> : null}
            <label className="acc-label" htmlFor="acc-username">用户名</label>
            <input id="acc-username" className="acc-input" value={username} autoComplete="username" disabled={pending} onChange={(event) => setUsername(event.target.value)} />
            <label className="acc-label" htmlFor="acc-password">密码</label>
            <PasswordInput id="acc-password" className="acc-input" value={password} autoComplete={account.dialog === 'register' ? 'new-password' : 'current-password'} disabled={pending} onChange={(event) => setPassword(event.target.value)} />
            {account.dialog === 'register' ? (
              <>
                <label className="acc-label" htmlFor="acc-password-confirm">再次输入密码</label>
                <PasswordInput id="acc-password-confirm" className="acc-input" value={confirmPassword} autoComplete="new-password" disabled={pending} onChange={(event) => setConfirmPassword(event.target.value)} />
              </>
            ) : null}
            {account.error ? <p className="acc-error">{account.error}</p> : null}
            <div className="acc-dialog-actions">
              <button type="button" className="acc-btn-ghost" disabled={pending} onClick={() => closeAccountDialog()}>关闭</button>
              {account.dialog === 'register' ? (
                <button type="button" className="acc-btn-primary" disabled={pending} onClick={() => void onRegister()}>{pending ? '提交中…' : '确认'}</button>
              ) : account.dialog === 'login' ? (
                <button type="button" className="acc-btn-primary" disabled={pending} onClick={() => void onLogin()}>{pending ? '登录中…' : '登录'}</button>
              ) : (
                <>
                  <button type="button" className="acc-btn-secondary" disabled={pending} onClick={() => openAccountDialog('login')}>登录</button>
                  <button type="button" className="acc-btn-primary" disabled={pending} onClick={() => openAccountDialog('register')}>注册</button>
                </>
              )}
            </div>
            {account.dialog === 'login' ? (
              <button type="button" className="acc-switch is-link" disabled={pending} onClick={() => openAccountDialog('register')}>没有账号？去注册</button>
            ) : account.dialog === 'register' ? (
              <button type="button" className="acc-switch" disabled={pending} onClick={() => openAccountDialog('login')}>已有账号？去登录</button>
            ) : null}
          </>
        ) : account.dialog === 'suggest' ? (
          <>
            <h2>建议注册</h2>
            <p>注册后可保存对话并获得更多次数。不想注册也可以关闭此窗口，继续以访客身份使用。</p>
            <div className="acc-dialog-actions">
              <button type="button" className="acc-btn-ghost" onClick={() => closeAccountDialog()}>关闭</button>
              <button type="button" className="acc-btn-primary" onClick={() => openAccountDialog('register')}>去注册</button>
            </div>
          </>
        ) : (
          <>
            <h2>超过限额</h2>
            <p>{account.quota?.role === 'guest'
              ? '今日对话已超过限额。查看不限次数。可联系管理员修改配额。'
              : '已超过对话限额，可联系管理员修改配额。'}</p>
            <div className="acc-dialog-actions">
              <button type="button" className="acc-btn-ghost" onClick={() => closeAccountDialog()}>关闭</button>
              {account.role === 'guest' ? (
                <button type="button" className="acc-btn-primary" onClick={() => openAccountDialog('register')}>去注册</button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function GuestAvatarIcon() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
      <circle cx="16" cy="16" r="14.5" fill="none" stroke="#8b93a0" strokeWidth="1.5" strokeDasharray="3 2.4" />
      <circle cx="16" cy="12.2" r="3.6" fill="none" stroke="#8b93a0" strokeWidth="1.5" />
      <path d="M8.2 24.2c1.7-3.8 4.4-5.6 7.8-5.6s6.1 1.8 7.8 5.6" fill="none" stroke="#8b93a0" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Call from future save / export / share actions. Returns true when the guest was blocked. */
export function requireAccountForRestricted() {
  return requestLoginForRestricted();
}
