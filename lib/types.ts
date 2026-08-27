export type Company = {
  rank: number;
  code: string;
  name: string;
  exchange: 'SSE' | 'SZSE';
  industry: string;
  weight: number;
};

export type Announcement = {
  source: 'CNINFO' | 'SSE' | 'SZSE';
  sourceId: string;
  code: string;
  name: string;
  title: string;
  publishedAt: string;
  pdfUrl: string;
  reportType: 'annual' | 'semiannual' | 'quarterly' | 'other';
};
