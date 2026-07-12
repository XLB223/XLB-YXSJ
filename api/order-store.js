import fs from "fs";
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
  claimPurchaseCode,
  claimUpgradeCode,
} from "./usage-store.js";
import {
  sendOrderCodeEmail,
  notifyAdminNewOrder,
  notifyAdminFulfillCode,
} from "./mail.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORDERS_FILE = path.join(__dirname, "..", "data", "orders.json");

function loadOrdersStore() {
  try {
    if (!fs.existsSync(ORDERS_FILE)) {
      return { orders: {} };
    }
    const raw = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8"));
    return { orders: raw.orders || {} };
  } catch {
    return { orders: {} };
  }
}

function saveOrdersStore(store) {
  const dir = path.dirname(ORDERS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(store, null, 2), "utf8");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
    code: order.status === "fulfilled" ? order.code : null,
    message: orderStatusMessage(order),
  };
}

function orderStatusMessage(order) {
  if (order.status === "fulfilled") {
    return order.type === "upgrade"
      ? "已确认收款，升级邀请码已填入下方，请点击开通。"
      : "已确认收款，邀请码已填入下方，请点击开通。";
  }
  if (order.status === "cancelled") {
    return "订单已取消，如有疑问请联系客服。";
  }
  if (!order.adminNotified) {
    return `订单号 ${order.orderId}。请点击「发送通知」，等待管理员确认收款。`;
  }
  return `订单号 ${order.orderId}。通知已发送，请等待管理员确认，邀请码将自动填入下方。`;
}

export function verifyAdminFulfillToken(token, env = process.env) {
  const expected = String(env.ADMIN_FULFILL_TOKEN || "").trim();
  const given = String(token || "").trim();
  if (!expected || !given || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export function buildAdminFulfillUrl(orderId, env = process.env) {
  const token = String(env.ADMIN_FULFILL_TOKEN || "").trim();
  if (!token) return "";
  const siteUrl = String(env.SITE_URL || "www.kjdsai.cn").replace(/^https?:\/\//, "");
  const params = new URLSearchParams({ orderId, token });
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

export function notifyOrderToAdmin(orderId, deviceId, env = process.env) {
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

  const formatted = formatOrderResponse(order);
  if (!order.adminNotified) {
    const fulfillUrl = buildAdminFulfillUrl(order.orderId, env);
    void notifyAdminNewOrder(formatted, env, fulfillUrl).catch(() => {});
    order.adminNotified = true;
    order.notifiedAt = new Date().toISOString();
    store.orders[normalizedId] = order;
    saveOrdersStore(store);
  }

  return {
    ...formatOrderResponse(order),
    message: `通知已发送到管理员邮箱，请等待确认。订单号：${order.orderId}`,
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

export async function fulfillOrderIfAuthorized(orderId, token, env = process.env) {
  if (!verifyAdminFulfillToken(token, env)) {
    const error = new Error("确认链接无效，请检查 ADMIN_FULFILL_TOKEN 或改用命令行确认");
    error.status = 403;
    throw error;
  }
  return fulfillOrder(orderId, env);
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
    return {
      ...formatOrderResponse(order),
      emailSent: false,
      message: "订单已发过邀请码，无需重复确认",
    };
  }
  if (order.status === "cancelled") {
    const error = new Error("订单已取消，无法发码");
    error.status = 400;
    throw error;
  }

  let claimResult;
  if (order.type === "upgrade") {
    claimResult = claimUpgradeCode(order.deviceId, order.planId, env);
  } else {
    claimResult = claimPurchaseCode(order.deviceId, order.planId, env);
  }

  const code = claimResult.code;
  if (!code) {
    const error = new Error("发码失败：邀请码库存不足");
    error.status = 503;
    throw error;
  }

  order.status = "fulfilled";
  order.code = code;
  order.fulfilledAt = new Date().toISOString();
  store.orders[normalizedId] = order;
  saveOrdersStore(store);

  const siteUrl = env.SITE_URL || "www.kjdsai.cn";
  const formatted = formatOrderResponse(order);

  const adminNotify = await notifyAdminFulfillCode(formatted, code, env);

  let userEmailResult = { sent: false };
  if (shouldNotifyUserEmail(env) && isValidEmail(order.email)) {
    userEmailResult = await sendOrderCodeEmail(
      {
        to: order.email,
        orderId: order.orderId,
        code,
        planName: claimResult.planName || getPlanById(order.planId)?.name || "",
        amountLabel: order.amountLabel,
        type: order.type,
        siteUrl,
      },
      env
    );
  }

  const adminOk = adminNotify.email?.sent || adminNotify.wechat?.sent;
  const parts = [`邀请码 ${code} 已生成`];
  if (adminNotify.email?.sent) parts.push(`已发到你邮箱 ${adminNotifyEmail(env)}`);
  if (adminNotify.wechat?.sent) parts.push(`已推送到微信（${adminNotify.wechat.channel}）`);
  if (!adminOk) parts.push(`管理员通知失败：${adminNotify.email?.error || adminNotify.wechat?.error || "未配置"}`);
  if (userEmailResult.sent) parts.push(`已发用户邮箱 ${order.email}`);

  return {
    ...formatted,
    code,
    adminNotify,
    userEmailSent: userEmailResult.sent,
    message: parts.join("；"),
  };
}

function shouldNotifyUserEmail(env = process.env) {
  const raw = String(env.NOTIFY_USER_EMAIL ?? "false").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "on";
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
