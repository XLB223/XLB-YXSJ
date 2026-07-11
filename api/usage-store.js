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

function isPoolActivationCode(code, env = process.env) {
  const normalized = String(code || "").trim();
  for (const planId of ["month", "half", "year"]) {
    if (getCodeListsForPlan(planId, env).includes(normalized)) return true;
  }
  return false;
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

function getPendingClaimByCode(store, code) {
  const normalized = String(code || "").trim();
  for (const [deviceId, claim] of Object.entries(store.pendingClaims || {})) {
    if (claim?.code === normalized) return { deviceId, ...claim };
  }
  return null;
}

function getPendingUpgradeClaimByCode(store, code) {
  const normalized = String(code || "").trim();
  for (const [deviceId, claim] of Object.entries(store.pendingUpgradeClaims || {})) {
    if (claim?.code === normalized) return { deviceId, ...claim };
  }
  return null;
}

function assertCodeAvailableForDevice(deviceId, code, store) {
  const normalized = String(code || "").trim();
  const owner = getCodeOwnerDeviceId(store, normalized);

  if (owner) {
    if (owner !== deviceId) {
      const error = new Error("该邀请码已在其他设备使用，一码仅限一台设备");
      error.status = 403;
      throw error;
    }
    return;
  }

  const pending = getPendingClaimByCode(store, normalized);
  if (pending) {
    if (pending.deviceId !== deviceId) {
      const error = new Error("该邀请码已在其他设备领取");
      error.status = 403;
      throw error;
    }
    return;
  }

  if (store.usedActivationCodes?.includes(normalized)) {
    const error = new Error("该邀请码已被使用，一码仅限一台设备");
    error.status = 403;
    throw error;
  }
}

function getUsedCodesSet(store) {
  const used = new Set(store.usedActivationCodes || []);
  for (const record of Object.values(store.proDevices || {})) {
    if (record?.code) used.add(record.code);
  }
  for (const claim of Object.values(store.pendingClaims || {})) {
    if (claim?.code) used.add(claim.code);
  }
  return used;
}

function loadStore() {
  try {
    if (!fs.existsSync(USAGE_FILE)) {
      return { devices: {}, proDevices: {}, usedActivationCodes: [], usedUpgradeCodes: [], pendingClaims: {}, pendingUpgradeClaims: {}, claimAttempts: {} };
    }
    const raw = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8"));
    return {
      devices: raw.devices || {},
      proDevices: raw.proDevices || {},
      usedActivationCodes: raw.usedActivationCodes || [],
      usedUpgradeCodes: raw.usedUpgradeCodes || [],
      pendingClaims: raw.pendingClaims || {},
      pendingUpgradeClaims: raw.pendingUpgradeClaims || {},
      claimAttempts: raw.claimAttempts || {},
    };
  } catch {
    return { devices: {}, proDevices: {}, usedActivationCodes: [], usedUpgradeCodes: [], pendingClaims: {}, pendingUpgradeClaims: {}, claimAttempts: {} };
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
    const error = new Error("请输入邀请码");
    error.status = 400;
    throw error;
  }

  const store = loadStore();
  const pending = store.pendingClaims?.[deviceId];
  let planId = resolveCodePlan(normalized, env);

  if (pending?.code === normalized) {
    planId = pending.planId;
  } else if (!planId) {
    const error = new Error("邀请码无效，请检查后重试");
    error.status = 403;
    throw error;
  }

  if (isPoolActivationCode(normalized, env) && pending?.code !== normalized) {
    const error = new Error("请先在上方点击「获取邀请码」，再将显示的邀请码填入下方并确认开通");
    error.status = 403;
    throw error;
  }

  assertCodeAvailableForDevice(deviceId, normalized, store);
  const result = applyPlanToDevice(deviceId, planId, { source: "code", code: normalized }, env);
  const after = loadStore();
  if (after.pendingClaims?.[deviceId]?.code === normalized) {
    delete after.pendingClaims[deviceId];
    saveStore(after);
  }
  return {
    ...result,
    message: `${result.planName}已开通，邀请码已绑定本设备，有效期至 ${formatDate(result.expiresAt)}`,
  };
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

export function claimPurchaseCode(deviceId, planId, env = process.env) {
  if (!deviceId?.trim()) {
    const error = new Error("缺少设备标识");
    error.status = 400;
    throw error;
  }

  const normalizedPlanId = String(planId || "").trim();
  const plan = getPlanById(normalizedPlanId);
  if (!plan) {
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

  const store = loadStore();
  const existingPending = store.pendingClaims?.[deviceId];
  if (existingPending?.code && existingPending.planId === normalizedPlanId) {
    return {
      code: existingPending.code,
      planId: normalizedPlanId,
      planName: plan.name,
      alreadyClaimed: true,
      message: `您的邀请码：${existingPending.code}。请填入下方输入框并点击「输入邀请码并开通」`,
    };
  }

  const configuredCodes = getCodeListsForPlan(normalizedPlanId, env);
  if (!configuredCodes.length) {
    const error = new Error("服务器未配置该套餐邀请码，请联系管理员");
    error.status = 503;
    throw error;
  }

  assertCanClaim(deviceId, store);

  const used = getUsedCodesSet(store);
  const available = configuredCodes.filter((code) => !used.has(code));
  if (!available.length) {
    const error = new Error("该套餐邀请码已发完，请换套餐或稍后再试");
    error.status = 503;
    throw error;
  }

  const code = available[0];
  if (!store.usedActivationCodes.includes(code)) {
    store.usedActivationCodes.push(code);
  }
  store.pendingClaims[deviceId] = {
    code,
    planId: normalizedPlanId,
    claimedAt: new Date().toISOString(),
  };
  recordClaimAttempt(deviceId, store);
  saveStore(store);

  return {
    code,
    planId: normalizedPlanId,
    planName: plan.name,
    alreadyClaimed: false,
    activated: false,
    message: `付款后请复制邀请码 ${code}，填入下方输入框并点击「输入邀请码并开通」`,
  };
}

export function claimAndActivate(deviceId, planId, env = process.env) {
  return claimPurchaseCode(deviceId, planId, env);
}

export function purchasePlan(deviceId, planId, env = process.env) {
  return claimPurchaseCode(deviceId, planId, env);
}

function getUpgradeCodeList(targetPlanId, env = process.env) {
  const tierMap = {
    half: parseCodeList(env.UPGRADE_CODES_HALF),
    year: parseCodeList(env.UPGRADE_CODES_YEAR),
  };
  return tierMap[targetPlanId] || [];
}

function resolveUpgradeCodeTarget(code, env = process.env) {
  const normalized = String(code || "").trim();
  if (!normalized) return null;

  for (const planId of ["half", "year"]) {
    if (getUpgradeCodeList(planId, env).includes(normalized)) return planId;
  }
  return null;
}

function getUsedUpgradeCodesSet(store) {
  const used = new Set(store.usedUpgradeCodes || []);
  for (const record of Object.values(store.proDevices || {})) {
    if (record?.upgradeCode) used.add(record.upgradeCode);
  }
  for (const claim of Object.values(store.pendingUpgradeClaims || {})) {
    if (claim?.code) used.add(claim.code);
  }
  return used;
}

function applyUpgradeToDevice(deviceId, targetPlanId, store, meta = {}) {
  const targetPlan = getPlanById(targetPlanId);
  const proRecord = getActiveProRecord(deviceId, store);
  if (!proRecord) {
    const error = new Error("当前不是会员，请先开通会员");
    error.status = 403;
    throw error;
  }

  const currentPlanId = proRecord.plan || "year";
  const diffPrice = calculateUpgradePrice(currentPlanId, targetPlanId);
  if (diffPrice == null) {
    const error = new Error("只能升级到更高档位套餐");
    error.status = 400;
    throw error;
  }

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + targetPlan.days);

  store.proDevices[deviceId] = {
    ...proRecord,
    plan: targetPlanId,
    upgradedAt: now.toISOString(),
    upgradedFrom: currentPlanId,
    upgradePaidDiff: diffPrice,
    renewedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    source: "upgrade",
    code: proRecord.code,
    ...meta,
  };

  const currentPlan = getPlanById(currentPlanId);
  return {
    currentPlan,
    targetPlan,
    diffPrice,
    expiresAt: expiresAt.toISOString(),
  };
}

export function claimUpgradeCode(deviceId, targetPlanId, env = process.env) {
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

  const existingPending = store.pendingUpgradeClaims?.[deviceId];
  if (existingPending?.code && existingPending.targetPlanId === normalizedTargetId) {
    return {
      code: existingPending.code,
      planId: normalizedTargetId,
      planName: targetPlan.name,
      diffLabel: formatMoney(diffPrice),
      alreadyClaimed: true,
      upgraded: false,
      message: `您的升级邀请码：${existingPending.code}。请填入下方输入框并点击「输入邀请码并升级」`,
    };
  }

  const configuredCodes = getUpgradeCodeList(normalizedTargetId, env);
  if (!configuredCodes.length) {
    const error = new Error("服务器未配置升级邀请码，请联系管理员");
    error.status = 503;
    throw error;
  }

  assertCanClaim(deviceId, store);

  const used = getUsedUpgradeCodesSet(store);
  const available = configuredCodes.filter((code) => !used.has(code));
  if (!available.length) {
    const error = new Error("该套餐升级邀请码已发完，请稍后再试");
    error.status = 503;
    throw error;
  }

  const code = available[0];
  store.pendingUpgradeClaims[deviceId] = {
    code,
    targetPlanId: normalizedTargetId,
    claimedAt: new Date().toISOString(),
  };
  recordClaimAttempt(deviceId, store);
  saveStore(store);

  return {
    code,
    planId: normalizedTargetId,
    planName: targetPlan.name,
    diffLabel: formatMoney(diffPrice),
    alreadyClaimed: false,
    upgraded: false,
    message: `补差价 ${formatMoney(diffPrice)} 后请复制升级邀请码 ${code}，填入下方并点击「输入邀请码并升级」`,
  };
}

export function upgradePlan(deviceId, targetPlanId, upgradeCode, env = process.env) {
  if (!deviceId?.trim()) {
    const error = new Error("缺少设备标识");
    error.status = 400;
    throw error;
  }

  const normalizedTargetId = String(targetPlanId || "").trim();
  const normalizedCode = String(upgradeCode || "").trim();
  if (!normalizedCode) {
    const error = new Error("请输入升级邀请码。请先点击「获取升级邀请码」");
    error.status = 400;
    throw error;
  }

  const codeTargetPlanId = resolveUpgradeCodeTarget(normalizedCode, env);
  if (!codeTargetPlanId) {
    const error = new Error("升级邀请码无效，请检查后重试");
    error.status = 403;
    throw error;
  }
  if (codeTargetPlanId !== normalizedTargetId) {
    const error = new Error(
      `该邀请码仅可用于升级为${getPlanById(codeTargetPlanId)?.name || "对应套餐"}，请重新选择套餐`
    );
    error.status = 400;
    throw error;
  }

  const store = loadStore();
  const pending = store.pendingUpgradeClaims?.[deviceId];
  const pendingByCode = getPendingUpgradeClaimByCode(store, normalizedCode);
  if (pendingByCode && pendingByCode.deviceId !== deviceId) {
    const error = new Error("该升级邀请码已在其他设备领取");
    error.status = 403;
    throw error;
  }
  if (
    !pending ||
    pending.code !== normalizedCode ||
    pending.targetPlanId !== normalizedTargetId
  ) {
    const error = new Error("请先在上方点击「获取升级邀请码」，再将显示的邀请码填入下方并确认升级");
    error.status = 403;
    throw error;
  }

  assertCanClaim(deviceId, store);

  const result = applyUpgradeToDevice(deviceId, normalizedTargetId, store, {
    upgradeCode: normalizedCode,
  });
  if (!store.usedUpgradeCodes.includes(normalizedCode)) {
    store.usedUpgradeCodes.push(normalizedCode);
  }
  if (store.pendingUpgradeClaims?.[deviceId]?.code === normalizedCode) {
    delete store.pendingUpgradeClaims[deviceId];
  }
  recordClaimAttempt(deviceId, store);
  saveStore(store);

  return {
    ...getUsageStatus(deviceId, env),
    upgraded: true,
    upgradeDiff: result.diffPrice,
    upgradeDiffLabel: formatMoney(result.diffPrice),
    message: `已从${result.currentPlan?.name || "原套餐"}升级为${result.targetPlan.name}（补差价 ${formatMoney(result.diffPrice)}），有效期至 ${formatDate(result.expiresAt)}`,
  };
}

export function adminUpgradePlan(lookup, targetPlanId, env = process.env) {
  const normalizedTargetId = String(targetPlanId || "").trim();
  if (!getPlanById(normalizedTargetId)) {
    const error = new Error("请选择有效的升级套餐");
    error.status = 400;
    throw error;
  }

  const store = loadStore();
  const key = String(lookup || "").trim();
  let deviceId = null;

  if (store.proDevices[key]) {
    deviceId = key;
  } else {
    for (const [id, record] of Object.entries(store.proDevices || {})) {
      if (record?.code === key) {
        deviceId = id;
        break;
      }
    }
  }

  if (!deviceId) {
    const error = new Error(`未找到设备或激活码 ${key} 的会员记录`);
    error.status = 404;
    throw error;
  }

  const result = applyUpgradeToDevice(deviceId, normalizedTargetId, store, {
    upgradeCode: null,
    source: "admin-upgrade",
  });
  saveStore(store);

  return {
    deviceId,
    activationCode: store.proDevices[deviceId]?.code || null,
    ...getUsageStatus(deviceId, env),
    upgraded: true,
    message: `已手动升级为${result.targetPlan.name}（补差价 ${formatMoney(result.diffPrice)}），有效期至 ${formatDate(result.expiresAt)}`,
  };
}

export function getUpgradeInventory(env = process.env) {
  const store = loadStore();
  const used = getUsedUpgradeCodesSet(store);
  const plans = ["half", "year"];
  const inventory = {};
  let configured = false;

  for (const planId of plans) {
    const codes = getUpgradeCodeList(planId, env);
    if (codes.length) configured = true;
    inventory[planId] = {
      total: codes.length,
      available: codes.filter((code) => !used.has(code)).length,
      ready: codes.length > 0,
    };
  }

  return { configured, plans: inventory };
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
      `免费试用每天限 ${FREE_DAILY_LIMIT} 次，今日已用完。开通会员：${formatPriceSummary()}，付款后获取邀请码并填入开通。`
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
  if (store.pendingClaims) {
    for (const [deviceId, claim] of Object.entries(store.pendingClaims)) {
      if (claim?.code === code) delete store.pendingClaims[deviceId];
    }
  }

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
