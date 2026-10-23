import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FALLBACK_ATTRIBUTION_MODULES,
  getIndustrySkill,
  industryAttributionModules,
  industryFromStructuredContext,
  industrySkillSystemAppend,
  industrySkillUserFacing,
  resetIndustrySkillCache,
} from '../lib/industry-skills';

test('loads 半导体 skill with volume/price skeleton in systemAppend', () => {
  resetIndustrySkillCache();
  const skill = getIndustrySkill('半导体');
  assert.ok(skill);
  assert.equal(skill!.industry, '半导体');
  assert.match(skill!.systemAppend, /量/);
  assert.match(skill!.systemAppend, /价/);
  assert.match(industrySkillSystemAppend('半导体'), /平均售价|ASP|晶圆/);
  const ui = industrySkillUserFacing('半导体');
  assert.equal(ui?.badge, '半导体视角');
  assert.ok(ui?.hover);
});

test('unknown industry returns null / empty', () => {
  resetIndustrySkillCache();
  assert.equal(getIndustrySkill('不存在的行业XYZ'), null);
  assert.equal(getIndustrySkill(null), null);
  assert.equal(getIndustrySkill('待分类'), null);
  assert.equal(industrySkillSystemAppend('火星矿业'), '');
  assert.equal(industrySkillUserFacing('火星矿业'), null);
});

test('parses industry from structuredContext', () => {
  assert.equal(
    industryFromStructuredContext('当前报告：中芯国际（688981），2025H1，行业 半导体。'),
    '半导体',
  );
  assert.equal(industryFromStructuredContext('行业 待分类。'), null);
});

test('AI应用 skill forbids AI收入 wording', () => {
  resetIndustrySkillCache();
  const append = industrySkillSystemAppend('AI应用');
  assert.match(append, /分产品|合同负债|研发/);
  assert.match(append, /「AI 收入」|禁止写「AI/);
});

test('银行 skill uses NIM framing', () => {
  resetIndustrySkillCache();
  const append = industrySkillSystemAppend('银行');
  assert.match(append, /息差|NIM/);
  assert.match(append, /不良|拨备/);
});

test('半导体 attributionModules expose volume/price/structure/gross/inventory', () => {
  resetIndustrySkillCache();
  const mods = industryAttributionModules('半导体');
  assert.ok(mods);
  assert.equal(mods!.length, 5);
  assert.deepEqual(mods!.map((m) => m.title), ['量', '价', '结构', '毛利', '存货与资本开支']);
  assert.deepEqual(mods!.map((m) => m.id), ['volume', 'price', 'structure', 'gross_margin', 'inventory_capex']);
  assert.equal(industryAttributionModules('待分类'), null);
  assert.equal(industryAttributionModules('不存在的行业XYZ'), null);
  assert.equal(FALLBACK_ATTRIBUTION_MODULES[0].id, 'business');
});

test('fuzzy industry label still resolves 半导体 skill', () => {
  resetIndustrySkillCache();
  assert.equal(getIndustrySkill('半导体及元件')?.industry, '半导体');
  assert.equal(industrySkillUserFacing('半导体及元件')?.badge, '半导体视角');
  assert.ok(industryAttributionModules('半导体及元件')?.length);
});
