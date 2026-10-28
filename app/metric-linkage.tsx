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
  /** Prefill chat with the card ask prompt. */
  onAsk?: (prompt: string) => void;
  askDisabled?: boolean;
};

function citeForNumber(n: MetricRelNumber, cites: MetricRelCite[]): MetricRelCite | null {
  if (n.page == null) return null;
  return cites.find((c) => c.metric === n.metric && c.page === n.page)
    ?? cites.find((c) => c.page === n.page)
    ?? { page: n.page, quote: n.label, metric: n.metric };
}

/** Overview metric-linkage cards: 数据 (with page chips) + 提示; optional 追问原因. */
export default function MetricLinkage({
  result,
  pageChip,
  pageDescription,
  onCite,
  onAsk,
  askDisabled,
}: Props) {
  return (
    <section className="cd-brief cd-rel-block" aria-label="指标联动">
      <div className="cd-verdict-head">
        <p className="cd-brief-kicker">指标联动</p>
      </div>
      {result.status === 'has_cards' ? (
        <div className="cd-rel-list">
          {result.cards.map(card => (
            <details key={card.id} className={`cd-rel-card${card.tone === 'ok' ? ' cd-rel-ok' : ''}`} data-rel-id={card.id}>
              <summary className="cd-rel-summary">
                <span className="cd-rel-dot" aria-hidden="true" />
                <span className="cd-rel-title">{card.title}</span>
                <svg className="cd-rel-chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </summary>
              <div className="cd-rel-detail">
                <div className="cd-rel-section">
                  <p className="cd-rel-section-label">{RELATION_DATA_LABEL}</p>
                  {card.numbers.length > 0 ? (
                    <ul className="cd-rel-numbers">
                      {card.numbers.map((n) => {
                        const cite = citeForNumber(n, card.cites);
                        const chip = cite && pageChip ? pageChip(cite.page) : null;
                        return (
                          <li key={`${card.id}-${n.metric}`} className="cd-rel-number">
                            <span className="cd-rel-number-label">{n.label}</span>
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
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    card.facts.map((line, index) => <p key={index} className="cd-rel-fact">{line}</p>)
                  )}
                  {card.numbers.length > 0 && card.facts.length > 0 ? (
                    <div className="cd-rel-facts">
                      {card.facts.map((line, index) => <p key={index} className="cd-rel-fact">{line}</p>)}
                    </div>
                  ) : null}
                </div>
                <div className="cd-rel-section">
                  <p className="cd-rel-section-label">{RELATION_TAKE_LABEL}</p>
                  <p className="cd-rel-how">{card.howToRead}</p>
                  {card.reasonBoundary ? <p className="cd-rel-boundary">{card.reasonBoundary}</p> : null}
                </div>
                {onAsk && card.askPrompt ? (
                  <div className="cd-rel-actions">
                    <button
                      type="button"
                      className="cd-rel-ask"
                      disabled={askDisabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAsk(card.askPrompt);
                      }}
                    >
                      追问原因
                    </button>
                  </div>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      ) : (
        <p className="cd-rel-empty">{result.status === 'checked_none' ? METRIC_REL_EMPTY.checked_none : METRIC_REL_EMPTY.insufficient}</p>
      )}
    </section>
  );
}
