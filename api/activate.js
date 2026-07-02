import { activateDevice } from "./usage-store.js";

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
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
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { deviceId, code } = await readJsonBody(req);
    const result = activateDevice(deviceId, code, process.env);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || "激活失败",
    });
  }
}
