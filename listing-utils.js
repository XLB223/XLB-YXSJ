export const CATEGORY_LIMITS = {
  general: { titleMax: 200, label: "通用类目（标题 ≤200 字符）" },
  apparel: { titleMax: 125, label: "服装/时尚（标题 ≤125 字符）" },
  electronics: { titleMax: 150, label: "电子产品（标题 ≤150 字符）" },
  baby_pet: { titleMax: 80, label: "母婴/宠物（标题 ≤80 字符）" },
};

export const SEARCH_TERMS_MAX_BYTES = 249;
export const BULLET_MAX_CHARS = 250;
export const TITLE_MOBILE_VISIBLE = 80;

export const COMPLIANCE_RULES = [
  {
    id: "superlative",
    pattern: /\b(best|#1|no\.?\s*1|number\s*one|top[\s-]?rated|perfect|flawless)\b/gi,
    tip: "避免最高级/排名用语",
  },
  {
    id: "promo",
    pattern: /\b(free|giveaway|discount|on sale|limited time|buy one get one)\b/gi,
    tip: "避免促销用语",
  },
  {
    id: "medical",
    pattern:
      /\b(cure|cures|treat|treats|heal|heals|therapy|therapeutic|anti-?bacterial|anti-?microbial|fda|disease|diagnose|medical grade)\b/gi,
    tip: "避免医疗/功效宣称",
  },
  {
    id: "absolute",
    pattern: /\b100\s*%|guaranteed\s+results?\b/gi,
    tip: "避免绝对化承诺",
  },
];

export function normalizeCategoryType(value) {
  const key = String(value || "general").trim();
  return CATEGORY_LIMITS[key] ? key : "general";
}

export function getTitleLimit(categoryType) {
  return CATEGORY_LIMITS[normalizeCategoryType(categoryType)].titleMax;
}

export function utf8ByteLength(str) {
  return new TextEncoder().encode(String(str)).length;
}

export function truncateToUtf8Bytes(str, maxBytes) {
  const text = String(str);
  if (utf8ByteLength(text) <= maxBytes) {
    return { text, truncated: false };
  }

  let result = "";
  for (const char of text) {
    const next = result + char;
    if (utf8ByteLength(next) > maxBytes) break;
    result = next;
  }

  return { text: result.replace(/[,\s]+$/, ""), truncated: true };
}

export function scanComplianceText(text, field = "text") {
  const source = String(text || "");
  if (!source.trim()) return [];

  const warnings = [];
  const seen = new Set();

  for (const rule of COMPLIANCE_RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match;
    while ((match = re.exec(source)) !== null) {
      const word = match[0];
      const key = `${field}:${word.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      warnings.push({
        field,
        word,
        tip: rule.tip,
        id: rule.id,
      });
    }
  }

  return warnings;
}

export function scanListingCompliance(listing) {
  const warnings = [];
  if (!listing) return warnings;

  warnings.push(...scanComplianceText(listing.title, "title"));
  (listing.bulletPoints || []).forEach((bullet, index) => {
    warnings.push(...scanComplianceText(bullet, `bullet${index + 1}`));
  });
  warnings.push(...scanComplianceText(listing.description, "description"));
  warnings.push(...scanComplianceText(listing.searchTerms, "searchTerms"));

  return warnings;
}

export function postProcessListing(listing, categoryType) {
  const titleMax = getTitleLimit(categoryType);
  let title = String(listing.title || "").trim();
  const titleTruncated = title.length > titleMax;
  if (titleTruncated) {
    title = title.slice(0, titleMax).trim();
  }

  const bulletPoints = (listing.bulletPoints || []).map((bullet) => {
    const text = String(bullet).trim();
    return text.length > BULLET_MAX_CHARS ? text.slice(0, BULLET_MAX_CHARS).trim() : text;
  });

  const { text: searchTerms, truncated: searchTermsTruncated } = truncateToUtf8Bytes(
    String(listing.searchTerms || "").trim(),
    SEARCH_TERMS_MAX_BYTES
  );

  const processed = {
    title,
    bulletPoints,
    description: String(listing.description || "").trim(),
    searchTerms,
    meta: {
      titleMax,
      titleLength: title.length,
      titleTruncated,
      titleMobilePreview: title.slice(0, TITLE_MOBILE_VISIBLE),
      searchTermsBytes: utf8ByteLength(searchTerms),
      searchTermsTruncated,
    },
  };

  return {
    ...processed,
    compliance: scanListingCompliance(processed),
  };
}
