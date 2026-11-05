/**
 * Extract auditor's opinion type from Chinese A-share filing text pages.
 * Used at parse time; does not block core metric extraction.
 */

export const AUDIT_OPINION_KINDS = ['standard', 'non_standard', 'none'] as const;
export type AuditOpinionKind = (typeof AUDIT_OPINION_KINDS)[number];

export const AUDIT_OPINION_TYPES = [
  'unqualified',
  'unqualified_emphasis',
  'qualified',
  'adverse',
  'disclaimer',
] as const;
export type AuditOpinionType = (typeof AUDIT_OPINION_TYPES)[number];

export type ParsedAuditOpinion = {
  kind: AuditOpinionKind;
  type: AuditOpinionType | null;
  /** Compact display label for UI / admin. */
  label: string;
  page: number | null;
  sourceSnippet: string;
};

type Candidate = {
  type: AuditOpinionType;
  kind: Exclude<AuditOpinionKind, 'none'>;
  label: string;
  page: number;
  score: number;
  snippet: string;
};

const TYPE_RANK: Record<AuditOpinionType, number> = {
  disclaimer: 5,
  adverse: 4,
  qualified: 3,
  unqualified_emphasis: 2,
  unqualified: 1,
};

const NONE: ParsedAuditOpinion = {
  kind: 'none',
  type: null,
  label: '本期未见审计意见',
  page: null,
  sourceSnippet: '',
};

export function auditOpinionKindLabel(kind: AuditOpinionKind | null | undefined): string {
  if (kind === 'standard') return '标准';
  if (kind === 'non_standard') return '非标';
  if (kind === 'none') return '未见';
  return '未见';
}

export function isNonStandardAuditOpinion(kind: AuditOpinionKind | null | undefined): boolean {
  return kind === 'non_standard';
}

function windowAround(text: string, index: number, radius = 48): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function contextScore(pageText: string, matchIndex: number): number {
  const nearby = windowAround(pageText, matchIndex, 90);
  let score = 0;
  if (/审计意见|审计报告/.test(nearby)) score += 0.35;
  if (/重要提示|会计师事务所|注册会计师/.test(nearby)) score += 0.2;
  if (/出具|发表|形成了?如下审计意见|我们出具/.test(nearby)) score += 0.15;
  // Prior-period chatter should not win over current disclosure.
  if (/上年|上期|以前年度|去年|前期审计/.test(nearby)) score -= 0.45;
  if (/拟聘|变更会计师|续聘/.test(nearby)) score -= 0.25;
  return score;
}

function pushCandidate(
  out: Candidate[],
  page: number,
  pageText: string,
  matchIndex: number,
  type: AuditOpinionType,
  label: string,
  baseScore: number,
) {
  const score = baseScore + contextScore(pageText, matchIndex) + (page <= 12 ? 0.08 : 0);
  if (score < 0.2) return;
  out.push({
    type,
    kind: type === 'unqualified' ? 'standard' : 'non_standard',
    label,
    page,
    score,
    snippet: windowAround(pageText, matchIndex, 56),
  });
}

/**
 * Scan extracted PDF text pages (1-indexed). Prefer specific non-standard forms
 * over bare 无保留意见; front-matter 重要提示 usually carries the type even when
 * the formal 审计报告 section sits past the parse page limit.
 */
export function parseAuditOpinionPages(pages: string[]): ParsedAuditOpinion {
  const candidates: Candidate[] = [];

  for (let i = 0; i < pages.length; i += 1) {
    const pageText = pages[i] ?? '';
    if (!pageText || pageText.length < 8) continue;
    const page = i + 1;

    // Order matters only for overlapping hits; each pattern records its own type.
    const patterns: Array<{ re: RegExp; type: AuditOpinionType; label: string; base: number }> = [
      { re: /无法表示意见|拒绝表示意见/g, type: 'disclaimer', label: '无法表示意见', base: 0.72 },
      { re: /否定意见/g, type: 'adverse', label: '否定意见', base: 0.7 },
      {
        re: /带(?:有)?(?:强调事项(?:段)?|持续经营重大不确定性(?:段落)?)[^。；\n]{0,32}无保留意见|无保留意见[^。；\n]{0,40}(?:强调事项|持续经营重大不确定性)/g,
        type: 'unqualified_emphasis',
        label: '带强调事项的无保留意见',
        base: 0.68,
      },
      // 保留意见 but not 无保留意见 / 标准无保留意见
      { re: /(?<!无)(?<!标准无)保留意见/g, type: 'qualified', label: '保留意见', base: 0.66 },
      {
        re: /标准无保留意见|(?:出具了?|发表了?)(?:了)?标准?无保留意见|无保留意见的审计报告/g,
        type: 'unqualified',
        label: '标准无保留意见',
        base: 0.55,
      },
    ];

    for (const pattern of patterns) {
      pattern.re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.re.exec(pageText)) !== null) {
        // Guard: 「非标准无保留」 must not count as clean unqualified.
        if (pattern.type === 'unqualified') {
          const prefix = pageText.slice(Math.max(0, match.index - 2), match.index);
          if (/非$/.test(prefix)) {
            pushCandidate(candidates, page, pageText, match.index, 'qualified', '非标准审计意见', 0.64);
            continue;
          }
        }
        pushCandidate(candidates, page, pageText, match.index, pattern.type, pattern.label, pattern.base);
      }
    }
  }

  if (!candidates.length) return { ...NONE };

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break: more severe opinion wins when scores are close.
    const severity = TYPE_RANK[b.type] - TYPE_RANK[a.type];
    if (severity !== 0) return severity;
    return a.page - b.page;
  });

  const best = candidates[0]!;
  // If a strong non-standard hit exists within 0.12 of the best standard hit, prefer non-standard.
  const severe = candidates
    .filter((c) => c.kind === 'non_standard' && c.score >= best.score - 0.12)
    .sort((a, b) => TYPE_RANK[b.type] - TYPE_RANK[a.type] || b.score - a.score)[0];
  const chosen = best.kind === 'standard' && severe ? severe : best;

  return {
    kind: chosen.kind,
    type: chosen.type,
    label: chosen.label,
    page: chosen.page,
    sourceSnippet: chosen.snippet,
  };
}

export function emptyAuditOpinion(): ParsedAuditOpinion {
  return { ...NONE };
}
