'use client';

import { useState } from 'react';

const metrics = [
  { label: '营业收入', value: '823.12亿', change: '+9.4%', note: '同比增长' },
  { label: '归母净利润', value: '154.27亿', change: '+12.8%', note: '同比增长' },
  { label: '每股收益', value: '1.52元', change: '+10.1%', note: '同比增长' },
  { label: '净资产收益率', value: '18.6%', change: '+1.2pct', note: '同比提升' },
];

const years = [
  { year: '2020', revenue: 42, profit: 34 },
  { year: '2021', revenue: 57, profit: 51 },
  { year: '2022', revenue: 69, profit: 62 },
  { year: '2023', revenue: 82, profit: 75 },
  { year: '2024', revenue: 94, profit: 88 },
];

const companies = [
  { name: '贵州茅台', code: '600519', market: '上交所', logo: '茅', color: 'blue', revenue: '823.12亿', profit: '154.27亿', eps: '1.52元', roe: '18.6%', report: '2024 年年度报告' },
  { name: '宁德时代', code: '300750', market: '深交所', logo: '宁', color: 'navy', revenue: '3,620.13亿', profit: '507.45亿', eps: '11.62元', roe: '24.3%', report: '2024 年年度报告' },
  { name: '比亚迪', code: '002594', market: '深交所', logo: '比', color: 'red', revenue: '7,771.02亿', profit: '402.54亿', eps: '13.84元', roe: '26.1%', report: '2024 年年度报告' },
  { name: '美的集团', code: '000333', market: '深交所', logo: '海', color: 'cyan', revenue: '4,091.08亿', profit: '385.37亿', eps: '5.18元', roe: '23.5%', report: '2024 年年度报告' },
  { name: '招商银行', code: '600036', market: '上交所', logo: '招', color: 'gold', revenue: '3,378.96亿', profit: '1,483.91亿', eps: '5.81元', roe: '15.7%', report: '2024 年年度报告' },
];

const tabNames = ['核心概览', '经营分析', '财务报表', '同业对比', '原文提纲'];

const answers: Record<string, string> = {
  '收入增长主要由什么驱动？': '收入增长主要来自核心产品量价齐升与直销渠道扩张。年报披露，直销渠道收入保持较快增长，同时产品结构持续优化。',
  '和五粮液相比盈利能力如何？': '从示例对比看，贵州茅台的净利率与 ROE 均高于同业平均，品牌溢价和产品结构是主要原因。正式版会同时引用两家公司年报口径。',
  '今年最大的经营风险是什么？': '年报重点提示宏观消费波动、渠道库存与食品安全风险。当前现金流和渠道掌控力较强，但仍需关注终端动销变化。',
};

export default function Home() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeTab, setActiveTab] = useState('核心概览');
  const [period, setPeriod] = useState('年度');
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);
  const selected = companies[selectedIndex];
  const displayMetrics = [
    { ...metrics[0], value: selected.revenue },
    { ...metrics[1], value: selected.profit },
    { ...metrics[2], value: selected.eps },
    { ...metrics[3], value: selected.roe },
  ];

  function ask(text: string) {
    const clean = text.trim();
    if (!clean) return;
    setChat((items) => [...items, { role: 'user', text: clean }, { role: 'ai', text: answers[clean] ?? `根据${selected.name}${selected.report}，这个问题需要结合财务报表附注进一步核对。Demo 已定位到相关章节，正式版会给出指标、原文页码和计算口径。` }]);
    setQuestion('');
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">财</span><strong>财报智析</strong><span className="beta">BETA</span></div>
        <div className="search"><span>⌕</span><span>搜索公司 / 股票代码 / 财报关键词</span><kbd>⌘ K</kbd></div>
        <div className="top-actions"><button className="icon-btn">◷</button><button className="profile">研究员</button></div>
      </header>

      <div className="workspace">
        <aside className="company-panel">
          <div className="panel-label">热门公司</div>
          <nav className="company-list">
            {companies.map((company, index) => <button key={company.code} onClick={() => { setSelectedIndex(index); setChat([]); }} className={`company ${selectedIndex === index ? 'active' : ''}`}><span className={`company-logo ${company.color}`}>{company.logo}</span><span><b>{company.name}</b><small>{company.code} · {company.market}</small></span>{selectedIndex === index && <i>›</i>}</button>)}
          </nav>
          <div className="coverage"><span>绿色通道</span><b>已覆盖 68 家</b><small>平均入库耗时 23 分钟</small><div><i style={{width:'68%'}} /></div></div>
        </aside>

        <section className="content">
          <div className="company-head">
            <div><div className="eyebrow"><span>{selected.market}直连</span> · {selected.report}</div><h1>{selected.name} <em>{selected.code}</em></h1><p>报告发布于 2025-03-29  ·  数据更新于 09:42  ·  <b>已校验</b></p></div>
            <div className="head-actions"><button onClick={(event) => { event.currentTarget.textContent = '★ 已关注'; }}>☆ 关注</button><button onClick={() => { setActiveTab('原文提纲'); document.getElementById('outline')?.scrollIntoView({ behavior: 'smooth' }); }}>↗ 查看原文</button></div>
          </div>

          <div className="tabs">{tabNames.map((tab) => <button key={tab} onClick={() => { setActiveTab(tab); if (tab === '原文提纲') document.getElementById('outline')?.scrollIntoView({ behavior: 'smooth' }); }} className={activeTab === tab ? 'active' : ''}>{tab}</button>)}</div>

          <div className="metric-grid">
            {displayMetrics.map((metric) => <article className="metric-card" key={metric.label}><div><span>{metric.label}</span><button aria-label={`${metric.label}说明`} title="数据来自交易所披露财报，已统一口径">?</button></div><strong>{metric.value}</strong><p><b>{metric.change}</b> {metric.note}</p></article>)}
          </div>

          <article className="chart-card">
            <div className="card-head"><div><h2>业绩趋势</h2><p>{period === '年度' ? '近五年核心指标变化' : '最近五个季度核心指标变化'}</p></div><div className="segmented"><button onClick={() => setPeriod('年度')} className={period === '年度' ? 'active' : ''}>年度</button><button onClick={() => setPeriod('季度')} className={period === '季度' ? 'active' : ''}>季度</button></div></div>
            <div className="legend"><span><i className="revenue-dot" />营业收入（亿元）</span><span><i className="profit-dot" />归母净利润（亿元）</span></div>
            <div className="chart-area">
              <div className="y-axis"><span>800</span><span>600</span><span>400</span><span>200</span><span>0</span></div>
              <div className="bars">
                {years.map((item, index) => <div className="bar-group" key={item.year}><div className="bar-pair"><i className="bar revenue" style={{height:`${period === '年度' ? item.revenue : item.revenue - 7 + index * 2}%`}} /><i className="bar profit" style={{height:`${period === '年度' ? item.profit : item.profit - 4 + index}%`}} /></div><span>{period === '年度' ? item.year : `${index + 1}Q`}</span></div>)}
              </div>
            </div>
          </article>

          <div className="insight-grid">
            <article className="insight-card"><div className="section-title"><span>AI</span><div><h3>核心发现</h3><p>基于 286 页财报自动提炼</p></div></div><ul><li><b>增长稳健：</b>营收连续五年增长，2024 年同比增速 9.4%。</li><li><b>盈利改善：</b>净利率提升至 18.7%，费用控制效果明显。</li><li><b>现金充沛：</b>经营现金流净额同比增长 15.3%，高于净利润增速。</li></ul></article>
            <article className="outline-card" id="outline"><div className="card-head"><div><h3>原文提纲</h3><p>点击快速定位财报章节</p></div><button onClick={() => setActiveTab('原文提纲')}>展开全部</button></div><ol><li><span>01</span><div><b>公司业务概要</b><small>第 12—18 页</small></div></li><li><span>02</span><div><b>经营情况讨论与分析</b><small>第 19—46 页</small></div></li><li><span>03</span><div><b>财务报告</b><small>第 108—276 页</small></div></li></ol></article>
          </div>
        </section>

        <aside className="ai-panel">
          <div className="ai-head"><div><span>✦</span><div><b>财报 AI 助手</b><small>回答仅基于当前财报</small></div></div><button>＋</button></div>
          <div className="chat-body">
            <div className="ai-message"><span>AI</span><div><p>你好，我已读完{selected.name} {selected.report}。你可以问我业绩变化、风险因素或具体指标。</p><small>数据源：{selected.report}</small></div></div>
            {chat.map((message, index) => message.role === 'user' ? <div className="user-message" key={index}>{message.text}</div> : <div className="ai-message chat-answer" key={index}><span>AI</span><div><p>{message.text}</p><small>引用：{selected.report} · 经营情况讨论与分析</small></div></div>)}
            <div className="prompt-title">试试这样问</div>
            {Object.keys(answers).map((text) => <button className="prompt" key={text} onClick={() => ask(text)}>{text}<span>↗</span></button>)}
          </div>
          <div className="chat-input"><div><textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); ask(question); } }} aria-label="向财报提问" placeholder="向这份财报提问…" rows={2}/><button onClick={() => ask(question)} aria-label="发送问题">↑</button></div><small>AI 回答可能有误，请以财报原文为准</small></div>
        </aside>
      </div>
    </main>
  );
}
