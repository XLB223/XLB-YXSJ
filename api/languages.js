// Vercel Serverless Function: /api/languages
import { SUPPORTED_LANGUAGES } from "../languages.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).json({ languages: SUPPORTED_LANGUAGES });
}
