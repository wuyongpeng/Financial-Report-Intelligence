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
  assert.match(source, />立即注册</);
  assert.match(source, /今日剩余对话/);
  assert.match(source, /今日可对话 9 次/);
  assert.match(source, /strokeDasharray/);
  assert.match(source, /建议注册/);
  assert.match(source, /超过限额/);
  assert.match(source, /可联系管理员修改配额/);
  assert.match(source, /不想注册也可以关闭此窗口/);
  assert.doesNotMatch(css, /#dc2626|#e11d48|#ef4444|cd-red/);
});

test('avatar menu absorbs overflow actions and opens 了解更多 to the left', () => {
  const source = read('components/account-access.tsx');
  const css = read('components/account-access.css');
  const overflow = read('app/home-overflow-menu.tsx');
  const overflowCss = read('app/home-overflow-menu.css');
  const home = read('app/page.tsx');
  const detail = read('app/company-detail.tsx');
  const prefs = read('app/reader-prefs-dialog.tsx');
  const legal = read('app/legal/page.tsx');

  assert.match(source, /账号设置/);
  assert.match(source, /发送反馈/);
  assert.match(source, /了解更多/);
  assert.match(source, /帮助中心/);
  assert.match(source, /服务条款/);
  assert.match(source, /关于Eva/);
  assert.match(source, /href="\/docs"/);
  assert.match(source, /href="\/legal"/);
  assert.match(source, /退出登录/);
  assert.match(source, /剩余对话 \$\{account\.quota\.remaining\} 次/);
  assert.match(source, /对话次数不限/);
  assert.match(source, /注册后可对话 100 次/);
  assert.match(source, /requestHomeMenuAction\('prefs'\)/);
  assert.match(source, /requestHomeMenuAction\('feedback'\)/);
  assert.match(source, /requestHomeMenuAction\('about'\)/);
  assert.match(css, /acc-flyout/);
  assert.match(css, /right:calc\(240px \+ 8px\)/);

  assert.match(overflow, /subscribeHomeMenuActions/);
  assert.match(overflow, /params.get\('feedback'\) === '1'/);
  assert.match(overflow, /subscribeFeedbackDraft/);
  assert.doesNotMatch(overflow, /className="hom-trigger"/);
  assert.doesNotMatch(overflow, /aria-label="更多"/);
  assert.doesNotMatch(overflow, /⋯/);
  assert.match(overflowCss, /\.hom-trigger\{display:none\}/);

  assert.match(home, /<AccountMenu \/>/);
  assert.match(home, /<HomeOverflowMenu showSources=\{false\} \/>/);
  assert.match(detail, /HomeOverflowMenu showSources=\{false\}/);

  assert.match(prefs, /账号设置/);
  assert.match(prefs, /id: 'account', label: '账户'/);
  assert.match(prefs, /useState<PrefsTab>\('account'\)/);
  assert.doesNotMatch(prefs, /偏好设置/);
  assert.match(prefs, /AccountWorkspace/);
  assert.match(prefs, /立即注册/);

  assert.match(legal, /LEGAL_PAGES\.map/);
  assert.match(legal, /服务条款/);
  assert.match(legal, /legalPath\(page\.slug\)/);
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
