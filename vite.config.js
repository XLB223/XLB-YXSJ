import { defineConfig, loadEnv } from "vite";
import { handleGenerateRequest, getUsageStatus, activateDevice, claimPurchaseCode, claimUpgradeCode, getActivationInventory, upgradePlan, getUpgradeInventory } from "./api/generate-handler.js";
import { createOrder, lookupOrder, getOrderStatus, notifyOrderToAdmin, fulfillOrderIfAuthorized, isManualPaymentMode } from "./api/order-store.js";
import { getPurchaseInfo } from "./api/pricing-plans.js";
import { sendContactMessage } from "./api/mail.mjs";
import { SUPPORTED_LANGUAGES } from "./languages.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    server: {
      port: 5173,
      host: "127.0.0.1",
      open: true,
    },
    plugins: [
      {
        name: "api-generate-dev",
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const url = req.url?.split("?")[0] || "";

            if (url === "/api/health") {
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(
                JSON.stringify({
                  ok: true,
                  hasApiKey: Boolean(env.DEEPSEEK_API_KEY),
                  message: env.DEEPSEEK_API_KEY
                    ? "服务器运行正常"
                    : "未配置 DEEPSEEK_API_KEY",
                })
              );
              return;
            }

            if (url === "/api/pricing") {
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(
                JSON.stringify({
                  ...getPurchaseInfo(env),
                  activationInventory: getActivationInventory(env),
                  upgradeInventory: getUpgradeInventory(env),
                })
              );
              return;
            }

            if (url === "/api/contact") {
              if (req.method === "OPTIONS") {
                res.statusCode = 204;
                res.end();
                return;
              }
              if (req.method !== "POST") {
                res.statusCode = 405;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: "Method not allowed" }));
                return;
              }
              let body = "";
              req.on("data", (chunk) => {
                body += chunk;
              });
              req.on("end", async () => {
                try {
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
                    res.statusCode = 500;
                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    res.end(JSON.stringify({ error: result.error || "发送失败" }));
                    return;
                  }
                  res.statusCode = 200;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify({ ok: true, message: result.message || "留言已发送" }));
                } catch (error) {
                  res.statusCode = error.status || 500;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify({ error: error.message || "发送失败" }));
                }
              });
              return;
            }

            if (url === "/api/languages") {
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ languages: SUPPORTED_LANGUAGES }));
              return;
            }

            if (url === "/api/usage") {
              const query = new URL(req.url, "http://localhost").searchParams;
              const deviceId = query.get("deviceId");
              res.statusCode = deviceId ? 200 : 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(
                JSON.stringify(
                  deviceId
                    ? getUsageStatus(deviceId, env)
                    : { error: "缺少 deviceId" }
                )
              );
              return;
            }

            if (url === "/api/purchase") {
              if (req.method === "OPTIONS") {
                res.statusCode = 204;
                res.end();
                return;
              }
              if (req.method !== "POST") {
                res.statusCode = 405;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: "Method not allowed" }));
                return;
              }
              let body = "";
              req.on("data", (chunk) => {
                body += chunk;
              });
              req.on("end", () => {
                try {
                  if (isManualPaymentMode(env)) {
                    res.statusCode = 403;
                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    res.end(JSON.stringify({ error: "请提交订单并等待确认收款，勿直接领取邀请码" }));
                    return;
                  }
                  const payload = body ? JSON.parse(body) : {};
                  const result = claimPurchaseCode(payload.deviceId, payload.planId, env);
                  res.statusCode = 200;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify(result));
                } catch (error) {
                  res.statusCode = error.status || 500;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify({ error: error.message || "开通失败" }));
                }
              });
              return;
            }

            if (url === "/api/claim-upgrade") {
              if (req.method === "OPTIONS") {
                res.statusCode = 204;
                res.end();
                return;
              }
              if (req.method !== "POST") {
                res.statusCode = 405;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: "Method not allowed" }));
                return;
              }
              let body = "";
              req.on("data", (chunk) => {
                body += chunk;
              });
              req.on("end", () => {
                try {
                  if (isManualPaymentMode(env)) {
                    res.statusCode = 403;
                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    res.end(JSON.stringify({ error: "请提交升级订单并等待确认收款，勿直接领取邀请码" }));
                    return;
                  }
                  const payload = body ? JSON.parse(body) : {};
                  const result = claimUpgradeCode(payload.deviceId, payload.planId, env);
                  res.statusCode = 200;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify(result));
                } catch (error) {
                  res.statusCode = error.status || 500;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify({ error: error.message || "领取失败" }));
                }
              });
              return;
            }

            if (url === "/api/upgrade") {
              if (req.method === "OPTIONS") {
                res.statusCode = 204;
                res.end();
                return;
              }
              if (req.method !== "POST") {
                res.statusCode = 405;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: "Method not allowed" }));
                return;
              }
              let body = "";
              req.on("data", (chunk) => {
                body += chunk;
              });
              req.on("end", () => {
                try {
                  const payload = body ? JSON.parse(body) : {};
                  const result = upgradePlan(payload.deviceId, payload.planId, payload.upgradeCode, env);
                  res.statusCode = 200;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify(result));
                } catch (error) {
                  res.statusCode = error.status || 500;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify({ error: error.message || "升级失败" }));
                }
              });
              return;
            }

            if (url === "/api/activate") {
              if (req.method === "OPTIONS") {
                res.statusCode = 204;
                res.end();
                return;
              }
              if (req.method !== "POST") {
                res.statusCode = 405;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: "Method not allowed" }));
                return;
              }
              let body = "";
              req.on("data", (chunk) => {
                body += chunk;
              });
              req.on("end", () => {
                try {
                  const payload = body ? JSON.parse(body) : {};
                  const result = activateDevice(payload.deviceId, payload.code, env);
                  res.statusCode = 200;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify(result));
                } catch (error) {
                  res.statusCode = error.status || 500;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify({ error: error.message || "激活失败" }));
                }
              });
              return;
            }

            if (url === "/api/order/create") {
              if (req.method === "OPTIONS") {
                res.statusCode = 204;
                res.end();
                return;
              }
              if (req.method !== "POST") {
                res.statusCode = 405;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: "Method not allowed" }));
                return;
              }
              let body = "";
              req.on("data", (chunk) => {
                body += chunk;
              });
              req.on("end", () => {
                try {
                  const payload = body ? JSON.parse(body) : {};
                  const result = createOrder(
                    {
                      deviceId: payload.deviceId,
                      planId: payload.planId,
                      type: payload.type || "purchase",
                    },
                    env
                  );
                  res.statusCode = 200;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify(result));
                } catch (error) {
                  res.statusCode = error.status || 500;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify({ error: error.message || "创建订单失败" }));
                }
              });
              return;
            }

            if (url === "/api/order/notify") {
              if (req.method === "OPTIONS") {
                res.statusCode = 204;
                res.end();
                return;
              }
              if (req.method !== "POST") {
                res.statusCode = 405;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: "Method not allowed" }));
                return;
              }
              let body = "";
              req.on("data", (chunk) => {
                body += chunk;
              });
              req.on("end", () => {
                try {
                  const payload = body ? JSON.parse(body) : {};
                  const result = notifyOrderToAdmin(payload.orderId, payload.deviceId, env);
                  res.statusCode = 200;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify(result));
                } catch (error) {
                  res.statusCode = error.status || 500;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify({ error: error.message || "发送通知失败" }));
                }
              });
              return;
            }

            if (url.startsWith("/api/order/lookup")) {
              try {
                const query = new URL(req.url, "http://localhost").searchParams;
                const result = lookupOrder(query.get("orderId"), query.get("deviceId"));
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify(result));
              } catch (error) {
                res.statusCode = error.status || 500;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: error.message || "查询失败" }));
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
                res.statusCode = 200;
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.end(
                  `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>已确认收款</title></head><body><h1>已确认收款</h1><p>${result.message || "邀请码已发放"}</p><p>订单号：${result.orderId || ""}</p><p>邀请码：${result.code || ""}</p></body></html>`
                );
              } catch (error) {
                res.statusCode = error.status || 500;
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.end(
                  `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>确认失败</title></head><body><h1>确认失败</h1><p>${error.message || "无法确认此订单"}</p></body></html>`
                );
              }
              return;
            }

            if (url.startsWith("/api/order/status")) {
              try {
                const query = new URL(req.url, "http://localhost").searchParams;
                const result = getOrderStatus(query.get("orderId"), query.get("deviceId"));
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify(result));
              } catch (error) {
                res.statusCode = error.status || 500;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: error.message || "查询失败" }));
              }
              return;
            }

            if (url !== "/api/generate") {
              next();
              return;
            }

            if (req.method === "OPTIONS") {
              res.statusCode = 204;
              res.setHeader("Access-Control-Allow-Origin", "*");
              res.end();
              return;
            }

            if (req.method !== "POST") {
              res.statusCode = 405;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Method not allowed" }));
              return;
            }

            let body = "";
            req.on("data", (chunk) => {
              body += chunk;
            });

            req.on("end", async () => {
              try {
                const payload = body ? JSON.parse(body) : {};
                const result = await handleGenerateRequest(payload, env);
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify(result));
              } catch (error) {
                const status = error.status || 500;
                res.statusCode = status;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(
                  JSON.stringify({
                    error: error.message || "Internal server error",
                  })
                );
              }
            });
          });
        },
      },
    ],
  };
});
