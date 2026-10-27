import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVoiceTocIntent } from '../lib/voice/toc-intent';
import {
  parseVoiceZoomIntent,
  nextPdfZoom,
  VOICE_PDF_ZOOM_DEFAULT,
  VOICE_PDF_ZOOM_LEVELS,
  VOICE_PDF_ZOOM_MAX,
  VOICE_PDF_ZOOM_MIN,
} from '../lib/voice/zoom-intent';
import { isVoiceCiteIntent, VOICE_CITE_MISSING_LINE } from '../lib/voice/cite-intent';
import { parseVoiceLayoutIntent } from '../lib/voice/layout-intent';
import { parseVoiceStyleIntent, voiceStyleConfirmLine } from '../lib/voice/style-intent';
import { parseVoiceTtsControlIntent } from '../lib/voice/tts-control-intent';
import { isVoiceCapabilityIntent, voiceCapabilitySpeech, VOICE_CAPABILITY_LINES } from '../lib/voice/meta-intent';
import { parseVoiceReadIntent } from '../lib/voice/read-intent';
import {
  matchSection,
  buildSectionReadChunks,
  findTocPage,
  parseChineseOrdinal,
  extractSectionOrdinal,
} from '../lib/voice/section-match';
import { parseVoiceNavIntent, parseVoicePageContinue } from '../lib/voice/nav-intent';
import { isVoiceFarewell } from '../lib/voice/farewell-intent';

test('toc intent open directory', () => {
  for (const s of ['打开目录', '看目录', '显示目录', '打开提纲']) {
    assert.deepEqual(parseVoiceTocIntent(s), { kind: 'open-toc' }, s);
  }
});

test('toc intent jump section', () => {
  assert.deepEqual(parseVoiceTocIntent('跳到管理层讨论'), { kind: 'jump-section', query: '管理层讨论' });
  assert.deepEqual(parseVoiceTocIntent('打开管理层讨论与分析'), {
    kind: 'jump-section',
    query: '管理层讨论与分析',
  });
  assert.deepEqual(parseVoiceTocIntent('去MD&A'), { kind: 'jump-section', query: 'MD&A' });
  assert.deepEqual(parseVoiceTocIntent('跳到第三节'), { kind: 'jump-section', query: '第三节' });
});

test('toc intent does not steal read or finance questions', () => {
  assert.equal(parseVoiceTocIntent('朗读第三节'), null);
  assert.equal(parseVoiceTocIntent('读一下管理层讨论'), null);
  assert.equal(parseVoiceTocIntent('营收是多少'), null);
  assert.equal(parseVoiceTocIntent('管理层讨论写了什么'), null);
});

test('zoom intent + nextPdfZoom discrete levels', () => {
  assert.deepEqual(parseVoiceZoomIntent('放大一点'), { kind: 'in' });
  assert.deepEqual(parseVoiceZoomIntent('缩小'), { kind: 'out' });
  assert.deepEqual(parseVoiceZoomIntent('适合宽度'), { kind: 'fit' });
  assert.deepEqual(parseVoiceZoomIntent('适应宽度'), { kind: 'fit' });
  assert.deepEqual(parseVoiceZoomIntent('实际大小'), { kind: 'actual' });
  assert.equal(parseVoiceZoomIntent('毛利率多少'), null);

  assert.deepEqual([...VOICE_PDF_ZOOM_LEVELS], [0.76, 0.88, 1, 1.12, 1.24]);
  assert.equal(nextPdfZoom(VOICE_PDF_ZOOM_DEFAULT, { kind: 'in' }), 1.12);
  assert.equal(nextPdfZoom(1.12, { kind: 'in' }), 1.24);
  assert.equal(nextPdfZoom(1.24, { kind: 'in' }), VOICE_PDF_ZOOM_MAX);
  assert.equal(nextPdfZoom(VOICE_PDF_ZOOM_DEFAULT, { kind: 'out' }), 0.88);
  assert.equal(nextPdfZoom(0.88, { kind: 'out' }), 0.76);
  assert.equal(nextPdfZoom(0.76, { kind: 'out' }), VOICE_PDF_ZOOM_MIN);
  assert.equal(nextPdfZoom(1.5, { kind: 'fit' }), VOICE_PDF_ZOOM_DEFAULT);
  assert.equal(nextPdfZoom(0.9, { kind: 'in' }), 1); // snap nearest 0.88 then +1
});

test('cite / layout / style / meta intents', () => {
  for (const s of ['出处在哪', '去证据页', '看看出处', '跳到出处', '带我看出处']) {
    assert.equal(isVoiceCiteIntent(s), true, s);
  }
  assert.equal(isVoiceCiteIntent('营收出处怎么算'), false);
  assert.match(VOICE_CITE_MISSING_LINE, /没有页码出处/);

  assert.deepEqual(parseVoiceLayoutIntent('收起中间'), { kind: 'collapse-mid' });
  assert.deepEqual(parseVoiceLayoutIntent('收起概览'), { kind: 'collapse-mid' });
  assert.deepEqual(parseVoiceLayoutIntent('只要原文和问答'), { kind: 'collapse-mid' });
  assert.deepEqual(parseVoiceLayoutIntent('展开概览'), { kind: 'expand-mid' });
  assert.deepEqual(parseVoiceLayoutIntent('打开中间栏'), { kind: 'expand-mid' });

  assert.deepEqual(parseVoiceStyleIntent('说重点'), { kind: 'brief' });
  assert.deepEqual(parseVoiceStyleIntent('讲简短点'), { kind: 'brief' });
  assert.deepEqual(parseVoiceStyleIntent('短一点'), { kind: 'brief' });
  assert.deepEqual(parseVoiceStyleIntent('讲细一点'), { kind: 'detailed' });
  assert.deepEqual(parseVoiceStyleIntent('展开说说'), { kind: 'detailed' });
  assert.deepEqual(parseVoiceStyleIntent('详细一点'), { kind: 'detailed' });
  assert.match(voiceStyleConfirmLine('brief'), /重点/);
  assert.match(voiceStyleConfirmLine('detailed'), /细/);

  assert.equal(isVoiceCapabilityIntent('你能干什么'), true);
  assert.equal(isVoiceCapabilityIntent('你有什么功能'), true);
  assert.equal(isVoiceCapabilityIntent('你会做什么'), true);
  assert.equal(isVoiceCapabilityIntent('营收多少'), false);
  const speech = voiceCapabilitySpeech();
  assert.equal(speech, VOICE_CAPABILITY_LINES.join(''));
  assert.match(speech, /页码|出处/);
});

test('tts pause/resume does not steal page continue or farewell', () => {
  assert.deepEqual(parseVoiceTtsControlIntent('先别念了'), { kind: 'pause' });
  assert.deepEqual(parseVoiceTtsControlIntent('别念了'), { kind: 'pause' });
  assert.deepEqual(parseVoiceTtsControlIntent('暂停朗读'), { kind: 'pause' });
  assert.deepEqual(parseVoiceTtsControlIntent('停一下'), { kind: 'pause' });
  assert.deepEqual(parseVoiceTtsControlIntent('接着念'), { kind: 'resume' });
  assert.deepEqual(parseVoiceTtsControlIntent('继续念'), { kind: 'resume' });
  assert.deepEqual(parseVoiceTtsControlIntent('接着说'), { kind: 'resume' });

  // Bare 继续 is page-continue, not TTS resume parser.
  assert.equal(parseVoiceTtsControlIntent('继续'), null);
  const now = 1_000_000;
  assert.deepEqual(
    parseVoicePageContinue('继续', { kind: 'next', at: now - 1000 }, now),
    { kind: 'next' },
  );
  assert.equal(parseVoiceNavIntent('接着念'), null);
  assert.equal(isVoiceFarewell('先别念了'), false);
});

test('read intent section + page head', () => {
  assert.deepEqual(parseVoiceReadIntent('朗读第三节'), { kind: 'section', query: '第三节' });
  assert.deepEqual(parseVoiceReadIntent('读一下第三节'), { kind: 'section', query: '第三节' });
  assert.deepEqual(parseVoiceReadIntent('朗读管理层讨论'), { kind: 'section', query: '管理层讨论' });
  assert.deepEqual(parseVoiceReadIntent('读一下管理层讨论与分析'), {
    kind: 'section',
    query: '管理层讨论与分析',
  });
  assert.deepEqual(parseVoiceReadIntent('从管理层讨论开始读'), { kind: 'section', query: '管理层讨论' });
  assert.deepEqual(parseVoiceReadIntent('读一下这页开头'), { kind: 'page-head' });
  assert.equal(parseVoiceReadIntent('营收是多少'), null);
  assert.equal(parseVoiceReadIntent('下一页'), null);
});

test('chinese ordinal + section match + continuous chunks', () => {
  assert.equal(parseChineseOrdinal('三'), 3);
  assert.equal(parseChineseOrdinal('十二'), 12);
  assert.equal(extractSectionOrdinal('第三节 管理层讨论与分析'), 3);

  const pages = [
    { page: 1, content: '目录\n第一节 释义 …… 4\n第二节 公司简介 …… 6\n第三节 管理层讨论与分析 …… 8\n第四节 公司治理 …… 40' },
    { page: 7, content: '前言杂文' },
    {
      page: 8,
      content: '一些前文。第三节 管理层讨论与分析\n本公司本期经营情况良好。营业收入增长。更多段落。',
    },
    { page: 9, content: '继续讨论产能与市场。' },
    { page: 10, content: '第四节 公司治理\n董事会认为……' },
  ];
  const outline = [
    { id: '1', title: '第一节 释义', page: 4, highlight: '第一节 释义' },
    { id: '2', title: '第二节 公司简介', page: 6, highlight: '第二节 公司简介' },
    { id: '3', title: '第三节 管理层讨论与分析', page: 8, highlight: '第三节 管理层讨论与分析' },
    { id: '4', title: '第四节 公司治理', page: 10, highlight: '第四节 公司治理' },
  ];

  assert.equal(findTocPage(pages), 1);

  const hit = matchSection('管理层讨论', outline, pages);
  assert.ok(hit);
  assert.equal(hit!.page, 8);
  assert.ok(hit!.startOffset >= 0);
  assert.equal(hit!.endPage, 10);

  const byOrdinal = matchSection('第三节', outline, pages);
  assert.ok(byOrdinal);
  assert.equal(byOrdinal!.page, 8);

  const chunks = buildSectionReadChunks(pages, hit!);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0]!.page, 8);
  assert.match(chunks[0]!.text, /管理层讨论/);
  assert.ok(!chunks.some((c) => c.page === 10), 'must stop before 第四节 page');
  assert.ok(!chunks[0]!.text.includes('一些前文'), 'should start at heading offset');
});

test('existing nav / farewell still work alongside new parsers', () => {
  assert.deepEqual(parseVoiceNavIntent('往下翻一页'), { kind: 'next' });
  assert.deepEqual(parseVoiceNavIntent('回首页'), { kind: 'home' });
  assert.equal(isVoiceFarewell('退下吧'), true);
  assert.equal(parseVoiceStyleIntent('下一页'), null);
  assert.equal(parseVoiceZoomIntent('下一页'), null);
  assert.equal(parseVoiceReadIntent('回首页'), null);
});
