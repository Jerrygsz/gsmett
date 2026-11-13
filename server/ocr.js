/**
 * 扫描件 OCR：把没有文字层的 PDF 页渲染成图片，交给视觉模型读字
 *
 * 为什么不用 Tesseract：客户电脑上不一定装了它，而且中文扫描件（发票、证书、报关单）
 * 用通用 OCR 引擎识别率一般。这里复用客户自己配置的多模态模型，不额外装软件。
 * 代价是要花 token，所以只对「读不出文字」的资料调用，且默认只读前 2 页。
 */
import { pdfAssetUrls } from './parser.js';
import * as LLM from './llm.js';

const DEFAULT_MAX_PAGES = 2;
const DEFAULT_SCALE = 2;
const MAX_WIDTH = 1600;   // 再大对识别没帮助，只会让 token 变多
const JPEG_QUALITY = 82;

/** 把 PDF 前 N 页渲染成 JPEG（base64），返回 { images, totalPages } */
export async function renderPdfImages(buf, { maxPages = DEFAULT_MAX_PAGES, scale = DEFAULT_SCALE } = {}) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = await import('@napi-rs/canvas');

  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: false,
    isEvalSupported: false,
    useWorkerFetch: false,
    disableFontFace: true,
    ...pdfAssetUrls(),
  });
  const doc = await task.promise;
  const totalPages = doc.numPages;
  const n = Math.min(totalPages, Math.max(1, maxPages));
  const images = [];

  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    let viewport = page.getViewport({ scale });
    if (viewport.width > MAX_WIDTH) {
      viewport = page.getViewport({ scale: scale * (MAX_WIDTH / viewport.width) });
    }
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    // 白底：不少扫描件是透明底，直接渲染会变黑
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const jpg = canvas.toBuffer('image/jpeg', JPEG_QUALITY);
    images.push({ page: i, mime: 'image/jpeg', b64: jpg.toString('base64'), width: canvas.width, height: canvas.height });
    page.cleanup();
  }

  await doc.destroy();
  return { images, totalPages };
}

const OCR_SYS = `你是文档辨认助手。任务是把图片里看得见的文字原样转写出来。

规则：
1. 只转写图片上真实存在的字，不要总结、不要推断、不要补全缺失内容。
2. 表格按行输出，单元格之间用 " | " 分隔，第一行通常是表头。
3. 保留型号、数量、单价、日期、单号、盖章单位名称这类关键信息，它们最重要。
4. 手写体或模糊字看不清就用 □ 代替，不要猜。
5. 图片里没有文字（纯图、照片）就只回一句：无文字内容。
只输出转写结果，不要任何开场白。`;

/** 逐页调视觉模型识别，返回 { text, pages, usage, model } */
export async function ocrImages(cfg, images, { model, timeout = 120000 } = {}) {
  const texts = [];
  let noTextPages = 0;
  let usage = { prompt: 0, completion: 0, total: 0 };
  let usedModel = model || cfg.model;

  for (const img of images) {
    const r = await LLM.chat(cfg, [
      { role: 'system', content: OCR_SYS },
      {
        role: 'user',
        content: [
          { type: 'text', text: `这是文档第 ${img.page} 页，请转写其中的文字。` },
          { type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.b64}` } },
        ],
      },
    ], { model, maxTokens: 1024, temperature: 0, timeout });
    /* 注：glm-4v-flash 的 max_tokens 上限就是 1024，写大会被直接 400 拒掉。
     * 一页纸约 700–900 字，够分类和检索用；更长的手册建议直接传文字版 PDF。 */

    usedModel = r.model || usedModel;
    usage = {
      prompt: usage.prompt + (r.usage?.prompt || 0),
      completion: usage.completion + (r.usage?.completion || 0),
      total: usage.total + (r.usage?.total || 0),
    };
    const t = String(r.content || '').trim();
    if (!t || /^无文字内容[。.]?$/.test(t)) noTextPages++;
    else texts.push(`【第 ${img.page} 页】\n${t}`);
  }

  return {
    text: texts.join('\n\n'),
    pages: images.length,
    noTextPages,
    /* 整页都是图（产品照片、包装图、条码页）：不是失败，是这页本来就没字 */
    noText: texts.length === 0,
    usage,
    model: usedModel,
  };
}

/** 视觉模型走不通时，给一句人话解释，别甩 400 错误码 */
export function explainNoVision(provider) {
  const map = {
    deepseek: 'DeepSeek 的对话模型不支持读图片（没有视觉能力）。到第 5 步换成智谱（GLM-4V）、通义（Qwen-VL）或 OpenAI 的模型再识别。',
    moonshot: '当前模型不支持读图片，换成 moonshot-v1-8k-vision-preview 再试。',
  };
  return map[provider] || '当前配置的模型不支持图片输入。到第 5 步换成带视觉能力的模型（如 glm-4v-flash / qwen-vl-max / gpt-4o-mini）再识别。';
}
