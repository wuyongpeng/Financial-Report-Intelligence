const domains = ['营业收入', '营收', '净利润', '利润', '每股收益', 'EPS', 'ROE', '净资产收益率', '现金流', '毛利率', '费用', '主营业务', '管理层', '经营情况', '同比', '资产负债'];
export function relevance(query: string, content: string) {
  const lower = content.toLowerCase();
  const terms = new Set<string>();
  for (const match of query.matchAll(/[\u4e00-\u9fa5]+|[A-Za-z0-9]+/g)) {
    const word = match[0].toLowerCase();
    if (/^[a-z0-9]+$/.test(word)) terms.add(word);
    else for(let i=0;i<word.length-1;i++) terms.add(word.slice(i,i+2));
  }
  let score = [...terms].reduce((s,t)=>s+(lower.includes(t)?1:0),0);
  for (const d of domains) if (query.toLowerCase().includes(d.toLowerCase()) && lower.includes(d.toLowerCase())) score += 8;
  if (/营收/.test(query) && /营业收入/.test(content)) score+=8;
  if (/原因|为什么|变化|概览/.test(query) && /经营情况|管理层|主要原因|同比|变动原因/.test(content)) score+=6;
  if (/原因|为什么|变化/.test(query) && /管理层讨论|主营业务分析|经营情况讨论/.test(content) && content.length > 600) score += 24;
  return score;
}
export function rankEvidence(query: string, chunks: { page:number;content:string }[], metricPages: number[] = []) {
  const explicit = query.match(/第\s*(\d+)\s*页/)?.[1];
  return chunks.map(c=>({...c,score:explicit ? (c.page===Number(explicit)?100:0) : relevance(query,c.content)+(metricPages.includes(c.page)?35:0)}))
    .filter(c=>c.score>0).sort((a,b)=>b.score-a.score||a.page-b.page).slice(0,12).map(({page,content})=>({page,content}));
}
export function unsupportedYears(question: string, context: string) {
  return [...new Set(question.match(/20\d{2}/g)??[])].filter(y=>!context.includes(y));
}
