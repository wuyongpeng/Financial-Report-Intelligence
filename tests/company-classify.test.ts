import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFromIndustryText, classifyFromName, classifyFromSignals } from '../lib/company-classify';
import { mapIndustryGroup } from '../lib/crawl-display';
import { nameVariants, officialNameFromAlias } from '../lib/company-aliases';

test('name variants strip corporate suffixes', () => {
  assert.deepEqual(nameVariants('美的集团'), ['美的集团', '美的']);
  assert.ok(nameVariants('燧原科技').includes('燧原'));
});

test('aliases map spoken nicknames to official names', () => {
  assert.equal(officialNameFromAlias('招行今年业绩怎样'), '招商银行');
  assert.equal(officialNameFromAlias('美的今年业绩怎么样'), '美的集团');
  assert.equal(officialNameFromAlias('平安银行今年'), '平安银行');
  assert.equal(officialNameFromAlias('平安今年'), '中国平安');
});

test('classifyFromName covers banks / IPO chip names / livestock', () => {
  assert.deepEqual(classifyFromName('招商银行'), { sector: '金融', industry: '银行' });
  assert.deepEqual(classifyFromName('燧原科技'), { sector: '科技', industry: 'AI芯片' });
  assert.deepEqual(classifyFromName('牧原股份'), { sector: '消费', industry: '农林牧渔' });
  assert.deepEqual(classifyFromName('上港集团'), { sector: '周期', industry: '交通运输' });
});

test('classifyFromIndustryText maps 东财/申万 labels', () => {
  assert.deepEqual(classifyFromIndustryText('家用电器', '美的集团'), { sector: '消费', industry: '家电' });
  assert.deepEqual(classifyFromIndustryText('白酒', '贵州茅台'), { sector: '消费', industry: '白酒' });
  assert.deepEqual(classifyFromIndustryText('计算机设备', '燧原科技'), { sector: '科技', industry: '计算机' });
});

test('classifyFromSignals prefers market label, refines AI chip names', () => {
  const midea = classifyFromSignals({ name: '美的集团', marketIndustry: '家用电器' });
  assert.equal(midea.sector, '消费');
  assert.equal(midea.industry, '家电');
  assert.equal(midea.source, 'market');

  const sui = classifyFromSignals({ name: '燧原科技', marketIndustry: '计算机设备' });
  assert.equal(sui.sector, '科技');
  assert.equal(sui.industry, 'AI芯片');
});

test('mapIndustryGroup derives 一级 from 二级 without sector', () => {
  assert.equal(mapIndustryGroup('家电'), '消费');
  assert.equal(mapIndustryGroup('白酒'), '消费');
  assert.equal(mapIndustryGroup('AI芯片'), '科技');
  assert.equal(mapIndustryGroup('券商'), '金融');
  assert.equal(mapIndustryGroup('军工'), '制造军工');
});
