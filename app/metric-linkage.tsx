import type { MetricName } from '@/lib/detail-model';
import type { MetricRelationshipsResult, MetricRelCite, MetricRelNumber } from '@/lib/metric-relationships';
import { METRIC_REL_EMPTY, RELATION_DATA_LABEL, RELATION_TAKE_LABEL } from '@/lib/metric-relationships';

export type MetricLinkageCite = {
  page: number;
  quote: string;
  metric?: MetricName;
};

type Props = {
  result: MetricRelationshipsResult;
  /** Page chip label, same as overview footnotes (e.g. P12). */
  pageChip?: (page: number) => string;
  /** Tooltip / aria description for a page. */
  pageDescription?: (page: number) => string;
  /** Jump left pane to PDF quote — same path as four-core footnotes. */
  onCite?: (cite: MetricLinkageCite) => void;
  /** Overview pick highlight class for a card id (same as other focus cards). */
  pickedClass?: (id: string) => string;
};

function citeForNumber(n: MetricRelNumber, cites: MetricRelCite[]): MetricRelCite | null {
  if (n.page == null) return null;
  return cites.find((c) => c.metric === n.metric && c.page === n.page)
    ?? cites.find((c) => c.page === n.page)
    ?? { page: n.page, quote: n.label, metric: n.metric };
}

function focusQuote(card: MetricRelationshipsResult['cards'][number]): string {
  const data = card.numbers.length > 0
    ? card.numbers.map((n) => `${n.label} ${n.valueText}`).join(' · ')
    : card.facts.join(' ');
  return `${card.title}。数据 ${data}。提示 ${card.howToRead}`;
}

/** Overview metric-linkage: short 数据 + 提示 lines with page chips; read-only except overview dblclick focus. */
export default function MetricLinkage({
  result,
  pageChip,
  pageDescription,
  onCite,
  pickedClass,
}: Props) {
  return (
    <section className="cd-brief cd-rel-block" aria-label="指标联动">
      <div className="cd-verdict-head">
        <p className="cd-brief-kicker">指标联动</p>
      </div>
      {result.status === 'has_cards' ? (
        <div className="cd-rel-list">
          {result.cards.map(card => {
            const page = card.cites.find((c) => c.page != null)?.page;
            return (
              <details
                key={card.id}
                className={`cd-rel-card cd-focus-card${card.tone === 'ok' ? ' cd-rel-ok' : ''}${pickedClass?.(card.id) ?? ''}`}
                data-rel-id={card.id}
                data-focus-card
                data-focus-id={card.id}
                data-focus-kind="finding"
                data-focus-title={card.title}
                data-focus-quote={focusQuote(card)}
                {...(page != null ? { 'data-focus-page': String(page) } : {})}
              >
                <summary className="cd-rel-summary">
                  <span className="cd-rel-dot" aria-hidden="true" />
                  <span className="cd-rel-title">{card.title}</span>
                </summary>
                <div className="cd-rel-detail">
                  <p className="cd-rel-line">
                    <span className="cd-rel-prefix">{RELATION_DATA_LABEL}</span>
                    <span className="cd-rel-body">
                      {card.numbers.length > 0 ? (
                        card.numbers.map((n, i) => {
                          const cite = citeForNumber(n, card.cites);
                          const chip = cite && pageChip ? pageChip(cite.page) : null;
                          return (
                            <span key={`${card.id}-${n.metric}`} className="cd-rel-num">
                              {i > 0 ? <span className="cd-rel-sep" aria-hidden="true"> · </span> : null}
                              <span className="cd-rel-number-label">{n.label}</span>
                              {' '}
                              <span className="cd-rel-number-value">
                                {n.valueText}
                                {cite && chip && onCite ? (
                                  <button
                                    type="button"
                                    className="cd-cite"
                                    data-source-jump
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onCite({ page: cite.page, quote: cite.quote, metric: cite.metric ?? n.metric });
                                    }}
                                    title={pageDescription
                                      ? `单击定位原文（来源栏加宽至约40%），${pageDescription(cite.page)}`
                                      : `单击定位原文 · PDF 第 ${cite.page} 页`}
                                  >
                                    [{chip}]
                                  </button>
                                ) : null}
                              </span>
                            </span>
                          );
                        })
                      ) : (
                        card.facts.join(' ')
                      )}
                    </span>
                  </p>
                  <p className="cd-rel-line">
                    <span className="cd-rel-prefix">{RELATION_TAKE_LABEL}</span>
                    <span className="cd-rel-body cd-rel-how">{card.howToRead}</span>
                  </p>
                </div>
              </details>
            );
          })}
        </div>
      ) : (
        <p className="cd-rel-empty">{result.status === 'checked_none' ? METRIC_REL_EMPTY.checked_none : METRIC_REL_EMPTY.insufficient}</p>
      )}
    </section>
  );
}
