/** Same predicate as the detail audit-warning banner; unknown is not a warning. */
export function hasReportAuditRisk(report?: { audit_opinion_kind?: string | null } | null): boolean {
  return report?.audit_opinion_kind === 'non_standard';
}
