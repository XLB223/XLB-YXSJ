import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const USAGE_FILE = path.join(DATA_DIR, "usage.json");
export const FREE_DAILY_LIMIT = 3;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
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
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(USAGE_FILE, JSON.stringify(store, null, 2), "utf8");
}

function getValidCodes(env = process.env) {
  const raw = env.ACTIVATION_CODES || "";
  return raw
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

export function isProDevice(deviceId, env = process.env) {
  if (!deviceId) return false;
  const store = loadStore();
  return Boolean(store.proDevices[deviceId]);
}

export function getUsageStatus(deviceId, env = process.env) {
  const store = loadStore();
  const isPro = Boolean(store.proDevices[deviceId]);

  if (isPro) {
    return {
      isPro: true,
      limit: null,
      usedToday: 0,
      remaining: null,
      message: "Pro 已激活，无限次生成",
    };
  }

  const today = todayKey();
  const record = store.devices[deviceId];
  const usedToday = record?.date === today ? record.count : 0;
  const remaining = Math.max(0, FREE_DAILY_LIMIT - usedToday);

  return {
    isPro: false,
    limit: FREE_DAILY_LIMIT,
    usedToday,
    remaining,
    message:
      remaining > 0
        ? `免费版 · 今日剩余 ${remaining}/${FREE_DAILY_LIMIT} 次`
        : `免费版今日次数已用完（${FREE_DAILY_LIMIT}/${FREE_DAILY_LIMIT}）`,
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

  const validCodes = getValidCodes(env);
  if (validCodes.length === 0) {
    const error = new Error("服务器未配置激活码，请联系管理员");
    error.status = 500;
    throw error;
  }

  if (!validCodes.includes(normalized)) {
    const error = new Error("激活码无效，请检查后重试");
    error.status = 403;
    throw error;
  }

  const store = loadStore();
  store.proDevices[deviceId] = {
    activatedAt: new Date().toISOString(),
    code: normalized,
  };
  saveStore(store);

  return {
    isPro: true,
    message: "Pro 激活成功，已解锁无限次生成",
  };
}

export function assertCanGenerate(deviceId, env = process.env) {
  if (isProDevice(deviceId, env)) return getUsageStatus(deviceId, env);

  const status = getUsageStatus(deviceId, env);
  if (status.remaining <= 0) {
    const error = new Error(
      `免费版每天限 ${FREE_DAILY_LIMIT} 次，今日已用完。请输入激活码解锁 Pro。`
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
