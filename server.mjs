import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import {
  handleGenerateRequest,
  getUsageStatus,
  activateDevice,
  claimPurchaseCode,
  claimUpgradeCode,
  getActivationInventory,
  upgradePlan,
  getUpgradeInventory,
} from "./api/generate-handler.js";
import {
  createOrder,
  lookupOrder,
  getOrderStatus,
  getCurrentOrderForDevice,
  notifyOrderToAdmin,
  fulfillOrderIfAuthorized,
  isManualPaymentMode,
} from "./api/order-store.js";
import { getPurchaseInfo } from "./api/pricing-plans.js";
import { sendContactMessage } from "./api/mail.mjs";
import { SUPPORTED_LANGUAGES } from "./languages.js";
import { checkRateLimit, clientKey } from "./api/rate-limit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const HOST = "0.0.0.0";
const MAX_BODY_BYTES = 64 * 1024;

const STATIC_ALLOWED_EXT = new Set([
  ".html",
  ".css",
  ".js",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".ico",
  ".xml",
  ".txt",
  ".webmanifest",
  ".woff",
  ".woff2",
  ".map",
]);

const STATIC_BLOCKED_SEGMENTS = new Set([
  "data",
  "api",
  "scripts",
  "deploy",
  "node_modules",
  ".git",
  ".cursor",
]);

function loadEnv() {
  const env = { ...process.env };
  const envPath = path.join(__dirname, ".env");
  try {
    let raw = fs.readFileSync(envPath, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (key) env[key] = value;
    }
  } catch {
    // .env optional
  }
  return env;
}

const env = loadEnv();

function allowedCorsOrigin(req) {
  const origin = String(req.headers.origin || "").trim();
  const site = String(env.SITE_URL || "www.kjdsai.cn")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  const allowList = new Set([
    `https://${site}`,
    `https://www.${site.replace(/^www\./, "")}`,
    `http://${site}`,
    "http://127.0.0.1:5173",
    "http://localhost:5173",
  ]);
  if (origin && allowList.has(origin)) return origin;
  if (!origin) return "";
  return `https://${site}`;
}

function setCorsHeaders(req, res) {
  const origin = allowedCorsOrigin(req);
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(req, res, status, data) {
  setCorsHeaders(req, res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendHtml(res, status, html) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderFulfillPage({ title, message, code, orderId, ok }) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeOrderId = escapeHtml(orderId);
  const safeCode = escapeHtml(code);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 520px; margin: 48px auto; padding: 0 16px; color: #111827; }
    .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; background: #fff; }
    h1 { font-size: 1.25rem; margin: 0 0 12px; color: ${ok ? "#166534" : "#b91c1c"}; }
    p { line-height: 1.6; margin: 0 0 10px; }
    .code { display: inline-block; margin-top: 8px; padding: 8px 12px; border-radius: 8px; background: #eff6ff; border: 1px dashed #60a5fa; font-weight: 700; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${safeTitle}</h1>
    <p>${safeMessage}</p>
    ${safeOrderId ? `<p>订单号：<strong>${safeOrderId}</strong></p>` : ""}
    ${safeCode ? `<p>邀请码：<span class="code">${safeCode}</span></p>` : ""}
    ${ok ? "<p>会员将自动开通/升级，用户页面会同步刷新。</p>" : ""}
  </div>
</body>
</html>`;
}

function readBody(req, { maxBytes = MAX_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("请求体过大"), { status: 413 }));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function assertRateLimit(req, res, suffix, options) {
  const result = checkRateLimit(clientKey(req, suffix), options);
  if (!result.ok) {
    res.setHeader("Retry-After", String(result.retryAfterSec || 60));
    sendJson(req, res, 429, { error: result.error });
    return false;
  }
  return true;
}

function isBlockedStaticPath(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) return true;
  if (normalized.startsWith(".")) return true;
  if (normalized.includes("/.")) return true;
  if (normalized.toLowerCase().endsWith(".env") || normalized.toLowerCase().includes(".env.")) {
    return true;
  }
  if (/\.(mjs|cjs|ts|md|json|py|sh|bat|ps1|yml|yaml|lock|zip|docx|pptx|doc)$/i.test(normalized)) {
    // Allow only explicit public json/webmanifest/xml via extension whitelist below;
    // block generic source/config dumps.
    if (!/\.(webmanifest|xml|txt)$/i.test(normalized) && !normalized.startsWith("assets/")) {
      if (/\.(json|mjs|cjs|ts|md|py|sh|zip|docx|pptx)$/i.test(normalized)) return true;
    }
  }
  const parts = normalized.split("/");
  if (STATIC_BLOCKED_SEGMENTS.has(parts[0])) return true;
  return false;
}

function resolveFilePath(url) {
  if (url === "/" || url === "/index.html") {
    return path.join(__dirname, "index.html");
  }
  if (url === "/mobile" || url === "/mobile/") {
    return path.join(__dirname, "mobile", "index.html");
  }

  const relative = decodeURIComponent(url.replace(/^\//, "")).replace(/\//g, path.sep);
  if (!relative || isBlockedStaticPath(relative.replace(/\\/g, "/"))) return null;

  const full = path.resolve(__dirname, relative);
  const root = path.resolve(__dirname);
  if (full !== root && !full.startsWith(root + path.sep)) return null;

  const ext = path.extname(full).toLowerCase();
  if (!STATIC_ALLOWED_EXT.has(ext)) return null;

  // Root-level: only known public files (not package.json etc — already blocked by ext)
  const relPosix = full.slice(root.length + 1).replace(/\\/g, "/");
  if (!relPosix.includes("/")) {
    const allowedRoot = new Set([
      "index.html",
      "robots.txt",
      "sitemap.xml",
      "languages.js",
      "favicon.ico",
    ]);
    if (
      !allowedRoot.has(relPosix) &&
      !/^baidu_verify_[A-Za-z0-9_-]+\.html$/i.test(relPosix)
    ) {
      return null;
    }
  }

  return full;
}

async function handleRequest(req, res) {
  const url = req.url.split("?")[0];

  if (req.method === "OPTIONS") {
    setCorsHeaders(req, res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (url === "/api/health") {
    sendJson(req, res, 200, { ok: true });
    return;
  }

  if (url === "/api/languages") {
    sendJson(req, res, 200, { languages: SUPPORTED_LANGUAGES });
    return;
  }

  if (url === "/api/pricing") {
    sendJson(req, res, 200, {
      ...getPurchaseInfo(env),
      activationInventory: getActivationInventory(env),
      upgradeInventory: getUpgradeInventory(env),
    });
    return;
  }

  if (url === "/api/contact" && req.method === "POST") {
    if (!assertRateLimit(req, res, "contact", { limit: 5, windowMs: 60 * 60 * 1000, message: "留言过于频繁，请一小时后再试" })) {
      return;
    }
    try {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const result = await sendContactMessage(
        {
          message: payload.message,
          contact: payload.contact,
          deviceId: payload.deviceId,
        },
        env
      );
      if (!result.sent) {
        sendJson(req, res, 500, { error: result.error || "发送失败" });
        return;
      }
      sendJson(req, res, 200, { ok: true, message: result.message || "留言已发送" });
    } catch (error) {
      sendJson(req, res, error.status || 500, { error: error.message || "发送失败" });
    }
    return;
  }

  if (url === "/api/contact") {
    sendJson(req, res, 405, { error: "Method not allowed" });
    return;
  }

  if (url.startsWith("/api/usage")) {
    const query = new URL(req.url, "http://localhost").searchParams;
    const deviceId = query.get("deviceId");
    if (!deviceId) {
      sendJson(req, res, 400, { error: "缺少 deviceId" });
      return;
    }
    sendJson(req, res, 200, getUsageStatus(deviceId, env));
    return;
  }

  if (url === "/api/purchase" && req.method === "POST") {
    if (isManualPaymentMode(env)) {
      sendJson(req, res, 403, { error: "请提交订单并等待确认收款，勿直接领取邀请码" });
      return;
    }
    if (!assertRateLimit(req, res, "purchase", { limit: 10, windowMs: 60 * 60 * 1000 })) return;
    try {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const result = claimPurchaseCode(payload.deviceId, payload.planId, env);
      sendJson(req, res, 200, result);
    } catch (error) {
      sendJson(req, res, error.status || 500, { error: error.message || "开通失败" });
    }
    return;
  }

  if (url === "/api/purchase") {
    sendJson(req, res, 405, { error: "Method not allowed" });
    return;
  }

  if (url === "/api/claim-upgrade" && req.method === "POST") {
    if (isManualPaymentMode(env)) {
      sendJson(req, res, 403, { error: "请提交升级订单并等待确认收款，勿直接领取邀请码" });
      return;
    }
    if (!assertRateLimit(req, res, "claim-upgrade", { limit: 10, windowMs: 60 * 60 * 1000 })) return;
    try {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const result = claimUpgradeCode(payload.deviceId, payload.planId, env);
      sendJson(req, res, 200, result);
    } catch (error) {
      sendJson(req, res, error.status || 500, { error: error.message || "领取失败" });
    }
    return;
  }

  if (url === "/api/claim-upgrade") {
    sendJson(req, res, 405, { error: "Method not allowed" });
    return;
  }

  if (url === "/api/upgrade" && req.method === "POST") {
    if (!assertRateLimit(req, res, "upgrade", { limit: 20, windowMs: 60 * 60 * 1000 })) return;
    try {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const result = upgradePlan(payload.deviceId, payload.planId, payload.upgradeCode, env);
      sendJson(req, res, 200, result);
    } catch (error) {
      sendJson(req, res, error.status || 500, { error: error.message || "升级失败" });
    }
    return;
  }

  if (url === "/api/upgrade") {
    sendJson(req, res, 405, { error: "Method not allowed" });
    return;
  }

  if (url === "/api/activate" && req.method === "POST") {
    if (!assertRateLimit(req, res, "activate", { limit: 20, windowMs: 60 * 60 * 1000 })) return;
    try {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const result = activateDevice(payload.deviceId, payload.code, env);
      sendJson(req, res, 200, result);
    } catch (error) {
      sendJson(req, res, error.status || 500, { error: error.message || "激活失败" });
    }
    return;
  }

  if (url === "/api/activate") {
    sendJson(req, res, 405, { error: "Method not allowed" });
    return;
  }

  if (url === "/api/order/create" && req.method === "POST") {
    if (!assertRateLimit(req, res, "order-create", { limit: 15, windowMs: 60 * 60 * 1000, message: "创建订单过于频繁，请稍后再试" })) {
      return;
    }
    try {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const result = createOrder(
        {
          deviceId: payload.deviceId,
          planId: payload.planId,
          type: payload.type || "purchase",
        },
        env
      );
      sendJson(req, res, 200, result);
    } catch (error) {
      sendJson(req, res, error.status || 500, { error: error.message || "创建订单失败" });
    }
    return;
  }

  if (url === "/api/order/create") {
    sendJson(req, res, 405, { error: "Method not allowed" });
    return;
  }

  if (url === "/api/order/notify" && req.method === "POST") {
    if (!assertRateLimit(req, res, "order-notify", { limit: 20, windowMs: 60 * 60 * 1000, message: "发送通知过于频繁，请稍后再试" })) {
      return;
    }
    try {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const result = await notifyOrderToAdmin(payload.orderId, payload.deviceId, env);
      sendJson(req, res, 200, result);
    } catch (error) {
      sendJson(req, res, error.status || 500, { error: error.message || "发送通知失败" });
    }
    return;
  }

  if (url === "/api/order/notify") {
    sendJson(req, res, 405, { error: "Method not allowed" });
    return;
  }

  if (url.startsWith("/api/order/lookup")) {
    try {
      const query = new URL(req.url, "http://localhost").searchParams;
      const result = lookupOrder(query.get("orderId"), query.get("deviceId"));
      sendJson(req, res, 200, result);
    } catch (error) {
      sendJson(req, res, error.status || 500, { error: error.message || "查询失败" });
    }
    return;
  }

  if (url.startsWith("/api/order/fulfill")) {
    try {
      const query = new URL(req.url, "http://localhost").searchParams;
      const result = await fulfillOrderIfAuthorized(
        query.get("orderId"),
        {
          token: query.get("token"),
          sig: query.get("sig"),
          exp: query.get("exp"),
        },
        env
      );
      const softFail =
        result &&
        result.status === "fulfilled" &&
        ((result.type === "purchase" && !result.activationApplied) ||
          (result.type === "upgrade" && !result.upgradeApplied));
      sendHtml(
        res,
        softFail ? 500 : 200,
        renderFulfillPage({
          ok: !softFail,
          title: softFail ? "已确认但开通未完成" : "已确认收款",
          message: result.message || "会员已处理完成。",
          orderId: result.orderId,
          code: result.code,
        })
      );
    } catch (error) {
      sendHtml(
        res,
        error.status || 500,
        renderFulfillPage({
          ok: false,
          title: "确认失败",
          message: error.message || "无法确认此订单",
        })
      );
    }
    return;
  }

  if (url.startsWith("/api/order/current")) {
    try {
      const query = new URL(req.url, "http://localhost").searchParams;
      const order = getCurrentOrderForDevice(query.get("deviceId"));
      sendJson(req, res, 200, { order });
    } catch (error) {
      sendJson(req, res, error.status || 500, { error: error.message || "查询失败" });
    }
    return;
  }

  if (url.startsWith("/api/order/status")) {
    try {
      const query = new URL(req.url, "http://localhost").searchParams;
      const result = getOrderStatus(query.get("orderId"), query.get("deviceId"));
      sendJson(req, res, 200, result);
    } catch (error) {
      sendJson(req, res, error.status || 500, { error: error.message || "查询失败" });
    }
    return;
  }

  if (url === "/api/generate" && req.method === "POST") {
    if (!assertRateLimit(req, res, "generate", { limit: 60, windowMs: 60 * 60 * 1000, message: "生成请求过于频繁，请稍后再试" })) {
      return;
    }
    try {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const result = await handleGenerateRequest(payload, env);
      sendJson(req, res, 200, result);
    } catch (error) {
      sendJson(req, res, error.status || 500, {
        error: error.message || "Internal server error",
      });
    }
    return;
  }

  if (url === "/api/generate") {
    sendJson(req, res, 405, { error: "Method not allowed" });
    return;
  }

  if (url.startsWith("/api/")) {
    sendJson(req, res, 404, { error: "Not Found" });
    return;
  }

  const filePath = resolveFilePath(url);
  if (!filePath) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".webmanifest": "application/manifest+json; charset=utf-8",
      ".svg": "image/svg+xml; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".ico": "image/x-icon",
      ".xml": "application/xml; charset=utf-8",
      ".txt": "text/plain; charset=utf-8",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".map": "application/json; charset=utf-8",
    };

    const headers = {
      "Content-Type": types[ext] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    };
    if (ext === ".html") {
      headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    }

    res.writeHead(200, headers);
    res.end(data);
  });
}

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return null;
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error("Unhandled request error:", error);
    if (!res.headersSent) {
      sendJson(req, res, 500, { error: error.message || "Internal server error" });
    }
  });
});

server.listen(PORT, HOST, () => {
  const ip = getLocalIp();
  console.log("");
  console.log("========================================");
  console.log("  跨境 AI Listing 生成器 已启动");
  console.log("");
  console.log("  电脑网页版:");
  console.log(`    http://127.0.0.1:${PORT}`);
  console.log("");
  console.log("  手机 APP 版:");
  console.log(`    http://127.0.0.1:${PORT}/mobile/`);
  if (ip) {
    console.log(`    http://${ip}:${PORT}/mobile/  （手机连同一 WiFi 访问）`);
  }
  console.log("");
  if (!env.DEEPSEEK_API_KEY) {
    console.log("  [警告] 未检测到 DEEPSEEK_API_KEY");
  }
  console.log("  按 Ctrl+C 停止服务器");
  console.log("========================================");
  console.log("");

  if (process.platform === "win32") {
    exec(`start "" "http://127.0.0.1:${PORT}"`);
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用。请先关闭其他 node 进程，或执行:`);
    console.error(`  taskkill /F /IM node.exe`);
  } else {
    console.error("服务器启动失败:", error.message);
  }
  process.exit(1);
});
