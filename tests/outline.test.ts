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

test('buildPageLabels uses Pxx when printed numbering is unknown', () => {
  const labels = buildPageLabels([
    { page: 1, content: '封面 某某股份有限公司年度报告' },
    { page: 2, content: '重要提示 本公司董事会保证' },
    { page: 3, content: '无页码标记的正文段落' },
  ]);
  assert.equal(labels.find((l) => l.page === 2)?.printed, null);
  assert.equal(labels.find((l) => l.page === 2)?.label, 'P2');
  assert.ok(labels.every((l) => !String(l.label).startsWith('PDF ')));
});


test('reads CSRC quarterly 一、 headings and ignores 第五章 citations and 利润表 lines', () => {
  // Flattened text from 中科曙光 2026Q3: no 目录, four 一、 sections, a prospectus
  // citation on the shareholder page, and income-statement 一、营业总收入 later.
  const chunks = [
    { page: 1, content: '曙光信息产业股份有限公司2026 年第三季度报告 1 / 12 证券代码：603019 证券简称：中科曙光 第三季度财务报表是否经审计 □是 √否 一、主要财务数据 （一） 主要会计数据和财务指标 单位：元 币种：人民币 项目 本报告期 营业收入 4,772,680,019.91' },
    { page: 4, content: '曙光信息产业股份有限公司2026 年第三季度报告 4 / 12 二、股东信息 （一） 普通股股东总数和表决权恢复的优先股股东数量及前十名股东持股情况表 单位：股 报告期末普通股股东总数 387,407' },
    { page: 5, content: '上述股东关联关系或一致行动的说明 中科算源与思科智存在关联关系（双方关联关系详见公司《首次公开发行 股票招股说明书》第五章第七部分），其他股东未知是否有关联关系或一致行动关系。 三、其他提醒事项 需提醒投资者关注的关于公司报告期经营情况的其他重要信息 □适用 √不适用 四、季度财务报表 （一）审计意见类型 □适用 √不适用' },
    { page: 6, content: '（二）财务报表 合并资产负债表 2026 年 9 月 30 日 编制单位：曙光信息产业股份有限公司' },
    { page: 8, content: '合并利润表 2026 年 1—9 月 项目 2026 年前三季度 一、营业总收入 12,238,490,171.34 二、营业总成本 11,171,055,122.12' },
  ];
  const outline = buildOutline(chunks);
  assert.deepEqual(outline.map((item) => [item.title, item.page, item.source]), [
    ['一、主要财务数据', 1, 'detected'],
    ['二、股东信息', 4, 'detected'],
    ['三、其他提醒事项', 5, 'detected'],
    ['四、季度财务报表', 5, 'detected'],
  ]);
  assert.ok(!outline.some((item) => item.title.includes('第五章') || item.title.includes('营业总收入')));
  assert.ok(!outline.some((item) => item.source === 'standard'));
});

test('reads SZSE quarterly outlines that insert 募集资金使用情况 or use 其他重要事项', () => {
  const fundraising = buildOutline([
    { page: 2, content: '美的集团2026年三季度报告 2 一、主要财务数据 （一） 主要会计数据和财务指标 营业收入 100' },
    { page: 4, content: '二、募集资金使用情况 √适用 □不适用 三、股东信息 （一） 普通股股东总数 1,000' },
    { page: 5, content: '四、其他重要事项 □适用 √不适用' },
    { page: 6, content: '五、季度财务报表 （一） 财务报表 1、合并资产负债表' },
    { page: 8, content: '五、净利润 12,859,511 六、其他综合收益的税后净额 1,000' },
  ]);
  assert.deepEqual(fundraising.map((item) => item.title), [
    '一、主要财务数据',
    '二、募集资金使用情况',
    '三、股东信息',
    '四、其他重要事项',
    '五、季度财务报表',
  ]);
  assert.equal(fundraising.find((item) => item.title.includes('募集资金'))?.page, 4);
  assert.equal(fundraising.find((item) => item.title.includes('季度财务报表'))?.page, 6);

  const ningde = buildOutline([
    { page: 1, content: '宁德时代新能源科技股份有限公司 2026年三季度报告 一、主要财务数据 （一） 主要会计数据和财务指标 公司是否需追溯调整或重述以前年度会计数据' },
    { page: 3, content: '二、股东信息 （一） 普通股股东总数和表决权恢复的优先股股东数量及前十名股东持股情况' },
    { page: 5, content: '三、其他重要事项 适用 □不适用 序号 重大事项 四、季度财务报表 （一） 财务报表 1、合并资产负债表 编制单位：宁德时代新能源科技' },
  ]);
  assert.deepEqual(ningde.map((item) => item.title), [
    '一、主要财务数据',
    '二、股东信息',
    '三、其他重要事项',
    '四、季度财务报表',
  ]);
});

test('reads bank quarterly Arabic section numbers (招商银行 style)', () => {
  const outline = buildOutline([
    { page: 1, content: '招 商 银 行 股 份 有 限 公 司 二○二六年第三季度报告 1 重要提示 本公司董事会、董事和高级管理人员保证本报告内容的真实、准确、完整' },
    { page: 2, content: '2026 年第三季度报告(A 股) 2 2 主要财务数据 2.1 本集团主要会计数据及财务指标 （人民币百万元，特别注明除外）' },
    { page: 3, content: '2026 年第三季度报告(A 股) 3 3 股东信息 3.1 普通股股东情况 截至报告期末，本公司普通股股东总数为582,672户' },
    { page: 4, content: '2026 年第三季度报告(A 股) 4 4 管理层讨论与分析 4.1 总体经营情况分析 本集团始终坚持质量、效益、规模协调发展理念' },
    { page: 7, content: '其中85%以上的房地产开发贷款余额分布在一、二线城市，区域结构保持良好。' },
    { page: 13, content: '2026 年第三季度报告(A 股) 13 5 财务报表 未经审计合并资产负债表（除特别注明外，货币单位均以人民币百万元列示）' },
    { page: 21, content: '未经审计合并现金流量表 一、经营活动产生的现金流量 客户存款净增加额 422,781 二、投资活动产生的现金流量 收回投资收到的现金' },
    { page: 25, content: '2026 年第三季度报告(A 股) 25 6 流动性覆盖率信息 本集团根据《商业银行流动性覆盖率信息披露办法》的相关规定编制和披露流动性覆盖率信息。' },
  ]);
  assert.deepEqual(outline.map((item) => [item.title, item.page]), [
    ['1 重要提示', 1],
    ['2 主要财务数据', 2],
    ['3 股东信息', 3],
    ['4 管理层讨论与分析', 4],
    ['5 财务报表', 13],
    ['6 流动性覆盖率信息', 25],
  ]);
  assert.ok(outline.every((item) => item.source === 'detected'));
  assert.ok(!outline.some((item) => item.title.includes('二线城市') || item.title.includes('经营活动')));
});

test('keeps H1/FY 目录 outlines and does not fall through to quarterly 一、 headings', () => {
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
    { page: 2, content: '重要提示 一、 本公司董事会及董事、高级管理人员保证半年度报告内容的真实性、准确性、完整性，不存在虚假记载、误导性陈述或重大遗漏，并承担个别和连带的法律责任。 二、 公司全体董事出席董事会会议。 三、 本半年度报告未经审计。' },
    { page: 3, content: toc },
    { page: 4, content: '4 贵州茅台酒股份有限公司\n第一节 释义\n在本报告书中，除非文义另有所指' },
    { page: 5, content: '5 贵州茅台酒股份有限公司\n第二节 公司简介和主要财务指标\n公司信息' },
    { page: 8, content: '8 第三节 管理层讨论与分析' },
    { page: 18, content: '18 第四节 公司治理' },
    { page: 20, content: '20 第五节 环境和社会责任' },
    { page: 21, content: '21 第六节 重要事项' },
    { page: 25, content: '25 第七节 债券相关情况 第八节 财务报告 合并资产负债表' },
  ];
  const outline = buildOutline(chunks, buildPageLabels(chunks));
  assert.equal(outline.length, 8);
  assert.ok(outline.every((item) => item.source === 'toc'));
  assert.ok(!outline.some((item) => item.title.startsWith('一、') || item.title.includes('本公司董事会')));
  assert.match(outline[0]!.title, /第一节\s*释义/);
  assert.match(outline[7]!.title, /第八节\s*财务报告/);
});
