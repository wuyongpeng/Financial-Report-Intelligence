const DIGITS = '零一二三四五六七八九';
const LARGE_UNITS = ['', '万', '亿', '万亿'];

/** Decimal strings only: never round financial figures through Number/parseFloat. */
function groupedNumberToSpeech(value: string): string {
  const sign = value.startsWith('-') || value.startsWith('−') ? '负' : value.startsWith('+') ? '正' : '';
  const [integer, fraction] = value.replace(/^[+−-]/u, '').replace(/,/g, '').split('.');
  const digits = integer.replace(/^0+(?=\d)/, '');
  const groups = digits.match(/.{1,4}(?=(?:.{4})*$)/g) ?? ['0'];
  // Unusual magnitudes stay exact, merely removing valid grouping separators.
  if (groups.length > LARGE_UNITS.length) return sign + digits + (fraction === undefined ? '' : '.' + fraction);
  let spoken = ''; let gap = false;
  groups.forEach((group, index) => {
    if (!Number(group)) { gap = Boolean(spoken); return; }
    if (spoken && (gap || Number(group) < 1000)) spoken += '零';
    let block = ''; let zero = false;
    [...group].forEach((digit, position) => {
      const n = Number(digit);
      if (!n) { zero = Boolean(block); return; }
      if (zero) block += '零';
      block += DIGITS[n] + ['', '十', '百', '千'][group.length - position - 1];
      zero = false;
    });
    spoken += block + LARGE_UNITS[groups.length - index - 1]; gap = false;
  });
  return sign + (spoken || '零').replace(/^一十/, '十') + (fraction === undefined ? '' : '点' + [...fraction].map(d => DIGITS[Number(d)]).join(''));
}

/**
 * Spoken form of standalone Eva: /ˈiːvə/. No trailing h — "Eevah" and "vuh"
 * were pronounced with an extra /h/. evaluate, EvaX and EVA-01 stay untouched.
 */
export const EVA_BRAND_SPEECH = 'Eeva';

/** Pronunciation only; do not write this result into chat, source data or the UI. */
export function normalizeSpeechPronunciation(raw: string): string {
  return raw.replace(/(?<![A-Za-z0-9_-])eva(?![A-Za-z0-9_-])/gi, EVA_BRAND_SPEECH)
    .replace(/[+−-]?\d[\d,.]*/g, (token, offset: number, source: string) => {
      // A final comma is punctuation, not part of the numeric grouping.
      const number = token.replace(/[,.]+$/, ''); const punctuation = token.slice(number.length);
      const before = source[offset - 1] ?? ''; const after = source[offset + token.length] ?? '';
      if ((before && /[\w.]/.test(before)) || (after && /[\w.]/.test(after))
        || !/^[+−-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(number)) return token;
      return groupedNumberToSpeech(number) + punctuation;
    });
}

/** Strip citation marks/markdown, then normalize only the spoken copy. */
export function speakableText(raw: string): string {
  return normalizeSpeechPronunciation(raw
    .replace(/【(?:E\d+|第\s*\d+\s*页)】/g, '')
    .replace(/\[P\d+\]/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim());
}
