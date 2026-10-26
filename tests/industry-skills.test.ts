import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FALLBACK_ATTRIBUTION_MODULES,
  attributionModulePool,
  expandAttributionModulePool,
  getIndustrySkill,
  industryAttributionModules,
  industryFromStructuredContext,
  industrySkillSystemAppend,
  industrySkillUserFacing,
  depthAttributionLead,
  resetIndustrySkillCache,
  selectDisplayAttributionModules,
  SECONDARY_ATTRIBUTION_MODULES,
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
  assert.deepEqual(mods!.map((m) => m.title), ['晶圆销量', '平均售价', '地区与应用结构', '毛利率', '存货与资本开支']);
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


test('broad label 电子 does not resolve to 消费电子', () => {
  resetIndustrySkillCache();
  assert.equal(getIndustrySkill('电子'), null);
  assert.equal(industrySkillUserFacing('电子'), null);
  assert.equal(industryAttributionModules('电子'), null);
});

test('depthAttributionLead uses real industry name, not 产业', () => {
  resetIndustrySkillCache();
  assert.equal(depthAttributionLead('半导体'), '按半导体行业视角组织归因');
  assert.equal(depthAttributionLead('半导体及元件'), '按半导体行业视角组织归因');
  assert.equal(depthAttributionLead(null), '解释营收、利润与异常指标为何变动');
});


test('attributionModulePool expands NEV primary 5 with ~10 secondary (~15 total)', () => {
  resetIndustrySkillCache();
  const primary = industryAttributionModules('新能源车');
  assert.ok(primary);
  assert.equal(primary!.length, 5);
  const pool = attributionModulePool('新能源车');
  assert.ok(pool.length >= 14 && pool.length <= 16, `pool size ${pool.length}`);
  assert.deepEqual(pool.slice(0, 5).map((m) => m.title), ['量', '价', '结构', '毛利与费用', '存货与现金流']);
  assert.ok(pool.some((m) => m.id === 'revenue_profit'));
  assert.ok(pool.some((m) => m.id === 'guidance_outlook'));
  assert.equal(SECONDARY_ATTRIBUTION_MODULES.length, 10);
});

test('selectDisplayAttributionModules falls back to secondary when all primary empty', () => {
  const pool = expandAttributionModulePool([
    { id: 'volume', title: '量', hint: '', priority: 1 },
    { id: 'price', title: '价', hint: '', priority: 2 },
    { id: 'structure', title: '结构', hint: '', priority: 3 },
    { id: 'gross_margin', title: '毛利与费用', hint: '', priority: 4 },
    { id: 'inventory', title: '存货与现金流', hint: '', priority: 5 },
  ]);
  const modules = [
    { id: 'volume', conclusion: '' },
    { id: 'price', conclusion: '本期该维度披露有限' },
    { id: 'revenue_profit', conclusion: '营收907亿元同比增1.47%，归母净利445亿元。' },
    { id: 'cash_conversion', conclusion: '经营现金流净额707亿元。' },
    { id: 'rd_intensity', conclusion: '研发费用率约5.2%。' },
  ];
  const picked = selectDisplayAttributionModules(pool, modules, { maxDisplay: 5 });
  assert.ok(picked.length >= 2 && picked.length <= 5);
  assert.ok(picked.every((m) => (m.priority ?? 99) > 5), 'should not keep empty primary when secondary filled');
  assert.ok(picked.some((m) => m.id === 'revenue_profit'));
});

test('selectDisplayAttributionModules prefers filled primary over secondary', () => {
  const pool = expandAttributionModulePool([
    { id: 'volume', title: '量', hint: '', priority: 1 },
    { id: 'price', title: '价', hint: '', priority: 2 },
  ]);
  const modules = [
    { id: 'volume', conclusion: '新能源车销量同比增20%至150万辆。' },
    { id: 'revenue_profit', conclusion: '营收3000亿元。' },
  ];
  const picked = selectDisplayAttributionModules(pool, modules, { maxDisplay: 5 });
  assert.equal(picked[0].id, 'volume');
  assert.ok(picked.some((m) => m.id === 'volume'));
});
