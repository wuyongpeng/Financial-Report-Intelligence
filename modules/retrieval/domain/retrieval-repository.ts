import type {
  RetrievalChunk,
  RetrievalMetric,
  RetrievalReport,
  WatchedCompany,
} from './retrieval';

export interface RetrievalRepository {
  findReport(reportId: string): Promise<RetrievalReport | null>;
  findMetrics(reportIds: string[]): Promise<RetrievalMetric[]>;
  listWatchedCompanies(): Promise<WatchedCompany[]>;
  findCompanyHistory(input: {
    code: string;
    excludeReportId: string;
    periodSuffix: string;
    limit: number;
  }): Promise<RetrievalReport[]>;
  findNamedPeerReports(input: {
    codes: string[];
    preferredPeriod: string;
  }): Promise<RetrievalReport[]>;
  findIndustryPeerReports(input: {
    industry: string;
    excludeCode: string;
    preferredPeriod: string;
    limit: number;
  }): Promise<RetrievalReport[]>;
  findChunks(reportIds: string[], limit: number): Promise<RetrievalChunk[]>;
}
