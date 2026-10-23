/**
 * 重点关注：阈值仅决定「是否有信号」，界面不展示具体阈值数字。
 */
export const FOCUS_THRESHOLDS = {
  /** 非经常性损益 / 归母净利润（归母净利 > 0 时） */
  nonRecurringToParentProfit: 0.2,
  /** 经营现金流净额 / 净利润 */
  cashToProfitRatio: 0.5,
  /** 货币资金 / 总资产 */
  cashToAssets: 0.2,
  /** 有息负债 / 总资产 */
  interestBearingToAssets: 0.2,
  /** 商誉 / 归母净资产 */
  goodwillToEquityParent: 0.2,
} as const;
