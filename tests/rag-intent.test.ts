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
