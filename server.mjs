import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { handleGenerateRequest } from "./api/generate-handler.js";
import { SUPPORTED_LANGUAGES } from "./languages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const HOST = "0.0.0.0";

function loadEnv() {
  const env = { ...process.env };
  try {
    const lines = fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
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

  const filePath =
    url === "/" || url === "/index.html"
      ? path.join(__dirname, "index.html")
      : path.join(__dirname, url);

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
    };

    res.writeHead(200, { "Content-Type": types[ext] || "text/plain; charset=utf-8" });
    res.end(data);
  });
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
  console.log("");
  console.log("========================================");
  console.log("  跨境 AI Listing 生成器 已启动");
  console.log(`  浏览器打开: http://127.0.0.1:${PORT}`);
  console.log(`  或访问:     http://localhost:${PORT}`);
  if (!env.DEEPSEEK_API_KEY) {
    console.log("");
    console.log("  [警告] 未检测到 DEEPSEEK_API_KEY");
    console.log("  请在 .env 文件中配置 API Key");
  }
  console.log("");
  console.log("  按 Ctrl+C 停止服务器");
  console.log("========================================");
  console.log("");
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
