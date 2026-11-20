import { matchesQuickSearch } from '@/lib/admin-table-search';

export type AdminUserFilter = 'all' | 'quota_full' | 'disabled';

export type AdminUserUnlimitedSource = 'env' | 'db' | 'both' | null;

export type AdminUserRecord = {
  id: string;
  username: string;
  createdAt: string;
  askCount: number;
  quotaLimit: number;
  unlimited: boolean;
  unlimitedSource: AdminUserUnlimitedSource;
  disabledAt: string | null;
  lastAskAt: string | null;
};

export type AdminUserCounts = {
  all: number;
  quotaFull: number;
  disabled: number;
};

export function unlimitedSource(envUnlimited: boolean, dbUnlimited: boolean): AdminUserUnlimitedSource {
  if (envUnlimited && dbUnlimited) return 'both';
  if (envUnlimited) return 'env';
  if (dbUnlimited) return 'db';
  return null;
}

export function accountIsUnlimited(envUnlimited: boolean, dbUnlimited: boolean) {
  return Boolean(envUnlimited || dbUnlimited);
}

export function quotaLabel(user: Pick<AdminUserRecord, 'askCount' | 'quotaLimit' | 'unlimited'>) {
  if (user.unlimited) return '对话次数不限';
  return `${user.askCount} / ${user.quotaLimit}`;
}

export function isQuotaFull(user: Pick<AdminUserRecord, 'askCount' | 'quotaLimit' | 'unlimited'>) {
  return !user.unlimited && user.askCount >= user.quotaLimit;
}

export function statusLabel(disabledAt: string | null) {
  return disabledAt ? '已停用' : '正常';
}

export function countAdminUsers(users: AdminUserRecord[]): AdminUserCounts {
  return {
    all: users.length,
    quotaFull: users.filter(isQuotaFull).length,
    disabled: users.filter((user) => Boolean(user.disabledAt)).length,
  };
}

export function filterAdminUsers(users: AdminUserRecord[], filter: AdminUserFilter, query: string) {
  return users.filter((user) => {
    if (filter === 'quota_full' && !isQuotaFull(user)) return false;
    if (filter === 'disabled' && !user.disabledAt) return false;
    return matchesQuickSearch(query, [
      user.username,
      quotaLabel(user),
      statusLabel(user.disabledAt),
    ]);
  });
}

export function canClearDbUnlimited(source: AdminUserUnlimitedSource) {
  return source === 'db' || source === 'both';
}

export function parseQuotaLimit(value: unknown) {
  const raw = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  if (!Number.isInteger(raw) || raw <= 0) throw new Error('额度须为正整数');
  if (raw > 1_000_000) throw new Error('额度不能超过 1000000');
  return raw;
}

export function parseAdminUserFilter(value: unknown): AdminUserFilter {
  if (value === 'quota_full' || value === 'disabled' || value === 'all') return value;
  return 'all';
}
