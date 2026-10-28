import type { MetricRelationshipsResult } from '@/lib/metric-relationships';
import { METRIC_REL_EMPTY } from '@/lib/metric-relationships';

/** Display-only, independently collapsed entries; no model call or navigation actions. */
export default function MetricLinkage({ result }: { result: MetricRelationshipsResult }) {
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
                {card.facts.map((line, index) => <p key={index} className="cd-rel-fact">{line}</p>)}
                <p className="cd-rel-how">{card.howToRead}</p>
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
