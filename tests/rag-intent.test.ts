import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mentionedCompanyCodes,
  wantsCompanyHistory,
  wantsEvaluativeJudgement,
  wantsPeerCompare,
} from '../lib/rag';

test('业绩好不好 pulls history and judgement, not only current filing', () => {
  const q = '000333今年业绩好不好';
  assert.equal(wantsCompanyHistory(q), true);
  assert.equal(wantsEvaluativeJudgement(q), true);
  assert.equal(wantsPeerCompare('营收是多少'), false);
});

test('peer phrasing and named competitors are detected', () => {
  assert.equal(wantsPeerCompare('和格力对比怎么样'), true);
  assert.equal(wantsPeerCompare('同行竞品对标'), true);
  const watched = [
    { code: '000333', company_name: '美的集团' },
    { code: '000651', company_name: '格力电器' },
    { code: '600036', company_name: '招商银行' },
  ];
  assert.deepEqual(mentionedCompanyCodes('美的和格力对比', watched, '000333'), ['000651']);
  assert.deepEqual(mentionedCompanyCodes('招行 vs 000333', watched, '000333'), ['600036']);
});


test('平安银行 must not pull 中国平安 via short alias 平安', () => {
  const watched = [
    { code: '000001', company_name: '平安银行' },
    { code: '601318', company_name: '中国平安' },
    { code: '600036', company_name: '招商银行' },
  ];
  assert.deepEqual(
    mentionedCompanyCodes('证券简称：平安银行 2026年第三季度报告', watched, '000001'),
    [],
  );
  assert.deepEqual(
    mentionedCompanyCodes('对比中国平安和招行', watched, '000001'),
    ['601318', '600036'],
  );
});

test('bare year in question does not force company history', () => {
  assert.equal(wantsCompanyHistory('当前用的哪个大语言模型'), false);
  assert.equal(wantsCompanyHistory('证券代码：000001 2026年第三季度报告'), false);
  assert.equal(wantsCompanyHistory('今年业绩同比怎么样'), true);
});
