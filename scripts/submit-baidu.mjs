import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const env = { ...process.env };
  try {
    const raw = readFileSync(path.join(__dirname, "..", ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
  } catch {
    // optional
  }
  return env;
}

const env = loadEnv();
const site = String(env.BAIDU_PUSH_SITE || env.SITE_URL || "www.kjdsai.cn").replace(/^https?:\/\//, "");
const token = String(env.BAIDU_PUSH_TOKEN || "").trim();
const urls = (process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["https://www.kjdsai.cn/", "https://www.kjdsai.cn/mobile/"]
).map((url) => url.trim());

if (!token) {
  console.error("请在 .env 中配置 BAIDU_PUSH_TOKEN（百度搜索资源平台 → 普通收录 → API 推送）");
  console.error("可选：BAIDU_PUSH_SITE=www.kjdsai.cn");
  process.exit(1);
}

const api = `http://data.zz.baidu.com/urls?site=${encodeURIComponent(site)}&token=${encodeURIComponent(token)}`;
const response = await fetch(api, {
  method: "POST",
  headers: { "Content-Type": "text/plain; charset=utf-8" },
  body: urls.join("\n"),
});
const text = await response.text();
console.log(text);
if (!response.ok) process.exit(1);
