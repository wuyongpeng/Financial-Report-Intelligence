import type { QuotaState } from '@/lib/app-account';

export type AccountDialog = 'login' | 'register' | 'suggest' | 'quota' | 'restricted' | null;

export type AccountView = {
  ready: boolean;
  role: 'guest' | 'user';
  username: string | null;
  quota: QuotaState | null;
  dialog: AccountDialog;
  error: string;
};

const SUGGEST_KEY = 'eva-suggest-register-dismissed';

const listeners = new Set<() => void>();

let view: AccountView = {
  ready: false,
  role: 'guest',
  username: null,
  quota: null,
  dialog: null,
  error: '',
};

function readFlag(key: string) {
  try { return sessionStorage.getItem(key) === '1'; } catch { return false; }
}

function writeFlag(key: string) {
  try { sessionStorage.setItem(key, '1'); } catch { /* ignore */ }
}

function emit() {
  for (const listener of listeners) listener();
}

function setView(patch: Partial<AccountView>) {
  view = { ...view, ...patch };
  emit();
}

export function getAccountView() {
  return view;
}

export function subscribeAccount(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function applyQuota(quota: QuotaState | null | undefined) {
  if (!quota) return;
  setView({
    role: quota.role,
    username: quota.username,
    quota,
  });
  if (quota.role === 'guest' && quota.suggestRegister && !readFlag(SUGGEST_KEY) && view.dialog == null) {
    setView({ dialog: 'suggest', error: '' });
  }
}

export async function refreshAccount() {
  try {
    const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
    const body = await response.json().catch(() => ({})) as { role?: string; username?: string | null; quota?: QuotaState };
    if (!response.ok) {
      setView({ ready: true });
      return view;
    }
    const role = body.role === 'user' ? 'user' as const : 'guest' as const;
    setView({
      ready: true,
      role,
      username: typeof body.username === 'string' ? body.username : null,
      quota: body.quota ?? null,
    });
    applyQuota(body.quota);
    return view;
  } catch {
    setView({ ready: true });
    return view;
  }
}

export async function handleAskResponse(response: Response) {
  const body = await response.json().catch(() => ({})) as { code?: string; quota?: QuotaState; error?: string; answer?: string; openCode?: string | null; mode?: string };
  if (response.status === 429 || body.code === 'quota_exceeded') {
    applyQuota(body.quota);
    setView({ dialog: 'quota', error: '' });
    return { kind: 'quota' as const, body };
  }
  if (!response.ok) return { kind: 'error' as const, body };
  applyQuota(body.quota);
  if (!body.quota) void refreshAccount();
  return { kind: 'ok' as const, body };
}

export function handleQuotaFailure(body: { code?: string; quota?: QuotaState | unknown; error?: string }) {
  if (body.code === 'quota_exceeded' || body.quota) {
    applyQuota(body.quota as QuotaState | undefined);
    setView({ dialog: 'quota', error: '' });
    return true;
  }
  return false;
}

export function openAccountDialog(dialog: Exclude<AccountDialog, null>) {
  setView({ dialog, error: '' });
}

export function closeAccountDialog() {
  if (view.dialog === 'suggest') writeFlag(SUGGEST_KEY);
  setView({ dialog: null, error: '' });
}

export function requestLoginForRestricted() {
  if (view.role === 'user') return false;
  setView({ dialog: 'restricted', error: '' });
  return true;
}

export function setAccountError(error: string) {
  setView({ error });
}

export async function submitLogin(username: string, password: string) {
  setView({ error: '' });
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) {
    setView({ error: body.error || '账号或密码错误' });
    return false;
  }
  await refreshAccount();
  setView({ dialog: null, error: '' });
  return true;
}

export async function submitRegister(username: string, password: string, confirmPassword: string) {
  setView({ error: '' });
  const response = await fetch('/api/auth/register', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, confirmPassword }),
  });
  const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
  if (!response.ok) {
    setView({ error: body.error || '注册失败' });
    return false;
  }
  await refreshAccount();
  setView({ dialog: null, error: '', ready: true });
  return body.message || '注册成功';
}

export async function submitLogout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
  setView({ role: 'guest', username: null, quota: null, dialog: null, error: '' });
  await refreshAccount();
}
