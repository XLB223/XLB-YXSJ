import { SUPPORTED_LANGUAGES } from "../languages.js";
import {
  assertCanGenerate,
  recordGeneration,
  getUsageStatus,
  activateDevice,
} from "./usage-store.js";
import {
  CATEGORY_LIMITS,
  normalizeCategoryType,
  getTitleLimit,
  postProcessListing,
} from "./listing-utils.js";

export { getUsageStatus, activateDevice };

const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const BATCH_SIZE = 4;
const BATCH_TIMEOUT_MS = 90_000;

export { SUPPORTED_LANGUAGES };

function buildPrompt({
  productName,
  brandName,
  sellingPoints,
  category,
  categoryType,
  coreKeywords,
  competitorReference,
  style,
  languages,
}) {
  const styleLabel = style === "casual" ? "活泼口语化，贴近消费者日常表达" : "专业正式，权威可信";
  const titleMax = getTitleLimit(categoryType);
  const categoryRule = CATEGORY_LIMITS[normalizeCategoryType(categoryType)].label;

  const langList = languages
    .map((code) => {
      const lang = SUPPORTED_LANGUAGES[code];
      return lang ? `${lang.name}（${code}，${lang.marketplace}）` : code;
    })
    .join("、");

  const listingSchema = languages
    .map(
      (code) => `    "${code}": {
      "title": "string",
      "bulletPoints": ["string", "string", "string", "string", "string"],
      "description": "string",
      "searchTerms": "string"
    }`
    )
    .join(",\n");

  const keywordBlock = coreKeywords?.trim()
    ? `\n核心关键词 / 长尾词（必须自然融入 Listing，不可遗漏重要词）：\n${coreKeywords.trim()}`
    : "";

  const competitorBlock = competitorReference?.trim()
    ? `\n竞品参考（仅学习结构与表达角度，禁止抄袭原文、禁止提及竞品品牌）：\n${competitorReference.trim()}`
    : "";

  const brandBlock = brandName?.trim() ? `\n品牌名：${brandName.trim()}（标题开头优先放置品牌名）` : "";

  return `你是一位专业的亚马逊 Listing 优化专家，拥有 10 年跨境电商实战经验。请根据以下中文产品信息，为每种目标语言分别撰写符合当地 Amazon 站点规范的高质量 Listing。

目标语言：${langList}
类目规则：${categoryRule}

【输出规范 — 每种语言必须严格遵守】

1. Title（标题）
   - 长度不超过 ${titleMax} 字符（含空格），主关键词尽量放在前 ${80} 字符（移动端可见区）
   - 结构：${brandName?.trim() ? "品牌名 + " : ""}核心关键词 + 核心卖点 + 规格/场景
   - 包含 2–3 个核心搜索关键词，符合 Amazon A9/A10 SEO 规范
   - 禁止促销用语（Best、Free、#1、100% 等违规词）

2. Bullet Points（核心优势）
   - 必须恰好 5 条
   - 每条不超过 250 字符
   - 格式：2–4 个词的大写卖点短语 + 冒号 + 1–2 句说明（例：SHARP BLADES: ...）
   - 覆盖：核心功能、材质/工艺、使用场景、对比优势、售后/保障
   - 突出差异化，不要空泛形容词堆砌

3. Description（产品描述）
   - 200–300 词（日语/中文等按该语言习惯，约 400–600 字符）
   - 必须使用 HTML 标签分段，仅允许：<p>、<br>、<b>、<strong>、<ul>、<li>
   - 结构：开篇痛点/场景 → 产品解决方案 → 核心功能详解 → 使用场景 → 品质保障
   - 文案风格：${styleLabel}

4. Search Terms（后台关键词）
   - 总长度不超过 249 字节（UTF-8），逗号分隔，使用该目标语言
   - 禁止重复 Title 中已出现的词（含变体、单复数）
   - 覆盖长尾词、场景词、同义词

【写作原则 — 极其重要】
- 严禁编造：只能使用下方「产品信息」中已提供的功能、材质、规格、卖点；未提供的信息一律不写
- 禁止翻译腔，必须达到母语级别的自然表达
- 不是直译中文，而是基于当地消费者搜索习惯和购买心理重新创作
- 严格符合 Amazon Listing 政策，不含夸大、医疗声明、竞品指名
- 关键词布局自然，避免 keyword stuffing
${competitorBlock ? "- 竞品参考仅用于学习表达方式，不得复制句式或虚构竞品未提及的功能" : ""}

【输出格式】
- 仅输出纯 JSON，不要 Markdown 代码块，不要任何解释文字
- JSON 格式：
{
  "listings": {
${listingSchema}
  }
}

【产品信息】
产品名称：${productName}
产品卖点/特点：${sellingPoints}
产品类型：${category}${brandBlock}${keywordBlock}${competitorBlock}
文案风格：${styleLabel}`;
}

function parseListingJson(content, languages, categoryType) {
  const trimmed = content.trim();
  const jsonText = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;

  const parsed = JSON.parse(jsonText);
  const listings = parsed.listings || parsed;
  const result = {};
  const compliance = {};

  for (const code of languages) {
    const listing = listings[code];
    if (!listing?.title || !Array.isArray(listing.bulletPoints) || !listing.description) {
      throw new Error(`API 返回格式不正确，缺少 ${SUPPORTED_LANGUAGES[code]?.name || code} 的 Listing 数据`);
    }

    if (listing.bulletPoints.length !== 5) {
      throw new Error(
        `API 返回格式不正确，${SUPPORTED_LANGUAGES[code]?.name || code} 的核心优势必须为 5 条`
      );
    }

    const processed = postProcessListing(
      {
        title: String(listing.title),
        bulletPoints: listing.bulletPoints.map(String),
        description: String(listing.description),
        searchTerms: String(listing.searchTerms || ""),
      },
      categoryType
    );

    const { compliance: listingCompliance, meta, ...listingData } = processed;
    result[code] = listingData;
    compliance[code] = listingCompliance;
    result[code].meta = meta;
  }

  return { listings: result, compliance };
}

function normalizeLanguages(languages) {
  if (!Array.isArray(languages) || languages.length === 0) {
    return Object.keys(SUPPORTED_LANGUAGES);
  }

  const valid = languages.filter((code) => SUPPORTED_LANGUAGES[code]);
  return valid.length > 0 ? valid : Object.keys(SUPPORTED_LANGUAGES);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function callDeepSeek(apiKey, prompt, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content:
              "You are a senior Amazon listing optimization expert with 10 years of cross-border e-commerce experience. You write native-level, SEO-optimized listings for all Amazon marketplaces. Never invent product features not provided in the user input. Always respond with valid JSON only, no markdown.",
          },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let message = `DeepSeek API 请求失败 (${response.status})`;

      if (response.status === 401) {
        message =
          "DeepSeek API Key 无效或已过期。请登录 platform.deepseek.com 检查余额并重新生成 Key，更新 .env 文件中的 DEEPSEEK_API_KEY 后重启 start.bat";
      } else {
        try {
          const parsed = JSON.parse(errorBody);
          message = parsed?.error?.message || message;
        } catch {
          if (errorBody) message += `: ${errorBody}`;
        }
      }

      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      const error = new Error("API 未返回有效内容");
      error.status = 502;
      throw error;
    }

    return content;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error(`请求超时（${Math.round(timeoutMs / 1000)}秒）`);
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function handleGenerateRequest(payload, env = process.env) {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    const error = new Error("服务器未配置 DEEPSEEK_API_KEY 环境变量");
    error.status = 500;
    throw error;
  }

  const {
    productName,
    brandName,
    sellingPoints,
    category,
    categoryType,
    coreKeywords,
    competitorReference,
    style,
    languages: rawLanguages,
    deviceId,
  } = payload || {};

  if (!productName?.trim() || !sellingPoints?.trim() || !category?.trim()) {
    const error = new Error("请填写完整的产品信息");
    error.status = 400;
    throw error;
  }

  assertCanGenerate(deviceId, env);

  const languages = normalizeLanguages(rawLanguages);
  const batches = chunkArray(languages, BATCH_SIZE);
  const normalizedCategoryType = normalizeCategoryType(categoryType);
  const input = {
    productName: productName.trim(),
    brandName: brandName?.trim() || "",
    sellingPoints: sellingPoints.trim(),
    category: category.trim(),
    categoryType: normalizedCategoryType,
    coreKeywords: coreKeywords?.trim() || "",
    competitorReference: competitorReference?.trim() || "",
    style: style === "casual" ? "casual" : "professional",
  };

  const allListings = {};
  const allCompliance = {};

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const content = await callDeepSeek(
      apiKey,
      buildPrompt({ ...input, languages: batch }),
      BATCH_TIMEOUT_MS
    );
    const batchResult = parseListingJson(content, batch, normalizedCategoryType);
    Object.assign(allListings, batchResult.listings);
    Object.assign(allCompliance, batchResult.compliance);
  }

  const usage = recordGeneration(deviceId, env);

  return {
    listings: allListings,
    compliance: allCompliance,
    total: languages.length,
    batches: batches.length,
    usage,
  };
}
