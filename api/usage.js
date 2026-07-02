import { getUsageStatus } from "./usage-store.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const deviceId = req.query?.deviceId || req.url?.split("deviceId=")[1]?.split("&")[0];

  if (!deviceId) {
    return res.status(400).json({ error: "缺少 deviceId" });
  }

  return res.status(200).json(getUsageStatus(deviceId, process.env));
}
