/**
 * 文档解析：把 PDF / Word / Excel / 文本 里的文字真的读出来
 * 不 OCR —— 扫描件会明确告诉客户"这份读不出字，需要先转文字版"
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SUPPORTED = ['pdf', 'docx', 'xlsx', 'xls', 'csv', 'txt', 'md', 'markdown', 'json'];

export function extOf(name) {
  return path.extname(name || '').replace('.', '').toLowerCase();
}

export function isSupported(name) {
  return SUPPORTED.includes(extOf(name));
}

/* ---------------- PDF ---------------- */

/**
 * pdfjs 处理中文 PDF 需要 cMap（字体编码表）和标准字体数据，
 * 不传这两个目录，CID 字体的文字层会被读成空——很多「扫描件」其实只是缺了它们。
 */
export function pdfAssetUrls() {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'pdfjs-dist');
  return {
    cMapUrl: pathToFileURL(path.join(root, 'cmaps') + path.sep).href,
    cMapPacked: true,
    standardFontDataUrl: pathToFileURL(path.join(root, 'standard_fonts') + path.sep).href,
  };
}

async function parsePDF(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: false,
    isEvalSupported: false,
    useWorkerFetch: false,
    disableFontFace: true,
    ...pdfAssetUrls(),
  });
  const doc = await task.promise;

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = '';
    let text = '';
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      line += item.str;
      if (item.hasEOL) {
        text += line + '\n';
        line = '';
      }
    }
    if (line) text += line;
    pages.push({ page: i, text: cleanup(joinLines(cleanup(text))) });
    page.cleanup();
  }
  await doc.destroy();

  const chars = pages.reduce((n, p) => n + p.text.replace(/\s/g, '').length, 0);
  return {
    pages: pages.length,
    chars,
    text: pages.map((p) => p.text).join('\n\n'),
    byPage: pages,
    // 中文 PDF 常见：字体没内嵌文字层，读出来是空的
    empty: chars < 20,
  };
}

/* ---------------- Word ---------------- */
async function parseDocx(buf) {
  const mammoth = (await import('mammoth')).default;
  const result = await mammoth.extractRawText({ buffer: buf });
  const text = cleanup(result.value || '');
  return {
    pages: Math.max(1, Math.ceil(text.length / 1200)),
    chars: text.replace(/\s/g, '').length,
    text,
    byPage: [],
    empty: text.replace(/\s/g, '').length < 20,
    warnings: (result.messages || []).slice(0, 3).map((m) => m.message),
  };
}

/* ---------------- Excel / CSV ---------------- */
async function parseXlsx(buf) {
  const XLSX = (await import('xlsx')).default;
  const wb = XLSX.read(buf, { type: 'buffer' });

  const blocks = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    const rows = csv.split('\n').filter((l) => l.trim());
    if (!rows.length) continue;
    // 每行前面带上表名，检索时能定位到是哪张表
    blocks.push(`【工作表：${name}】\n` + rows.join('\n'));
  }

  const text = cleanup(blocks.join('\n\n'));
  return {
    pages: wb.SheetNames.length,
    chars: text.replace(/\s/g, '').length,
    text,
    byPage: blocks.map((b, i) => ({ page: i + 1, text: b })),
    empty: text.replace(/\s/g, '').length < 20,
    sheets: wb.SheetNames,
  };
}

function parseText(buf) {
  let text = buf.toString('utf8');
  // 去掉 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = cleanup(text);
  const chars = text.replace(/\s/g, '').length;
  return {
    pages: Math.max(1, Math.ceil(text.length / 1200)),
    chars,
    text,
    byPage: [],
    empty: chars < 20,
  };
}

/* PDF 的换行大多是版式换行，不是段落。合并回去，中文之间不补空格 */
function joinLines(t) {
  const lines = t.split('\n');
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { out.push(''); continue; }              // 空行保留为段落分隔
    const last = out.length ? out[out.length - 1] : '';
    if (!out.length || last === '') { out.push(line); continue; }
    const cjk = /[\u4e00-\u9fa5，。；：、）】]/.test(last.slice(-1)) ||
                /[\u4e00-\u9fa5（【]/.test(line.slice(0, 1));
    out[out.length - 1] = last + (cjk ? '' : ' ') + line;
  }
  return out.join('\n');
}

/* 清理：全角空格、连续空行、页眉页脚残留的分页符 */
function cleanup(t) {
  return t
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\f/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function parseFile(buf, name) {
  const ext = extOf(name);
  const started = Date.now();
  let out;

  if (ext === 'pdf') out = await parsePDF(buf);
  else if (ext === 'docx') out = await parseDocx(buf);
  else if (ext === 'xlsx' || ext === 'xls') out = await parseXlsx(buf);
  else if (['txt', 'md', 'markdown', 'csv', 'json'].includes(ext)) out = parseText(buf);
  else throw new Error(`不支持的文件格式：.${ext}`);

  return {
    ...out,
    ext,
    ms: Date.now() - started,
    // 扫描件：看着有页数，一个字都没读出来
    scanned: out.empty && ext === 'pdf',
  };
}
