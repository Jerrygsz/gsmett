/**
 * 贸智库 · 本地服务
 * - 托管前端页面
 * - 提供真实的环境检测、文档解析、知识库索引、检索与问答接口
 *
 * 启动：node server/index.js
 * 访问：http://localhost:8787
 */
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Busboy from 'busboy';

import { probeEnvironment } from './env.js';
import { parseFile, isSupported, extOf, SUPPORTED } from './parser.js';
import { chunkDoc, buildIndex, search } from './kb.js';
import * as LLM from './llm.js';
import {
  ROOT, initStorage, listClients, getClient, saveClient, nextProjectNo, deleteClient,
  getState, saveState, patchState, getDocs, saveDocs, getIndex, saveIndex,
  getFolders, saveFolders,
  uploadDir, clientDir, getConfig, saveConfig,
  getPlatform, savePlatform, getTickets, saveTickets,
  listMembers, addMember, updateMember, removeMember,
} from './store.js';

const PORT = Number(process.env.PORT || 8787);
/* 默认只绑本机回环：同 WiFi 的其他人访问不到这个服务。
 * 这个服务没有登录鉴权，一旦绑 0.0.0.0，别人就能用你的 Key 白嫖额度。
 * 真要让手机/同事访问，再显式设 HOST=0.0.0.0 启动，并清楚这是对外开放。 */
const HOST = process.env.HOST || '127.0.0.1';
const MAX_UPLOAD = 80 * 1024 * 1024; // 80MB

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---------------- HTTP 小工具 ---------------- */

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, code, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(text);
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJSONBody(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new Error('请求体不是合法 JSON'); }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' ) rel = '/index.html';

  const file = path.join(ROOT, path.normalize(rel).replace(/^([/\\])+/, ''));
  // 防目录穿越
  if (!file.startsWith(ROOT)) return sendText(res, 403, '禁止访问');

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // 找不到就回首页（前端用 hash 路由）
      return sendText(res, 404, 'Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------------- 客户状态默认值 ---------------- */

function defaultState(client) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const short = (client.org || '')
    .replace(/^(深圳市|东莞市|广州市|佛山市|宁波市|厦门市|青岛市|上海市|杭州市|苏州市)/, '')
    .replace(/(有限公司|股份公司|公司|工厂|厂)$/, '')
    .slice(0, 8) || (client.org || '').slice(0, 8);

  return {
    org: {
      name: client.org,
      short,
      industry: client.industry || '',
      size: client.size || '11–50 人',
      contact: client.contact || '',
      email: client.email || '',
      phone: client.phone || '',
      city: client.city || '',
      markets: '',
      categories: '',
      goal: '',
      plan: '标准交付',
    },
    user: { name: client.contact || '企业管理员', role: '企业管理员' },
    members: [{
      id: 'm1', name: client.contact || '企业管理员', email: client.email || '',
      role: '企业管理员', status: 'active', at: today,
    }],
    project: {
      id: client.pid,
      name: client.svc || '企业 AI 知识库建设',
      createdAt: today,
      owner: client.owner || '周明',
      steps: {},
      testRun: null,
      report: null,
      env: null,
    },
    cfg: {
      llm: null, // { provider, baseURL, model, apiKey } 只存在服务端
    },
    assistants: [], // 第 6 步创建，第 7/8 步按它决定口吻和检索范围
    portalAsks: 0,
    portalMiss: 0,
    feedback: [],
    activity: [{ t: `${today.slice(5)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, txt: `项目「${client.svc}」已创建`, who: '系统' }],
    log: [],
  };
}

function requireClient(id) {
  const c = getClient(id);
  if (!c) { const e = new Error('客户不存在'); e.status = 404; throw e; }
  return c;
}

function ensureState(id) {
  let st = getState(id);
  if (!st) {
    const c = requireClient(id);
    st = defaultState(c);
    saveState(id, st);
  }
  return st;
}

/* Key 打码，绝不把明文发给浏览器 */
function maskKey(k) {
  if (!k) return '';
  if (k.length <= 10) return '••••';
  return k.slice(0, 6) + '••••' + k.slice(-4);
}

/* ---------------- 模型配置解析 ----------------
 * 平台不内置、也不补贴任何模型：客户必须自己填 API Key（任何一个 OpenAI 兼容接口都行）。
 * 管理员可在 data/config.json 里「可选」配置一个平台默认 Key，但它不会自动补贴客户——
 * 客户请求一律用自己的 Key，平台 Key 只是管理员自检用途。浏览器任何请求都拿不到明文 Key。
 */
function platformLLM() {
  const l = getConfig().llm;
  return l && l.apiKey ? l : null;
}

function effectiveLLM(st) {
  // 只用客户自己填的 Key；平台不提供兜底 Key（避免用平台账号替客户付费）
  const own = st?.cfg?.llm;
  return own && own.apiKey ? { ...own, source: 'client' } : null;
}

/* 资料分类：老数据没存 cat，按文件名推断，规则和前端保持一致 */
function guessCat(name) {
  const n = name || '';
  if (/售后|退换|保修|维修|投诉/.test(n)) return '售后资料';
  if (/SOP|流程|规范|制度/.test(n)) return '业务流程';
  if (/报价|价格|条款|合同|账期|付款|折扣/.test(n)) return '销售资料';
  if (/FAQ|常见问题|话术|销售/.test(n)) return '销售资料';
  return '产品资料';
}

const docCat = (d) => d.cat || guessCat(d.name);

/* 模型用量统计。以前配置中心显示「482 次 / 1.24M token / ¥5.12」是编的，
 * 这里记真实调用次数与 token，前端照着显示。 */
function addUsage(st, usage) {
  if (!usage || !usage.total) return;
  st.usage = st.usage || { calls: 0, tokens: 0, byDay: {} };
  st.usage.calls = (st.usage.calls || 0) + 1;
  st.usage.tokens = (st.usage.tokens || 0) + usage.total;
  const day = new Date().toISOString().slice(0, 10);
  st.usage.byDay = st.usage.byDay || {};
  st.usage.byDay[day] = (st.usage.byDay[day] || 0) + usage.total;
}

/* 真正的"答不上来的问题"清单：客户拿这个去补资料。
 * 按问题去重，最多留 30 条，最近的排前面。 */
function recordGap(st, question, assistant) {
  const text = String(question || '').trim().slice(0, 120);
  if (!text) return;
  st.portalGaps = st.portalGaps || [];
  const hit = st.portalGaps.find((g) => g.q === text);
  if (hit) {
    hit.n = (hit.n || 1) + 1;
    hit.at = new Date().toISOString().slice(0, 10);
    return;
  }
  st.portalGaps.unshift({
    q: text,
    at: new Date().toISOString().slice(0, 10),
    n: 1,
    by: assistant?.name || '',
  });
  if (st.portalGaps.length > 30) st.portalGaps.length = 30;
}

/* 按助手的资料范围过滤检索结果。scope 为空 = 不限制 */
function filterByScope(hits, assistant, docs) {
  if (!assistant?.scope?.length) return hits;
  const byId = Object.fromEntries(docs.map((d) => [d.id, docCat(d)]));
  const byName = Object.fromEntries(docs.map((d) => [d.name, docCat(d)]));
  return hits.filter((h) => {
    const cat = byId[h.chunk.docId] || byName[h.chunk.doc];
    return assistant.scope.includes(cat);
  });
}

/* 只有明确指定了助手才用助手；不传 = 通用模式，查全部资料 */
function pickAssistant(st, assistantId) {
  if (!assistantId) return null;
  return (st.assistants || []).find((a) => a.id === assistantId && a.enabled !== false) || null;
}

/* ---------------- 上传 ---------------- */

function handleUpload(req, clientId) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_UPLOAD, files: 20 } });
    } catch (e) {
      return reject(new Error('上传格式不对'));
    }

    const dir = uploadDir(clientId);
    const added = [];
    const failed = [];
    let pending = 0;
    let ended = false;

    const maybeDone = () => {
      if (ended && pending === 0) resolve({ added, failed });
    };

    bb.on('file', (_field, stream, info) => {
      const original = Buffer.from(info.filename || 'file', 'latin1').toString('utf8');
      const ext = extOf(original);

      if (!isSupported(original)) {
        stream.resume();
        failed.push({ name: original, reason: `不支持的格式 .${ext || '未知'}（支持 ${SUPPORTED.join('/')}）` });
        return;
      }

      const id = 'd' + crypto.randomBytes(6).toString('hex');
      const saved = path.join(dir, `${id}.${ext}`);
      const ws = fs.createWriteStream(saved);
      let truncated = false;
      let size = 0;

      stream.on('data', (c) => { size += c.length; });
      stream.on('limit', () => { truncated = true; });

      pending++;
      ws.on('finish', async () => {
        try {
          if (truncated) {
            fs.unlinkSync(saved);
            failed.push({ name: original, reason: `超过 ${MAX_UPLOAD / 1024 / 1024}MB 上限` });
            return;
          }
          const buf = fs.readFileSync(saved);
          const parsed = await parseFile(buf, original);

          added.push({
            id,
            name: original,
            ext,
            size,
            sizeText: size > 1024 * 1024 ? (size / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(size / 1024)) + ' KB',
            pages: parsed.pages,
            chars: parsed.chars,
            scanned: !!parsed.scanned,
            empty: !!parsed.empty,
            ms: parsed.ms,
            textPath: saved,
            addedAt: new Date().toISOString(),
            status: parsed.empty ? 'empty' : 'ok',
          });
        } catch (e) {
          failed.push({ name: original, reason: '解析失败：' + e.message });
          try { fs.unlinkSync(saved); } catch { }
        } finally {
          pending--;
          maybeDone();
        }
      });

      stream.pipe(ws);
    });

    bb.on('error', reject);
    bb.on('close', () => { ended = true; maybeDone(); });
    req.pipe(bb);
  });
}

/* ---------------- 本地文件夹扫描 / 导入 ----------------
 * 本地服务读的是这台电脑真实的文件系统，不是模拟：
 * 扫描 → 解析 → 复制到客户 uploads/ → 写入 docs.json，和上传走的同一条链路。
 */

const SCAN_SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '.idea', '.vscode', '__pycache__',
  '$recycle.bin', 'system volume information', '.trash', '.venv', 'venv',
  'windows', 'program files', 'program files (x86)', 'programdata', 'appdata',
  'dist', 'build', '.cache', 'temp', 'tmp',
  /* 系统与开发工具目录：扫「整个电脑」时不该把这些当企业资料 */
  '$windows.~bt', '$windows.~ws', 'perflogs', 'recovery', 'msocache', 'config.msi',
  'scoop', '.workbuddy', 'workbuddy', 'anaconda3', 'miniconda3', 'conda-meta',
  'site-packages', 'node_modules_cache', '.npm', '.yarn', '.pnpm-store', '.gradle', '.m2',
  'crashpad', 'gpucache', 'code cache', 'extensions',
]);
const SCAN_MAX_FILES = 3000;   // 单次扫描上限，防止扫整个盘扫到卡死
const SCAN_MAX_DEPTH = 12;

function sizeText(n) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
  return n + ' B';
}

function normAbs(p) {
  return path.resolve(String(p || '').trim());
}

/* 多个路径：支持数组，或「分号/换行/逗号/顿号」分隔的字符串 */
function normalizeDirs(v) {
  const arr = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/[\n;；，、]+|,\s+/) : []);
  return [...new Set(arr.map((s) => String(s || '').trim()).filter(Boolean))];
}

/* ---------------- 把「人话」翻译成真实文件夹 ----------------
 * 用户可以直接说「扫描桌面」「扫描 D 盘的公司资料」「下载文件夹」，
 * 这里翻译成本机真实存在的绝对路径。全部基于真实文件系统探测，不是猜。
 */

const HOME_DIR = os.homedir();

/* 常见中文叫法 → 用户目录下的真实子目录（按顺序取第一个存在的） */
const DIR_ALIASES = [
  { keys: ['桌面', '电脑桌面'], subs: ['Desktop', '桌面'] },
  { keys: ['下载', '下载文件夹', '下载目录'], subs: ['Downloads', '下载'] },
  { keys: ['文档', '我的文档', '文档文件夹', '我的文件'], subs: ['Documents', '文档'] },
  { keys: ['图片', '照片', '相册'], subs: ['Pictures', '图片'] },
  { keys: ['视频'], subs: ['Videos', '视频'] },
  { keys: ['音乐'], subs: ['Music', '音乐'] },
  { keys: ['用户目录', '主目录', '个人目录', '家目录'], subs: [''] },
  { keys: ['微信文件', '微信文件夹', '微信接收文件'], subs: ['Documents/WeChat Files', 'Documents/xwechat_files', 'Desktop/WeChat Files'] },
];

function existsDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

/* 去掉礼貌语、动词、量词尾巴，把「扫描一下桌面这个文件夹」压成「桌面」 */
function cleanPhrase(s) {
  let t = String(s || '').trim().replace(/^[「『"'“”‘’《》]+|[」』"'“”‘’《》]+$/g, '').trim();
  t = t.replace(/^(请问|请|麻烦|帮我|帮忙|我想要|我要|我想|需要|能不能|可以|把|从|扫描一下|扫描下|扫描|扫一下|扫下|扫|添加|导入|读取|加载|收录|整理|加上|加入|看看|看下)+/g, '');
  t = t.replace(/(这个|那个|这些|那些)/g, '');
  t = t.replace(/(文件夹|资料夹|目录)$/g, '');
  return t.trim();
}

/* 去掉「的 / 上的 / 里的 / 中的 / 下面的」这类连接语
 * 注意：只在连接词后面确实跟着「的/里/中」时才剥，避免把「上海分公司」剥成「海分公司」 */
function stripLink(s) {
  let t = String(s || '').trim();
  for (let i = 0; i < 3; i++) {
    const before = t;
    t = t.replace(/^(?:的|之)\s*/, '');
    t = t.replace(/^(?:上面|上|里面|里边|里|中间|中|下面|下|内部|内)\s*(?:的|里|中)\s*/, '');
    t = t.replace(/^[\/\\]+/, '');
    if (t === before) break;
  }
  return t.trim();
}

function normName(s) {
  return String(s || '').toLowerCase().replace(/[\s_\-·.．（）()【】\[\]《》]+/g, '');
}

/* 名称匹配打分：完全一致 > 前缀 > 包含 > 被包含 */
function matchScore(name, query) {
  const n = normName(name), k = normName(query);
  if (n && k) {
    if (n === k) return 100;
    if (n.startsWith(k)) return 88;
    if (n.includes(k)) return 74;
    if (k.includes(n) && n.length >= 2) return 62;
  }
  // 多词（「公司 资料」）全部命中才算
  const parts = String(query).split(/[\s+＋]+/).map(normName).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => n.includes(p))) return 66;
  return 0;
}

function listSubDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SCAN_SKIP_DIRS.has(e.name.toLowerCase()))
      .map((e) => path.join(dir, e.name));
  } catch { return []; }
}

function listDrives() {
  if (process.platform !== 'win32') return ['/'];
  const out = [];
  for (let c = 67; c <= 90; c++) { // C: - Z:
    const root = String.fromCharCode(c) + ':\\';
    if (existsDir(root)) out.push(root);
  }
  return out;
}

/* 在给定根目录下浅层（默认 2 层）按名字找文件夹 */
function fuzzyFindDir(query, { roots = null, depth = 2, budgetMs = 2500, limit = 6 } = {}) {
  const deadline = Date.now() + budgetMs;
  const scopes = roots && roots.length ? roots : [
    path.join(HOME_DIR, 'Desktop'),
    path.join(HOME_DIR, 'Documents'),
    path.join(HOME_DIR, 'Downloads'),
    HOME_DIR,
    ...listDrives(),
  ];
  const hits = [];
  const seen = new Set();
  const queue = scopes.map((d) => ({ dir: d, level: 0 }));
  while (queue.length && Date.now() < deadline) {
    const { dir, level } = queue.shift();
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    for (const full of listSubDirs(dir)) {
      if (Date.now() > deadline) break;
      const score = matchScore(path.basename(full), query);
      if (score) hits.push({ path: full, name: path.basename(full), score, parent: dir });
      if (level + 1 < depth) queue.push({ dir: full, level: level + 1 });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  return hits.slice(0, limit);
}

/* 单个短语 → { path, how, label } 或 { path:null, what, candidates } */
async function resolveDirPhrase(raw) {
  const original = String(raw || '').trim();
  if (!original) return { raw: original, path: null, what: '空输入' };

  /* 1) 本身就是一个真实存在的路径 */
  const abs = normAbs(original);
  if (existsDir(abs)) {
    return { raw: original, path: abs, how: 'path', label: path.basename(abs) || abs };
  }

  const t = cleanPhrase(original);
  if (!t) return { raw: original, path: null, what: '没说要扫哪里' };

  /* 2) 整台电脑 / 所有盘 */
  if (/^(整个?电脑|全盘|所有盘|每个盘|各个盘|所有硬盘)$/.test(t)) {
    const drives = listDrives();
    if (drives.length) return { raw: original, path: drives, how: 'all-drives', label: '所有磁盘', wholeDrive: true };
  }

  /* 3) 盘符：D盘 / D: / D盘的公司资料 / D 盘 报价单 */
  const dm = t.match(/^([a-zA-Z])\s*(?:盘|:|：)\s*(.*)$/);
  if (dm) {
    const letter = dm[1].toUpperCase();
    const root = letter + ':\\';
    const rest = stripLink(dm[2]).replace(/[\/\\]+$/, '');
    if (!existsDir(root)) {
      return { raw: original, path: null, what: `这台电脑上没有 ${letter} 盘` };
    }
    if (!rest) {
      return { raw: original, path: root, how: 'drive-root', label: `${letter} 盘`, wholeDrive: true };
    }
    const direct = path.join(root, rest);
    if (existsDir(direct)) {
      return { raw: original, path: direct, how: 'drive', label: rest };
    }
    const hits = fuzzyFindDir(rest, { roots: [root], depth: 2 });
    if (hits.length) {
      return { raw: original, path: hits[0].path, how: 'fuzzy', label: hits[0].name, candidates: hits };
    }
    return { raw: original, path: null, what: `${letter} 盘里没找到「${rest}」`, candidates: listSubDirs(root).slice(0, 8).map((p) => ({ path: p, name: path.basename(p), score: 0 })) };
  }

  /* 4) 常见别名：桌面 / 下载 / 文档 …（可带子路径，如「桌面上的报价资料」） */
  for (const alias of DIR_ALIASES) {
    for (const key of alias.keys) {
      if (t !== key && !t.startsWith(key)) continue;
      let base = null;
      for (const sub of alias.subs) {
        const cand = sub ? path.join(HOME_DIR, sub) : HOME_DIR;
        if (existsDir(cand)) { base = cand; break; }
      }
      if (!base) continue;
      const rest = stripLink(t.slice(key.length)).replace(/[\/\\]+$/, '');
      if (!rest) return { raw: original, path: base, how: 'alias', label: key };
      const direct = path.join(base, rest);
      if (existsDir(direct)) return { raw: original, path: direct, how: 'alias', label: rest };
      const hits = fuzzyFindDir(rest, { roots: [base], depth: 3 });
      if (hits.length) return { raw: original, path: hits[0].path, how: 'fuzzy', label: hits[0].name, candidates: hits };
      return { raw: original, path: null, what: `${key}里没找到「${rest}」`, candidates: listSubDirs(base).slice(0, 8).map((p) => ({ path: p, name: path.basename(p), score: 0 })) };
    }
  }

  /* 5) 直接给一个文件夹名：在桌面/文档/下载/用户目录/各盘浅层里找 */
  const hits = fuzzyFindDir(t, { depth: 3 });
  if (hits.length) {
    return { raw: original, path: hits[0].path, how: 'fuzzy', label: hits[0].name, candidates: hits };
  }

  return { raw: original, path: null, what: `没找到「${t}」这个文件夹`, candidates: [] };
}

/* 批量解析；失败时再尝试按「和 / 以及 / 还有」拆开，支持「桌面和下载文件夹」 */
async function resolveDirInputs(v) {
  const raws = normalizeDirs(v);
  const items = [];
  const unmatched = [];
  const candidates = [];

  const push = (res) => {
    if (res.path) {
      const list = Array.isArray(res.path) ? res.path : [res.path];
      list.forEach((p, i) => items.push({
        raw: res.raw, path: p,
        label: list.length > 1 ? `${res.label}${i + 1}` : res.label,
        how: res.how, wholeDrive: !!res.wholeDrive,
      }));
    } else {
      unmatched.push({ raw: res.raw, reason: res.what || '没找到这个文件夹' });
      (res.candidates || []).forEach((c) => candidates.push(c));
    }
  };

  for (const raw of raws) {
    let res = await resolveDirPhrase(raw);
    if (!res.path && /[和及与]|还有|以及/.test(raw)) {
      const parts = raw.split(/(?:以及|还有|和|及|与)/).map((s) => s.trim()).filter(Boolean);
      if (parts.length > 1) {
        const sub = await resolveDirInputs(parts);
        sub.items.forEach((it) => items.push(it));
        sub.unmatched.forEach((u) => unmatched.push(u));
        sub.candidates.forEach((c) => candidates.push(c));
        res = null;
      }
    }
    if (res) push(res);
  }

  /* 去重（同一路径只保留一次） */
  const seen = new Set();
  const uniq = items.filter((it) => (seen.has(it.path) ? false : (seen.add(it.path), true)));
  return { items: uniq, unmatched, candidates: candidates.slice(0, 8) };
}

/* 递归遍历一个文件夹，只收受支持的文档类型 */
async function walkDir(root, { recursive = true, maxFiles = SCAN_MAX_FILES, maxDepth = SCAN_MAX_DEPTH } = {}) {
  const out = [];
  let truncated = false;
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    if (out.length >= maxFiles) { truncated = true; break; }
    const { dir, depth } = stack.pop();
    let ents;
    try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const ent of ents) {
      if (out.length >= maxFiles) { truncated = true; break; }
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!recursive || depth >= maxDepth) continue;
        if (ent.name.startsWith('.') || SCAN_SKIP_DIRS.has(ent.name.toLowerCase())) continue;
        stack.push({ dir: full, depth: depth + 1 });
      } else if (ent.isFile()) {
        if (ent.name.startsWith('.') || !isSupported(ent.name)) continue;
        let stt;
        try { stt = await fs.promises.stat(full); } catch { continue; }
        out.push({ path: full, name: ent.name, ext: extOf(ent.name), size: stt.size, sizeText: sizeText(stt.size), mtimeMs: stt.mtimeMs, dir });
      }
    }
  }
  return { files: out, truncated };
}

/* 把磁盘上的一个文件读进来：解析 → 复制到 uploads → 生成 doc 记录 */
async function ingestPath(absPath, clientId, sourceDir) {
  const buf = fs.readFileSync(absPath);
  if (buf.length > MAX_UPLOAD) {
    const e = new Error(`超过 ${MAX_UPLOAD / 1024 / 1024}MB 上限`);
    throw e;
  }
  const name = path.basename(absPath);
  const ext = extOf(name);
  const parsed = await parseFile(buf, name);
  const id = 'd' + crypto.randomBytes(6).toString('hex');
  const saved = path.join(uploadDir(clientId), `${id}.${ext}`);
  fs.writeFileSync(saved, buf);
  const stt = fs.statSync(absPath);
  return {
    id, name, ext, size: buf.length, sizeText: sizeText(buf.length),
    pages: parsed.pages, chars: parsed.chars, scanned: !!parsed.scanned,
    empty: !!parsed.empty, ms: parsed.ms, textPath: saved,
    sourcePath: absPath, sourceDir: sourceDir || path.dirname(absPath),
    mtimeMs: stt.mtimeMs,
    addedAt: new Date().toISOString(),
    status: parsed.empty ? 'empty' : 'ok',
  };
}

/* 批量导入：按 sourcePath 去重，内容变了就替换，没变就跳过 */
async function importEntries(clientId, entries) {
  const docs = getDocs(clientId);
  const bySource = new Map(docs.filter((d) => d.sourcePath).map((d) => [d.sourcePath, d]));
  const added = [];
  const updated = [];
  const skipped = [];
  const failed = [];

  for (const ent of entries) {
    const abs = normAbs(ent.path);
    const prev = bySource.get(abs);
    try {
      const stt = fs.statSync(abs);
      if (prev) {
        if (prev.mtimeMs && Math.abs(prev.mtimeMs - stt.mtimeMs) < 1 && prev.size === stt.size) {
          skipped.push({ name: path.basename(abs), reason: '未变化' });
          continue;
        }
        const rec = await ingestPath(abs, clientId, ent.dir);
        const i = docs.findIndex((d) => d.id === prev.id);
        try { fs.unlinkSync(prev.textPath); } catch { }
        const merged = { ...rec, id: prev.id, cat: prev.cat, addedAt: prev.addedAt || rec.addedAt };
        if (i >= 0) docs[i] = merged; else docs.push(merged);
        bySource.set(abs, merged);
        updated.push({ name: rec.name });
      } else {
        const rec = await ingestPath(abs, clientId, ent.dir);
        docs.push(rec);
        bySource.set(abs, rec);
        added.push({ id: rec.id, name: rec.name, chars: rec.chars });
      }
    } catch (e) {
      failed.push({ name: path.basename(abs), reason: e.message });
    }
  }

  saveDocs(clientId, docs);
  return { added, updated, skipped, failed, total: docs.length };
}

/* 按文件夹路径统计已导入的份数 */
function countImportedIn(docs, folderPath) {
  const base = folderPath.endsWith(path.sep) ? folderPath : folderPath + path.sep;
  return docs.filter((d) => d.sourcePath && (d.sourcePath === folderPath || d.sourcePath.startsWith(base))).length;
}

/* 建库：把所有可用资料切片并建倒排索引。导入新资料后复用它自动重建。 */
async function buildKbForClient(id) {
  const docs = getDocs(id).filter((d) => d.status === 'ok');
  if (!docs.length) {
    const e = new Error('还没有可用的资料，先上传再建库');
    e.status = 400;
    throw e;
  }
  const started = Date.now();
  const chunks = [];
  const perDoc = [];
  for (const d of docs) {
    const buf = fs.readFileSync(d.textPath);
    const parsed = await parseFile(buf, d.name);
    const cs = chunkDoc(parsed);
    cs.forEach((c) => chunks.push({ ...c, doc: d.name, docId: d.id }));
    perDoc.push({ id: d.id, name: d.name, chunks: cs.length, pages: parsed.pages });
  }
  const index = buildIndex(chunks);
  saveIndex(id, { chunks, index: { ...index, postings: index.postings }, builtAt: new Date().toISOString() });

  const st = ensureState(id);
  st.kb = {
    chunks: chunks.length,
    docs: docs.length,
    terms: Object.keys(index.postings).length,
    builtAt: new Date().toISOString(),
    perDoc,
  };
  st.activity = st.activity || [];
  st.activity.unshift({
    t: new Date().toISOString().slice(5, 16).replace('T', ' '),
    txt: `知识库构建完成，生成 ${chunks.length} 个切片`,
    who: '系统',
  });
  saveState(id, st);

  return { chunks: chunks.length, docs: docs.length, terms: Object.keys(index.postings).length, perDoc, ms: Date.now() - started };
}

/* ---------------- 路由 ---------------- */

async function route(req, res, url) {
  const p = url.pathname;
  const method = req.method;
  let m;   // 路由正则捕获，平台段和客户段共用

  /* --- 基础 --- */
  if (p === '/api/health' && method === 'GET') {
    const l = platformLLM();
    return sendJSON(res, 200, {
      ok: true, service: 'maozhiku-local', node: process.version, port: PORT,
      llm: l ? { ready: true, provider: l.provider, model: l.model } : { ready: false },
    });
  }

  if (p === '/api/env' && method === 'GET') {
    const env = await probeEnvironment();
    return sendJSON(res, 200, env);
  }

  if (p === '/api/providers' && method === 'GET') {
    return sendJSON(res, 200, LLM.PROVIDERS);
  }

  /* --- 服务商后台：账号 / 团队人员 / 工单 ---
   * 浏览器永远拿不到密码明文：登录在服务端比对，profile 只返回展示字段。 */
  if (p === '/api/platform/profile' && method === 'GET') {
    const plat = getPlatform();
    return sendJSON(res, 200, {
      account: { email: plat.account.email, name: plat.account.name, role: plat.account.role },
      staffCount: plat.staff.length,
    });
  }

  if (p === '/api/admin/login' && method === 'POST') {
    const b = await readJSONBody(req);
    const plat = getPlatform();
    const ok = String(b.email || '').trim().toLowerCase() === String(plat.account.email).toLowerCase()
      && String(b.pwd || '') === String(plat.account.pwd);
    if (!ok) return sendJSON(res, 401, { ok: false, error: '账号或密码不对' });
    return sendJSON(res, 200, {
      ok: true,
      account: { email: plat.account.email, name: plat.account.name, role: plat.account.role },
    });
  }

  if (p === '/api/platform/profile' && (method === 'PATCH' || method === 'POST')) {
    const b = await readJSONBody(req);
    const plat = getPlatform();
    const a = { ...plat.account };
    if (b.name !== undefined) a.name = String(b.name).trim().slice(0, 30) || '管理员';
    if (b.role !== undefined) a.role = String(b.role).trim().slice(0, 30) || '服务商管理员';
    if (b.email !== undefined) {
      const e = String(b.email).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return sendJSON(res, 400, { error: '邮箱格式不对' });
      a.email = e;
    }
    if (b.pwd !== undefined && String(b.pwd).trim()) {
      const pw = String(b.pwd);
      if (pw.length < 6) return sendJSON(res, 400, { error: '密码至少 6 位' });
      a.pwd = pw;
    }
    plat.account = a;
    savePlatform(plat);
    return sendJSON(res, 200, { ok: true, account: { email: a.email, name: a.name, role: a.role } });
  }

  if (p === '/api/staff' && method === 'GET') {
    return sendJSON(res, 200, { staff: getPlatform().staff });
  }

  if (p === '/api/staff' && method === 'POST') {
    const b = await readJSONBody(req);
    const name = String(b.name || '').trim();
    if (!name) return sendJSON(res, 400, { error: '姓名必填' });
    const plat = getPlatform();
    if (plat.staff.some((s) => s.name === name)) {
      return sendJSON(res, 400, { error: '已经有同名人员了' });
    }
    const s = {
      id: 's_' + crypto.randomBytes(4).toString('hex'),
      name,
      role: String(b.role || '服务顾问').trim(),
      title: String(b.title || '').trim(),
      phone: String(b.phone || '').trim(),
      email: String(b.email || '').trim(),
      enabled: b.enabled !== false,
      createdAt: new Date().toISOString(),
    };
    plat.staff.push(s);
    savePlatform(plat);
    return sendJSON(res, 200, { staff: s });
  }

  if ((m = p.match(/^\/api\/staff\/([\w]+)$/)) && (method === 'PATCH' || method === 'DELETE')) {
    const plat = getPlatform();
    const i = plat.staff.findIndex((s) => s.id === m[1]);
    if (i < 0) return sendJSON(res, 404, { error: '人员不存在' });
    if (method === 'DELETE') {
      const removed = plat.staff.splice(i, 1)[0];
      savePlatform(plat);
      return sendJSON(res, 200, { ok: true, removed: removed.name });
    }
    const b = await readJSONBody(req);
    const cur = plat.staff[i];
    const next = {
      ...cur,
      name: b.name !== undefined ? String(b.name).trim() : cur.name,
      role: b.role !== undefined ? String(b.role).trim() : cur.role,
      title: b.title !== undefined ? String(b.title).trim() : cur.title,
      phone: b.phone !== undefined ? String(b.phone).trim() : cur.phone,
      email: b.email !== undefined ? String(b.email).trim() : cur.email,
      enabled: b.enabled !== undefined ? !!b.enabled : cur.enabled,
    };
    if (!next.name) return sendJSON(res, 400, { error: '姓名不能为空' });
    plat.staff[i] = next;
    savePlatform(plat);
    return sendJSON(res, 200, { staff: next });
  }

  if (p === '/api/tickets' && method === 'GET') {
    return sendJSON(res, 200, { tickets: getTickets() });
  }

  if (p === '/api/tickets' && method === 'POST') {
    const b = await readJSONBody(req);
    const title = String(b.title || '').trim();
    if (!title) return sendJSON(res, 400, { error: '请写一下遇到的问题' });
    const c = b.clientId ? getClient(b.clientId) : null;
    const t = {
      id: 't_' + crypto.randomBytes(4).toString('hex'),
      clientId: b.clientId || '',
      org: c?.org || String(b.org || '未指定企业').trim(),
      type: String(b.type || 'assist').trim(),
      title,
      detail: String(b.detail || '').trim(),
      contact: String(b.contact || '').trim(),
      status: 'open',
      reply: '',
      handler: '',
      createdAt: new Date().toISOString(),
      doneAt: '',
    };
    const all = getTickets();
    all.unshift(t);
    saveTickets(all);
    return sendJSON(res, 200, { ticket: t });
  }

  if ((m = p.match(/^\/api\/tickets\/([\w]+)$/)) && (method === 'PATCH' || method === 'DELETE')) {
    const all = getTickets();
    const i = all.findIndex((t) => t.id === m[1]);
    if (i < 0) return sendJSON(res, 404, { error: '工单不存在' });
    if (method === 'DELETE') {
      all.splice(i, 1);
      saveTickets(all);
      return sendJSON(res, 200, { ok: true });
    }
    const b = await readJSONBody(req);
    const cur = all[i];
    const status = b.status === 'done' ? 'done' : b.status === 'open' ? 'open' : cur.status;
    all[i] = {
      ...cur,
      status,
      reply: b.reply !== undefined ? String(b.reply).trim() : cur.reply,
      handler: b.handler !== undefined ? String(b.handler).trim() : cur.handler,
      doneAt: status === 'done' ? (cur.doneAt || new Date().toISOString()) : '',
    };
    saveTickets(all);
    return sendJSON(res, 200, { ticket: all[i] });
  }

  /* --- 客户 --- */
  if (p === '/api/clients' && method === 'GET') {
    // 列表要带上真实进度，否则后台永远显示「待启动 0%」，客户做完了也看不出来
    const clients = listClients().map((c) => {
      const st = getState(c.id);
      const steps = st?.project?.steps || {};
      const done = Object.values(steps).filter((s) => s && s.done).length;
      const total = 10;
      const pct = Math.round((done / total) * 100);
      const hasReport = !!st?.project?.report;
      const stage = pct >= 100 ? '维护期' : hasReport ? '验收中' : pct > 0 ? '实施中' : '待启动';
      return {
        ...c,
        pct,
        doneSteps: done,
        totalSteps: total,
        stage,
        docs: getDocs(c.id).length,
        asks: st?.portalAsks || 0,
        feedback: (st?.feedback || []).length,
      };
    });
    return sendJSON(res, 200, { clients });
  }

  if (p === '/api/clients' && method === 'POST') {
    const b = await readJSONBody(req);
    if (!b.org || !b.org.trim()) return sendJSON(res, 400, { error: '企业名称必填' });

    const pid = nextProjectNo();
    const client = {
      id: 'c_' + crypto.randomBytes(4).toString('hex'),
      pid,
      org: b.org.trim(),
      contact: (b.contact || '').trim(),
      email: (b.email || '').trim(),
      phone: (b.phone || '').trim(),
      industry: (b.industry || '').trim(),
      size: b.size || '11–50 人',
      city: (b.city || '').trim(),
      svc: b.svc || '企业 AI 知识库建设',
      stage: '待启动',
      pct: 0,
      owner: (b.owner || '').trim(),   // 不填就是「未指派」，不编个人名出来
      amount: (b.amount || '').trim(),
      due: (b.due || '').trim(),
      note: (b.note || '').trim(),
      createdAt: new Date().toISOString().slice(0, 10),
    };
    saveClient(client);
    saveState(client.id, defaultState(client));
    saveDocs(client.id, []);
    return sendJSON(res, 200, { client });
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)$/)) && method === 'GET') {
    const c = requireClient(m[1]);
    return sendJSON(res, 200, { client: c, state: ensureState(c.id) });
  }

  /* 编辑客户档案：后台「编辑客户」用，别让金额/负责人只能看不能改 */
  if ((m = p.match(/^\/api\/clients\/([\w]+)$/)) && (method === 'PATCH' || method === 'POST')) {
    const c = requireClient(m[1]);
    const b = await readJSONBody(req);
    const next = { ...c };
    for (const k of ['org', 'contact', 'email', 'phone', 'industry', 'size', 'city', 'svc', 'owner', 'amount', 'due', 'note']) {
      if (b[k] !== undefined) next[k] = String(b[k]).trim();
    }
    if (!next.org) return sendJSON(res, 400, { error: '企业名称不能为空' });
    saveClient(next);
    // 企业名/联系人也要同步到工作区，不然侧栏还显示旧名字
    const st = getState(m[1]);
    if (st?.org) {
      st.org.name = next.org;
      st.org.short = next.org.slice(0, 8);
      st.org.contact = next.contact;
      st.org.industry = next.industry;
      st.org.city = next.city;
      st.org.size = next.size;
      saveState(m[1], st);
    }
    return sendJSON(res, 200, { client: next });
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)$/)) && method === 'DELETE') {
    deleteClient(m[1]);
    return sendJSON(res, 200, { ok: true });
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)\/state$/)) && method === 'GET') {
    requireClient(m[1]);
    return sendJSON(res, 200, { state: ensureState(m[1]) });
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)\/state$/)) && (method === 'PATCH' || method === 'POST')) {
    requireClient(m[1]);
    const patch = await readJSONBody(req);
    const st = patchState(m[1], patch);
    return sendJSON(res, 200, { state: st });
  }

  /* --- 客户成员：后台和客户端共用同一份，改完立刻落盘 --- */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/members$/)) && method === 'GET') {
    requireClient(m[1]);
    return sendJSON(res, 200, { members: listMembers(m[1]) });
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)\/members$/)) && method === 'POST') {
    const id = m[1];
    requireClient(id);
    const b = await readJSONBody(req);
    const name = String(b.name || '').trim();
    if (!name) return sendJSON(res, 400, { error: '姓名必填' });
    const email = String(b.email || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendJSON(res, 400, { error: '邮箱格式不对，或者留空' });
    }
    if (listMembers(id).some((x) => x.email && email && x.email.toLowerCase() === email.toLowerCase())) {
      return sendJSON(res, 400, { error: '这个邮箱已经在成员列表里了' });
    }
    const member = {
      id: 'm_' + crypto.randomBytes(4).toString('hex'),
      name,
      role: String(b.role || '销售员工').trim(),
      email,
      phone: String(b.phone || '').trim(),
      status: b.status === 'limited' ? 'limited' : 'active',
      at: new Date().toISOString().slice(0, 10),
    };
    addMember(id, member);
    return sendJSON(res, 200, { member });
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)\/members\/([\w]+)$/)) && (method === 'PATCH' || method === 'DELETE')) {
    const id = m[1];
    requireClient(id);
    if (method === 'DELETE') {
      const ok = removeMember(id, m[2]);
      return sendJSON(res, ok ? 200 : 404, ok ? { ok: true } : { error: '成员不存在' });
    }
    const b = await readJSONBody(req);
    const patch = {};
    for (const k of ['name', 'role', 'email', 'phone', 'status']) {
      if (b[k] !== undefined) patch[k] = String(b[k]).trim();
    }
    if (patch.name === '') return sendJSON(res, 400, { error: '姓名不能为空' });
    if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) {
      return sendJSON(res, 400, { error: '邮箱格式不对，或者留空' });
    }
    const member = updateMember(id, m[2], patch);
    return sendJSON(res, member ? 200 : 404, member ? { member } : { error: '成员不存在' });
  }

  /* --- 资料 --- */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/docs$/)) && method === 'GET') {
    requireClient(m[1]);
    const docs = getDocs(m[1]).map((d) => ({ ...d, cat: docCat(d), textPath: undefined }));
    return sendJSON(res, 200, { docs });
  }

  /* 改资料分类：分类直接决定哪些助手能查到它，得让人能纠正 */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/docs\/([\w]+)$/)) && method === 'PATCH') {
    const id = m[1];
    requireClient(id);
    const b = await readJSONBody(req);
    const docs = getDocs(id);
    const d = docs.find((x) => x.id === m[2]);
    if (!d) return sendJSON(res, 404, { error: '资料不存在' });
    d.cat = String(b.cat || '').trim() || docCat(d);
    saveDocs(id, docs);
    return sendJSON(res, 200, { ok: true, docs: docs.map((x) => ({ ...x, cat: docCat(x), textPath: undefined })) });
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)\/docs$/)) && method === 'POST') {
    const id = m[1];
    requireClient(id);
    const result = await handleUpload(req, id);
    let docs = getDocs(id);

    // 同名文件覆盖：企业重复上传同一份资料是常态，不该在列表里堆两份
    const replaced = [];
    for (const d of result.added) {
      const oldDoc = docs.find((x) => x.name === d.name);
      if (oldDoc) {
        try { fs.unlinkSync(oldDoc.textPath); } catch { }
        docs = docs.filter((x) => x.name !== d.name);
        replaced.push(d.name);
      }
      docs.push(d);
    }
    saveDocs(id, docs);
    return sendJSON(res, 200, {
      added: result.added.map((d) => ({ ...d, textPath: undefined })),
      failed: result.failed,
      replaced,
      total: docs.length,
    });
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)\/docs\/([\w]+)$/)) && method === 'DELETE') {
    const id = m[1];
    const docId = m[2];
    const docs = getDocs(id);
    const d = docs.find((x) => x.id === docId);
    if (d) {
      try { fs.unlinkSync(d.textPath); } catch { }
    }
    saveDocs(id, docs.filter((x) => x.id !== docId));
    return sendJSON(res, 200, { ok: true });
  }

  /* --- 本地文件夹扫描 / 导入 --- */

  /* 把「人话」翻译成真实路径，只探测不读写：前端用来回显「桌面 → C:\Users\xx\Desktop」 */
  if (p === '/api/fs/resolve' && method === 'POST') {
    const b = await readJSONBody(req);
    const r = await resolveDirInputs(b.q !== undefined ? b.q : b.dirs);
    return sendJSON(res, 200, {
      ...r,
      home: HOME_DIR,
      drives: listDrives(),
      shortcuts: ['桌面', '下载', '文档', 'D盘', '整个电脑'],
    });
  }

  /* 只扫描、不导入：先让用户看清楚发现了哪些文件 */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/scan$/)) && method === 'POST') {
    const id = m[1];
    requireClient(id);
    const b = await readJSONBody(req);
    const { items, unmatched } = await resolveDirInputs(b.dirs);
    if (!items.length) {
      return sendJSON(res, 400, {
        error: unmatched.length ? `没找到要扫描的文件夹：${unmatched.map((u) => u.raw).join('、')}` : '请提供要扫描的文件夹路径',
        unmatched,
      });
    }
    const recursive = b.recursive !== false;

    const docs = getDocs(id);
    const importedSet = new Set(docs.filter((d) => d.sourcePath).map((d) => d.sourcePath));
    let all = [];
    let truncated = false;

    for (const it of items) {
      const abs = it.path;
      if (!existsDir(abs)) continue;
      const r = await walkDir(abs, { recursive });
      truncated = truncated || r.truncated;
      all = all.concat(r.files);
    }

    return sendJSON(res, 200, {
      files: all.map((f) => ({ ...f, imported: importedSet.has(f.path), dirName: path.basename(f.dir) })),
      total: all.length,
      truncated,
      badDirs: unmatched.map((u) => u.raw),
      unmatched,
      resolved: items.map((it) => ({ raw: it.raw, path: it.path, label: it.label, how: it.how, wholeDrive: it.wholeDrive })),
    });
  }

  /* 导入：显式给文件路径，或给文件夹路径（先扫再导） */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/import$/)) && method === 'POST') {
    const id = m[1];
    requireClient(id);
    const b = await readJSONBody(req);

    let entries = [];
    const badDirs = [];
    if (Array.isArray(b.paths) && b.paths.length) {
      entries = b.paths
        .map((x) => normAbs(x))
        .filter((abs) => { try { return isSupported(abs) && fs.statSync(abs).isFile(); } catch { return false; } })
        .map((abs) => ({ path: abs, dir: path.dirname(abs) }));
    } else {
      const { items, unmatched } = await resolveDirInputs(b.dirs);
      unmatched.forEach((u) => badDirs.push(u.raw));
      for (const it of items) {
        const abs = it.path;
        if (!existsDir(abs)) continue;
        const r = await walkDir(abs, { recursive: b.recursive !== false });
        entries = entries.concat(r.files.map((f) => ({ path: f.path, dir: abs })));
      }
    }

    const result = await importEntries(id, entries);
    const changed = result.added.length || result.updated.length;
    if (changed) {
      const st = ensureState(id);
      st.activity = st.activity || [];
      st.activity.unshift({
        t: new Date().toISOString().slice(5, 16).replace('T', ' '),
        txt: `从本地文件夹导入 ${result.added.length} 份${result.updated.length ? `、更新 ${result.updated.length} 份` : ''}资料`,
        who: '系统',
      });
      saveState(id, st);
    }
    // 已经建过库的客户，导入新资料后自动重建，助手立刻能查到
    let rebuilt = null;
    if (changed && (getState(id)?.kb?.chunks || 0) > 0) {
      try { rebuilt = await buildKbForClient(id); } catch (e) { rebuilt = { error: e.message }; }
    }
    return sendJSON(res, 200, { ...result, rebuilt, badDirs });
  }

  /* 已纳入的文件夹列表 */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/folders$/)) && method === 'GET') {
    const id = m[1];
    requireClient(id);
    return sendJSON(res, 200, { folders: getFolders(id) });
  }

  /* 添加文件夹（注册到客户名下，随后由前端触发 rescan 导入） */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/folders$/)) && method === 'POST') {
    const id = m[1];
    requireClient(id);
    const b = await readJSONBody(req);
    const { items, unmatched } = await resolveDirInputs(b.dirs);
    if (!items.length) {
      return sendJSON(res, 400, {
        error: unmatched.length ? `没找到要扫描的文件夹：${unmatched.map((u) => u.raw).join('、')}` : '请提供文件夹路径',
        unmatched,
      });
    }

    const folders = getFolders(id);
    const added = [];
    const badDirs = [];
    for (const it of items) {
      const abs = it.path;
      if (!existsDir(abs)) { badDirs.push(it.raw); continue; }
      if (folders.some((f) => f.path === abs)) continue;
      folders.push({
        path: abs, label: it.label || path.basename(abs) || abs,
        addedAt: new Date().toISOString(), lastScanAt: null,
        imported: 0, count: 0, recursive: b.recursive !== false,
      });
      added.push(abs);
    }
    saveFolders(id, folders);
    return sendJSON(res, 200, {
      folders, added,
      badDirs: badDirs.concat(unmatched.map((u) => u.raw)),
      unmatched,
      resolved: items.map((it) => ({ raw: it.raw, path: it.path, label: it.label, how: it.how, wholeDrive: it.wholeDrive })),
    });
  }

  /* 移除文件夹（只取消自动扫描，已导入的资料仍在） */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/folders\/remove$/)) && method === 'POST') {
    const id = m[1];
    requireClient(id);
    const b = await readJSONBody(req);
    const abs = normAbs(b.dir);
    const folders = getFolders(id).filter((f) => f.path !== abs);
    saveFolders(id, folders);
    return sendJSON(res, 200, { folders });
  }

  /* 重新扫描全部文件夹：只导入新增或内容有变化的文件，用于随时扩充/更新知识库 */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/folders\/rescan$/)) && method === 'POST') {
    const id = m[1];
    requireClient(id);
    const folders = getFolders(id);
    if (!folders.length) return sendJSON(res, 400, { error: '还没有添加文件夹' });

    let entries = [];
    let truncated = false;
    for (const f of folders) {
      const r = await walkDir(f.path, { recursive: f.recursive !== false });
      truncated = truncated || r.truncated;
      entries = entries.concat(r.files.map((x) => ({ path: x.path, dir: f.path })));
      f.count = r.files.length;
      f.lastScanAt = new Date().toISOString();
    }

    const result = await importEntries(id, entries);
    const docs = getDocs(id);
    for (const f of folders) f.imported = countImportedIn(docs, f.path);
    saveFolders(id, folders);

    const changed = result.added.length || result.updated.length;
    if (changed) {
      const st = ensureState(id);
      st.activity = st.activity || [];
      st.activity.unshift({
        t: new Date().toISOString().slice(5, 16).replace('T', ' '),
        txt: `重新扫描文件夹，新增 ${result.added.length} 份、更新 ${result.updated.length} 份资料`,
        who: '系统',
      });
      saveState(id, st);
    }

    // 已建过库的客户：重扫后自动重建索引，新资料立即进入知识库
    let rebuilt = null;
    if (changed && (getState(id)?.kb?.chunks || 0) > 0) {
      try { rebuilt = await buildKbForClient(id); } catch (e) { rebuilt = { error: e.message }; }
    }

    return sendJSON(res, 200, { ...result, folders, truncated, rebuilt });
  }

  /* --- 知识库 --- */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/kb\/build$/)) && method === 'POST') {
    const id = m[1];
    requireClient(id);
    try {
      const r = await buildKbForClient(id);
      return sendJSON(res, 200, { ok: true, ...r });
    } catch (e) {
      return sendJSON(res, e.status || 500, { error: e.message });
    }
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)\/kb\/stats$/)) && method === 'GET') {
    const id = m[1];
    requireClient(id);
    const idx = getIndex(id);
    const st = ensureState(id);
    return sendJSON(res, 200, {
      built: !!idx,
      chunks: idx?.chunks?.length || 0,
      terms: idx ? Object.keys(idx.index.postings).length : 0,
      builtAt: idx?.builtAt || null,
      kb: st.kb || null,
    });
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)\/kb\/search$/)) && method === 'POST') {
    const id = m[1];
    requireClient(id);
    const b = await readJSONBody(req);
    const idx = getIndex(id);
    if (!idx) return sendJSON(res, 400, { error: '知识库尚未构建' });
    const hits = search(idx.index, idx.chunks, b.q || '', b.topK || 6);
    return sendJSON(res, 200, {
      hits: hits.map((h) => ({
        score: h.score,
        rel: h.rel,
        doc: h.chunk.doc,
        page: h.chunk.page,
        text: h.chunk.text,
      })),
    });
  }

  /* --- 平台默认模型配置（可选；不会自动补贴客户，仅供管理员自检连通性） --- */
  if (p === '/api/platform/llm' && method === 'GET') {
    const l = platformLLM();
    return sendJSON(res, 200, l
      ? { available: true, provider: l.provider, baseURL: l.baseURL, model: l.model, keyMasked: maskKey(l.apiKey) }
      : { available: false });
  }

  if (p === '/api/platform/llm' && method === 'POST') {
    const b = await readJSONBody(req);
    const cur = platformLLM() || {};
    const cfg = {
      provider: b.provider || cur.provider || 'deepseek',
      baseURL: (b.baseURL || cur.baseURL || 'https://api.deepseek.com').replace(/\/+$/, ''),
      model: b.model || cur.model || 'deepseek-chat',
      apiKey: (b.apiKey || '').trim() || cur.apiKey || '',
    };
    if (!cfg.apiKey) return sendJSON(res, 400, { ok: false, error: '请填入 API Key' });

    let test;
    try {
      test = await LLM.testConnection(cfg);
    } catch (e) {
      return sendJSON(res, 200, { ok: false, error: e.message, code: e.code || 'ERROR' });
    }

    const c = getConfig();
    c.llm = cfg;
    saveConfig(c);
    return sendJSON(res, 200, {
      ok: true,
      test,
      config: { provider: cfg.provider, baseURL: cfg.baseURL, model: cfg.model, keyMasked: maskKey(cfg.apiKey) },
    });
  }

  /* --- AI 助手：第 6 步创建，第 7/8 步真正参与回答 --- */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/assistants$/)) && method === 'GET') {
    const st = ensureState(m[1]);
    return sendJSON(res, 200, { assistants: st.assistants || [] });
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)\/assistants$/)) && method === 'POST') {
    const id = m[1];
    requireClient(id);
    const b = await readJSONBody(req);
    const st = ensureState(id);
    st.assistants = st.assistants || [];

    const now = new Date().toISOString();
    const a = {
      id: b.id || 'a_' + crypto.randomBytes(3).toString('hex'),
      name: (b.name || '').trim() || '未命名助手',
      role: (b.role || '').trim(),
      desc: (b.desc || '').trim(),
      scope: Array.isArray(b.scope) ? b.scope.filter(Boolean) : [],
      prompt: (b.prompt || '').trim(),
      tone: (b.tone || '').trim(),
      rules: {
        cite: b.rules?.cite !== false,
        refuse: b.rules?.refuse !== false,
        brevity: b.rules?.brevity !== false,
        noPrice: !!b.rules?.noPrice,
      },
      enabled: b.enabled !== false,
      updatedAt: now,
    };

    const i = st.assistants.findIndex((x) => x.id === a.id);
    if (i >= 0) {
      a.createdAt = st.assistants[i].createdAt || now;
      st.assistants[i] = a;
    } else {
      a.createdAt = now;
      // 按创建顺序追加，别把新助手插到最前面——门户默认用第一个，插队会让人一进来就撞上错的助手
      st.assistants.push(a);
    }

    st.activity = st.activity || [];
    st.activity.unshift({
      t: new Date().toISOString().slice(5, 16).replace('T', ' '),
      txt: `${i >= 0 ? '更新' : '创建'} AI 助手「${a.name}」${a.scope.length ? ` · 限定 ${a.scope.join('/')}` : ''}`,
      who: '系统',
    });
    saveState(id, st);

    return sendJSON(res, 200, { ok: true, assistant: a, assistants: st.assistants });
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)\/assistants\/([\w]+)$/)) && method === 'DELETE') {
    const id = m[1];
    requireClient(id);
    const st = ensureState(id);
    const before = (st.assistants || []).length;
    st.assistants = (st.assistants || []).filter((a) => a.id !== m[2]);
    if (st.assistants.length === before) return sendJSON(res, 404, { error: '助手不存在' });
    saveState(id, st);
    return sendJSON(res, 200, { ok: true, assistants: st.assistants });
  }

  /* --- 模型配置 --- */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/llm$/)) && method === 'GET') {
    const id = m[1];
    requireClient(id);
    const st = ensureState(id);
    const own = st.cfg?.llm;
    const plat = platformLLM();
    const eff = effectiveLLM(st);
    return sendJSON(res, 200, {
      configured: !!eff,
      provider: eff?.provider || null,
      baseURL: eff?.baseURL || null,
      model: eff?.model || null,
      keyMasked: maskKey(eff?.apiKey),
      source: eff?.source || null,          // client = 客户自己的 Key（平台不补贴，故不会是 platform）
      own: own ? { provider: own.provider, model: own.model, keyMasked: maskKey(own.apiKey) } : null,
      platform: plat
        ? { available: true, provider: plat.provider, model: plat.model, keyMasked: maskKey(plat.apiKey) }
        : { available: false },
    });
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)\/llm$/)) && method === 'POST') {
    const id = m[1];
    requireClient(id);
    const b = await readJSONBody(req);
    const st = ensureState(id);
    const prev = st.cfg?.llm || {};

    const cfg = {
      provider: b.provider || prev.provider || 'deepseek',
      baseURL: b.baseURL || prev.baseURL || 'https://api.deepseek.com',
      model: b.model || prev.model || 'deepseek-chat',
      apiKey: b.apiKey || prev.apiKey || '',
    };

    // 真发一次请求验证，不通过就不保存
    let test;
    try {
      test = await LLM.testConnection(cfg);
    } catch (e) {
      return sendJSON(res, 200, {
        ok: false,
        error: e.message,
        code: e.code || 'ERROR',
      });
    }

    st.cfg = st.cfg || {};
    st.cfg.llm = cfg;
    st.activity = st.activity || [];
    st.activity.unshift({
      t: new Date().toISOString().slice(5, 16).replace('T', ' '),
      txt: `配置模型 ${cfg.model}，连通性测试通过`,
      who: '系统',
    });
    saveState(id, st);

    return sendJSON(res, 200, {
      ok: true,
      test,
      config: { provider: cfg.provider, baseURL: cfg.baseURL, model: cfg.model, keyMasked: maskKey(cfg.apiKey) },
    });
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)\/llm\/test$/)) && method === 'POST') {
    const id = m[1];
    requireClient(id);
    const st = ensureState(id);
    const cfg = effectiveLLM(st);
    if (!cfg?.apiKey) return sendJSON(res, 400, { ok: false, error: '还没有配置 API Key' });
    try {
      const test = await LLM.testConnection(cfg);
      return sendJSON(res, 200, { ok: true, test, source: cfg.source });
    } catch (e) {
      return sendJSON(res, 200, { ok: false, error: e.message, code: e.code });
    }
  }

  /* --- 问答 --- */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/chat$/)) && method === 'POST') {
    const id = m[1];
    requireClient(id);
    const b = await readJSONBody(req);
    const q = (b.question || '').trim();
    if (!q) return sendJSON(res, 400, { error: '问题不能为空' });

    const st = ensureState(id);
    const idx = getIndex(id);
    if (!idx) return sendJSON(res, 400, { error: '知识库尚未构建' });

    // 助手决定"以谁的口吻、查哪些资料"——这是第 6 步配置真正生效的地方
    const asst = pickAssistant(st, b.assistantId);
    const topK = b.topK || 5;
    // 限定了范围就多取一些候选，过滤完再截断，避免过滤后不够用
    let hits = search(idx.index, idx.chunks, q, asst?.scope?.length ? topK * 4 : topK);
    if (asst?.scope?.length) hits = filterByScope(hits, asst, getDocs(id)).slice(0, topK);

    // 没检索到就直接告知，不浪费模型调用
    if (!hits.length) {
      st.portalAsks = (st.portalAsks || 0) + 1;
      st.portalMiss = (st.portalMiss || 0) + 1;
      recordGap(st, q, asst);
      saveState(id, st);
      const scoped = asst?.scope?.length
        ? `「${asst.name}」只查 ${asst.scope.join('、')} 这几类资料，这个问题可能落在它的范围外。`
        : '这个问题涉及的资料还没有上传，或者换一种说法再试试。';
      return sendJSON(res, 200, {
        answer: `知识库里没有找到相关内容。${scoped}`,
        citations: [],
        gap: true,
        hits: 0,
        assistant: asst ? { id: asst.id, name: asst.name } : null,
        gaps: st.portalGaps || [],
        stats: { asks: st.portalAsks, miss: st.portalMiss },
      });
    }

    const cfg = effectiveLLM(st);
    if (!cfg?.apiKey) {
      // 没配模型：只给检索结果，不编回答
      st.portalAsks = (st.portalAsks || 0) + 1;
      saveState(id, st);
      return sendJSON(res, 200, {
        answer: null,
        needLLM: true,
        citations: hits.map((h) => ({
          doc: h.chunk.doc, page: h.chunk.page, score: h.score, snippet: h.chunk.text.slice(0, 160),
        })),
        message: '知识库里找到了相关内容，但还没有配置模型，无法生成自然语言回答。到第 5 步填入 API Key 即可。',
        stats: { asks: st.portalAsks, miss: st.portalMiss },
      });
    }

    try {
      const r = await LLM.answerWithRag(cfg, { question: q, hits, assistant: asst });
      st.portalAsks = (st.portalAsks || 0) + 1;
      addUsage(st, r.usage);
      if (r.gap) {
        st.portalMiss = (st.portalMiss || 0) + 1;
        recordGap(st, q, asst);
      }
      saveState(id, st);

      return sendJSON(res, 200, {
        answer: r.answer,
        citations: r.citations,
        gap: r.gap,
        usage: r.usage,
        ms: r.ms,
        model: r.model,
        assistant: asst ? { id: asst.id, name: asst.name, scope: asst.scope } : null,
        gaps: st.portalGaps || [],
        stats: { asks: st.portalAsks, miss: st.portalMiss },
      });
    } catch (e) {
      return sendJSON(res, 200, { error: e.message, code: e.code || 'ERROR' });
    }
  }

  /* --- 测试题 --- */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/tests\/generate$/)) && method === 'POST') {
    const id = m[1];
    requireClient(id);
    const st = ensureState(id);
    const idx = getIndex(id);
    if (!idx || !idx.chunks.length) return sendJSON(res, 400, { error: '知识库尚未构建' });

    // 从真实切片里抽题：让模型基于片段出题，答案必须能在片段里找到
    const cfg = effectiveLLM(st);
    const b = await readJSONBody(req);
    const count = Math.min(30, Math.max(5, b.count || 15));

    /* 出题也要按助手来。
     * 以前这里写死「你是企业知识库测试出题人」，不管选哪个助手都出同一套通用题——
     * 客户建了"售后政策助手"，测试题却全是产品参数，第 6 步的配置等于白配。 */
    const asst = pickAssistant(st, b.assistantId);

    if (!cfg?.apiKey) {
      // 没有模型就出不了真实的测试题。硬凑"原句抽查"没有判定价值，直接说清楚。
      return sendJSON(res, 400, {
        error: '生成测试题需要先配置模型。测试题要基于你的资料自动出，没有模型只能瞎编，那不如不出。请先到第 5 步填入 API Key。',
        needLLM: true,
      });
    }

    /* 抽题范围跟着助手的资料范围走：售后助手只从售后资料里抽，
     * 这样出的题才像这个岗位真会遇到的问题 */
    let pool = idx.chunks;
    if (asst?.scope?.length) {
      const docs = getDocs(id);
      const byId = Object.fromEntries(docs.map((d) => [d.id, docCat(d)]));
      const byName = Object.fromEntries(docs.map((d) => [d.name, docCat(d)]));
      const inScope = pool.filter((c) => asst.scope.includes(byId[c.docId] || byName[c.doc]));
      if (!inScope.length) {
        // 范围内没资料就不出题，别偷偷退回全量——那样出的题跟这个助手无关
        return sendJSON(res, 400, {
          error: `「${asst.name}」的资料范围是 ${asst.scope.join('、')}，但这几类下面还没有资料。先上传对应资料，或者把范围改成包含已有资料的分类。`,
          emptyScope: true,
        });
      }
      pool = inScope;
    }

    const sample = pickEvenly(pool, Math.min(12, pool.length))
      .map((c) => c.text.slice(0, 300))
      .join('\n---\n');

    const asstBrief = asst
      ? `本轮是为「${asst.name}」出题。这个岗位的定位是：${asst.role || '企业员工'}${asst.desc ? `，负责 ${asst.desc}` : ''}。问题要贴近这个岗位的人真实会开口问的，不要出泛泛的百科题。`
      : '';

    try {
      const r = await LLM.chat(cfg, [
        { role: 'system', content: '你是企业知识库测试出题人。' + (asstBrief ? '\n' + asstBrief : '') },
        {
          role: 'user',
          content: `根据下面的资料片段，出 ${count} 道企业员工真实会问的问题。\n要求：问题必须能且仅能用这些资料回答；覆盖不同资料；用中文；不要出现"根据资料"字样。\n只输出 JSON 数组，每项 {"q":"问题","expect":"答案要点","doc":"资料名"}。\n\n资料：\n${sample}`,
        },
      ], { maxTokens: 2000, temperature: 0.3 });

      const jsonText = (r.content.match(/\[[\s\S]*\]/) || [r.content])[0];
      let items = [];
      try { items = JSON.parse(jsonText); } catch { items = []; }

      const tests = items.slice(0, count).map((it, i) => ({
        id: 't' + i,
        q: String(it.q || '').trim(),
        expect: String(it.expect || '').trim(),
        doc: String(it.doc || '').trim(),
        page: null,
        key: i < Math.ceil(count / 3),
        source: 'llm',
      })).filter((t) => t.q);

      if (!tests.length) throw new Error('模型没有返回可用的题目，换一次试试');

      st.tests = { items: tests, generatedAt: new Date().toISOString(), source: 'llm' };
      saveState(id, st);
      return sendJSON(res, 200, { tests, source: 'llm' });
    } catch (e) {
      return sendJSON(res, 200, { ok: false, error: '生成题目失败：' + e.message });
    }
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)\/tests$/)) && method === 'GET') {
    requireClient(m[1]);
    const st = ensureState(m[1]);
    return sendJSON(res, 200, st.tests || { items: [] });
  }

  /* 逐题跑：真实检索 + 真实回答，不预设结果 */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/tests\/run$/)) && method === 'POST') {
    const id = m[1];
    requireClient(id);
    const b = await readJSONBody(req);
    const st = ensureState(id);
    const idx = getIndex(id);
    if (!idx) return sendJSON(res, 400, { error: '知识库尚未构建' });
    if (!st.tests?.items?.length) return sendJSON(res, 400, { error: '还没有测试题' });

    const cfg = effectiveLLM(st);
    const limit = Math.min(30, b.limit || st.tests.items.length);
    const results = [];
    // 用哪个助手跑测试，就按谁的资料范围和口吻回答
    const asst = pickAssistant(st, b.assistantId);
    const docsForScope = getDocs(id);

    for (let i = 0; i < Math.min(limit, st.tests.items.length); i++) {
      const t = st.tests.items[i];
      let hits = search(idx.index, idx.chunks, t.q, asst?.scope?.length ? 16 : 4);
      if (asst?.scope?.length) hits = filterByScope(hits, asst, docsForScope).slice(0, 4);

      if (!hits.length) {
        results.push({ ...t, answer: null, citations: [], verdict: 'gap', reason: '没有检索到任何相关片段' });
        continue;
      }

      if (!cfg?.apiKey) {
        results.push({
          ...t,
          answer: null,
          citations: hits.map((h) => ({ doc: h.chunk.doc, page: h.chunk.page, score: h.score, snippet: h.chunk.text.slice(0, 160) })),
          verdict: 'unmarked',
          reason: '未配置模型，仅检索',
        });
        continue;
      }

      try {
        const r = await LLM.answerWithRag(cfg, { question: t.q, hits, assistant: asst });
        addUsage(st, r.usage);
        results.push({
          ...t,
          answer: r.answer,
          citations: r.citations,
          gap: r.gap,
          verdict: r.gap ? 'gap' : 'unmarked', // 由人工判定通过/不通过
          ms: r.ms,
        });
      } catch (e) {
        results.push({ ...t, answer: null, verdict: 'error', reason: e.message });
      }
    }

    st.tests.results = results;
    st.tests.ranAt = new Date().toISOString();
    saveState(id, st);
    return sendJSON(res, 200, { results, ranAt: st.tests.ranAt });
  }

  /* 人工判定 */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/tests\/mark$/)) && method === 'POST') {
    const id = m[1];
    requireClient(id);
    const b = await readJSONBody(req);
    const st = ensureState(id);
    if (!st.tests?.results) return sendJSON(res, 400, { error: '还没有跑过测试' });
    const item = st.tests.results.find((r) => r.id === b.id);
    if (!item) return sendJSON(res, 404, { error: '题目不存在' });
    if (!['pass', 'fix', 'gap'].includes(b.verdict)) {
      return sendJSON(res, 400, { error: '判定值只能是 pass / fix / gap' });
    }
    item.verdict = b.verdict;
    item.note = b.note || '';
    saveState(id, st);
    return sendJSON(res, 200, { ok: true, report: summarize(st.tests.results) });
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)\/tests\/report$/)) && method === 'GET') {
    requireClient(m[1]);
    const st = ensureState(m[1]);
    if (!st.tests?.results) return sendJSON(res, 404, { error: '还没有跑过测试' });
    return sendJSON(res, 200, summarize(st.tests.results));
  }

  return sendJSON(res, 404, { error: `接口不存在：${method} ${p}` });
}

function summarize(results) {
  const total = results.length;
  const pass = results.filter((r) => r.verdict === 'pass').length;
  const fix = results.filter((r) => r.verdict === 'fix').length;
  const gap = results.filter((r) => r.verdict === 'gap').length;
  const unmarked = results.filter((r) => !['pass', 'fix', 'gap'].includes(r.verdict)).length;
  return {
    total, pass, fix, gap, unmarked,
    rate: total ? Math.round((pass / total) * 100) : 0,
    keys: results.filter((r) => r.key).length,
    keysDone: results.filter((r) => r.key && ['pass', 'fix', 'gap'].includes(r.verdict)).length,
  };
}

function pickEvenly(arr, n) {
  if (arr.length <= n) return arr.slice();
  const step = arr.length / n;
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]);
}

/* ---------------- 启动 ---------------- */

initStorage();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // 局域网访问放开（同一个 WiFi 内的其他电脑可以打开）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);

  try {
    await route(req, res, url);
  } catch (e) {
    if (!res.headersSent) sendJSON(res, e.status || 500, { error: e.message || '服务端错误' });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  const open = HOST !== '127.0.0.1' && HOST !== 'localhost';
  const nets = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal);
  console.log('');
  console.log('  贸智库 · 本地服务已启动');
  console.log('  ─────────────────────────────────────');
  console.log(`  本机访问    http://localhost:${PORT}`);
  if (open) {
    for (const n of nets) console.log(`  局域网访问  http://${n.address}:${PORT}`);
    console.log('');
    console.log('  ⚠ 已开放到局域网。此服务没有登录鉴权，同网络的人可以用你的模型额度。');
  } else {
    console.log('  仅本机可访问（默认）。需要用手机/别的电脑打开时：HOST=0.0.0.0 npm start');
  }
  console.log('');
  console.log('  按 Ctrl+C 停止');
  console.log('');
});
