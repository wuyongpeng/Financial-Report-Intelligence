import type { Evidence } from '@/lib/conversations';

export const METRIC_PATTERNS = {
  revenue: /营业收入|营收|收入/,
  net_profit: /净利|利润/,
  eps: /每股|EPS/i,
  roe: /收益率|ROE/i,
  total_assets: /资产|负债率/,
  total_liabilities: /负债/,
  operating_cash_flow: /现金流/,
  operating_cost: /成本|毛利/,
  non_recurring_pnl: /非经常性损益/,
  profit_ex_non_recurring: /扣非/,
  cash_and_equivalents: /货币资金/,
  restricted_cash: /受限.*货币资金|货币资金.*受限/,
  short_term_borrowings: /短期借款/,
  long_term_borrowings: /长期借款/,
  bonds_payable: /应付债券/,
  current_portion_debt: /一年内到期/,
  goodwill: /商誉/,
  equity_parent: /归属于母公司.*权益|归母净资产|归母权益/,
} as const;

export type RetrievalMetricName = keyof typeof METRIC_PATTERNS;

export type RetrievalReport = {
  id: string;
  code: string;
  companyName: string;
  industry: string;
  reportType: string;
  title: string;
  publishedAt: string;
};

export type RetrievalMetric = {
  reportId: string;
  metric: string;
  value: number;
  unit: string;
  period: string;
  sourcePage: number | null;
  sourceLabel: string | null;
  priorValue?: number | null;
  yoyPct?: number | null;
};

export type RetrievalChunk = {
  reportId: string;
  page: number;
  content: string;
};

export type WatchedCompany = { code: string; companyName: string };

export type QueryPlan = {
  originalQuestion: string;
  retrievalQuestion: string;
  metricNames: RetrievalMetricName[];
  needsHistory: boolean;
  needsPeers: boolean;
  namedPeerCodes: string[];
  explicitPage: number | null;
  wantsStructuredValue: boolean;
  wantsChangeCalculation: boolean;
  outOfScope: boolean;
};

export type RetrievedPassage = Evidence & { content: string };

export type RetrievalContext = {
  question: string;
  retrievalQuestion: string;
  structuredContext: string;
  /** Target company industry from companies table (may be empty). */
  industry: string;
  evidence: Evidence[];
  passages: RetrievedPassage[];
  fallback: string;
  directAnswer?: string;
  mode: string;
  metrics: Array<{
    announcement_id: string;
    metric: string;
    value: number;
    unit: string;
    period: string;
    source_page: number | null;
    source_label: string | null;
  }>;
  peers: Array<{ code: string; company_name: string }>;
};
