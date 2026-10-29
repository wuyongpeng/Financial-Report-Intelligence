import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLocalCommand, type LocalCommand, type LocalCommandContext } from '../lib/voice/local-command';
import { parseChineseNumber } from '../lib/voice/cn-number';
import { parseVoiceNavIntent, resolveGotoPage, VOICE_PAGE_CONTINUE_WINDOW_MS } from '../lib/voice/nav-intent';
import { normalizeVoiceText } from '../lib/voice/text-normalize';

const NOW = 5_000_000;
const noWindow: LocalCommandContext = { lastPageNav: null, now: NOW };
const freshNext: LocalCommandContext = { lastPageNav: { kind: 'next', at: NOW - 3_000 }, now: NOW };
const freshPrev: LocalCommandContext = { lastPageNav: { kind: 'prev', at: NOW - 3_000 }, now: NOW };
const staleNext: LocalCommandContext = {
  lastPageNav: { kind: 'next', at: NOW - VOICE_PAGE_CONTINUE_WINDOW_MS - 1 },
  now: NOW,
};

const nav = (n: object, via: 'direct' | 'continue' = 'direct'): LocalCommand =>
  ({ kind: 'page-nav', nav: n, via }) as LocalCommand;

/** Must match: [phrase, expected command]. Run for BOTH typed and voice (same parser). */
const MUST_MATCH: [string, LocalCommand][] = [
  // —— page nav: next / prev / last
  ['下一页', nav({ kind: 'next' })],
  ['请帮我往下翻一页', nav({ kind: 'next' })],
  ['麻烦你下一页', nav({ kind: 'next' })],
  ['往下翻一页吧', nav({ kind: 'next' })],
  ['下一页。', nav({ kind: 'next' })],
  ['上一页', nav({ kind: 'prev' })],
  ['往前翻', nav({ kind: 'prev' })],
  ['请往上翻一页谢谢', nav({ kind: 'prev' })],
  ['翻到最后一页', nav({ kind: 'last' })],
  ['最后一页', nav({ kind: 'last' })],
  // —— goto: arabic / chinese / full-width / P-forms / polite / punctuation
  ['翻到第8页', nav({ kind: 'goto', page: 8 })],
  ['翻到第八页', nav({ kind: 'goto', page: 8 })],
  ['翻到第八页。', nav({ kind: 'goto', page: 8 })],
  ['翻到第八页！', nav({ kind: 'goto', page: 8 })],
  ['  翻到 第八页  ', nav({ kind: 'goto', page: 8 })],
  ['请翻到第八页', nav({ kind: 'goto', page: 8 })],
  ['帮我翻到第八页', nav({ kind: 'goto', page: 8 })],
  ['麻烦你帮我翻到第八页吧', nav({ kind: 'goto', page: 8 })],
  ['跳转到第十二页', nav({ kind: 'goto', page: 12 })],
  ['去第二十三页', nav({ kind: 'goto', page: 23 })],
  ['第一百零五页', nav({ kind: 'goto', page: 105 })],
  ['翻到第两页', nav({ kind: 'goto', page: 2 })],
  ['翻到第十页', nav({ kind: 'goto', page: 10 })],
  ['第一页', nav({ kind: 'goto', page: 1 })],
  ['翻到第０页', nav({ kind: 'goto', page: 0 })],
  ['翻到第零页', nav({ kind: 'goto', page: 0 })],
  ['翻到第〇页', nav({ kind: 'goto', page: 0 })],
  ['翻到第１２页', nav({ kind: 'goto', page: 12 })],
  ['跳到第48页', nav({ kind: 'goto', page: 48 })],
  ['第12页', nav({ kind: 'goto', page: 12 })],
  ['8页', nav({ kind: 'goto', page: 8 })],
  ['８页', nav({ kind: 'goto', page: 8 })],
  ['八页', nav({ kind: 'goto', page: 8 })],
  ['P8', nav({ kind: 'goto', page: 8 })],
  ['p8', nav({ kind: 'goto', page: 8 })],
  ['p.8', nav({ kind: 'goto', page: 8 })],
  ['Ｐ８', nav({ kind: 'goto', page: 8 })],
  ['翻到P12', nav({ kind: 'goto', page: 12 })],
  ['翻到第9999页', nav({ kind: 'goto', page: 9999 })],
  // —— pack: capability / tts / style / layout / zoom / cite / read / toc
  ['你能干什么', { kind: 'capability' }],
  ['介绍一下你自己', { kind: 'capability' }],
  ['我该怎么提问', { kind: 'how-to-ask' }],
  ['可以问什么', { kind: 'how-to-ask' }],
  ['问什么好', { kind: 'how-to-ask' }],
  ['先别念了', { kind: 'tts-pause' }],
  ['暂停朗读', { kind: 'tts-pause' }],
  ['停一下', { kind: 'tts-pause' }],
  ['接着念', { kind: 'tts-resume' }],
  ['继续朗读', { kind: 'tts-resume' }],
  ['说重点', { kind: 'style', style: 'brief' }],
  ['讲简短点', { kind: 'style', style: 'brief' }],
  ['讲细一点', { kind: 'style', style: 'detailed' }],
  ['展开说说', { kind: 'style', style: 'detailed' }],
  ['收起概览', { kind: 'layout', layout: 'collapse-mid' }],
  ['收起中间栏', { kind: 'layout', layout: 'collapse-mid' }],
  ['只要原文和问答', { kind: 'layout', layout: 'collapse-mid' }],
  ['展开概览', { kind: 'layout', layout: 'expand-mid' }],
  ['打开中间栏', { kind: 'layout', layout: 'expand-mid' }],
  ['放大', { kind: 'zoom', zoom: { kind: 'in' } }],
  ['放大一点', { kind: 'zoom', zoom: { kind: 'in' } }],
  ['请放大一点吧', { kind: 'zoom', zoom: { kind: 'in' } }],
  ['缩小一点', { kind: 'zoom', zoom: { kind: 'out' } }],
  ['适合宽度', { kind: 'zoom', zoom: { kind: 'fit' } }],
  ['实际大小', { kind: 'zoom', zoom: { kind: 'actual' } }],
  ['带我看出处', { kind: 'cite' }],
  ['出处在哪', { kind: 'cite' }],
  ['去证据页', { kind: 'cite' }],
  ['看看出处', { kind: 'cite' }],
  ['读一下这页开头', { kind: 'read-page-head' }],
  ['朗读第三节', { kind: 'read-section', query: '第三节' }],
  ['读一下管理层讨论', { kind: 'read-section', query: '管理层讨论' }],
  ['从管理层讨论开始读', { kind: 'read-section', query: '管理层讨论' }],
  ['打开目录', { kind: 'toc-open' }],
  ['请帮我打开目录', { kind: 'toc-open' }],
  ['跳到管理层讨论', { kind: 'toc-jump', query: '管理层讨论' }],
  ['跳到第三节', { kind: 'toc-jump', query: '第三节' }],
  ['打开管理层讨论与分析', { kind: 'toc-jump', query: '管理层讨论与分析' }],
  ['去风险因素', { kind: 'toc-jump', query: '风险因素' }],
  // —— session
  ['回首页', { kind: 'home' }],
  ['换一家', { kind: 'home' }],
  ['退下吧', { kind: 'farewell' }],
  ['再见', { kind: 'farewell' }],
];

/** Real finance questions / chit-chat that must reach the AI (parser → null). */
const MUST_NOT_MATCH = [
  // user-reported guards
  '第八页讲了什么',
  '下一页的营收是多少',
  '放大一下研发投入',
  '第三节管理层讨论说了啥',
  // page-ish questions
  '第8页的净利润是多少',
  '翻到第八页看看营收',
  '翻到第八页的利润表怎么看',
  '第八页和第九页有什么区别',
  '上一页的数据为什么下降',
  '第十二页写了什么风险',
  '8页的现金流',
  'P8的表格是什么意思',
  '往下翻看营收是多少',
  '前八页讲了什么',
  '这份报告一共有多少页',
  '八',
  '8',
  '第八',
  '页',
  // zoom / layout / cite / style lookalikes
  '放大研发投入',
  '缩小亏损范围的措施有哪些',
  '放大一下毛利率的变化',
  '显示中间业务收入',
  '展开概览里的营收数据',
  '打开中间业务收入明细',
  '收起中间业务的风险',
  '这个数据的出处是哪份文件',
  '营收出处怎么算',
  '说重点是什么',
  '讲细一点的话研发费用是多少',
  '短一点的周期有哪些影响',
  // section / toc / read lookalikes
  '看看管理层讨论说了什么',
  '风险因素有哪些',
  '跳到风险因素看看有没有诉讼',
  '管理层讨论写了什么',
  '读一下管理层讨论里的营收',
  '朗读第三节讲了什么',
  '目录里有什么',
  '打开目录看看营收是多少',
  // home / farewell lookalikes
  '其他公司的毛利率是多少',
  '别的公司的利润怎么样',
  '看看其他公司的营收',
  '去首页看看营收',
  '换一家公司的话毛利率对比怎么样',
  '同行业别的公司研发投入多少',
  '再见证券的营收是多少',
  // continue without a window / stale / content continuation
  '继续',
  '继续分析毛利率',
  '接着说一下风险',
  '再翻一页营收有什么变化',
  // plain finance questions
  '今年毛利率多少',
  '营业收入同比多少',
  '为什么净利润下降',
  '你好',
  '谢谢',
  '怎么算营收同比',
  '有什么风险因素',
  '',
  '   ',
];

test('must-match table: every command in the pack resolves identically for typed and voice', () => {
  for (const [phrase, expected] of MUST_MATCH) {
    // Typed and voice share one parser: assert twice with independent contexts (no source arg exists).
    for (const source of ['typed', 'voice'] as const) {
      assert.deepEqual(parseLocalCommand(phrase, noWindow), expected, `${source}: ${JSON.stringify(phrase)}`);
    }
  }
});

test('must-not-match table: finance questions are NOT stolen (typed + voice, with and without a live 继续 window)', () => {
  for (const phrase of MUST_NOT_MATCH) {
    for (const [label, ctx] of [['none', noWindow], ['fresh', freshNext], ['stale', staleNext]] as const) {
      const cmd = parseLocalCommand(phrase, ctx);
      // Bare 继续 is the only phrase allowed to match, and only with a fresh window.
      if (phrase === '继续' && label === 'fresh') continue;
      assert.equal(cmd, null, `${label} window: ${JSON.stringify(phrase)} → ${JSON.stringify(cmd)}`);
    }
  }
});

test('covers every command kind in the pack', () => {
  const kinds = new Set<string>(MUST_MATCH.map(([, c]) => c.kind));
  // tts-resume-bare / continue are context-driven — covered below.
  for (const k of [
    'capability', 'how-to-ask', 'tts-pause', 'tts-resume', 'style', 'layout', 'zoom', 'cite', 'read-page-head',
    'read-section', 'toc-open', 'toc-jump', 'page-nav', 'home', 'farewell',
  ]) {
    assert.ok(kinds.has(k), `table lacks ${k}`);
  }
});

test('「继续」 shares the 12s window with typed/voice page nav; 接着念 never steals it', () => {
  assert.deepEqual(parseLocalCommand('继续', freshNext), nav({ kind: 'next' }, 'continue'));
  assert.deepEqual(parseLocalCommand('再翻一页', freshPrev), nav({ kind: 'prev' }, 'continue'));
  assert.deepEqual(parseLocalCommand('请继续翻吧', freshNext), nav({ kind: 'next' }, 'continue'));
  assert.deepEqual(parseLocalCommand('再往下', noWindow), nav({ kind: 'next' }, 'continue'));
  assert.deepEqual(parseLocalCommand('继续往上翻', freshNext), nav({ kind: 'prev' }, 'continue'));
  assert.equal(parseLocalCommand('继续', noWindow), null);
  assert.equal(parseLocalCommand('继续', staleNext), null);
  // Exactly at the edge of the window is still valid; 1ms later is not.
  const edge: LocalCommandContext = { lastPageNav: { kind: 'next', at: NOW - VOICE_PAGE_CONTINUE_WINDOW_MS }, now: NOW };
  assert.deepEqual(parseLocalCommand('继续', edge), nav({ kind: 'next' }, 'continue'));
  // 接着念 is TTS resume, not page continue, even inside a fresh window.
  assert.deepEqual(parseLocalCommand('接着念', freshNext), { kind: 'tts-resume' });
  // Paused TTS + bare 继续 and no window → resume reading; a fresh window still wins (page nav first).
  assert.deepEqual(parseLocalCommand('继续', { ...noWindow, ttsPaused: true }), { kind: 'tts-resume-bare' });
  assert.deepEqual(parseLocalCommand('继续', { ...freshNext, ttsPaused: true }), nav({ kind: 'next' }, 'continue'));
  assert.equal(parseLocalCommand('继续分析营收', { ...noWindow, ttsPaused: true }), null);
});

test('chinese numerals + full-width digits', () => {
  const table: [string, number | null][] = [
    ['0', 0], ['〇', 0], ['零', 0], ['一', 1], ['二', 2], ['两', 2], ['九', 9],
    ['十', 10], ['十二', 12], ['十九', 19], ['二十', 20], ['二十三', 23], ['九十九', 99],
    ['一百', 100], ['一百零五', 105], ['一百一十', 110], ['一百二十五', 125], ['两百', 200],
    ['一千零五', 1005], ['一零五', 105], ['二三', 23], ['８', 8], ['１２', 12], ['48', 48],
    ['', null], ['百', null], ['abc', null], ['一二三四五', null], ['12345', null],
  ];
  for (const [s, n] of table) assert.equal(parseChineseNumber(s), n, JSON.stringify(s));
});

test('resolveGotoPage clamps to the document with a friendly message', () => {
  const pdfPages = Array.from({ length: 13 }, (_, i) => i + 1);
  assert.deepEqual(resolveGotoPage(8, { pdfPages }), { page: 8, message: '已跳到第 8 页', clamped: false });
  const over = resolveGotoPage(99, { pdfPages });
  assert.equal(over.page, 13);
  assert.equal(over.clamped, true);
  assert.match(over.message, /只有 13 页.*最后一页/);
  const zero = resolveGotoPage(0, { pdfPages });
  assert.equal(zero.page, null);
  assert.match(zero.message, /第 1 页开始/);
  // No outline loaded yet → do not block the jump.
  assert.equal(resolveGotoPage(5, { pdfPages: [] }).page, 5);
  // Printed numbering wins: P8 is the physical page 10 (2-page cover offset).
  const printed = pdfPages.map(p => ({ page: p, printed: p > 2 ? p - 2 : null }));
  assert.equal(resolveGotoPage(8, { pdfPages, printed }).page, 10);
  assert.match(resolveGotoPage(99, { pdfPages, printed }).message, /只有 11 页/);
  // 「第 1 页」 means the printed page 1 (physical 3), not the cover.
  assert.equal(resolveGotoPage(1, { pdfPages, printed }).page, 3);
});

test('normalize: full-width, punctuation, polite words', () => {
  assert.equal(normalizeVoiceText(' 请帮我 翻到第８页，谢谢！'), '翻到第8页');
  assert.equal(normalizeVoiceText('ＭＤ＆Ａ'), 'MD&A');
  assert.equal(normalizeVoiceText('请吧'), '请吧'); // never strips to empty
  assert.deepEqual(parseVoiceNavIntent('翻到第八页'), { kind: 'goto', page: 8 });
});

test('company-detail routes typed AND voice through the one shared dispatcher', () => {
  const src = readFileSync(new URL('../app/company-detail.tsx', import.meta.url), 'utf8');
  assert.match(src, /runLocalCommand\(cmd, text, 'voice'\)/);
  assert.match(src, /runLocalCommand\(cmd, typed, 'typed'\)/);
  assert.equal((src.match(/parseLocalCommand\(/g) ?? []).length, 2);
  // No second, drifting copy of the individual parsers in the UI.
  for (const old of ['parseVoiceNavIntent', 'parseVoiceZoomIntent', 'parseVoiceTocIntent', 'isVoiceFarewell', 'parseVoicePageContinue']) {
    assert.ok(!src.includes(old), `company-detail still references ${old}`);
  }
  // Typed path must never auto-open the voice float.
  const runStart = src.indexOf('function runLocalCommand');
  const runEnd = src.indexOf('async function handleVoiceUtterance');
  const run = src.slice(runStart, runEnd);
  assert.ok(!/voice\.start\(|startVoiceMode\(/.test(run), 'dispatcher must not start a voice session');
});
