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
  /** 受限货币资金 / 货币资金 */
  restrictedToCash: 0.3,
  /** 短期有息（短借+一年内到期）/ 有息负债 */
  shortDebtShare: 0.6,
  /** 货币资金 / 短期有息负债（低于此视为偏紧） */
  cashToShortDebt: 1.0,
  /** 字面「万元」金额换算后相对营收的倍数上限 */
  unitAnomalyVsRevenue: 1.5,
  /** 无营收时：万元口径整数位达到该位数视为荒诞 */
  unitAnomalyWanDigits: 8,
  /** 毛利率同比下滑（百分点） */
  marginDropPp: 3,
} as const;

/** 最多展示的重点关注卡片数 */
export const FOCUS_MAX_CARDS = 2;
