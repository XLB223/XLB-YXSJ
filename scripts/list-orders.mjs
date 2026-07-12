import { loadEnv } from "./_load-env.mjs";
import { listOrders } from "../api/order-store.js";

loadEnv();

const status = process.argv.includes("--pending") ? "pending" : null;
const orders = listOrders(status ? { status } : {});

if (!orders.length) {
  console.log(status ? "暂无待确认订单。" : "暂无订单记录。");
  process.exit(0);
}

console.log(status ? "待确认收款订单：" : "全部订单：");
for (const order of orders) {
  const label = order.type === "upgrade" ? "升级" : "开通";
  console.log(
    [
      order.orderId,
      order.status,
      label,
      order.planName,
      order.amountLabel,
      order.email,
      order.createdAt,
      order.code ? `code=${order.code}` : "",
    ]
      .filter(Boolean)
      .join(" | ")
  );
}
