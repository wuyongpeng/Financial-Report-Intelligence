export type Company = {
  rank: number;
  code: string;
  name: string;
  exchange: 'SSE' | 'SZSE';
  /** 主题（白酒/半导体…），用于同业对比 */
  industry: string;
  weight: number;
  /** 产业大类：科技/消费/新能源/医药/金融/周期/制造军工 */
  sector?: string;
  theme?: string;
  heat?: 'S' | 'A' | 'B';
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
