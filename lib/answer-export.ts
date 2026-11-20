import { citeReferenceText, matchAnswerCitation, tokenizeAnswerCites } from './answer-cite';

export type AnswerExportCitation = {
  id?: string;
  reportId?: string;
  page: number;
  quote?: string;
  companyName?: string;
  period?: string;
  code?: string;
};

export type AnswerExportInput = {
  companyName?: string | null;
  code?: string | null;
  period?: string | null;
  question?: string | null;
  answer?: string | null;
  citations?: AnswerExportCitation[];
};

export type AnswerExportResult = {
  markdown: string;
  filename: string;
};

const MISSING = '未提供';
const DISCLAIMER = '以上内容只陈述财报事实，不构成投资建议。数据以公告原文为准。';

function textOrMissing(value?: string | null) {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  return text || MISSING;
}

export function formatExportCompany(companyName?: string | null, code?: string | null) {
  const name = companyName?.trim() ?? '';
  const stock = code?.trim() ?? '';
  if (name && stock) return `${name}（${stock}）`;
  if (name || stock) return name || stock;
  return MISSING;
}

export function formatExportPeriod(period?: string | null) {
  return period?.trim() || MISSING;
}

function formatSourceIdentity(source: AnswerExportCitation) {
  const company = formatExportCompany(source.companyName, source.code);
  const named = company === MISSING ? undefined : company;
  const label = citeReferenceText({
    companyName: named,
    period: source.period?.trim() || undefined,
    page: source.page,
  });
  return label || `第 ${source.page} 页`;
}

function formatExportBody(answer: string, citations: AnswerExportCitation[] | undefined) {
  const pageLabel = (page: number) => `P${page}`;
  let previous: string | null = null;
  let out = '';
  for (const token of tokenizeAnswerCites(answer)) {
    if (token.kind === 'text') {
      out += token.text;
      previous = null;
      continue;
    }
    const cited = matchAnswerCitation(token, citations, pageLabel);
    if (!cited) {
      out += `${token.raw}（待核验）`;
      previous = null;
      continue;
    }
    const key = `${cited.reportId ?? ''}:${cited.page}`;
    if (key === previous) continue;
    previous = key;
    out += `[P${cited.page}]`;
  }
  return out.trim();
}

export type AnswerExportSourceLine = {
  kind: 'source' | 'unresolved';
  text: string;
};

export function listExportSources(input: Pick<AnswerExportInput, 'answer' | 'citations'>): AnswerExportSourceLine[] {
  const answer = input.answer ?? '';
  const citations = input.citations;
  const pageLabel = (page: number) => `P${page}`;
  const seen = new Set<string>();
  const lines: AnswerExportSourceLine[] = [];
  for (const token of tokenizeAnswerCites(answer)) {
    if (token.kind !== 'mark') continue;
    const cited = matchAnswerCitation(token, citations, pageLabel);
    if (!cited) {
      const key = `unresolved:${token.raw}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push({ kind: 'unresolved', text: `文中标注了 ${token.raw}，但本轮没有对应出处。` });
      continue;
    }
    const key = `${cited.reportId ?? ''}:${cited.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const quote = cited.quote?.replace(/\s+/g, ' ').trim();
    lines.push({
      kind: 'source',
      text: quote ? `${formatSourceIdentity(cited)}：${quote}` : formatSourceIdentity(cited),
    });
  }
  return lines;
}

function sanitizeFilenamePart(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, '').trim();
}

export function answerExportFilename(input: Pick<AnswerExportInput, 'companyName' | 'code' | 'period'>) {
  const parts = [input.companyName, input.code, input.period]
    .map((part) => sanitizeFilenamePart(part ?? ''))
    .filter(Boolean);
  return `Eva-${parts.join('-') || '回答'}.md`;
}

export function formatAnswerExport(input: AnswerExportInput): AnswerExportResult {
  const company = formatExportCompany(input.companyName, input.code);
  const period = formatExportPeriod(input.period);
  const question = textOrMissing(input.question);
  const body = formatExportBody(input.answer ?? '', input.citations) || MISSING;
  const sources = listExportSources(input);
  const sourceBlock = sources.length
    ? sources.map((item, index) => `${index + 1}. ${item.text}`).join('\n')
    : '本文没有标注来源。';
  const markdown = [
    '# Eva 回答',
    '',
    `- 公司：${company}`,
    `- 期间：${period}`,
    '',
    '## 问题',
    '',
    question,
    '',
    '## 回答',
    '',
    body,
    '',
    '## 出处',
    '',
    sourceBlock,
    '',
    DISCLAIMER,
    '',
  ].join('\n');
  return { markdown, filename: answerExportFilename(input) };
}

export async function copyAndDownloadAnswerExport(input: AnswerExportInput): Promise<'exported' | 'failed'> {
  const { markdown, filename } = formatAnswerExport(input);
  let copied = false;
  let downloaded = false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(markdown);
      copied = true;
    }
  } catch {
    /* fall through to a textarea copy */
  }
  if (!copied && typeof document !== 'undefined') {
    try {
      const ta = document.createElement('textarea');
      ta.value = markdown;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      copied = document.execCommand('copy');
      ta.remove();
    } catch {
      /* download may still succeed */
    }
  }
  if (typeof document !== 'undefined') {
    try {
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      downloaded = true;
    } catch {
      /* copy may still have succeeded */
    }
  }
  return copied || downloaded ? 'exported' : 'failed';
}
