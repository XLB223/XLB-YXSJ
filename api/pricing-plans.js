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

export const PLAN_TIER_ORDER = { month: 1, half: 2, year: 3 };

export function getPlanById(planId) {
  return PLAN_BY_ID[planId] || null;
}

export function getPlanTier(planId) {
  return PLAN_TIER_ORDER[planId] || 0;
}

export function formatMoney(amount) {
  if (amount == null || Number.isNaN(amount)) return "";
  const rounded = Math.round(Number(amount) * 10) / 10;
  return `¥${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}`;
}

export function calculateUpgradePrice(currentPlanId, targetPlanId) {
  const current = getPlanById(currentPlanId);
  const target = getPlanById(targetPlanId);
  if (!current || !target) return null;
  if (getPlanTier(targetPlanId) <= getPlanTier(currentPlanId)) return null;

  const diff = Math.round((target.price - current.price) * 10) / 10;
  return diff > 0 ? diff : null;
}

export function buildUpgradeOptions(currentPlanId) {
  const currentTier = getPlanTier(currentPlanId);
  if (!currentTier) return [];

  return PRICING_PLANS.filter((plan) => getPlanTier(plan.id) > currentTier)
    .map((target) => {
      const diffPrice = calculateUpgradePrice(currentPlanId, target.id);
      return {
        id: target.id,
        name: target.name,
        price: target.price,
        priceLabel: target.priceLabel,
        period: target.period,
        days: target.days,
        badge: target.badge,
        diffPrice,
        diffLabel: formatMoney(diffPrice),
      };
    })
    .filter((item) => item.diffPrice != null);
}

export function getPurchaseInfo(env = process.env) {
  const siteUrl = (env.SITE_URL || "www.kjdsai.cn").trim();
  const contact = (env.CONTACT_INFO || "").trim();
  const wechatId = (env.CONTACT_WECHAT_ID || env.CONTACT_WECHAT || "").trim();
  const email = (env.CONTACT_EMAIL || "108729447@qq.com").trim();

  return {
    plans: PRICING_PLANS,
    siteUrl,
    contact: contact || "选择套餐 → 扫码付款 → 获取邀请码 → 填入并开通",
    contactService: {
      wechatQr: (env.CONTACT_WECHAT_QR || "/assets/payment/wechat-service.png").trim(),
      wechatId,
      email,
      label: "联系客服",
      hint: wechatId ? `微信号：${wechatId}` : "扫码添加客服微信",
    },
    payment: {
      wechatQr: (env.PAYMENT_WECHAT_QR || "/assets/payment/wechat-pay.png").trim(),
      alipayQr: (env.PAYMENT_ALIPAY_QR || "/assets/payment/alipay-pay.png").trim(),
      note: "先选择套餐并扫码支付，再联系客服获取激活码（不同套餐激活码不同）",
    },
    freeDailyLimit: FREE_DAILY_LIMIT,
    trialNote: "免费试用每天 3 次，试用结束后可扫码开通会员",
  };
}

export function formatPriceSummary() {
  return PRICING_PLANS.map((p) => `${p.period} ${p.priceLabel}`).join(" · ");
}
