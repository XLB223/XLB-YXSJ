// Cloudflare Pages Function: /api/health
export async function onRequest(context) {
  const { env } = context;
  return new Response(
    JSON.stringify({
      ok: true,
      hasApiKey: Boolean(env.DEEPSEEK_API_KEY),
      message: env.DEEPSEEK_API_KEY
        ? "Server running"
        : "DEEPSEEK_API_KEY not configured",
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
