export const FREE_DAILY_LIMIT = 3;

export const PRICING_PLANS = [
  {
    id: "month",
    name: "月卡",
    price: 29.9,
    priceLabel: "¥29.9",
    period: "1 个月",
    days: 30,
  },
  {
    id: "half",
    name: "半年卡",
    price: 69.9,
    priceLabel: "¥69.9",
    period: "6 个月",
    days: 180,
    badge: "划算",
  },
  {
    id: "year",
    name: "年卡",
    price: 129.9,
    priceLabel: "¥129.9",
    period: "1 年",
    days: 365,
    badge: "最省",
  },
];

const PLAN_BY_ID = Object.fromEntries(PRICING_PLANS.map((plan) => [plan.id, plan]));

export function getPlanById(planId) {
  return PLAN_BY_ID[planId] || null;
}

export function getPurchaseInfo(env = process.env) {
  const siteUrl = (env.SITE_URL || "www.kjdsai.cn").trim();
  const contact = (env.CONTACT_INFO || env.CONTACT_WECHAT || "").trim();

  return {
    plans: PRICING_PLANS,
    siteUrl,
    contact: contact || `付款后访问 ${siteUrl} 或联系客服获取激活码`,
    payment: {
      wechatQr: (env.PAYMENT_WECHAT_QR || "/assets/payment/wechat-pay.png").trim(),
      alipayQr: (env.PAYMENT_ALIPAY_QR || "/assets/payment/alipay-pay.png").trim(),
      note: "微信/支付宝扫码支付对应套餐金额，付款后联系客服获取激活码",
    },
    freeDailyLimit: FREE_DAILY_LIMIT,
    trialNote: "免费试用每天 3 次，试用结束后可扫码开通会员",
  };
}

export function formatPriceSummary() {
  return PRICING_PLANS.map((p) => `${p.period} ${p.priceLabel}`).join(" · ");
}
