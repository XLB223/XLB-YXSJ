import pptxgen from "pptxgenjs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, "..", "跨境AI Listing生成器-宣传一页纸.pptx");

const SITE = "www.kjdsai.cn";
const SITE_URL = "https://www.kjdsai.cn/";

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "跨境 AI Listing 生成器";
pres.title = "跨境 AI Listing 生成器 - 宣传资料";

const PRIMARY = "2563EB";
const DARK = "1E293B";
const MUTED = "64748B";
const LIGHT = "EFF6FF";

function addTitleSlide() {
  const slide = pres.addSlide();
  slide.background = { color: PRIMARY };
  slide.addText("跨境 AI Listing 生成器", {
    x: 0.6, y: 1.4, w: 8.8, h: 1,
    fontSize: 36, bold: true, color: "FFFFFF", align: "center",
  });
  slide.addText("中文输入 · 36 语言 · 一键生成 Amazon Listing", {
    x: 0.6, y: 2.5, w: 8.8, h: 0.6,
    fontSize: 18, color: "DBEAFE", align: "center",
  });
  slide.addText(`${SITE_URL}  ·  免费试用 3 次/天`, {
    x: 0.6, y: 3.3, w: 8.8, h: 0.4,
    fontSize: 14, color: "BFDBFE", align: "center",
  });
  slide.addText("输入中文，一键出全球 Amazon Listing", {
    x: 0.6, y: 4.5, w: 8.8, h: 0.4,
    fontSize: 12, color: "93C5FD", align: "center", italic: true,
  });
}

function addBulletsSlide(title, bullets, note) {
  const slide = pres.addSlide();
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.9,
    fill: { color: PRIMARY }, line: { color: PRIMARY },
  });
  slide.addText(title, {
    x: 0.5, y: 0.15, w: 9, h: 0.6,
    fontSize: 24, bold: true, color: "FFFFFF",
  });
  const items = bullets.map((text, i) => ({
    text,
    options: { bullet: true, breakLine: i < bullets.length - 1, fontSize: 15, color: DARK },
  }));
  slide.addText(items, { x: 0.7, y: 1.15, w: 8.6, h: 3.9, valign: "top" });
  if (note) {
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y: 4.85, w: 9, h: 0.55,
      fill: { color: LIGHT }, line: { color: "BFDBFE" },
    });
    slide.addText(note, {
      x: 0.7, y: 4.95, w: 8.6, h: 0.4,
      fontSize: 11, color: MUTED,
    });
  }
}

function addTwoColSlide(title, leftTitle, leftItems, rightTitle, rightItems) {
  const slide = pres.addSlide();
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.9,
    fill: { color: PRIMARY }, line: { color: PRIMARY },
  });
  slide.addText(title, {
    x: 0.5, y: 0.15, w: 9, h: 0.6,
    fontSize: 24, bold: true, color: "FFFFFF",
  });
  slide.addText(leftTitle, {
    x: 0.5, y: 1.1, w: 4.3, h: 0.4,
    fontSize: 14, bold: true, color: PRIMARY,
  });
  slide.addText(
    leftItems.map((t, i) => ({
      text: t,
      options: { bullet: true, breakLine: i < leftItems.length - 1, fontSize: 13, color: DARK },
    })),
    { x: 0.5, y: 1.5, w: 4.3, h: 3.5, valign: "top" }
  );
  slide.addText(rightTitle, {
    x: 5.2, y: 1.1, w: 4.3, h: 0.4,
    fontSize: 14, bold: true, color: PRIMARY,
  });
  slide.addText(
    rightItems.map((t, i) => ({
      text: t,
      options: { bullet: true, breakLine: i < rightItems.length - 1, fontSize: 13, color: DARK },
    })),
    { x: 5.2, y: 1.5, w: 4.3, h: 3.5, valign: "top" }
  );
}

addTitleSlide();

addBulletsSlide(
  "产品定位 & 目标用户",
  [
    "Amazon 跨境卖家专用 AI Listing 工具 · kjdsai.cn",
    "中文填产品信息 → 批量生成 36 语言 Listing",
    "目标用户：FBA/FBM 卖家、运营、代运营、多站点团队",
    "解决痛点：写 Listing 慢、外语弱、多站点扩张文案跟不上",
  ],
  "Slogan：输入中文，一键出全球 Amazon Listing"
);

addBulletsSlide(
  "核心功能",
  [
    "36 种语言，按亚/欧/非/美大洲筛选",
    "标题 + 5 条 Bullet + HTML 描述 + 后台 Search Terms",
    "品牌名 / 核心关键词 / 竞品参考（选填增强 SEO）",
    "Amazon 规范：类目字符上限、249 字节后台词、移动端 80 字符预览",
    "合规敏感词自检 · 一键导出 Word · 网页版 & 手机版",
    "只基于真实卖点生成，AI 不编造未提供的功能",
  ]
);

addTwoColSlide(
  "使用流程 & 输出示例",
  "3 步上手",
  [
    "打开 kjdsai.cn 填产品信息",
    "勾选目标语言，选文案风格",
    "生成 → 复制 / 导出 Word",
  ],
  "每次生成包含",
  [
    "Title：SEO 优化标题",
    "5 条 Bullet Points",
    "Description：HTML 格式",
    "Search Terms：后台关键词",
    "合规提示 + 字符统计",
  ]
);

addBulletsSlide(
  "定价 & 行动号召",
  [
    "免费试用：每天 3 次，打开即用",
    "月卡 ¥29.9 · 半年卡 ¥69.9 · 年卡 ¥129.9（无限次）",
    "扫码支付 → 联系客服获取激活码",
    `立即体验：${SITE_URL}`,
    "推广话术详见 Word 资料包（朋友圈/小红书/抖音脚本）",
  ],
  "合规提示：AI 文案需人工终审，勿承诺「保证爆单/100% 过审」"
);

addBulletsSlide(
  "vs 通用 AI / Coze / 人工外包",
  [
    "ChatGPT：需自写 Prompt，格式不稳定，无 Amazon 规范内置",
    "Coze 工作流：搭建维护麻烦，多语言需反复调试",
    "人工外包：单 SKU 多语言成本高、周期长",
    "本产品：填表即生成，36 语言批量，年卡 ¥129.9 无限次",
  ],
  `官网 ${SITE}  ·  手机版 ${SITE}/mobile/`
);

await pres.writeFile({ fileName: out });
console.log("已生成:", out);
