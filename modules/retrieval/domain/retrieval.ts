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
