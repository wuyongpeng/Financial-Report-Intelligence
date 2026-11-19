'use client';

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

export function AccountMenu() {
  const pathname = usePathname();
  const account = useAccountView();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const hidden = isAdminPath(pathname);
  const guest = account.role !== 'user';

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (hidden) return null;

  const remaining = account.quota?.unlimited
    ? '对话次数不限'
    : account.quota?.remaining != null
      ? `剩余对话 ${account.quota.remaining} 次`
      : guest
        ? '每日可对话 9 次'
        : '注册后可对话 100 次';

  return (
    <div className="acc-menu" ref={rootRef}>
      <button
        type="button"
        className={`acc-avatar ${guest ? 'is-guest' : 'is-user'}`}
        aria-label={guest ? '访客模式' : account.username || '已登录'}
        title={guest ? '访客模式' : account.username || '已登录'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        {guest ? <GuestAvatarIcon /> : <span>{(account.username || '用').slice(0, 1)}</span>}
      </button>
      {open ? (
        <div className="acc-panel" id={menuId} role="dialog" aria-label={guest ? '访客模式' : '账户'}>
          <h2>{guest ? '访客模式' : account.username}</h2>
          <p>{guest ? '当前为访客，数据仅本地 / 会话有效，关闭页面会丢失' : remaining}</p>
          {guest ? (
            <div className="acc-panel-actions">
              <button type="button" className="acc-btn-secondary" onClick={() => { setOpen(false); openAccountDialog('login'); }}>登录</button>
              <button type="button" className="acc-btn-primary" onClick={() => { setOpen(false); openAccountDialog('register'); }}>注册</button>
            </div>
          ) : (
            <div className="acc-panel-actions">
              <button type="button" className="acc-btn-secondary" onClick={() => { setOpen(false); void submitLogout(); }}>退出</button>
            </div>
          )}
        </div>
      ) : null}
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
              <button type="button" className="acc-switch" disabled={pending} onClick={() => openAccountDialog('register')}>没有账号？去注册</button>
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
