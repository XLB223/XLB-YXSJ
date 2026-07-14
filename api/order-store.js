import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import {
  getPlanById,
  calculateUpgradePrice,
  formatMoney,
} from "./pricing-plans.js";
import {
  getUsageStatus,
  isProDevice,
  applyOrderUpgrade,
  applyOrderPurchase,
} from "./usage-store.js";
import {
  notifyAdminNewOrder,
  notifyAdminFulfillCode,
} from "./mail.mjs";
import { loadJsonStore, saveJsonStore } from "./safe-json-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORDERS_FILE = path.join(__dirname, "..", "data", "orders.json");
const FULFILL_LINK_TTL_SEC = 48 * 60 * 60;
const NOTIFY_RETRY_COOLDOWN_MS = 45_000;
const fulfillLocks = new Map();

function loadOrdersStore() {
  const raw = loadJsonStore(ORDERS_FILE, { orders: {} });
  return { orders: raw.orders || {} };
}

function saveOrdersStore(store) {
  saveJsonStore(ORDERS_FILE, store);
}

function toBuffer(value) {
  return Buffer.from(String(value || ""), "utf8");
}

function safeEqual(a, b) {
  const left = toBuffer(a);
  const right = toBuffer(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function getFulfillSecret(env = process.env) {
  return String(env.ADMIN_FULFILL_TOKEN || "").trim();
}

function signFulfillPayload(orderId, exp, env = process.env) {
  const secret = getFulfillSecret(env);
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(`${orderId}.${exp}`).digest("base64url");
}

function generateOrderId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `KJ-${date}-${suffix}`;
}

function formatOrderResponse(order) {
  const plan = getPlanById(order.planId);
  return {
    orderId: order.orderId,
    type: order.type,
    status: order.status,
    planId: order.planId,
    planName: plan?.name || order.planId,
    amountLabel: order.amountLabel,
    paymentNote: order.orderId,
    createdAt: order.createdAt,
    fulfilledAt: order.fulfilledAt || null,
    adminNotified: Boolean(order.adminNotified),
    upgradeApplied: Boolean(order.upgradeApplied),
    activationApplied: Boolean(order.activationApplied),
    code: order.status === "fulfilled" ? order.code : null,
    message: orderStatusMessage(order),
  };
}

function orderStatusMessage(order) {
  if (order.status === "fulfilled") {
    if (order.type === "upgrade") {
      return order.upgradeApplied
        ? "已确认收款，会员套餐已升级完成。"
        : "已确认收款，请点击升级完成套餐变更。";
    }
    return order.activationApplied
      ? "已确认收款，会员已开通完成。"
      : "已确认收款，请点击开通完成会员激活。";
  }
  if (order.status === "cancelled") {
    return "订单已取消，如有疑问请联系客服。";
  }
  if (!order.adminNotified) {
    return `订单号 ${order.orderId}。请点击「发送通知」，等待管理员确认收款。`;
  }
  return order.type === "upgrade"
    ? `订单号 ${order.orderId}。通知已发送，请等待管理员确认，确认后自动升级。`
    : `订单号 ${order.orderId}。通知已发送，请等待管理员确认，确认后自动开通。`;
}

/** Legacy global token (scripts / old emails). Prefer signed per-order links. */
export function verifyAdminFulfillToken(token, env = process.env) {
  const expected = getFulfillSecret(env);
  const given = String(token || "").trim();
  if (!expected || !given) return false;
  return safeEqual(expected, given);
}

export function verifyFulfillAuthorization(orderId, query, env = process.env) {
  const normalizedId = String(orderId || "").trim().toUpperCase();
  if (!normalizedId || !getFulfillSecret(env)) return false;

  const sig = String(query?.sig || "").trim();
  const exp = String(query?.exp || "").trim();
  if (sig && exp) {
    const expNum = Number(exp);
    if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return false;
    const expected = signFulfillPayload(normalizedId, exp, env);
    return Boolean(expected) && safeEqual(expected, sig);
  }

  // Backward-compatible global token (discourage for new emails).
  return verifyAdminFulfillToken(query?.token, env);
}

export function buildAdminFulfillUrl(orderId, env = process.env) {
  const secret = getFulfillSecret(env);
  if (!secret) return "";
  const normalizedId = String(orderId || "").trim().toUpperCase();
  const exp = String(Math.floor(Date.now() / 1000) + FULFILL_LINK_TTL_SEC);
  const sig = signFulfillPayload(normalizedId, exp, env);
  const siteUrl = String(env.SITE_URL || "www.kjdsai.cn").replace(/^https?:\/\//, "");
  const params = new URLSearchParams({ orderId: normalizedId, exp, sig });
  return `https://${siteUrl}/api/order/fulfill?${params.toString()}`;
}

export function isManualPaymentMode(env = process.env) {
  const raw = String(env.MANUAL_PAYMENT_ORDERS ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off";
}

export function createOrder({ deviceId, planId, type }, env = process.env) {
  if (!deviceId?.trim()) {
    const error = new Error("缺少设备标识");
    error.status = 400;
    throw error;
  }

  const normalizedType = String(type || "purchase").trim();
  const normalizedPlanId = String(planId || "").trim();
  const plan = getPlanById(normalizedPlanId);
  if (!plan) {
    const error = new Error("请选择有效的套餐");
    error.status = 400;
    throw error;
  }

  const usage = getUsageStatus(deviceId, env);

  if (normalizedType === "upgrade") {
    if (!usage.isPro) {
      const error = new Error("当前不是会员，请先开通会员");
      error.status = 403;
      throw error;
    }
    const diffPrice = calculateUpgradePrice(usage.plan || "year", normalizedPlanId);
    if (diffPrice == null) {
      const error = new Error("只能升级到更高档位套餐");
      error.status = 400;
      throw error;
    }
  } else if (usage.isPro) {
    const error = new Error("您已是会员，如需升级请使用升级套餐");
    error.status = 400;
    throw error;
  }

  const store = loadOrdersStore();
  const pendingSame = Object.values(store.orders).find(
    (order) =>
      order.deviceId === deviceId &&
      order.status === "pending" &&
      order.type === normalizedType &&
      order.planId === normalizedPlanId
  );
  if (pendingSame) {
    return {
      ...formatOrderResponse(pendingSame),
      paymentInstructions: `您的订单号：${pendingSame.orderId}`,
    };
  }

  let amountLabel = plan.priceLabel;
  if (normalizedType === "upgrade") {
    amountLabel = formatMoney(calculateUpgradePrice(usage.plan || "year", normalizedPlanId));
  }

  const orderId = generateOrderId();
  const order = {
    orderId,
    type: normalizedType,
    deviceId: deviceId.trim(),
    email: "",
    planId: normalizedPlanId,
    amountLabel,
    status: "pending",
    code: null,
    adminNotified: false,
    createdAt: new Date().toISOString(),
    fulfilledAt: null,
  };

  store.orders[orderId] = order;
  saveOrdersStore(store);

  return {
    ...formatOrderResponse(order),
    paymentInstructions: `您的订单号：${orderId}`,
  };
}

export async function notifyOrderToAdmin(orderId, deviceId, env = process.env) {
  const normalizedId = String(orderId || "").trim().toUpperCase();
  const normalizedDeviceId = String(deviceId || "").trim();

  if (!normalizedId) {
    const error = new Error("缺少订单号");
    error.status = 400;
    throw error;
  }
  if (!normalizedDeviceId) {
    const error = new Error("缺少设备标识");
    error.status = 400;
    throw error;
  }

  const store = loadOrdersStore();
  const order = store.orders[normalizedId];
  if (!order) {
    const error = new Error("未找到订单");
    error.status = 404;
    throw error;
  }
  if (order.deviceId !== normalizedDeviceId) {
    const error = new Error("无权操作此订单");
    error.status = 403;
    throw error;
  }
  if (order.status === "fulfilled") {
    return formatOrderResponse(order);
  }
  if (order.status === "cancelled") {
    const error = new Error("订单已取消");
    error.status = 400;
    throw error;
  }

  if (order.adminNotified) {
    const notifiedAge = order.notifiedAt
      ? Date.now() - new Date(order.notifiedAt).getTime()
      : Number.POSITIVE_INFINITY;
    // 允许 30 分钟后重发，避免历史“假成功”卡住订单
    if (Number.isFinite(notifiedAge) && notifiedAge < 30 * 60 * 1000) {
      return {
        ...formatOrderResponse(order),
        message: `通知已发送，请等待管理员确认。订单号：${order.orderId}`,
      };
    }
    order.adminNotified = false;
  }

  if (order.notifiedAt) {
    const elapsed = Date.now() - new Date(order.notifiedAt).getTime();
    if (Number.isFinite(elapsed) && elapsed < NOTIFY_RETRY_COOLDOWN_MS) {
      const waitSec = Math.ceil((NOTIFY_RETRY_COOLDOWN_MS - elapsed) / 1000);
      const error = new Error(`通知发送中或刚失败，请 ${waitSec} 秒后再试`);
      error.status = 429;
      throw error;
    }
  }

  const formatted = formatOrderResponse(order);
  const fulfillUrl = buildAdminFulfillUrl(order.orderId, env);
  order.notifiedAt = new Date().toISOString();
  store.orders[normalizedId] = order;
  saveOrdersStore(store);

  const notifyResult = await notifyAdminNewOrder(formatted, env, fulfillUrl);
  const sent = Boolean(notifyResult.email?.sent || notifyResult.wechat?.sent);
  if (!sent) {
    const error = new Error(
      notifyResult.email?.error ||
        notifyResult.wechat?.error ||
        "管理员通知发送失败，请稍后重试或联系客服"
    );
    error.status = 502;
    throw error;
  }

  order.adminNotified = true;
  order.notifiedAt = new Date().toISOString();
  store.orders[normalizedId] = order;
  saveOrdersStore(store);

  return {
    ...formatOrderResponse(order),
    message: `通知已发送到管理员，请等待确认。订单号：${order.orderId}`,
  };
}

export function getOrderStatus(orderId, deviceId) {
  const normalizedId = String(orderId || "").trim().toUpperCase();
  const normalizedDeviceId = String(deviceId || "").trim();

  if (!normalizedId) {
    const error = new Error("请输入订单号");
    error.status = 400;
    throw error;
  }
  if (!normalizedDeviceId) {
    const error = new Error("缺少设备标识");
    error.status = 400;
    throw error;
  }

  const store = loadOrdersStore();
  const order = store.orders[normalizedId];
  if (!order) {
    const error = new Error("未找到订单，请检查订单号");
    error.status = 404;
    throw error;
  }
  if (order.deviceId !== normalizedDeviceId) {
    const error = new Error("无权查看此订单");
    error.status = 403;
    throw error;
  }

  return formatOrderResponse(order);
}

export function getCurrentOrderForDevice(deviceId) {
  const normalizedDeviceId = String(deviceId || "").trim();
  if (!normalizedDeviceId) {
    const error = new Error("缺少设备标识");
    error.status = 400;
    throw error;
  }
  const store = loadOrdersStore();
  const orders = Object.values(store.orders)
    .filter((order) => order.deviceId === normalizedDeviceId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return orders[0] ? formatOrderResponse(orders[0]) : null;
}

export function lookupOrder(orderId, deviceId) {
  return getOrderStatus(orderId, deviceId);
}

export async function fulfillOrderIfAuthorized(orderId, authQuery, env = process.env) {
  const query =
    typeof authQuery === "string"
      ? { token: authQuery }
      : authQuery && typeof authQuery === "object"
        ? authQuery
        : {};
  if (!verifyFulfillAuthorization(orderId, query, env)) {
    const error = new Error("确认链接无效或已过期，请使用最新邮件中的链接，或在服务器执行 node scripts/fulfill-order.mjs <订单号>");
    error.status = 403;
    throw error;
  }

  const normalizedId = String(orderId || "").trim().toUpperCase();
  if (fulfillLocks.has(normalizedId)) {
    return fulfillLocks.get(normalizedId);
  }
  const task = fulfillOrder(normalizedId, env).finally(() => {
    fulfillLocks.delete(normalizedId);
  });
  fulfillLocks.set(normalizedId, task);
  return task;
}

export function listOrders({ status } = {}) {
  const store = loadOrdersStore();
  let orders = Object.values(store.orders);
  if (status) {
    orders = orders.filter((order) => order.status === status);
  }
  orders.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return orders.map(formatOrderResponse);
}

export async function fulfillOrder(orderId, env = process.env) {
  const normalizedId = String(orderId || "").trim().toUpperCase();
  const store = loadOrdersStore();
  const order = store.orders[normalizedId];

  if (!order) {
    const error = new Error(`未找到订单 ${normalizedId}`);
    error.status = 404;
    throw error;
  }
  if (order.status === "fulfilled") {
    if (order.type === "upgrade" && !order.upgradeApplied) {
      try {
        const upgradeResult = applyOrderUpgrade(order.deviceId, order.planId, order.orderId, env);
        order.upgradeApplied = true;
        order.code = order.orderId;
        store.orders[normalizedId] = order;
        saveOrdersStore(store);
        return {
          ...formatOrderResponse(order),
          emailSent: false,
          upgradeApplied: true,
          message: upgradeResult.message || "会员套餐已升级完成",
        };
      } catch (error) {
        return {
          ...formatOrderResponse(order),
          emailSent: false,
          message: error.message || "订单已确认，但自动升级失败，请联系管理员",
        };
      }
    }
    if (order.type === "purchase" && !order.activationApplied) {
      if (isProDevice(order.deviceId, env)) {
        order.activationApplied = true;
        store.orders[normalizedId] = order;
        saveOrdersStore(store);
        return {
          ...formatOrderResponse(order),
          emailSent: false,
          activationApplied: true,
          message: "订单已确认，会员已开通完成",
        };
      }
      try {
        const activationResult = applyOrderPurchase(order.deviceId, order.planId, order.orderId, env);
        order.activationApplied = true;
        order.code = order.orderId;
        store.orders[normalizedId] = order;
        saveOrdersStore(store);
        return {
          ...formatOrderResponse(order),
          emailSent: false,
          activationApplied: true,
          message: activationResult.message || "会员已开通完成",
        };
      } catch (error) {
        return {
          ...formatOrderResponse(order),
          emailSent: false,
          message: error.message || "订单已确认，但自动开通失败，请联系管理员",
        };
      }
    }
    return {
      ...formatOrderResponse(order),
      emailSent: false,
      message:
        order.type === "upgrade" && order.upgradeApplied
          ? "订单已确认，会员已升级完成"
          : order.type === "purchase" && order.activationApplied
            ? "订单已确认，会员已开通完成"
            : "订单已发过邀请码，无需重复确认",
    };
  }
  if (order.status === "cancelled") {
    const error = new Error("订单已取消，无法发码");
    error.status = 400;
    throw error;
  }

  if (order.type === "upgrade") {
    const upgradeResult = applyOrderUpgrade(order.deviceId, order.planId, order.orderId, env);
    order.status = "fulfilled";
    order.code = order.orderId;
    order.upgradeApplied = true;
    order.fulfilledAt = new Date().toISOString();
    store.orders[normalizedId] = order;
    saveOrdersStore(store);

    const formatted = formatOrderResponse(order);
    const adminNotify = await notifyAdminFulfillCode(
      formatted,
      `订单 ${order.orderId} 升级完成`,
      env
    );

    const adminOk = adminNotify.email?.sent || adminNotify.wechat?.sent;
    const parts = [upgradeResult.message || "会员套餐已升级完成"];
    if (adminNotify.email?.sent) parts.push(`已发到你邮箱 ${adminNotifyEmail(env)}`);
    if (adminNotify.wechat?.sent) parts.push(`已推送到微信（${adminNotify.wechat.channel}）`);
    if (!adminOk) parts.push(`管理员通知失败：${adminNotify.email?.error || adminNotify.wechat?.error || "未配置"}`);

    return {
      ...formatted,
      code: order.orderId,
      upgradeApplied: true,
      adminNotify,
      userEmailSent: false,
      message: parts.join("；"),
    };
  }

  const activationResult = applyOrderPurchase(order.deviceId, order.planId, order.orderId, env);
  order.status = "fulfilled";
  order.code = order.orderId;
  order.activationApplied = true;
  order.fulfilledAt = new Date().toISOString();
  store.orders[normalizedId] = order;
  saveOrdersStore(store);

  const formatted = formatOrderResponse(order);
  const adminNotify = await notifyAdminFulfillCode(
    formatted,
    `订单 ${order.orderId} 开通完成`,
    env
  );

  const adminOk = adminNotify.email?.sent || adminNotify.wechat?.sent;
  const parts = [activationResult.message || "会员已开通完成"];
  if (adminNotify.email?.sent) parts.push(`已发到你邮箱 ${adminNotifyEmail(env)}`);
  if (adminNotify.wechat?.sent) parts.push(`已推送到微信（${adminNotify.wechat.channel}）`);
  if (!adminOk) parts.push(`管理员通知失败：${adminNotify.email?.error || adminNotify.wechat?.error || "未配置"}`);

  return {
    ...formatted,
    code: order.orderId,
    activationApplied: true,
    adminNotify,
    userEmailSent: false,
    message: parts.join("；"),
  };
}

function adminNotifyEmail(env = process.env) {
  const value =
    String(env.ADMIN_NOTIFY_EMAIL || env.CONTACT_EMAIL || env.SMTP_USER || "").trim();
  return value;
}

export function cancelOrder(orderId) {
  const normalizedId = String(orderId || "").trim().toUpperCase();
  const store = loadOrdersStore();
  const order = store.orders[normalizedId];
  if (!order) {
    const error = new Error(`未找到订单 ${normalizedId}`);
    error.status = 404;
    throw error;
  }
  if (order.status === "fulfilled") {
    const error = new Error("已发码订单不能取消");
    error.status = 400;
    throw error;
  }
  order.status = "cancelled";
  store.orders[normalizedId] = order;
  saveOrdersStore(store);
  return formatOrderResponse(order);
}
