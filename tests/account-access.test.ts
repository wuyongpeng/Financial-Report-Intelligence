import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

test('home and company detail place the account avatar next to the overflow menu', () => {
  const home = read('app/page.tsx');
  const detail = read('app/company-detail.tsx');
  assert.match(home, /<AccountMenu \/>/);
  assert.match(home, /<HomeOverflowMenu showSources=\{false\} \/>/);
  assert.match(detail, /<AccountMenu \/>/);
  assert.match(detail, /HomeOverflowMenu showSources=\{false\}/);
});

test('guest avatar panel uses the specified copy and has login and register actions', () => {
  const source = read('components/account-access.tsx');
  const css = read('components/account-access.css');
  assert.match(source, /title=\{guest \? '访客模式' :/);
  assert.match(source, /当前为访客，数据仅本地 \/ 会话有效，关闭页面会丢失/);
  assert.match(source, />登录</);
  assert.match(source, />注册</);
  assert.match(source, /strokeDasharray/);
  assert.match(source, /建议注册/);
  assert.match(source, /超过限额/);
  assert.match(source, /可联系管理员修改配额/);
  assert.match(source, /不想注册也可以关闭此窗口/);
  assert.doesNotMatch(css, /#dc2626|#e11d48|#ef4444|cd-red/);
});

test('account provider wraps the app and password fields reuse PasswordInput', () => {
  const providers = read('app/providers.tsx');
  const source = read('components/account-access.tsx');
  const env = read('.env.example');
  assert.match(providers, /<AccountProvider>/);
  assert.match(source, /from '@\/components\/password-input'/);
  assert.match(source, /再次输入密码/);
  assert.match(source, /注册成功/);
  assert.match(env, /UNLIMITED_TOKEN_USERS=/);
});

test('ask routes enforce quota and register route exists', () => {
  const homeAsk = read('app/api/home/ask/route.ts');
  const chat = read('app/api/chat/route.ts');
  const register = read('app/api/auth/register/route.ts');
  const login = read('app/api/auth/login/route.ts');
  assert.match(homeAsk, /consumeAskQuota/);
  assert.match(chat, /consumeAskQuota/);
  assert.match(register, /registerAccount/);
  assert.match(register, /注册成功/);
  assert.match(login, /authenticateAccount/);
});
