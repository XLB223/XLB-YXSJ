import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import {
  FREE_DAILY_LIMIT,
  getPlanById,
  formatPriceSummary,
} from "./pricing-plans.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getUsageFile() {
  if (process.env.VERCEL) {
    return path.join(os.tmpdir(), "listing-usage.json");
  }
  return path.join(__dirname, "..", "data", "usage.json");
}

const USAGE_FILE = getUsageFile();

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function parseCodeList(raw) {
  return String(raw || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

function loadStore() {
  try {
    if (!fs.existsSync(USAGE_FILE)) {
      return { devices: {}, proDevices: {} };
    }
    const raw = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8"));
    return {
      devices: raw.devices || {},
      proDevices: raw.proDevices || {},
    };
  } catch {
    return { devices: {}, proDevices: {} };
  }
}

function saveStore(store) {
  const dir = path.dirname(USAGE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(USAGE_FILE, JSON.stringify(store, null, 2), "utf8");
}

function resolveCodePlan(code, env = process.env) {
  const normalized = String(code || "").trim();
  if (!normalized) return null;

  const tierMap = {
    month: parseCodeList(env.ACTIVATION_CODES_MONTH),
    half: parseCodeList(env.ACTIVATION_CODES_HALF),
    year: parseCodeList(env.ACTIVATION_CODES_YEAR),
  };

  for (const [planId, codes] of Object.entries(tierMap)) {
    if (codes.includes(normalized)) return planId;
  }

  if (parseCodeList(env.ACTIVATION_CODES).includes(normalized)) {
    return "year";
  }

  return null;
}

function computeExpiresAt(existingExpiresAt, days) {
  const now = new Date();
  const base =
    existingExpiresAt && new Date(existingExpiresAt) > now
      ? new Date(existingExpiresAt)
      : now;
  base.setDate(base.getDate() + days);
  return base.toISOString();
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("zh-CN");
}

function daysRemaining(expiresAt) {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

function getActiveProRecord(deviceId, store = loadStore()) {
  const record = store.proDevices[deviceId];
  if (!record) return null;

  if (record.expiresAt && new Date(record.expiresAt) <= new Date()) {
    return null;
  }

  return record;
}

function cleanupExpiredPro(deviceId, store) {
  const record = store.proDevices[deviceId];
  if (!record?.expiresAt) return;
  if (new Date(record.expiresAt) <= new Date()) {
    delete store.proDevices[deviceId];
  }
}

export function isProDevice(deviceId, env = process.env) {
  if (!deviceId) return false;
  const store = loadStore();
  cleanupExpiredPro(deviceId, store);
  if (store.proDevices[deviceId] !== getActiveProRecord(deviceId, store)) {
    saveStore(store);
  }
  return Boolean(getActiveProRecord(deviceId, store));
}

export function getUsageStatus(deviceId, env = process.env) {
  const store = loadStore();
  cleanupExpiredPro(deviceId, store);
  const proRecord = getActiveProRecord(deviceId, store);

  if (store.proDevices[deviceId] && !proRecord) {
    delete store.proDevices[deviceId];
    saveStore(store);
  }

  if (proRecord) {
    const plan = getPlanById(proRecord.plan) || getPlanById("year");
    const remainDays = daysRemaining(proRecord.expiresAt);
    const expireText = proRecord.expiresAt ? formatDate(proRecord.expiresAt) : "";

    return {
      isPro: true,
      plan: proRecord.plan || "year",
      planName: plan?.name || "会员",
      expiresAt: proRecord.expiresAt || null,
      daysRemaining: remainDays,
      limit: null,
      usedToday: 0,
      remaining: null,
      message:
        remainDays != null
          ? `会员 ${plan?.name || ""} · 剩余 ${remainDays} 天 · 无限次生成`
          : `会员已激活 · 无限次生成（至 ${expireText}）`,
    };
  }

  const today = todayKey();
  const record = store.devices[deviceId];
  const usedToday = record?.date === today ? record.count : 0;
  const remaining = Math.max(0, FREE_DAILY_LIMIT - usedToday);

  return {
    isPro: false,
    plan: null,
    limit: FREE_DAILY_LIMIT,
    usedToday,
    remaining,
    pricingHint: formatPriceSummary(),
    message:
      remaining > 0
        ? `免费试用 · 今日剩余 ${remaining}/${FREE_DAILY_LIMIT} 次`
        : "免费试用今日已用完",
  };
}

export function activateDevice(deviceId, code, env = process.env) {
  if (!deviceId?.trim()) {
    const error = new Error("缺少设备标识");
    error.status = 400;
    throw error;
  }

  const normalized = String(code || "").trim();
  if (!normalized) {
    const error = new Error("请输入激活码");
    error.status = 400;
    throw error;
  }

  const planId = resolveCodePlan(normalized, env);
  if (!planId) {
    const error = new Error("激活码无效，请检查后重试");
    error.status = 403;
    throw error;
  }

  return applyPlanToDevice(deviceId, planId, { source: "code", code: normalized });
}

export function purchasePlan(deviceId, planId, env = process.env) {
  if (!deviceId?.trim()) {
    const error = new Error("缺少设备标识");
    error.status = 400;
    throw error;
  }

  const normalizedPlanId = String(planId || "").trim();
  if (!getPlanById(normalizedPlanId)) {
    const error = new Error("请选择有效的会员套餐");
    error.status = 400;
    throw error;
  }

  return applyPlanToDevice(deviceId, normalizedPlanId, { source: "purchase" });
}

function applyPlanToDevice(deviceId, planId, meta = {}) {
  const plan = getPlanById(planId);
  if (!plan) {
    const error = new Error("套餐配置异常，请联系管理员");
    error.status = 500;
    throw error;
  }

  const store = loadStore();
  const existing = getActiveProRecord(deviceId, store);
  const expiresAt = computeExpiresAt(existing?.expiresAt, plan.days);

  store.proDevices[deviceId] = {
    activatedAt: existing?.activatedAt || new Date().toISOString(),
    renewedAt: new Date().toISOString(),
    expiresAt,
    plan: planId,
    ...meta,
  };
  saveStore(store);

  return {
    isPro: true,
    plan: planId,
    planName: plan.name,
    expiresAt,
    message: `${plan.name}已开通，有效期至 ${formatDate(expiresAt)}，已解锁无限次生成`,
  };
}

export function assertCanGenerate(deviceId, env = process.env) {
  if (isProDevice(deviceId, env)) return getUsageStatus(deviceId, env);

  const status = getUsageStatus(deviceId, env);
  if (status.remaining <= 0) {
    const error = new Error(
      `免费试用每天限 ${FREE_DAILY_LIMIT} 次，今日已用完。开通会员：${formatPriceSummary()}，付款后即可无限生成。`
    );
    error.status = 402;
    error.code = "DAILY_LIMIT_REACHED";
    throw error;
  }

  return status;
}

export function recordGeneration(deviceId, env = process.env) {
  if (isProDevice(deviceId, env)) return getUsageStatus(deviceId, env);

  const store = loadStore();
  const today = todayKey();
  const current = store.devices[deviceId];

  if (!current || current.date !== today) {
    store.devices[deviceId] = { date: today, count: 1 };
  } else {
    store.devices[deviceId] = { date: today, count: current.count + 1 };
  }

  saveStore(store);
  return getUsageStatus(deviceId, env);
}

export { FREE_DAILY_LIMIT };
