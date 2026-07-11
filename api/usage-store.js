import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import {
  FREE_DAILY_LIMIT,
  getPlanById,
  formatPriceSummary,
  buildUpgradeOptions,
  calculateUpgradePrice,
  formatMoney,
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

function getCodeListsForPlan(planId, env = process.env) {
  const tierMap = {
    month: parseCodeList(env.ACTIVATION_CODES_MONTH),
    half: parseCodeList(env.ACTIVATION_CODES_HALF),
    year: parseCodeList(env.ACTIVATION_CODES_YEAR),
  };
  const codes = tierMap[planId] || [];
  if (codes.length) return codes;
  if (planId === "year") return parseCodeList(env.ACTIVATION_CODES);
  return [];
}

function getCodeOwnerDeviceId(store, code) {
  const normalized = String(code || "").trim();
  if (!normalized) return null;

  for (const [deviceId, record] of Object.entries(store.proDevices || {})) {
    if (record?.code === normalized) return deviceId;
  }
  return null;
}

function assertCodeAvailableForDevice(deviceId, code, store) {
  const normalized = String(code || "").trim();
  const owner = getCodeOwnerDeviceId(store, normalized);

  if (owner) {
    if (owner !== deviceId) {
      const error = new Error(
        "该激活码已在其他设备使用，一码仅限一台设备。请为本机单独购买或联系客服"
      );
      error.status = 403;
      throw error;
    }
    return;
  }

  if (store.usedActivationCodes?.includes(normalized)) {
    const error = new Error("该激活码已被使用，一码仅限一台设备");
    error.status = 403;
    throw error;
  }
}

function getUsedCodesSet(store) {
  const used = new Set(store.usedActivationCodes || []);
  for (const record of Object.values(store.proDevices || {})) {
    if (record?.code) used.add(record.code);
  }
  return used;
}

function loadStore() {
  try {
    if (!fs.existsSync(USAGE_FILE)) {
      return { devices: {}, proDevices: {}, usedActivationCodes: [], claimAttempts: {} };
    }
    const raw = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8"));
    return {
      devices: raw.devices || {},
      proDevices: raw.proDevices || {},
      usedActivationCodes: raw.usedActivationCodes || [],
      claimAttempts: raw.claimAttempts || {},
    };
  } catch {
    return { devices: {}, proDevices: {}, usedActivationCodes: [], claimAttempts: {} };
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
      canUpgrade: buildUpgradeOptions(proRecord.plan || "year").length > 0,
      upgradeOptions: buildUpgradeOptions(proRecord.plan || "year"),
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

  const store = loadStore();
  assertCodeAvailableForDevice(deviceId, normalized, store);
  return applyPlanToDevice(deviceId, planId, { source: "code", code: normalized }, env);
}

export function getActivationInventory(env = process.env) {
  const store = loadStore();
  const used = getUsedCodesSet(store);
  const plans = ["month", "half", "year"];
  const inventory = {};
  let configured = false;

  for (const planId of plans) {
    const codes = getCodeListsForPlan(planId, env);
    const available = codes.filter((code) => !used.has(code));
    if (codes.length) configured = true;
    inventory[planId] = {
      total: codes.length,
      available: available.length,
      ready: codes.length > 0,
    };
  }

  const legacy = parseCodeList(env.ACTIVATION_CODES);
  if (legacy.length) configured = true;

  return {
    configured,
    oneCodeOneDevice: true,
    plans: inventory,
    legacyYear: {
      total: legacy.length,
      available: legacy.filter((code) => !used.has(code)).length,
    },
  };
}

function recordClaimAttempt(deviceId, store) {
  const today = todayKey();
  const current = store.claimAttempts[deviceId];
  if (!current || current.date !== today) {
    store.claimAttempts[deviceId] = { date: today, count: 1 };
  } else {
    store.claimAttempts[deviceId] = { date: today, count: current.count + 1 };
  }
}

function assertCanClaim(deviceId, store) {
  const today = todayKey();
  const record = store.claimAttempts[deviceId];
  if (record?.date === today && record.count >= 5) {
    const error = new Error("今日领取次数过多，请明天再试或联系客服");
    error.status = 429;
    throw error;
  }
}

export function claimAndActivate(deviceId, planId, env = process.env) {
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

  if (isProDevice(deviceId, env)) {
    const status = getUsageStatus(deviceId, env);
    return {
      ...status,
      code: null,
      alreadyPro: true,
      message: status.message || "您已是会员，无需重复开通",
    };
  }

  const configuredCodes = getCodeListsForPlan(normalizedPlanId, env);
  if (!configuredCodes.length) {
    const error = new Error(
      "服务器未配置该套餐激活码，请联系管理员在 .env 中设置 ACTIVATION_CODES_* 后重启服务"
    );
    error.status = 503;
    throw error;
  }

  const store = loadStore();
  assertCanClaim(deviceId, store);

  const used = getUsedCodesSet(store);
  const available = configuredCodes.filter((code) => !used.has(code));
  if (!available.length) {
    const error = new Error("该套餐激活码已发完，请点击左侧「联系客服」");
    error.status = 503;
    throw error;
  }

  const code = available[0];
  assertCodeAvailableForDevice(deviceId, code, store);
  if (!store.usedActivationCodes.includes(code)) {
    store.usedActivationCodes.push(code);
  }
  recordClaimAttempt(deviceId, store);
  saveStore(store);

  const result = applyPlanToDevice(deviceId, normalizedPlanId, { source: "claim", code }, env);
  return {
    ...result,
    code,
    alreadyPro: false,
    message: `${result.planName}已开通，激活码 ${code} 已绑定本设备（一码仅限一台电脑），有效期至 ${formatDate(result.expiresAt)}`,
  };
}

export function purchasePlan(deviceId, planId, env = process.env) {
  return claimAndActivate(deviceId, planId, env);
}

export function upgradePlan(deviceId, targetPlanId, env = process.env) {
  if (!deviceId?.trim()) {
    const error = new Error("缺少设备标识");
    error.status = 400;
    throw error;
  }

  const normalizedTargetId = String(targetPlanId || "").trim();
  const targetPlan = getPlanById(normalizedTargetId);
  if (!targetPlan) {
    const error = new Error("请选择有效的升级套餐");
    error.status = 400;
    throw error;
  }

  const store = loadStore();
  const proRecord = getActiveProRecord(deviceId, store);
  if (!proRecord) {
    const error = new Error("当前不是会员，请先开通会员");
    error.status = 403;
    throw error;
  }

  const currentPlanId = proRecord.plan || "year";
  const diffPrice = calculateUpgradePrice(currentPlanId, normalizedTargetId);
  if (diffPrice == null) {
    const error = new Error("只能升级到更高档位套餐");
    error.status = 400;
    throw error;
  }

  assertCanClaim(deviceId, store);

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + targetPlan.days);

  store.proDevices[deviceId] = {
    ...proRecord,
    plan: normalizedTargetId,
    upgradedAt: now.toISOString(),
    upgradedFrom: currentPlanId,
    upgradePaidDiff: diffPrice,
    renewedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    source: "upgrade",
    code: proRecord.code,
  };
  recordClaimAttempt(deviceId, store);
  saveStore(store);

  const currentPlan = getPlanById(currentPlanId);
  return {
    ...getUsageStatus(deviceId, env),
    upgraded: true,
    upgradeDiff: diffPrice,
    upgradeDiffLabel: formatMoney(diffPrice),
    message: `已从${currentPlan?.name || "原套餐"}升级为${targetPlan.name}（补差价 ${formatMoney(diffPrice)}），有效期至 ${formatDate(expiresAt.toISOString())}`,
  };
}

function applyPlanToDevice(deviceId, planId, meta = {}, env = process.env) {
  const plan = getPlanById(planId);
  if (!plan) {
    const error = new Error("套餐配置异常，请联系管理员");
    error.status = 500;
    throw error;
  }

  const store = loadStore();
  const existing = getActiveProRecord(deviceId, store);
  const expiresAt = computeExpiresAt(existing?.expiresAt, plan.days);
  const code = meta.code;

  if (code && !store.usedActivationCodes.includes(code)) {
    store.usedActivationCodes.push(code);
  }

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
      `免费试用每天限 ${FREE_DAILY_LIMIT} 次，今日已用完。开通会员：${formatPriceSummary()}，付款后联系客服获取激活码。`
    );
    error.status = 402;
    error.code = "DAILY_LIMIT_REACHED";
    throw error;
  }

  return status;
}

export function listCodeBindings() {
  const store = loadStore();
  const bindings = [];

  for (const [deviceId, record] of Object.entries(store.proDevices || {})) {
    if (!record?.code) continue;
    const plan = getPlanById(record.plan);
    bindings.push({
      code: record.code,
      deviceId,
      planId: record.plan || null,
      planName: plan?.name || record.plan || "会员",
      expiresAt: record.expiresAt || null,
      expiresLabel: formatDate(record.expiresAt),
      source: record.source || "",
    });
  }

  return bindings.sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

export function unbindActivationCode(rawCode) {
  const code = String(rawCode || "").trim();
  if (!code) {
    const error = new Error("请提供激活码");
    error.status = 400;
    throw error;
  }

  const store = loadStore();
  const removedDevices = [];

  for (const [deviceId, record] of Object.entries(store.proDevices || {})) {
    if (record?.code === code) {
      removedDevices.push(deviceId);
      delete store.proDevices[deviceId];
    }
  }

  const hadUsedFlag = (store.usedActivationCodes || []).includes(code);
  store.usedActivationCodes = (store.usedActivationCodes || []).filter((item) => item !== code);

  if (!removedDevices.length && !hadUsedFlag) {
    const error = new Error(`未找到激活码 ${code} 的绑定记录`);
    error.status = 404;
    throw error;
  }

  saveStore(store);
  return {
    code,
    removedDevices,
    message: `已解绑 ${code}。请让用户在新电脑上重新输入该激活码即可开通。`,
  };
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
