/** Turn a feedback「页面」label into a company-period detail link when both are specific. */

const CANONICAL_PERIOD = /20\d{2}(?:FY|H1|Q[1-3])/i;
const CHINESE_PERIOD = /(20\d{2})\s*(年度报告|年报|半年度报告|半年报|中报|一季报|三季报|二季报)/;

export type FeedbackFilingLink = {
  href: string;
  start: number;
  end: number;
};

function codeFrom(text: string | null | undefined): string | null {
  if (!text) return null;
  try {
    const url = new URL(text, 'https://local.invalid');
    const fromPath = url.pathname.match(/\/(\d{6})(?:\/|$)/);
    if (fromPath) return fromPath[1];
  } catch {
    /* plain labels are not URLs */
  }
  return text.match(/(?:^|[^\d])(\d{6})(?:[^\d]|$)/)?.[1] ?? null;
}

function locatePeriod(text: string): { start: number; end: number; token: string } | null {
  const canonical = CANONICAL_PERIOD.exec(text);
  if (canonical) {
    return {
      start: canonical.index,
      end: canonical.index + canonical[0].length,
      token: canonical[0].toUpperCase(),
    };
  }
  const chinese = CHINESE_PERIOD.exec(text);
  if (!chinese) return null;
  const year = chinese[1];
  const kind = chinese[2];
  const token = /年报|年度报告/.test(kind)
    ? `${year}FY`
    : /半年|中报|二季/.test(kind)
      ? `${year}H1`
      : /一季/.test(kind)
        ? `${year}Q1`
        : `${year}Q3`;
  return { start: chinese.index, end: chinese.index + chinese[0].length, token };
}

/** Link only the period span. Homepage and company-only labels stay plain text. */
export function feedbackFilingLink(page: string | null, url: string | null): FeedbackFilingLink | null {
  const display = (page ?? '').trim() || (url ?? '').trim();
  if (!display) return null;
  const period = locatePeriod(display);
  if (!period) return null;
  const code = codeFrom(url) ?? codeFrom(page);
  if (!code) return null;
  return {
    href: `/${code}?period=${encodeURIComponent(period.token)}`,
    start: period.start,
    end: period.end,
  };
}
