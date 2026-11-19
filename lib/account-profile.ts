import { ensureBackendSchema } from './backend-schema';
import { getDb } from './db';
import { verifyPassword } from './app-account';
import { deleteAllConversations } from './conversations';
import { deleteUserNotifications } from './user-notifications';
import { deleteUserShares } from './shared-answers';
import { deleteUserWatchlist } from './user-watchlist';
import { appSessionOwner } from './auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function validateEmail(value: string) {
  const email = normalizeEmail(value);
  if (!email) return { ok: true as const, email: null };
  if (email.length > 120 || !EMAIL_RE.test(email)) return { ok: false as const, error: '请输入有效邮箱' };
  return { ok: true as const, email };
}

export async function getAccountProfile(userKey: string) {
  await ensureBackendSchema();
  const [row] = await getDb()<Array<{ username: string; email: string | null; email_notify: boolean; created_at: string | Date }>>`
    SELECT username, email, email_notify, created_at FROM app_users WHERE username_key=${userKey} LIMIT 1
  `;
  if (!row) return { username: userKey, email: null, emailNotify: true, createdAt: null as string | null, inDirectory: false };
  return {
    username: row.username,
    email: row.email,
    emailNotify: row.email_notify,
    createdAt: new Date(row.created_at).toISOString(),
    inDirectory: true,
  };
}

export async function updateAccountEmail(userKey: string, email: string | null, emailNotify = true) {
  await ensureBackendSchema();
  const rows = await getDb()`
    UPDATE app_users SET email=${email}, email_notify=${emailNotify}, updated_at=NOW()
    WHERE username_key=${userKey} RETURNING username
  `;
  return rows.length > 0;
}

export async function deleteRegisteredAccount(request: Request, password: string) {
  await ensureBackendSchema();
  const { appSessionUsername } = await import('./auth');
  const username = appSessionUsername(request);
  if (!username) return { ok: false as const, error: '请先登录', status: 401 };
  const userKey = username.trim().toLowerCase();
  const [row] = await getDb()<Array<{ password_hash: string }>>`
    SELECT password_hash FROM app_users WHERE username_key=${userKey} LIMIT 1
  `;
  if (!row) return { ok: false as const, error: '当前账号不支持注销', status: 400 };
  if (!(await verifyPassword(password, row.password_hash))) return { ok: false as const, error: '密码不正确', status: 403 };
  const owner = appSessionOwner(request);
  await deleteUserWatchlist(userKey);
  await deleteUserNotifications(userKey);
  if (owner) {
    await deleteAllConversations(owner);
    await deleteUserShares(owner);
  }
  await getDb()`DELETE FROM ask_counters WHERE subject_key=${`user:${userKey}`}`;
  await getDb()`DELETE FROM app_users WHERE username_key=${userKey}`;
  return { ok: true as const };
}
