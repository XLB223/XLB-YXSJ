// Vercel Serverless Function: /api/health
export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).json({
    ok: true,
    hasApiKey: Boolean(process.env.DEEPSEEK_API_KEY),
    message: process.env.DEEPSEEK_API_KEY
      ? "Server running"
      : "Server started, but DEEPSEEK_API_KEY not configured",
  });
}
