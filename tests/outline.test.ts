import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOutline } from '../lib/outline';
import { buildPageLabels } from '../lib/pdf-pages';

test('prefers 目录 entries with dotted leaders and maps printed pages', () => {
  const chunks = [
    { page: 1, content: '贵州茅台酒股份有限公司 2024年年度报告' },
    { page: 3, content: '目录\n第一节 释义 …… P4\n第二节 公司简介和主要财务指标 …… 5\n第三节 管理层讨论与分析 ........ 12\n第四节 公司治理 .... 40\n第五节 环境和社会责任 …… 55\n第六节 重要事项 …… 60\n第七节 股份变动及股东情况 …… 70\n第八节 财务报告 .... 81' },
    { page: 4, content: '4 贵州茅台酒股份有限公司\n第一节 释义\n在本报告书中，除非文义另有所指' },
    { page: 5, content: '5 贵州茅台酒股份有限公司\n第二节 公司简介和主要财务指标\n公司信息' },
    { page: 12, content: '12 贵州茅台酒股份有限公司\n第三节 管理层讨论与分析\n报告期内公司从事的主要业务' },
    { page: 40, content: '40 公司治理 第四节 公司治理' },
    { page: 55, content: '55 第五节 环境和社会责任' },
    { page: 60, content: '60 第六节 重要事项' },
    { page: 70, content: '70 第七节 股份变动及股东情况' },
    { page: 81, content: '81 第八节 财务报告 合并资产负债表' },
  ];
  const labels = buildPageLabels(chunks);
  const outline = buildOutline(chunks, labels);
  assert.ok(outline.length >= 3);
  assert.ok(outline.every((item) => item.source === 'toc'));
  const first = outline.find((item) => item.title.includes('释义'));
  assert.ok(first);
  assert.equal(first!.page, 4);
  assert.match(first!.title, /第一节\s*释义/);
  const mda = outline.find((item) => item.title.includes('管理层讨论与分析'));
  assert.ok(mda);
  assert.equal(mda!.page, 12);
  assert.ok(outline.every((item, i, all) => i === 0 || item.page >= all[i - 1].page));
});

test('falls back to standard rules when 目录 is missing or unusable', () => {
  const outline = buildOutline([
    { page: 2, content: '重要提示 本公司已在本报告中“管理层讨论与分析”章节阐述了风险。' },
    { page: 3, content: '目录 第三章 管理层讨论与分析 ........ 10 第八章 财务报表 .... 81' },
    { page: 11, content: '10 招商银行股份有限公司 第三章 管理层讨论与分析 2026年半年度报告 管理层讨论与分析 3.1 总体经营情况分析' },
  ]);
  assert.equal(outline.find((s) => s.id === 'mda')?.page, 11);
  assert.ok(!outline.some((s) => s.page === 3));
  assert.ok(!outline.some((s) => s.source === 'toc'));
});

test('keeps same-page 目录 neighbors (Maotai H1 style)', () => {
  // Real 茅台 2026H1 目录: 第一节/第二节 share printed page 4; 第七节/第八节 share 25.
  const toc = [
    '目录',
    '第一节 释义 ………………………………………… 4',
    '第二节 公司简介和主要财务指标 ………………………………………… 4',
    '第三节 管理层讨论与分析 ………………………………………… 8',
    '第四节 公司治理 ………………………………………… 18',
    '第五节 环境和社会责任 ………………………………………… 20',
    '第六节 重要事项 ………………………………………… 21',
    '第七节 债券相关情况 ………………………………………… 25',
    '第八节 财务报告 ………………………………………… 25',
  ].join('\n');
  const chunks = [
    { page: 1, content: '贵州茅台酒股份有限公司 2026年半年度报告' },
    { page: 3, content: toc },
    { page: 4, content: '4 贵州茅台酒股份有限公司\n第一节 释义\n在本报告书中，除非文义另有所指' },
    { page: 5, content: '5 贵州茅台酒股份有限公司\n第二节 公司简介和主要财务指标\n公司信息' },
    { page: 8, content: '8 第三节 管理层讨论与分析' },
    { page: 18, content: '18 第四节 公司治理' },
    { page: 20, content: '20 第五节 环境和社会责任' },
    { page: 21, content: '21 第六节 重要事项' },
    { page: 25, content: '25 第七节 债券相关情况' },
    { page: 26, content: '26 第八节 财务报告 合并资产负债表' },
  ];
  const labels = buildPageLabels(chunks);
  const outline = buildOutline(chunks, labels);
  assert.equal(outline.length, 8);
  assert.ok(outline.every((item) => item.source === 'toc'));
  const s1 = outline.find((item) => item.title.includes('释义'));
  const s2 = outline.find((item) => item.title.includes('公司简介和主要财务指标'));
  const s7 = outline.find((item) => item.title.includes('债券相关情况'));
  const s8 = outline.find((item) => item.title.includes('财务报告'));
  assert.ok(s1 && s2 && s7 && s8);
  assert.equal(s1!.page, s2!.page);
  assert.equal(s7!.page, s8!.page);
  assert.match(s2!.title, /第二节/);
  assert.match(s8!.title, /第八节\s*财务报告/);
  assert.ok(outline.every((item, i, all) => i === 0 || item.page >= all[i - 1].page));
});
