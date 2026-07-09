// Cloudflare Pages Function: /api/languages
import { SUPPORTED_LANGUAGES } from "../../languages.js";

export async function onRequest() {
  return new Response(
    JSON.stringify({ languages: SUPPORTED_LANGUAGES }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
