// Vercel Serverless Function: /api/generate
import { handleGenerateRequest } from "./generate-handler.js";

const allowedOrigins = ["https://xlb-yxsj.vercel.app", "http://localhost:5173", "http://localhost:3000"];

function setCors(req, res) {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin) || !origin || origin.startsWith("http://localhost")) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const payload = await readBody(req);
    const result = await handleGenerateRequest(payload, process.env);
    res.status(200).json(result);
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || "Internal server error",
    });
  }
}
