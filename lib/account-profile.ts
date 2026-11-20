import { ensureBackendSchema } from './backend-schema';
import { getDb } from './db';
import { verifyPassword } from './app-account';
import { deleteAllConversations } from './conversations';
import { deleteUserNotifications } from './user-notifications';
import { deleteUserShares } from './shared-answers';
import { deleteUserWatchlist } from './user-watchlist';
import { appSessionOwner } from './auth';

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
