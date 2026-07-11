#!/usr/bin/env node
import { loadEnv } from "./_load-env.mjs";
import { listCodeBindings, getActivationInventory, getUpgradeInventory } from "../api/usage-store.js";

loadEnv();

const bindings = listCodeBindings();
const inventory = getActivationInventory(process.env);
const upgradeInventory = getUpgradeInventory(process.env);

console.log("=== 已绑定的激活码 ===");
if (!bindings.length) {
  console.log("（暂无绑定记录）");
} else {
  for (const item of bindings) {
    console.log(
      [
        item.code,
        item.planName,
        item.expiresLabel ? `至 ${item.expiresLabel}` : "无到期日",
        `设备 ${item.deviceId.slice(0, 8)}…`,
      ].join(" | ")
    );
  }
}

console.log("\n=== 激活码库存（未使用） ===");
for (const [planId, info] of Object.entries(inventory.plans || {})) {
  console.log(`${planId}: ${info.available}/${info.total} 可用`);
}
if (inventory.legacyYear?.total) {
  console.log(`legacy-year: ${inventory.legacyYear.available}/${inventory.legacyYear.total} 可用`);
}

console.log("\n=== 升级码库存（未使用） ===");
for (const [planId, info] of Object.entries(upgradeInventory.plans || {})) {
  console.log(`${planId}: ${info.available}/${info.total} 可用`);
}

console.log("\n换绑命令：node scripts/unbind-code.mjs <激活码>");
console.log("手动升级：node scripts/upgrade-plan.mjs <激活码> <half|year>");
