export type LegalPage = {
  slug: 'disclaimer' | 'sources' | 'privacy';
  title: string;
  paragraphs: string[];
};

export const LEGAL_PAGES: LegalPage[] = [
  {
    slug: 'disclaimer',
    title: '投资免责声明',
    paragraphs: [
      'Eva 是一款财报阅读与问答工具，只陈述上市公司公告中的事实与数据，不对投资价值作出判断，也不提供买入、卖出或持有建议。',
      '页面中的指标、摘要和回答均来自已披露的定期报告原文或据此解析的结果，可能存在口径差异、解析遗漏或更新延迟。任何内容都不构成投资建议、要约或承诺。',
      '作出投资决策前，请自行阅读原始公告，并在必要时咨询具备资质的专业人士。使用本产品即表示你理解并接受上述说明。',
    ],
  },
  {
    slug: 'sources',
    title: '数据来源',
    paragraphs: [
      'Eva 使用的定期报告来自上交所、深交所和巨潮资讯网公开发布的公告原文。',
      '财务指标由系统从公告 PDF 中解析，并尽量保留出处页码与原文片段。如解析结果与公告不一致，一律以公告原文为准。',
      '抓取、解析可能出现延迟或失败。产品会在相关公司页面说明「正在抓取」「抓取延迟」或「暂不可用」，而不是只在运营后台展示。',
    ],
  },
  {
    slug: 'privacy',
    title: '隐私政策',
    paragraphs: [
      '访客可以浏览已覆盖的公司与报告；对话次数按日限额，相关记录仅在当前会话中有效，关闭页面后可能丢失。',
      '注册时我们保存你的用户名和密码散列。我们还会保存你的自选公司、对话内容和站内通知，以便你换设备后继续使用。',
      '我们不会把这些个人信息出售给第三方。你随时可以退出登录，也可以在账号面板申请注销。注销后将删除该账号的自选、对话、通知和账号本身，已公开分享的答案也会移除。覆盖抓取所用的公开公告数据属于产品共用数据，不会因个人注销而删除。',
    ],
  },
];

export function legalPath(slug: LegalPage['slug']) {
  return `/legal/${slug}`;
}

export function findLegalPage(slug: string) {
  return LEGAL_PAGES.find((page) => page.slug === slug) ?? null;
}
