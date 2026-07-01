import { handleGenerateRequest } from "./generate-handler.js";

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  const url = req.url?.split("?")[0] || "";

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (url.endsWith("/health") || url === "/api/health") {
    return res.status(200).json({
      ok: true,
      hasApiKey: Boolean(process.env.DEEPSEEK_API_KEY),
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const payload = await readJsonBody(req);
    const result = await handleGenerateRequest(payload, process.env);
    return res.status(200).json(result);
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      error: error.message || "Internal server error",
    });
  }
}
