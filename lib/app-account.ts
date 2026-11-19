import { promisify } from 'node:util';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { ApiError } from '@/lib/api';
import { ensureBackendSchema } from '@/lib/backend-schema';
import { getDb } from '@/lib/db';
import {
  appSessionUsername,
  appUserRole,
  ensureGuestSession,
  validAppCredentials,
} from '@/lib/auth';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number }) => Promise<Buffer>;

export const GUEST_DAILY_ASK_LIMIT = 9;
export const REGISTERED_ASK_LIMIT = 100;
export const SUGGEST_REGISTER_AFTER = 3;
export const DEFAULT_USER_QUOTA = REGISTERED_ASK_LIMIT;

const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fff]{2,32}$/;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

export type AccountRole = 'guest' | 'user';

export type QuotaState = {
  role: AccountRole;
  username: string | null;
  askCount: number;
  askLimit: number | null;
  unlimited: boolean;
  suggestRegister: boolean;
  remaining: number | null;
};

export class QuotaError extends ApiError {
  constructor(message: string, public quota: QuotaState, public setCookie?: string) {
    super(429, message, { code: 'quota_exceeded', quota });
  }
}

export function usernameKey(username: string) {
  return username.trim().toLowerCase();
}

export function parseUnlimitedTokenUsers(raw: string | undefined = process.env.UNLIMITED_TOKEN_USERS) {
  if (!raw) return new Set<string>();
  return new Set(raw.split(',').map((item) => usernameKey(item)).filter(Boolean));
}

export function isUnlimitedUsername(username: string, raw?: string) {
  return parseUnlimitedTokenUsers(raw).has(usernameKey(username));
}

export function shanghaiDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function shouldSuggestRegister(role: AccountRole, askCount: number) {
  return role === 'guest' && askCount > SUGGEST_REGISTER_AFTER;
}

export function validateUsername(username: string) {
  const value = username.trim();
  if (!USERNAME_RE.test(value)) return '请使用 2–32 位字母、数字、下划线或中文作为用户名';
  return null;
}

export function validatePassword(password: string) {
  if (typeof password !== 'string' || password.length < 6 || password.length > 72) {
    return '密码长度需要 6–72 位';
  }
  return null;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string) {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'hex');
  const expected = Buffer.from(parts[5], 'hex');
  if (!N || !r || !p || salt.length === 0 || expected.length === 0) return false;
  const actual = await scryptAsync(password, salt, expected.length, { N, r, p });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function quotaMessage(role: AccountRole) {
  if (role === 'guest') return '今日对话已超过限额。查看不限次数。可联系管理员修改配额。';
  return '已超过对话限额，可联系管理员修改配额。';
}

function buildState(input: {
  role: AccountRole;
  username: string | null;
  askCount: number;
  askLimit: number | null;
  unlimited: boolean;
}): QuotaState {
  const remaining = input.unlimited || input.askLimit == null ? null : Math.max(0, input.askLimit - input.askCount);
  return {
    ...input,
    suggestRegister: shouldSuggestRegister(input.role, input.askCount),
    remaining,
  };
}

function subjectKey(role: AccountRole, username: string | null, ownerKey: string, day: string) {
  if (role === 'user' && username) return `user:${usernameKey(username)}`;
  return `guest:${ownerKey}:${day}`;
}

async function userQuotaLimit(username: string) {
  if (isUnlimitedUsername(username)) return null;
  const db = getDb();
  const rows = await db<{ quota_limit: number }[]>`
    SELECT quota_limit FROM app_users WHERE username_key = ${usernameKey(username)} LIMIT 1
  `;
  return rows[0]?.quota_limit ?? DEFAULT_USER_QUOTA;
}

async function readCount(key: string) {
  const db = getDb();
  const rows = await db<{ count: number }[]>`SELECT count FROM ask_counters WHERE subject_key = ${key} LIMIT 1`;
  return rows[0]?.count ?? 0;
}

export async function peekAskQuota(request: Request): Promise<{ state: QuotaState; setCookie?: string }> {
  await ensureBackendSchema();
  const username = appSessionUsername(request);
  if (username) {
    if (isUnlimitedUsername(username)) {
      const askCount = await readCount(subjectKey('user', username, '', ''));
      return { state: buildState({ role: 'user', username, askCount, askLimit: null, unlimited: true }) };
    }
    const askLimit = await userQuotaLimit(username);
    const askCount = await readCount(subjectKey('user', username, '', ''));
    return { state: buildState({ role: 'user', username, askCount, askLimit, unlimited: false }) };
  }
  const guest = ensureGuestSession(request);
  const day = shanghaiDate();
  const askCount = await readCount(subjectKey('guest', null, guest.owner, day));
  return {
    state: buildState({ role: 'guest', username: null, askCount, askLimit: GUEST_DAILY_ASK_LIMIT, unlimited: false }),
    setCookie: guest.setCookie,
  };
}

export async function consumeAskQuota(request: Request): Promise<{ state: QuotaState; setCookie?: string }> {
  await ensureBackendSchema();
  const username = appSessionUsername(request);
  if (username) {
    if (isUnlimitedUsername(username)) {
      const key = subjectKey('user', username, '', '');
      const askCount = await incrementCounter(key, null);
      return { state: buildState({ role: 'user', username, askCount, askLimit: null, unlimited: true }) };
    }
    const askLimit = await userQuotaLimit(username);
    const key = subjectKey('user', username, '', '');
    const result = await incrementCounter(key, askLimit);
    if (result == null) {
      const askCount = await readCount(key);
      throw new QuotaError(quotaMessage('user'), buildState({ role: 'user', username, askCount, askLimit, unlimited: false }));
    }
    return { state: buildState({ role: 'user', username, askCount: result, askLimit, unlimited: false }) };
  }

  const guest = ensureGuestSession(request);
  const day = shanghaiDate();
  const key = subjectKey('guest', null, guest.owner, day);
  const result = await incrementCounter(key, GUEST_DAILY_ASK_LIMIT);
  if (result == null) {
    const askCount = await readCount(key);
    throw new QuotaError(
      quotaMessage('guest'),
      buildState({ role: 'guest', username: null, askCount, askLimit: GUEST_DAILY_ASK_LIMIT, unlimited: false }),
      guest.setCookie,
    );
  }
  return {
    state: buildState({ role: 'guest', username: null, askCount: result, askLimit: GUEST_DAILY_ASK_LIMIT, unlimited: false }),
    setCookie: guest.setCookie,
  };
}

async function incrementCounter(key: string, limit: number | null) {
  const db = getDb();
  if (limit == null) {
    const rows = await db<{ count: number }[]>`
      INSERT INTO ask_counters (subject_key, count, updated_at)
      VALUES (${key}, 1, NOW())
      ON CONFLICT (subject_key) DO UPDATE
        SET count = ask_counters.count + 1, updated_at = NOW()
      RETURNING count
    `;
    return rows[0]?.count ?? 1;
  }
  const rows = await db<{ count: number }[]>`
    INSERT INTO ask_counters (subject_key, count, updated_at)
    VALUES (${key}, 1, NOW())
    ON CONFLICT (subject_key) DO UPDATE
      SET count = ask_counters.count + 1, updated_at = NOW()
      WHERE ask_counters.count < ${limit}
    RETURNING count
  `;
  return rows[0]?.count ?? null;
}

export async function registerAccount(username: string, password: string, confirmPassword: string) {
  const nameError = validateUsername(username);
  if (nameError) throw new ApiError(400, nameError);
  const passwordError = validatePassword(password);
  if (passwordError) throw new ApiError(400, passwordError);
  if (password !== confirmPassword) throw new ApiError(400, '两次密码不一致');
  const trimmed = username.trim();
  if (process.env.APP_USERNAME && usernameKey(trimmed) === usernameKey(process.env.APP_USERNAME)) {
    throw new ApiError(409, '该用户名已被注册');
  }
  await ensureBackendSchema();
  const db = getDb();
  const passwordHash = await hashPassword(password);
  try {
    await db`
      INSERT INTO app_users (id, username, username_key, password_hash, quota_limit)
      VALUES (gen_random_uuid(), ${trimmed}, ${usernameKey(trimmed)}, ${passwordHash}, ${DEFAULT_USER_QUOTA})
    `;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError(409, '该用户名已被注册');
    throw error;
  }
  return trimmed;
}

export async function authenticateAccount(username: string, password: string) {
  const trimmed = username.trim();
  if (!trimmed || !password) return null;
  if (validAppCredentials(trimmed, password)) return process.env.APP_USERNAME || trimmed;
  await ensureBackendSchema();
  const db = getDb();
  const rows = await db<{ username: string; password_hash: string }[]>`
    SELECT username, password_hash FROM app_users WHERE username_key = ${usernameKey(trimmed)} LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  if (!(await verifyPassword(password, row.password_hash))) return null;
  return row.username;
}

export function sessionPayload(state: QuotaState) {
  return {
    authenticated: state.role === 'user',
    role: state.role,
    username: state.username,
    admin: false,
    quota: state,
  };
}

export function isProductUser(request: Request) {
  return appUserRole(request) === 'user';
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505');
}
