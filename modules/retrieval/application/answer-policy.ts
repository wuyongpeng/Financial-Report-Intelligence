import { unsupportedYears } from '@/lib/chat-evidence';
import { llmModelName } from '@/lib/llm-providers';
import type { QueryPlan, RetrievedPassage, RetrievalMetric } from '../domain/retrieval';

export type FactLine = { metric: RetrievalMetric; line: string; citation?: { id: string } | null };

export function outOfScopeReply(kind: QueryPlan['outOfScopeKind'] = 'off-topic') {
  if (kind === 'investment') {
    return '不提供投资建议或股价预测。可以继续查看本期指标、经营变化与财报原文。';
  }
  if (kind === 'meta-model') {
    const model = llmModelName();
    return model
      ? `我是财报智析 Eva。当前问答使用的模型是 ${model}。我只依据本份已入库财报的可核验数据与原文回答，不闲聊或编造报告外信息。`
      : '我是财报智析 Eva。当前未配置可用大模型时，只会返回可核验指标与原文摘录。我只回答与本份财报相关的问题。';
  }
  return '这个问题超出当前财报范围。我是财报智析 Eva，只依据本份报告的可核验指标与原文回答；请换一个关于本期业绩、科目或某页内容的问题。';
}

export function decideDirectAnswer(input: {
  plan: QueryPlan;
  currentReportId: string;
  metrics: RetrievalMetric[];
  factLines: FactLine[];
  calculations: string[];
  passages: RetrievedPassage[];
}) {
  const { plan, metrics, factLines, calculations, passages } = input;
  let directAnswer: string | undefined;
  let mode = 'evidence-retrieval';
  const missingYears = unsupportedYears(plan.originalQuestion, metrics.map(metric => metric.period).join(' '));

  if (plan.outOfScope) {
    directAnswer = outOfScopeReply(plan.outOfScopeKind);
    mode = 'out-of-scope';
  } else if (missingYears.length) {
    directAnswer = `暂无法回答：尚未入库 ${missingYears.join('、')} 年对应的同口径结构化数据。当前可核验报告期：${[...new Set(metrics.map(metric => metric.period))].join('、') || '无'}。`;
    mode = 'out-of-scope';
  } else if (plan.explicitPage && !passages.some(passage => passage.reportId === input.currentReportId)) {
    directAnswer = '暂无法回答：所选页没有可检索的原文，请打开原始 PDF 核验。';
    mode = 'insufficient-evidence';
  } else if (plan.wantsStructuredValue) {
    const lines = plan.needsHistory || plan.needsPeers
      ? factLines
      : factLines.filter(fact => fact.metric.reportId === input.currentReportId);
    directAnswer = lines.length
      ? [...lines.map(fact => fact.line), ...(plan.wantsChangeCalculation ? calculations : [])].join('\n')
      : '暂无法回答：相关指标尚未解析。';
    mode = lines.length ? 'structured-query' : 'insufficient-evidence';
  }

  if (!directAnswer && !factLines.length && !passages.length) {
    directAnswer = '暂无法回答：当前报告中没有足够的已解析指标或原文证据。';
    mode = 'insufficient-evidence';
  }
  return { directAnswer, mode };
}
