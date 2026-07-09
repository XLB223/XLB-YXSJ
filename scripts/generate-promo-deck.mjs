import pptxgen from "pptxgenjs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, "..", "跨境AI Listing生成器-宣传一页纸.pptx");

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "跨境 AI Listing 生成器";
pres.title = "跨境 AI Listing 生成器 - 宣传一页纸";

const PRIMARY = "2563EB";
const DARK = "1E293B";
const MUTED = "64748B";
const LIGHT = "EFF6FF";

function addTitleSlide() {
  const slide = pres.addSlide();
  slide.background = { color: PRIMARY };
  slide.addText("跨境 AI Listing 生成器", {
    x: 0.6,
    y: 1.6,
    w: 8.8,
    h: 1,
    fontSize: 36,
    bold: true,
    color: "FFFFFF",
    align: "center",
  });
  slide.addText("中文输入 · 36 语言 · 一键生成 Amazon Listing", {
    x: 0.6,
    y: 2.7,
    w: 8.8,
    h: 0.6,
    fontSize: 18,
    color: "DBEAFE",
    align: "center",
  });
  slide.addText("【填：访问地址】  ·  【填：联系方式】", {
    x: 0.6,
    y: 4.6,
    w: 8.8,
    h: 0.4,
    fontSize: 12,
    color: "BFDBFE",
    align: "center",
  });
}

function addBulletsSlide(title, bullets, note) {
  const slide = pres.addSlide();
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 10,
    h: 0.9,
    fill: { color: PRIMARY },
    line: { color: PRIMARY },
  });
  slide.addText(title, {
    x: 0.5,
    y: 0.15,
    w: 9,
    h: 0.6,
    fontSize: 24,
    bold: true,
    color: "FFFFFF",
  });
  const items = bullets.map((text, i) => ({
    text,
    options: { bullet: true, breakLine: i < bullets.length - 1, fontSize: 16, color: DARK },
  }));
  slide.addText(items, { x: 0.7, y: 1.2, w: 8.6, h: 3.8, valign: "top" });
  if (note) {
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.5,
      y: 4.85,
      w: 9,
      h: 0.55,
      fill: { color: LIGHT },
      line: { color: "BFDBFE" },
    });
    slide.addText(note, {
      x: 0.7,
      y: 4.95,
      w: 8.6,
      h: 0.4,
      fontSize: 11,
      color: MUTED,
    });
  }
}

addTitleSlide();

addBulletsSlide(
  "产品定位 & 目标用户",
  [
    "Amazon 跨境卖家专用 AI Listing 工具",
    "中文填产品信息 → 批量生成多语言 Listing",
    "目标：FBA/FBM 卖家、运营、代运营、多站点团队",
    "痛点：写 Listing 慢、外语弱、Coze 搭建太麻烦",
  ],
  "Slogan：输入中文，一键出全球 Amazon Listing"
);

addBulletsSlide(
  "核心功能",
  [
    "36 种语言（亚/欧/非/美大洲筛选）",
    "标题 + 5 条核心优势 + HTML 描述 + 后台关键词",
    "品牌名 / 关键词库 / 竞品参考（选填）",
    "Amazon 规范：SEO 标题、249 字节后台词、类目字符上限",
    "合规自检 + 导出 Word + 网页版 & 手机版",
  ]
);

addBulletsSlide(
  "与 Coze 教程方案对比",
  [
    "Coze：需搭工作流、配插件、偏英语单站点",
    "本产品：打开即用、36 语言批量、填表即生成",
    "更适合：想快速出稿、不想维护 Agent 的卖家",
  ],
  "免费版 3 次/天 · 月卡 ¥29.9 · 半年 ¥69.9 · 年卡 ¥129.9"
);

addBulletsSlide(
  "推广渠道 & 行动号召",
  [
    "抖音：30 秒痛点/对比/效率脚本（见 Word 资料包）",
    "小红书：九宫格功能图解 + 实测正文",
    "朋友圈：3 条短文案 + 产品截图",
    "卖家群：工具分享 + 免费试用链接",
    "CTA：免费试用 → 【访问地址】→ 私信【联系方式】升级 Pro",
  ],
  "合规：AI 文案需人工终审；勿承诺「保证爆单/100% 过审」"
);

await pres.writeFile({ fileName: out });
console.log("已生成:", out);
