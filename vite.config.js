import { defineConfig, loadEnv } from "vite";
import { handleGenerateRequest } from "./api/generate-handler.js";
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

            if (url === "/api/languages") {
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ languages: SUPPORTED_LANGUAGES }));
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
