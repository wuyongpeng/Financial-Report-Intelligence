import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAsrLexicon,
  correctAsrHomophones,
  correctAsrText,
  lithiumContextActive,
} from '../lib/voice/asr-correct';

test('lithium context active for 紫金 / 有色 / 锂电', () => {
  assert.equal(lithiumContextActive({ companyName: '紫金矿业', industry: '有色' }), true);
  assert.equal(lithiumContextActive({ industry: '锂电' }), true);
  assert.equal(lithiumContextActive({ companyName: '贵州茅台', industry: '白酒' }), false);
});

test('李言 → 锂盐 under 紫金/锂电 context (acceptance)', () => {
  const ctx = { companyName: '紫金矿业', industry: '有色' };
  assert.equal(correctAsrHomophones('李言价格怎么样', ctx), '锂盐价格怎么样');
  assert.equal(correctAsrHomophones('立盐成本', ctx), '锂盐成本');
  assert.equal(correctAsrHomophones('里盐毛利率', ctx), '锂盐毛利率');
  const r = correctAsrText('本期李言和碳酸里', ctx);
  assert.equal(r.text, '本期锂盐和碳酸锂');
  assert.ok(r.replacements.some((x) => x.from === '李言' && x.to === '锂盐'));
  assert.ok(r.replacements.some((x) => x.from === '碳酸里' && x.to === '碳酸锂'));
});

test('李言 not rewritten outside lithium context', () => {
  const ctx = { companyName: '贵州茅台', industry: '白酒' };
  assert.equal(correctAsrHomophones('李言是谁', ctx), '李言是谁');
});

test('global finance hotwords: 归母 / 豆粕', () => {
  assert.equal(
    correctAsrHomophones('归母静利润是多少', { companyName: '牧原股份' }),
    '归母净利润是多少',
  );
  assert.equal(correctAsrHomophones('豆泊价格', { industry: '养殖' }), '豆粕价格');
});

test('buildAsrLexicon includes company name and lithium terms in context', () => {
  const lex = buildAsrLexicon({ companyName: '紫金矿业', industry: '有色' });
  assert.ok(lex.includes('紫金矿业'));
  assert.ok(lex.includes('锂盐'));
  assert.ok(lex.includes('归母净利润'));
});

test('already-correct 锂盐 is left alone', () => {
  const ctx = { companyName: '紫金矿业', industry: '锂电' };
  assert.equal(correctAsrHomophones('锂盐价格', ctx), '锂盐价格');
});
