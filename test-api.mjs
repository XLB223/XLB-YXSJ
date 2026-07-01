import { readFileSync } from "fs";
import { handleGenerateRequest } from "./api/generate-handler.js";

function loadEnv() {
  try {
    const lines = readFileSync(".env", "utf8").split("\n");
    const env = { ...process.env };
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
    return env;
  } catch {
    return process.env;
  }
}

const payload = {
  productName: "不锈钢厨房剪刀",
  sellingPoints: "锋利耐用、防滑手柄、可拆卸清洗",
  category: "厨房用品",
  style: "professional",
  languages: ["en", "de", "ja"],
};

console.log("正在生成多语言 Listing，语言:", payload.languages.join(", "));
console.log("请稍候...\n");

try {
  const result = await handleGenerateRequest(payload, loadEnv());
  for (const [code, listing] of Object.entries(result.listings)) {
    console.log(`\n========== ${code.toUpperCase()} ==========`);
    console.log("【Title】", listing.title);
    console.log("【Bullets】");
    listing.bulletPoints.forEach((bp, i) => console.log(`  ${i + 1}. ${bp}`));
    console.log("【Description】", listing.description.slice(0, 120) + "...");
    console.log("【Search Terms】", listing.searchTerms);
  }
} catch (error) {
  console.error("生成失败:", error.message);
  process.exit(1);
}
