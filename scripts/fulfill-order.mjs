import { loadEnv } from "./_load-env.mjs";
import { fulfillOrder } from "../api/order-store.js";

loadEnv();

const orderId = process.argv[2];
if (!orderId) {
  console.error("用法: node scripts/fulfill-order.mjs <订单号>");
  console.error("示例: node scripts/fulfill-order.mjs KJ-20260711-A3F9");
  process.exit(1);
}

const result = await fulfillOrder(orderId, process.env);
console.log(result.message);
console.log(`订单号: ${result.orderId || orderId}`);
if (result.code) {
  console.log(`关联码: ${result.code}`);
}
if (result.activationApplied) {
  console.log("开通状态: 已自动开通");
}
if (result.upgradeApplied) {
  console.log("升级状态: 已自动升级");
}
if (result.adminNotify?.email?.sent) {
  console.log("管理员邮箱通知已发送。");
} else if (result.adminNotify?.email?.error) {
  console.log(`管理员邮箱: ${result.adminNotify.email.error}`);
}
if (result.adminNotify?.wechat?.sent) {
  console.log(`微信通知已发送（${result.adminNotify.wechat.channel}）。`);
} else if (result.adminNotify?.wechat?.error) {
  console.log(`微信通知: ${result.adminNotify.wechat.error}`);
}
if (result.userEmailSent) {
  console.log("用户邮箱也已发送。");
}
