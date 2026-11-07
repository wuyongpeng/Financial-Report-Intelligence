import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSpeechPronunciation, speakableText } from '../lib/voice/speakable';

test('all brand spellings speak 伊娃 without changing the original display copy or other English words', () => {
  const original = 'Eva，问EVA，eva的回答。evaluate Revaluation EvaX';
  assert.equal(speakableText(original), '伊娃，问伊娃，伊娃的回答。evaluate Revaluation EvaX');
  assert.ok(original.startsWith('Eva'));
});

test('legal grouped financial numbers speak exact Chinese integers and decimal digits', () => {
  const cases = [
    ['3,835.54亿元', '三千八百三十五点五四亿元'],
    ['-3,835.5400亿元', '负三千八百三十五点五四零零亿元'],
    ['−1,000.05', '负一千点零五'], ['+12,345.60%', '正一万二千三百四十五点六零%'],
    ['1,001', '一千零一'], ['10,010', '一万零一十'], ['100,000,001', '一亿零一'],
    ['1,010,010,010', '十亿一千零一万零一十'], ['0,000.01', '零点零一'],
    ['1,234,567,890,123', '一万亿二千三百四十五亿六千七百八十九万零一百二十三'],
    ['9,007,199,254,740,993', '九千零七万亿一千九百九十二亿五千四百七十四万零九百九十三'],
  ];
  for (const [raw, expected] of cases) assert.equal(normalizeSpeechPronunciation(raw), expected, raw);
});

test('ordinary punctuation, enumerations, malformed groups, identifiers and ungrouped values remain intact', () => {
  for (const raw of ['1,2,3', '一,二,三', '1, 234', '12,34,567', '1,234,56', '3835.54亿元', '000001', 'v1,234.5.6', '1,234.56,789', 'ID1,234', 'A,B,C']) {
    assert.equal(normalizeSpeechPronunciation(raw), raw, raw);
  }
  assert.equal(speakableText('**Eva**：3,835.54亿元【E1】，另有1,234, 5,678。'), '伊娃：三千八百三十五点五四亿元，另有一千二百三十四, 五千六百七十八。');
});
