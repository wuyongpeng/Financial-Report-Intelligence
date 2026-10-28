import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MetricLinkage from '../app/metric-linkage';
import { documentHref, listProductDocuments, productDocumentLink, readProductDocument } from '../lib/product-documents';
import type { MetricRelationshipsResult } from '../lib/metric-relationships';

test('documentation lists Chinese Markdown files and refuses paths outside the catalog', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eva-docs-'));
  try {
    await writeFile(join(directory, '产品介绍.md'), '# 产品介绍\n正文');
    await writeFile(join(directory, 'ignore.txt'), 'not a document');
    await mkdir(join(directory, 'nested.md'));
    const documents = await listProductDocuments(directory);
    assert.deepEqual(documents, [{ name: '产品介绍.md', title: '产品介绍' }]);
    assert.equal(await readProductDocument('产品介绍.md', directory), '# 产品介绍\n正文');
    assert.equal(await readProductDocument('../outside.md', directory), null);
    assert.equal(await readProductDocument('/etc/passwd', directory), null);
    assert.deepEqual(await listProductDocuments(join(directory, 'missing')), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('documentation links route Chinese names and reject unsafe protocols and unknown local files', () => {
  const names = ['产品介绍.md'];
  assert.equal(productDocumentLink('产品介绍.md', names), documentHref('产品介绍.md'));
  assert.equal(productDocumentLink('../docs/产品介绍.md#说明', names), `${documentHref('产品介绍.md')}#${encodeURIComponent('说明')}`);
  assert.equal(productDocumentLink('#说明', names), '#说明');
  assert.equal(productDocumentLink('https://example.com', names), 'https://example.com');
  assert.equal(productDocumentLink('javascript:alert(1)', names), '');
  assert.equal(productDocumentLink('../lib/auth.ts', names), '');
  assert.equal(productDocumentLink('%XX', names), '');
});

test('indicator linkage reuses overview heading and renders independently collapsed display-only entries', () => {
  const result: MetricRelationshipsResult = {
    status: 'has_cards',
    cards: [{ id: 'cash_vs_profit', title: '账面盈利但经营现金流为负', facts: ['净利润 8 亿，经营现金流 -2 亿。'], howToRead: '利润与现金流不同步。', reasonBoundary: '原因待核验', tone: 'watch', numbers: [], cites: [], askPrompt: '追问原因' }],
  };
  const html = renderToStaticMarkup(createElement(MetricLinkage, { result }));
  assert.match(html, /class="cd-brief cd-rel-block"/);
  assert.match(html, /class="cd-brief-kicker">指标联动/);
  assert.match(html, /<details[^>]*><summary/);
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:=|\s|>)/);
  assert.match(html, /账面盈利但经营现金流为负/);
  assert.doesNotMatch(html, /<button|查看依据|追问原因|原因待核验|cd-rel-numbers/);
});

test('indicator linkage retains honest empty and missing-data states', () => {
  const html = renderToStaticMarkup(createElement(MetricLinkage, { result: { status: 'insufficient', cards: [] } }));
  assert.match(html, /缺少可比数据/);
  assert.doesNotMatch(html, /暂无风险/);
});
