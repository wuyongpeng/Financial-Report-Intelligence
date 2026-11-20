import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

function mediaBlocks(css: string, query: string) {
  const needle = `@media(${query})`;
  const blocks: string[] = [];
  let from = 0;
  while (from < css.length) {
    const start = css.indexOf(needle, from);
    if (start < 0) break;
    const open = css.indexOf('{', start);
    if (open < 0) break;
    let depth = 0;
    let i = open;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) {
          blocks.push(css.slice(open + 1, i));
          from = i + 1;
          break;
        }
      }
    }
    if (depth !== 0) break;
  }
  return blocks.join('\n');
}

test('homepage search, coverage inventory, and asking stay present at phone width', () => {
  const css = read('app/report-home.css');
  const page = read('app/page.tsx');
  const home = read('app/report-home.tsx');
  const narrow = mediaBlocks(css, 'max-width:760px');

  assert.match(page, /<NotificationBell \/>/);
  assert.match(page, /<AccountMenu \/>/);
  assert.match(home, /className="rh-search"/);
  assert.match(home, /rh-card-grid|rh-companies/);
  assert.match(css, /\.rh-table-wrap\{overflow:auto/);
  assert.match(narrow, /\.rh-home\{[^}]*width:calc\(100% - 32px\)/);
  assert.match(narrow, /\.rh-search\{/);
  assert.match(narrow, /\.rh-card-grid,\s*\.rh-card-grid-all\{grid-template-columns:1fr/);
  assert.match(narrow, /\.rh-home\{[^}]*max-width:100%/);
  assert.match(narrow, /overflow-x:clip/);
  assert.match(css, /topbar\.home-topbar\{[^}]*overflow:visible|\.topbar\.home-topbar\{[^}]*overflow:visible/);
});

test('company detail phone header keeps period switch, citations, and watchlist reachable', () => {
  const css = read('app/company-detail.css');
  const source = read('app/company-detail.tsx');
  const phone = mediaBlocks(css, 'max-width:640px');
  const tablet = mediaBlocks(css, 'max-width:900px');

  assert.match(source, /aria-label="本期、上一期、去年同期"/);
  assert.match(source, /className="cd-period-switch"/);
  assert.match(source, /watching \? '移出自选' : '加入自选'/);
  assert.match(source, /<NotificationBell \/>/);
  assert.match(source, /aria-label="详情页分栏"/);
  assert.match(source, /\['sources','来源'\],\['dashboard','数据概览'\],\['chat','对话'\]/);
  assert.match(source, /className="cd-table-scroll cd-period-compare"/);

  assert.match(tablet, /\.cd-columns\{[^}]*flex:1/);
  assert.match(tablet, /\.cd-columns\{[^}]*min-height:0/);
  assert.match(tablet, /\.cd-pane\.mobile-active\{[^}]*min-height:0/);
  assert.match(tablet, /\.cd-source-slot\.mobile-active\{[^}]*min-height:0/);
  assert.match(tablet, /\.cd-company-meta h1\{[^}]*text-overflow:ellipsis/);
  assert.match(tablet, /\.cd-company-meta h1\{[^}]*min-width:0/);
  assert.match(phone, /\.cd-company-meta p\{[^}]*display:none/);
  assert.match(tablet, /cd-period-compare[\s\S]*overflow-x:\s*auto/);
  assert.match(tablet, /cd-period-compare[\s\S]*max-width:100%/);
  assert.match(tablet, /\.cd-period-compare \.cd-period-value\{[^}]*min-height:32px/);
  assert.match(tablet, /\.cd-chart-tabs\{[^}]*flex-wrap:wrap/);
});

test('follow-up composer and answer actions stay visible and tappable on phone', () => {
  const css = read('app/company-detail.css');
  const source = read('app/company-detail.tsx');
  const tablet = mediaBlocks(css, 'max-width:900px');

  assert.match(source, /id="cd-chat-panel"/);
  assert.match(source, /aria-label="向 Eva 提问"/);
  assert.match(source, /aria-label="复制"/);
  assert.match(source, /aria-label="导出"/);
  assert.match(source, /aria-label="分享"/);
  assert.match(source, /className="cd-chat-input"/);
  assert.match(source, /className="cd-actions"/);

  assert.match(tablet, /\.cd-pane\.mobile-active\{[^}]*overflow:hidden/);
  assert.match(tablet, /\.cd-chat-input\{[^}]*safe-area-inset-bottom/);
  assert.match(tablet, /\.cd-actions button\{[^}]*(width:36px|min-width:36px|min-height:36px)/);
  assert.match(tablet, /\.cd-actions \.cd-regen-menu button\{[^}]*height:auto/);
});

test('notification bell, login dialog, and account settings stay on-screen at phone width', () => {
  const bellCss = read('components/product-workspace.css');
  const bell = read('components/product-workspace.tsx');
  const accountCss = read('components/account-access.css');
  const prefsCss = read('app/reader-prefs-dialog.css');
  const narrowBell = mediaBlocks(bellCss, 'max-width:640px');
  const narrowAccount = mediaBlocks(accountCss, 'max-width:640px');
  const narrowPrefs = mediaBlocks(prefsCss, 'max-width:640px');

  assert.match(bell, /aria-label=\{unread \? `通知，\$\{unread\} 条未读` : '通知'\}/);
  assert.match(bell, /role="dialog" aria-label="通知"/);
  assert.match(bell, />提醒</);
  assert.match(narrowBell, /\.pw-bell-panel\{[^}]*position:fixed/);
  assert.match(narrowBell, /\.pw-bell-panel\{[^}]*left:12px/);
  assert.match(narrowBell, /\.pw-bell-panel\{[^}]*right:12px/);
  assert.match(narrowAccount, /\.acc-dialog\{[^}]*max-height:/);
  assert.match(narrowAccount, /\.acc-panel\{[^}]*max-width:min\(260px,calc\(100vw - 24px\)\)/);
  assert.match(narrowPrefs, /\.prefs-dialog\{[^}]*flex-direction:column/);
  assert.match(narrowPrefs, /\.prefs-backdrop\{[^}]*padding:12px/);
});
