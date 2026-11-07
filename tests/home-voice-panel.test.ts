import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { shouldExpandHomeVoicePanel } from '../lib/voice/home-panel';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('only a current real user submission expands; assistant/welcome/status/filler/history never do', () => {
  for (const text of ['', '  ', '…', '嗯', '啊啊', '哦。', '哈哈']) {
    assert.equal(shouldExpandHomeVoicePanel('user', text, true), false, text);
  }
  for (const text of ['欢迎使用Eva', '正在连接', '正在聆听', '这是之前保存的回答', '支持沪深A股']) {
    assert.equal(shouldExpandHomeVoicePanel('assistant', text, true), false, text);
  }
  for (const text of ['支持港股吗', '贵州茅台', '你好', '第二个', '是', '加入', '取消']) {
    assert.equal(shouldExpandHomeVoicePanel('user', text, true), true, text);
    assert.equal(shouldExpandHomeVoicePanel('user', text, false), false, 'inactive session: ' + text);
  }
});

test('manual folding stays folded for replies; end/restart explicitly collapse even if old history exists', () => {
  const home = source('../app/report-home.tsx');
  assert.ok(home.includes('setVoicePanelOpen((open) => !open)'));
  assert.ok(home.includes('voice.active && voicePanelOpen'));
  assert.ok(home.includes('但说无妨...'));
  assert.ok(home.includes('setVoicePanelOpen(false); // A fresh session never unfolds old history.'));
  assert.ok(home.includes('function endHomeVoice() {\n    setVoicePanelOpen(false);'));
  const trueAssignments = home.split('\n').filter((line) => line.includes('setVoicePanelOpen(true)'));
  assert.equal(trueAssignments.length, 1);
  assert.ok(trueAssignments.every((line) => line.includes('shouldExpandHomeVoicePanel(')));
  assert.ok(!home.match(/useEffect\([^]*?\[voiceTurns[^]*?setVoicePanelOpen\(true/));
});

test('header and questions live inside one draggable styled shell, not separate floating cards', () => {
  const home = source('../app/report-home.tsx');
  const css = source('../app/report-home.css');
  const rule = (selector: string) => css.split('\n').find((line) => line.startsWith(selector + '{'))?.split('{')[1]?.split('}')[0] || '';
  assert.ok(home.indexOf('ref={voiceDockRef}') < home.indexOf('id="rh-eva-conversation"'));
  assert.ok(home.includes('className="rh-eva-panel" role="region"'));
  assert.ok(rule('.rh-eva-dock.is-active').includes('background:#fff'));
  assert.ok(rule('.rh-eva-dock.is-active').includes('border:1px solid'));
  assert.ok(rule('.rh-eva-capsule').includes('background:transparent'));
  assert.ok(rule('.rh-eva-capsule').includes('border:0'));
  assert.ok(rule('.rh-eva-panel').includes('background:transparent'));
  assert.ok(rule('.rh-eva-panel').includes('box-shadow:none'));
  assert.ok(rule('.rh-eva-panel').includes('border:0'));
  assert.ok(rule('.rh-eva-dock').includes('gap:0'));
  assert.ok(rule('.rh-eva-dock').includes('max-height:calc(100dvh - 16px)'));
  assert.ok(!rule('.rh-eva-dock.is-open').includes('width:'));
  assert.ok(rule('.rh-eva-dock').includes('max-width:calc(100vw - 24px)'));
  assert.ok(rule('.rh-eva-panel').includes('contain:inline-size'));
  assert.ok(rule('.rh-eva-panel-log').includes('overflow-wrap:anywhere'));
  assert.ok(rule('.rh-eva-panel-log').includes('overflow:auto'));
});


test('all voice phases use one fixed viewport-bounded width, never intrinsic text or open-state width', () => {
  const css = source('../app/report-home.css');
  const rule = (selector: string) => css.split('\n').find(line => line.startsWith(selector + '{')) || '';
  assert.ok(rule('.rh-eva-dock').includes('width:min(400px,calc(100vw - 24px))'));
  assert.ok(!rule('.rh-eva-dock').includes('max-content'));
  assert.ok(!rule('.rh-eva-dock.is-open').includes('width:'));
  assert.ok(rule('.rh-eva-capsule').includes('width:100%'));
  assert.ok(rule('.rh-home button.rh-eva-activity-toggle').includes('min-width:0'));
  assert.ok(rule('.rh-eva-status').includes('text-overflow:ellipsis'));
  assert.ok(rule('.rh-eva-controls').includes('flex:none'));
  assert.ok(rule('.rh-eva-panel-log').includes('overflow-wrap:anywhere'));
  const drag = source('../lib/voice/float-drag.ts');
  assert.ok(!drag.includes("width: `${"), 'drag only moves the shell; it cannot size it from content');

});
