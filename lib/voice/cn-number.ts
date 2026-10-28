/** Chinese / Arabic / full-width numerals → integer (0..9999). Used for 「翻到第八页」. */

const DIGIT: Record<string, number> = {
  〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** Character class source (no brackets) for numerals accepted in page commands. */
export const CN_NUM_CHARS = '〇零一二三四五六七八九两十百千';

export function parseChineseNumber(input: string): number | null {
  let s = input.trim();
  if (!s) return null;
  // Full-width digits.
  s = s.replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10));
  if (/^\d{1,4}$/.test(s)) return Number(s);
  if (!new RegExp(`^[${CN_NUM_CHARS}]+$`).test(s)) return null;

  // No unit → digit-by-digit (「一零五」→105, 「二三」→23, 「〇」→0).
  if (!/[十百千]/.test(s)) {
    if (s.length > 4) return null;
    let n = 0;
    for (const ch of s) n = n * 10 + (DIGIT[ch] ?? 0);
    return n;
  }

  let total = 0;
  let cur = 0;
  let lastUnit = 0;
  let sawDigitAfterUnit = false;
  for (const ch of s) {
    if (ch in DIGIT) {
      cur = DIGIT[ch]!;
      sawDigitAfterUnit = true;
    } else {
      const u = UNIT[ch]!;
      // 「十二」/「十」 → implicit 一; 「百」/「千」 need an explicit multiplier.
      if (cur === 0 && u !== 10) return null;
      total += (cur || 1) * u;
      cur = 0;
      lastUnit = u;
      sawDigitAfterUnit = false;
    }
  }
  if (cur > 0) {
    // 「一百一」→110, 「一千二」→1200 shorthand: trailing bare digit is one unit lower.
    if (sawDigitAfterUnit && lastUnit >= 100 && !/零|〇/.test(s.slice(-2, -1))) total += cur * (lastUnit / 10);
    else total += cur;
  }
  return total > 0 && total <= 9999 ? total : null;
}
