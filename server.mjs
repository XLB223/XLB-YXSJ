import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import { handleGenerateRequest, getUsageStatus, activateDevice, claimPurchaseCode, claimUpgradeCode, getActivationInventory, upgradePlan, getUpgradeInventory } from "./api/generate-handler.js";
import { createOrder, lookupOrder, getOrderStatus, notifyOrderToAdmin, fulfillOrderIfAuthorized, isManualPaymentMode } from "./api/order-store.js";
import { getPurchaseInfo } from "./api/pricing-plans.js";
import { sendContactMessage } from "./api/mail.mjs";
import { SUPPORTED_LANGUAGES } from "./languages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const HOST = "0.0.0.0";

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
    // .env is optional if env var is set elsewhere
  }
  return env;
}

const env = loadEnv();

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, data) {
  setCorsHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendHtml(res, status, html) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function renderFulfillPage({ title, message, code, orderId, ok }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
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
    <h1>${title}</h1>
    <p>${message}</p>
    ${orderId ? `<p>订单号：<strong>${orderId}</strong></p>` : ""}
    ${code ? `<p>邀请码：<span class="code">${code}</span></p>` : ""}
    ${ok ? "<p>用户付款页面的订单号下方会自动显示邀请码。</p>" : ""}
  </div>
</body>
</html>`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleRequest(req, res) {
  const url = req.url.split("?")[0];

  if (req.method === "OPTIONS") {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (url === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      hasApiKey: Boolean(env.DEEPSEEK_API_KEY),
      hasActivationCodes: Boolean(env.ACTIVATION_CODES_MONTH || env.ACTIVATION_CODES_HALF || env.ACTIVATION_CODES_YEAR || env.ACTIVATION_CODES),
      hasUpgradeCodes: Boolean(env.UPGRADE_CODES_HALF || env.UPGRADE_CODES_YEAR),
      envFile: path.join(__dirname, ".env"),
      envFileExists: fs.existsSync(path.join(__dirname, ".env")),
      cwd: process.cwd(),
      message: env.DEEPSEEK_API_KEY
        ? "服务器运行正常"
        : "服务器已启动，但未配置 DEEPSEEK_API_KEY",
    });
    return;
  }

  if (url === "/api/languages") {
    sendJson(res, 200, { languages: SUPPORTED_LANGUAGES });
    return;
  }

  if (url === "/api/pricing") {
    sendJson(res, 200, {
      ...getPurchaseInfo(env),
      activationInventory: getActivationInventory(env),
      upgradeInventory: getUpgradeInventory(env),
    });
    return;
  }

  if (url === "/api/contact" && req.method === "POST") {
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
        sendJson(res, 500, { error: result.error || "发送失败" });
        return;
      }
      sendJson(res, 200, { ok: true, message: result.message || "留言已发送" });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || "发送失败" });
    }
    return;
  }

  if (url === "/api/contact") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (url.startsWith("/api/usage")) {
    const query = new URL(req.url, "http://localhost").searchParams;
    const deviceId = query.get("deviceId");
    if (!deviceId) {
      sendJson(res, 400, { error: "缺少 deviceId" });
      return;
    }
    sendJson(res, 200, getUsageStatus(deviceId, env));
    return;
  }

  if (url === "/api/purchase" && req.method === "POST") {
    if (isManualPaymentMode(env)) {
      sendJson(res, 403, { error: "请提交订单并等待确认收款，勿直接领取邀请码" });
      return;
    }
    try {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const result = claimPurchaseCode(payload.deviceId, payload.planId, env);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || "开通失败" });
    }
    return;
  }

  if (url === "/api/purchase") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (url === "/api/claim-upgrade" && req.method === "POST") {
    if (isManualPaymentMode(env)) {
      sendJson(res, 403, { error: "请提交升级订单并等待确认收款，勿直接领取邀请码" });
      return;
    }
    try {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const result = claimUpgradeCode(payload.deviceId, payload.planId, env);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || "领取失败" });
    }
    return;
  }

  if (url === "/api/claim-upgrade") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (url === "/api/upgrade" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const result = upgradePlan(payload.deviceId, payload.planId, payload.upgradeCode, env);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || "升级失败" });
    }
    return;
  }

  if (url === "/api/upgrade") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (url === "/api/activate" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const result = activateDevice(payload.deviceId, payload.code, env);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || "激活失败" });
    }
    return;
  }

  if (url === "/api/activate") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (url === "/api/order/create" && req.method === "POST") {
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
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || "创建订单失败" });
    }
    return;
  }

  if (url === "/api/order/create") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (url === "/api/order/notify" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const result = notifyOrderToAdmin(payload.orderId, payload.deviceId, env);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || "发送通知失败" });
    }
    return;
  }

  if (url === "/api/order/notify") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (url.startsWith("/api/order/lookup")) {
    try {
      const query = new URL(req.url, "http://localhost").searchParams;
      const result = lookupOrder(query.get("orderId"), query.get("deviceId"));
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || "查询失败" });
    }
    return;
  }

  if (url.startsWith("/api/order/fulfill")) {
    try {
      const query = new URL(req.url, "http://localhost").searchParams;
      const result = await fulfillOrderIfAuthorized(
        query.get("orderId"),
        query.get("token"),
        env
      );
      sendHtml(
        res,
        200,
        renderFulfillPage({
          ok: true,
          title: "已确认收款",
          message: result.message || "邀请码已发放。",
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

  if (url.startsWith("/api/order/status")) {
    try {
      const query = new URL(req.url, "http://localhost").searchParams;
      const result = getOrderStatus(query.get("orderId"), query.get("deviceId"));
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || "查询失败" });
    }
    return;
  }

  if (url === "/api/generate" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const result = await handleGenerateRequest(payload, env);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.status || 500, {
        error: error.message || "Internal server error",
      });
    }
    return;
  }

  if (url === "/api/generate") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const filePath = resolveFilePath(url);
  if (!filePath) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  const normalizedRoot = path.resolve(__dirname);
  const normalizedFile = path.resolve(filePath);

  if (!normalizedFile.startsWith(normalizedRoot)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(normalizedFile, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    const ext = path.extname(normalizedFile);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".webmanifest": "application/manifest+json; charset=utf-8",
      ".svg": "image/svg+xml; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    };

    const headers = { "Content-Type": types[ext] || "text/plain; charset=utf-8" };
    if (ext === ".html") {
      headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    }

    res.writeHead(200, headers);
    res.end(data);
  });
}

function resolveFilePath(url) {
  if (url === "/" || url === "/index.html") {
    return path.join(__dirname, "index.html");
  }
  if (url === "/mobile" || url === "/mobile/") {
    return path.join(__dirname, "mobile", "index.html");
  }
  const relative = url.replace(/^\//, "").replace(/\//g, path.sep);
  if (!relative) return null;
  return path.join(__dirname, relative);
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
      sendJson(res, 500, { error: error.message || "Internal server error" });
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
  console.log("  收款码测试:");
  console.log(`    http://127.0.0.1:${PORT}/assets/payment/wechat-pay.png`);
  if (!env.DEEPSEEK_API_KEY) {
    console.log("");
    console.log("  [警告] 未检测到 DEEPSEEK_API_KEY");
    console.log("  请在 .env 文件中配置 API Key");
  }
  console.log("");
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
