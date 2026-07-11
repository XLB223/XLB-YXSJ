#!/usr/bin/env node
import { loadEnv } from "./_load-env.mjs";
import { unbindActivationCode } from "../api/usage-store.js";

loadEnv();

const code = process.argv[2]?.trim();

if (!code || code === "--help" || code === "-h") {
  console.log(`
用法：node scripts/unbind-code.mjs <激活码>

示例：
  node scripts/unbind-code.mjs LISTING-M29-001

说明：
  用户换电脑时，在服务器执行此命令解绑旧设备。
  解绑后让用户在新电脑「手动输入激活码」重新开通即可。
`);
  process.exit(code ? 0 : 1);
}

try {
  const result = unbindActivationCode(code);
  console.log("✓", result.message);
  if (result.removedDevices.length) {
    console.log("  已清除设备数：", result.removedDevices.length);
  }
} catch (error) {
  console.error("✗", error.message || error);
  process.exit(1);
}
