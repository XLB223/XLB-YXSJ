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
    email: order.email,
    planId: order.planId,
    planName: plan?.name || order.planId,
    amountLabel: order.amountLabel,
    paymentNote: order.orderId,
    createdAt: order.createdAt,
    fulfilledAt: order.fulfilledAt || null,
    code: order.status === "fulfilled" ? order.code : null,
    message: orderStatusMessage(order),
  };
}

function orderStatusMessage(order) {
  if (order.status === "fulfilled") {
    return order.type === "upgrade"
      ? `订单已确认收款，升级邀请码：${order.code}。请在本页下方输入邀请码并升级。`
      : `订单已确认收款，邀请码：${order.code}。请在本页下方输入邀请码并开通。`;
  }
  if (order.status === "cancelled") {
    return "订单已取消，如有疑问请联系客服。";
  }
  return `订单待确认收款。请付款时在备注填写订单号 ${order.orderId}。确认后您可在「查询订单」查看邀请码，或由客服发送给您。`;
}

export function isManualPaymentMode(env = process.env) {
  const raw = String(env.MANUAL_PAYMENT_ORDERS ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off";
}

export function createOrder({ deviceId, email, planId, type }, env = process.env) {
  if (!deviceId?.trim()) {
    const error = new Error("缺少设备标识");
    error.status = 400;
    throw error;
  }

  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    const error = new Error("请输入有效的邮箱地址，用于接收邀请码");
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
      paymentInstructions: `请扫码支付 ${pendingSame.amountLabel}，并在付款备注中填写：${pendingSame.orderId}`,
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
    email: normalizedEmail,
    planId: normalizedPlanId,
    amountLabel,
    status: "pending",
    code: null,
    createdAt: new Date().toISOString(),
    fulfilledAt: null,
  };

  store.orders[orderId] = order;
  saveOrdersStore(store);

  const formatted = {
    ...formatOrderResponse(order),
    paymentInstructions: `请扫码支付 ${amountLabel}，并在付款备注中填写：${orderId}`,
  };

  void notifyAdminNewOrder(formatted, env).catch(() => {});

  return formatted;
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

export function lookupOrder(orderId, email, env = process.env) {
  const normalizedId = String(orderId || "").trim().toUpperCase();
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedId) {
    const error = new Error("请输入订单号");
    error.status = 400;
    throw error;
  }
  if (!isValidEmail(normalizedEmail)) {
    const error = new Error("请输入下单时填写的邮箱");
    error.status = 400;
    throw error;
  }

  const store = loadOrdersStore();
  const order = store.orders[normalizedId];
  if (!order) {
    const error = new Error("未找到订单，请检查订单号和邮箱");
    error.status = 404;
    throw error;
  }
  if (order.email !== normalizedEmail) {
    const error = new Error("订单号与邮箱不匹配");
    error.status = 403;
    throw error;
  }

  return formatOrderResponse(order);
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
  if (shouldNotifyUserEmail(env)) {
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
