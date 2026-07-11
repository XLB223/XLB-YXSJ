#!/usr/bin/env node
import { loadEnv } from "./_load-env.mjs";
import { adminUpgradePlan } from "../api/usage-store.js";

loadEnv();

const lookup = process.argv[2]?.trim();
const targetPlanId = process.argv[3]?.trim();

if (!lookup || !targetPlanId || lookup === "--help" || lookup === "-h") {
  console.log(`
用法：node scripts/upgrade-plan.mjs <激活码或设备ID> <目标套餐>

目标套餐：half（半年卡）或 year（年卡）

示例：
  node scripts/upgrade-plan.mjs LISTING-M29-001 half
  node scripts/upgrade-plan.mjs LISTING-M29-001 year

说明：
  用户付款补差价并联系客服后，核实截图后执行此命令为其升级。
  也可先发升级码让用户自行在页面输入（需在 .env 配置 UPGRADE_CODES_*）。
`);
  process.exit(lookup && targetPlanId ? 0 : 1);
}

try {
  const result = adminUpgradePlan(lookup, targetPlanId);
  console.log("✓", result.message);
  if (result.deviceId) console.log("  设备ID：", result.deviceId);
} catch (error) {
  console.error("✗", error.message || error);
  process.exit(1);
}
