import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MetricLinkage from '../app/metric-linkage';
import { documentHref, listProductDocuments, productDocumentLink, readProductDocument, PUBLIC_DOCUMENT_ORDER } from '../lib/product-documents';
import {
  RELATION_DATA_LABEL,
  RELATION_TAKE_LABEL,
  type MetricRelationshipsResult,
} from '../lib/metric-relationships';

test('documentation lists whitelisted Markdown in fixed order and refuses paths outside the catalog', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eva-docs-'));
  try {
    await writeFile(join(directory, '技术架构.md'), '# 技术\n');
    await writeFile(join(directory, '产品介绍.md'), '# 产品介绍\n正文');
    await writeFile(join(directory, '功能评测.md'), '# 评测\n');
    await writeFile(join(directory, '旧材料.md'), '# 不应对外\n');
    await writeFile(join(directory, 'ignore.txt'), 'not a document');
    await mkdir(join(directory, '_archive'));
    await writeFile(join(directory, '_archive', '隐藏.md'), '# 归档\n');
    await mkdir(join(directory, 'nested.md'));
    const documents = await listProductDocuments(directory);
    assert.deepEqual(documents, [
      { name: '产品介绍.md', title: '产品介绍' },
      { name: '功能评测.md', title: '功能评测' },
      { name: '技术架构.md', title: '技术架构' },
    ]);
    assert.equal(await readProductDocument('产品介绍.md', directory), '# 产品介绍\n正文');
    assert.equal(await readProductDocument('旧材料.md', directory), null);
    assert.equal(await readProductDocument('../outside.md', directory), null);
    assert.equal(await readProductDocument('/etc/passwd', directory), null);
    assert.deepEqual(await listProductDocuments(join(directory, 'missing')), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('repo docs root exposes exactly the five public documents in order', async () => {
  const documents = await listProductDocuments();
  assert.deepEqual(documents.map(item => item.name), [...PUBLIC_DOCUMENT_ORDER]);
});

test('documentation links route Chinese names and reject unsafe protocols and unknown local files', () => {
  const names = ['产品介绍.md'];
  assert.equal(productDocumentLink('产品介绍.md', names), documentHref('产品介绍.md'));
  assert.equal(documentHref('产品介绍.md'), `/docs?file=${encodeURIComponent('产品介绍.md')}`);
  assert.equal(productDocumentLink('../docs/产品介绍.md#说明', names), `${documentHref('产品介绍.md')}#${encodeURIComponent('说明')}`);
  assert.equal(productDocumentLink('#说明', names), '#说明');
  assert.equal(productDocumentLink('https://example.com', names), 'https://example.com');
  assert.equal(productDocumentLink('javascript:alert(1)', names), '');
  assert.equal(productDocumentLink('../lib/auth.ts', names), '');
  assert.equal(productDocumentLink('%XX', names), '');
});

const sampleCard = {
  id: 'cash_vs_profit' as const,
  title: '账面盈利但经营现金流为负',
  facts: ['归母净利润 8.00 亿元，经营现金流净额 -2.00 亿元。'],
  howToRead: '利润为正而经营现金流净额为负，利润与现金创造暂时不同步。',
  reasonBoundary: '原因待核验，需检查应收与原文解释。',
  tone: 'watch' as const,
  numbers: [
    { metric: 'net_profit' as const, label: '归母净利润', valueText: '8.00 亿元', page: 10 },
    { metric: 'operating_cash_flow' as const, label: '经营现金流', valueText: '-2.00 亿元' },
  ],
  cites: [{ page: 10, quote: '归母净利润', metric: 'net_profit' as const }],
  askPrompt: '请结合原文解释利润与经营现金流为何可能出现这种关系。',
};

test('indicator linkage keeps short 数据 + 提示 lines with page chips, no ask button or chevron', () => {
  assert.equal(RELATION_DATA_LABEL, '数据');
  assert.equal(RELATION_TAKE_LABEL, '提示');
  const result: MetricRelationshipsResult = { status: 'has_cards', cards: [sampleCard] };
  const html = renderToStaticMarkup(createElement(MetricLinkage, {
    result,
    pageChip: (page: number) => `P${page}`,
    pageDescription: (page: number) => `PDF 第 ${page} 页`,
    onCite: () => {},
  }));
  assert.match(html, /class="cd-brief cd-rel-block"/);
  assert.match(html, /class="cd-brief-kicker">指标联动/);
  assert.match(html, /<details[^>]*data-focus-card[^>]*><summary/);
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:=|\s|>)/);
  assert.match(html, /账面盈利但经营现金流为负/);
  assert.match(html, /cd-rel-prefix">数据</);
  assert.match(html, /cd-rel-prefix">提示</);
  assert.match(html, /cd-rel-line/);
  assert.match(html, /\[P10\]/);
  // Missing page on operating_cash_flow — no fake chip for that row
  assert.equal((html.match(/class="cd-cite"/g) || []).length, 1);
  assert.doesNotMatch(html, /追问原因|cd-rel-ask|cd-rel-chevron|原因待核验/);
  assert.doesNotMatch(html, /怎么看|查看依据|>结论</);
  assert.match(html, /data-focus-id="cash_vs_profit"/);
  assert.match(html, /data-focus-kind="finding"/);
});

test('indicator linkage without onCite still renders numbers and does not crash without pages', () => {
  const result: MetricRelationshipsResult = {
    status: 'has_cards',
    cards: [{
      ...sampleCard,
      numbers: [
        { metric: 'net_profit', label: '归母净利润', valueText: '8.00 亿元' },
        { metric: 'operating_cash_flow', label: '经营现金流', valueText: '-2.00 亿元' },
      ],
      cites: [],
    }],
  };
  const html = renderToStaticMarkup(createElement(MetricLinkage, { result }));
  assert.match(html, /cd-rel-line/);
  assert.doesNotMatch(html, /class="cd-cite"/);
  assert.doesNotMatch(html, /追问原因|cd-rel-chevron/);
});

test('indicator linkage retains honest empty and missing-data states', () => {
  const html = renderToStaticMarkup(createElement(MetricLinkage, { result: { status: 'insufficient', cards: [] } }));
  assert.match(html, /缺少可比数据/);
  assert.doesNotMatch(html, /暂无风险/);
  const none = renderToStaticMarkup(createElement(MetricLinkage, { result: { status: 'checked_none', cards: [] } }));
  assert.match(none, /已检查的关系未发现明显背离/);
});
