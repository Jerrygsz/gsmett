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
import { renderPdfImages, ocrImages, explainNoVision } from './ocr.js';
import { hashPwd, verifyPwd, signToken, verifyToken } from './portal-auth.js';
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

/* ---------------- 员工门户：身份 / 会话 / 可见范围 ----------------
 * 员工账号复用 members[]，不另起一套人。管理员在「成员与权限」里给成员
 * 设登录密码和可见资料分类。没设密码 = 不能登录，不是弱密码默认值。
 *
 * 明文 API Key 和密码哈希都绝不下发：以前 GET /state 直接把整个 state
 * 丢给浏览器，cfg.llm.apiKey 是解过封的明文，和 README 的承诺对不上。 */
function publicMember(m) {
  const { pwdHash, ...rest } = m || {};
  return { ...rest, hasPortalPwd: !!pwdHash };
}
function publicState(st) {
  const out = JSON.parse(JSON.stringify(st || {}));
  if (out.cfg?.llm?.apiKey) out.cfg.llm.apiKey = maskKey(out.cfg.llm.apiKey);
  out.members = (out.members || []).map(publicMember);
  return out;
}
function allCats(id) {
  return [...new Set(getDocs(id).map(docCat))].sort();
}
function portalAccount(m) {
  return String(m?.login || m?.email || '').trim().toLowerCase();
}
function isLive(st) { return !!(st?.project?.live?.on); }
function viewerCats(m) {
  return Array.isArray(m?.cats) ? m.cats.filter(Boolean) : [];
}
/** 令牌无状态：验签 + 账号仍然可用 + 密码没被改过，三条都过才算登录 */
function portalViewer(id, token) {
  const p = verifyToken(token);
  if (!p || p.cid !== id) return null;
  const st = ensureState(id);
  const m = (st.members || []).find((x) => x.id === p.mid);
  if (!m || m.status === 'limited' || m.portal === false || !m.pwdHash) return null;
  if ((p.pwdAt || '') !== (m.pwdAt || '')) return null;
  return m;
}
function bearer(req, body) {
  const h = String(req.headers.authorization || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : String(body?.portalToken || '').trim();
}
/* 必须放在 route 外面：每次请求新建 Map 就等于没限流 */
const LOGIN_FAILS = new Map();   // 同一账号连错 5 次，冷却 60 秒

/* ---------------- 答案反馈 ----------------
 * 预览界面的打分不算进满意度，否则管理员自己点几下就能把报表做好看。 */
function visibleDocCount(id, cats) {
  const docs = getDocs(id);
  return cats.length ? docs.filter((d) => cats.includes(docCat(d))).length : docs.length;
}
/** 登录后才给的快捷问题：从「这份资料能回答什么」里取，且只取该员工可见分类 */
function portalPrompts(id, cats) {
  const out = [];
  const seen = new Set();
  for (const d of getDocs(id)) {
    const cat = docCat(d);
    if (cats.length && !cats.includes(cat)) continue;
    const q = (Array.isArray(d.qa) ? d.qa : [])[0];
    if (!q || out.includes(q) || seen.has(cat)) continue;
    out.push(q);
    seen.add(cat);
    if (out.length >= 4) break;
  }
  return out;
}
function feedbackStats(list) {
  const active = (list || []).filter((x) => x.vote === 'up' || x.vote === 'down');
  const real = active.filter((x) => x.source !== 'preview');
  const up = real.filter((x) => x.vote === 'up').length;
  const down = real.length - up;
  const byDay = {};
  const reasons = {};
  for (const x of real) {
    byDay[x.atDay] = (byDay[x.atDay] || 0) + 1;
    if (x.vote === 'down' && x.reason) reasons[x.reason] = (reasons[x.reason] || 0) + 1;
  }
  return {
    total: (list || []).length,
    rated: real.length,
    up, down,
    rate: real.length ? Math.round((up / real.length) * 100) : null,
    preview: active.length - real.length,
    byDay,
    reasonTop: Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([reason, n]) => ({ reason, n })),
  };
}
/** 检索层过滤：受限片段连模型都看不到，不是答完再遮 */
function filterByCats(hits, cats, docs) {
  if (!cats.length) return hits;
  const byId = Object.fromEntries(docs.map((d) => [d.id, docCat(d)]));
  const byName = Object.fromEntries(docs.map((d) => [d.name, docCat(d)]));
  return hits.filter((h) => cats.includes(byId[h.chunk.docId] || byName[h.chunk.doc] || ''));
}

/* ---------------- AI 资料分类 ----------------
 * 只看文件名的规则，会把报价单、PI、订单全塞进「产品资料」。
 * 这里改成读正文节选交给模型判定，四选一，并把判定理由一起存下来，
 * 让人能看出「为什么归到这一类」，而不是给个黑箱结果。
 */
const DOC_CATS = ['产品资料', '销售资料', '业务流程', '售后资料'];

const DOC_CAT_GUIDE = [
  '产品资料：产品规格书、参数表、型号/料号清单、产品目录、认证证书、图纸、BOM、测试报告、包装规格、说明书',
  '销售资料：报价单、价格表、PI/形式发票、订单、合同商务条款、折扣账期、销售话术、客户名单、竞品对比、展会资料',
  '业务流程：SOP、作业流程、审批流、内部制度、管理规范、表单模板、岗位职责、培训制度',
  '售后资料：保修条款、退换货政策、维修指引、客诉处理、不良品判定、返修记录、FAQ 售后部分',
].join('\n');

const CAT_SYS = `你是企业资料库的归类助手。把每份资料归入下面四类之一，只能选这四个，不要自创类别：
${DOC_CAT_GUIDE}

判断时以正文内容为主，文件名只作参考。

同时，为每份资料写出「员工看这份资料能问出什么问题」——2 到 3 个，必须是一线员工真会问的口语问题，
并且答案确实能在这份资料里找到。例如「GC07 这款车载充电器输出多少瓦？」「MOQ 是多少？」「保修多久？」。
不要写成"了解产品参数""查看报价"这种目录式的空话。

只输出 JSON 数组，不要解释、不要 markdown 代码块，格式：
[{"i":1,"cat":"销售资料","why":"含阶梯报价与PI号","q":["GC07 的 FOB 报价是多少？","1000 台的单价能到多少？"]}]
i 对应资料序号；why 用不超过 20 个字说明判断依据；q 是 2–3 个问题，每个不超过 30 字。`;

/* manual=人手动改过（AI 不再覆盖）；ai=模型判定；rule=只有文件名规则 */
const catSourceOf = (d) => d.catSource || 'rule';

/* 对外返回的资料记录：去掉本机绝对路径，补上前端要用的标记 */
const publicDoc = (d) => ({
  ...d,
  cat: docCat(d),
  catSource: catSourceOf(d),
  textPath: undefined,
  ocrPath: undefined,
  hasOcr: !!d.ocrPath,
  qa: Array.isArray(d.qa) ? d.qa : [],
});

const QA_SYS = `你是外贸制造企业的老员工，帮同事看看「手里这份资料能拿来回答什么问题」。

为每份资料写 2–3 个一线员工真会问的口语问题，答案必须能在这份资料里找到。
要具体到型号、数字、条件，不要「了解产品参数」这种目录式的话。
好例子：「GC07 的输出功率是多少？」「1000 台的单价能到多少？」「保修期多久，谁付运费？」
只输出 JSON 数组，不要解释、不要 markdown 代码块：
[{"i":1,"q":["GC07 输出多少瓦？","MOQ 是多少？"]}]
每个问题不超过 30 字，i 对应资料序号。`;

function parseQaJSON(text, n) {
  const raw = String(text || '');
  const a = raw.indexOf('[');
  const b = raw.lastIndexOf(']');
  let arr = null;
  if (a >= 0 && b > a) { try { arr = JSON.parse(raw.slice(a, b + 1)); } catch { } }
  const out = new Map();
  if (Array.isArray(arr)) {
    for (const it of arr) {
      const i = Number(it && it.i);
      if (!(i >= 1 && i <= n)) continue;
      const qs = Array.isArray(it.q)
        ? it.q.map((x) => String(x || '').trim()).filter((x) => x.length >= 4 && x.length <= 60).slice(0, 3)
        : [];
      if (qs.length) out.set(i, qs);
    }
  }
  return out;
}

/* 扫描件：有 OCR 文本就用 OCR 的，没有才现解析 */
function ocrTextOf(d) {
  if (!d.ocrPath) return '';
  try {
    return fs.readFileSync(d.ocrPath, 'utf8').trim();
  } catch { return ''; }
}

/* 读正文节选：OCR 结果优先，其次解析原始文件，单份最多取 maxChars 字 */
async function docExcerpt(d, maxChars = 900) {
  try {
    const ocr = ocrTextOf(d);
    if (ocr) return ocr.replace(/\s+/g, ' ').trim().slice(0, maxChars);
    const buf = fs.readFileSync(d.textPath);
    const parsed = await parseFile(buf, d.name);
    return String(parsed.text || '').replace(/\s+/g, ' ').trim().slice(0, maxChars);
  } catch { return ''; }
}

function parseCatJSON(text, n) {
  const raw = String(text || '');
  const a = raw.indexOf('[');
  const b = raw.lastIndexOf(']');
  let arr = null;
  if (a >= 0 && b > a) { try { arr = JSON.parse(raw.slice(a, b + 1)); } catch { } }
  const out = new Map();
  if (Array.isArray(arr)) {
    for (const it of arr) {
      const i = Number(it && it.i);
      const cat = String((it && it.cat) || '').trim();
      if (i >= 1 && i <= n && DOC_CATS.includes(cat)) {
        const qs = Array.isArray(it?.q)
          ? it.q.map((x) => String(x || '').trim()).filter((x) => x.length >= 4 && x.length <= 60).slice(0, 3)
          : [];
        out.set(i, { cat, why: String((it && it.why) || '').slice(0, 40), q: qs });
      }
    }
  }
  return out;
}

/* 一批资料（建议 ≤10 份）交给模型判定，返回每份的分类与理由 */
async function classifyDocs(id, cfg, targets) {
  const items = [];
  /* 每份带分类 + 依据 + 2–3 个问题，8 份一批时输出会明显变长。
   * 原来固定 1500 tokens 会把 JSON 截断，模型返回的数组解析不出来，整批都判失败。 */
  for (const d of targets) items.push({ doc: d, excerpt: await docExcerpt(d, 700) });

  const body = items
    .map((it, i) => `【${i + 1}】文件名：${it.doc.name}\n内容：${it.excerpt || '（读不出文本，可能是扫描件或空文件）'}`)
    .join('\n\n');

  const call = (payload, n) => LLM.chat(cfg, [
    { role: 'system', content: CAT_SYS },
    { role: 'user', content: payload },
  ], { maxTokens: Math.min(700 + n * 260, 3200), temperature: 0 });

  let r = await call(body, items.length);
  let map = parseCatJSON(r.content, items.length);
  let usageTotal = r.usage?.total || 0;

  /* 整批一条都解析不出来，通常是模型输出被截断或格式跑偏。
   * 不要整批算失败——拆成单份再跑一遍，最多多花几次调用，保证每份都有结论。 */
  if (map.size === 0 && items.length > 1) {
    map = new Map();
    for (let i = 0; i < items.length; i++) {
      const one = items[i];
      try {
        const rr = await call(`【1】文件名：${one.doc.name}\n内容：${one.excerpt || '（读不出文本）'}`, 1);
        usageTotal += rr.usage?.total || 0;
        const m1 = parseCatJSON(rr.content, 1);
        if (m1.has(1)) map.set(i + 1, m1.get(1));
      } catch { /* 单份也失败就跳过，记到 failed 里 */ }
    }
  }

  const docs = getDocs(id);
  const updated = [];
  const failed = [];

  items.forEach((it, idx) => {
    const target = docs.find((x) => x.id === it.doc.id);
    if (!target) return;
    const hit = map.get(idx + 1);
    /* 扫描件没有文字层，模型只能看文件名——结果要标成「待复核」，别当成读过内容 */
    const noText = (it.excerpt || '').replace(/\s/g, '').length < 20;
    if (hit) {
      target.cat = hit.cat;
      target.catSource = 'ai';
      target.catLow = noText;
      target.catWhy = noText
        ? `无文字层，仅凭文件名${hit.why ? '：' + hit.why : '判断'}`
        : (hit.why || '');
      target.catAt = new Date().toISOString();
      /* 能回答什么问题：给门户做「试试这样问」，也给第 6 步挑助手范围做参照 */
      if (hit.q && hit.q.length) {
        target.qa = hit.q;
        target.qaAt = target.catAt;
      }
      updated.push({ id: target.id, name: target.name, cat: hit.cat, why: target.catWhy, low: noText, qa: target.qa || [] });
    } else {
      /* 模型漏了这一份：保留文件名规则结果，标记出来让人知道没判成功 */
      if (!target.cat) { target.cat = guessCat(target.name); target.catSource = 'rule'; }
      failed.push({ id: target.id, name: target.name });
    }
  });

  saveDocs(id, docs);

  const st = ensureState(id);
  addUsage(st, { total: usageTotal });
  if (updated.length) {
    st.activity = st.activity || [];
    st.activity.unshift({
      t: new Date().toISOString().slice(5, 16).replace('T', ' '),
      txt: `AI 读了 ${updated.length} 份资料的内容，判定所属分类`,
      who: 'AI 助手',
    });
    saveState(id, st);
  }

  return { updated, failed, usage: r.usage, model: r.model, ms: r.ms };
}

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

/* ---------------- 答不上来的问题：从「记录」变成「待办」 ----------------
 * 老数据只有 { q, at, n, by }，这里补 id / status 等字段，全部可选，
 * 所以旧客户的清单读出来照样能用，status 缺省视为 open。
 * 服务端是唯一真相：live.js 的 syncSoon 不回写 portalGaps，前端改不动它。 */
/** id 由问题内容算出来，老数据每次读都能得到同一个 id —— GET 不必为了补 id 写盘 */
function gapId(q) {
  return 'g_' + crypto.createHash('sha1').update(String(q || '')).digest('hex').slice(0, 10);
}

function ensureGaps(st) {
  if (!Array.isArray(st.portalGaps)) st.portalGaps = [];
  for (const g of st.portalGaps) {
    if (!g.id) g.id = gapId(g.q);
    if (!g.status) g.status = 'open';
    if (g.assignee === undefined) g.assignee = '';
    if (g.note === undefined) g.note = '';
  }
  return st.portalGaps;
}

/** 匹配问法时忽略标点、空格、大小写，避免「GC25 多少瓦?」和「GC25多少瓦」算两条 */
function normGap(s) {
  return String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '').slice(0, 120);
}

function gapStats(list) {
  const all = Array.isArray(list) ? list : [];
  const c = { total: all.length, open: 0, assigned: 0, resolved: 0, ignored: 0 };
  for (const g of all) {
    const k = g.status || 'open';
    if (c[k] !== undefined) c[k]++;
    else c.open++;
  }
  const active = c.total - c.ignored;   // 主动忽略的不算待办
  c.rate = active ? Math.round((c.resolved / active) * 100) : 0;
  return c;
}

/** 同一个问题后来答上来了 → 自动销账，但标明是系统判定的，允许人工重新打开 */
function autoResolveGap(st, question, result, assistantId) {
  const list = ensureGaps(st);
  const key = normGap(question);
  if (!key) return null;
  // 缺口是某个助手范围内产生的，就只认同一个助手答上来；全库产生的谁答上来都算
  const hit = list.find((g) => normGap(g.q) === key
    && !['resolved', 'ignored'].includes(g.status || 'open')
    && (!g.aid || !assistantId || g.aid === assistantId));
  if (!hit) return null;
  const now = new Date().toISOString();
  hit.status = 'resolved';
  hit.resolvedAt = now;
  hit.resolvedBy = 'auto';
  hit.verify = {
    at: now, ok: true, by: 'chat',
    answer: String(result?.answer || '').slice(0, 240),
    docs: (result?.citations || []).slice(0, 3).map((c) => c.doc),
  };
  return hit;
}

function recordGap(st, question, assistant) {
  const text = String(question || '').trim().slice(0, 120);
  if (!text) return;
  const list = ensureGaps(st);
  const today = new Date().toISOString().slice(0, 10);
  const hit = list.find((g) => normGap(g.q) === normGap(text));
  if (hit) {
    hit.n = (hit.n || 1) + 1;
    hit.at = today;
    hit.lastAt = today;
    if (!hit.aid && assistant?.id) hit.aid = assistant.id;
    // 之前销过账，现在又答不上来 → 自动重新打开，不能让它悄悄消失
    if (hit.status === 'resolved') {
      hit.status = 'open';
      hit.reopenedAt = today;
      hit.resolvedBy = '';
      hit.verify = { ...(hit.verify || {}), at: new Date().toISOString(), ok: false, by: 'chat' };
    }
    return hit;
  }
  list.unshift({
    id: gapId(text),
    q: text, at: today, n: 1,
    by: assistant?.name || '', aid: assistant?.id || '',
    status: 'open', assignee: '', note: '',
  });
  if (list.length > 30) list.length = 30;
}

/**
 * 拿一个问题真跑一次「检索 + 模型」，只回答"现在能不能答上来"。
 * 用于缺口任务的「重新验证」——不写提问计数、不再记缺口，由调用方决定落库。
 */
async function probeQuestion(id, question, assistantId) {
  const st = ensureState(id);
  const idx = getIndex(id);
  if (!idx) return { error: '知识库尚未构建', gap: true, citations: [], answer: '' };

  const asst = pickAssistant(st, assistantId);
  const topK = 5;
  let hits = search(idx.index, idx.chunks, question, asst?.scope?.length ? topK * 4 : topK);
  if (asst?.scope?.length) hits = filterByScope(hits, asst, getDocs(id)).slice(0, topK);
  if (!hits.length) return { gap: true, citations: [], answer: '知识库里没有找到相关内容' };

  const cfg = effectiveLLM(st);
  if (!cfg?.apiKey) return { error: '还没有配置模型 Key，无法验证', gap: true, citations: [], answer: '' };
  try {
    const r = await LLM.answerWithRag(cfg, { question, hits, assistant: asst });
    addUsage(st, r.usage);
    return { gap: !!r.gap, citations: r.citations, answer: r.answer, model: r.model, ms: r.ms };
  } catch (e) {
    return { error: e.message, gap: true, citations: [], answer: '' };
  }
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
    /* 先给文件名规则一个初判，标记来源是 rule，后面 AI 会按内容覆盖 */
    cat: guessCat(name),
    catSource: 'rule',
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
        /* 文件内容变了，旧的 OCR 文字就作废；分类和问题清单保留，等下次分析覆盖 */
        if (prev.ocrPath) { try { fs.unlinkSync(prev.ocrPath); } catch { } }
        const merged = {
          ...rec, id: prev.id, cat: prev.cat, catSource: prev.catSource, catWhy: prev.catWhy,
          catLow: prev.catLow, catAt: prev.catAt, qa: prev.qa, qaAt: prev.qaAt,
          addedAt: prev.addedAt || rec.addedAt,
        };
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
    /* 扫描件已经 OCR 过就直接用识别出的文字，否则原始文件里是空的 */
    const ocr = ocrTextOf(d);
    let parsed;
    if (ocr) {
      parsed = { text: ocr, pages: d.ocrPages || d.pages || 1, byPage: null };
    } else {
      const buf = fs.readFileSync(d.textPath);
      parsed = await parseFile(buf, d.name);
    }
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
    return sendJSON(res, 200, { state: publicState(ensureState(m[1])) });
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)\/state$/)) && (method === 'PATCH' || method === 'POST')) {
    requireClient(m[1]);
    const patch = await readJSONBody(req);
    // 前端不能借这个接口改员工登录设置，统一走 /members/:id
    delete patch.members;
    delete patch.answerFeedback;
    delete patch.portalGaps;
    const st = patchState(m[1], patch);
    return sendJSON(res, 200, { state: publicState(st) });
  }

  /* --- 员工门户：登录态 ---
   * 员工端是独立的 portal.html，不加载后台那套 JS，后台页面不对员工开放。
   * 没按下「开启使用」时，服务端直接拒绝登录，光改前端拦不住。 */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/portal\/meta$/)) && method === 'GET') {
    const id = m[1];
    requireClient(id);
    const st = ensureState(id);
    const c = getClient(id);
    return sendJSON(res, 200, {
      org: { name: c?.name || st.org?.name || '企业', short: st.org?.short || '' },
      live: isLive(st),
      cats: allCats(id),
      assistants: (st.assistants || []).filter((a) => a.enabled !== false)
        .map((a) => ({ id: a.id, name: a.name, scope: a.scope || [] })),
      docCount: getDocs(id).length,
      accountCount: (st.members || []).filter((x) => x.pwdHash && x.portal !== false && x.status !== 'limited').length,
    });
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)\/portal\/login$/)) && method === 'POST') {
    const id = m[1];
    requireClient(id);
    const b = await readJSONBody(req);
    const st = ensureState(id);
    if (!isLive(st)) {
      return sendJSON(res, 409, { error: '员工门户还没开放，请联系管理员开启使用', code: 'LOCKED' });
    }
    const account = String(b.account || '').trim().toLowerCase();
    const key = `${id}:${account}`;
    const fail = LOGIN_FAILS.get(key);
    if (fail && fail.n >= 5 && Date.now() - fail.at < 60000) {
      return sendJSON(res, 429, { error: '尝试次数太多，请一分钟后再试' });
    }
    const member = (st.members || []).find((x) => portalAccount(x) === account);
    const ok = member && member.pwdHash && member.portal !== false && member.status !== 'limited'
      && verifyPwd(String(b.pwd || ''), member.pwdHash);
    if (!ok) {
      LOGIN_FAILS.set(key, { n: (fail?.n || 0) + 1, at: Date.now() });
      return sendJSON(res, 401, { error: '账号或密码不对' });
    }
    LOGIN_FAILS.delete(key);
    member.lastLoginAt = new Date().toISOString();
    saveState(id, st);
    const token = signToken({ cid: id, mid: member.id, pwdAt: member.pwdAt || '' });
    const cats = viewerCats(member);
    return sendJSON(res, 200, {
      token,
      member: { id: member.id, name: member.name, role: member.role, cats, allDocs: !cats.length },
      org: { name: st.org?.short || st.org?.name || '企业' },
      prompts: portalPrompts(id, cats),
      docCount: visibleDocCount(id, cats),
      assistants: (st.assistants || []).filter((a) => a.enabled !== false)
        .map((a) => ({ id: a.id, name: a.name, scope: a.scope || [] })),
    });
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)\/portal\/me$/)) && method === 'GET') {
    const id = m[1];
    requireClient(id);
    const token = bearer(req, {});
    const viewer = token ? portalViewer(id, token) : null;
    if (!viewer) return sendJSON(res, 401, { error: '登录已失效，请重新登录', code: 'AUTH' });
    const st = ensureState(id);
    if (!isLive(st)) return sendJSON(res, 409, { error: '员工门户已暂停使用', code: 'LOCKED' });
    const cats = viewerCats(viewer);
    return sendJSON(res, 200, {
      member: { id: viewer.id, name: viewer.name, role: viewer.role, cats, allDocs: !cats.length },
      org: { name: st.org?.short || st.org?.name || '企业' },
      prompts: portalPrompts(id, cats),
      docCount: visibleDocCount(id, cats),
      assistants: (st.assistants || []).filter((a) => a.enabled !== false)
        .map((a) => ({ id: a.id, name: a.name, scope: a.scope || [] })),
    });
  }

  /* 员工端右侧只读摘要：只给该看的几个数字，不把整个 state 丢出去 */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/portal\/summary$/)) && method === 'GET') {
    const id = m[1];
    requireClient(id);
    const viewer = portalViewer(id, bearer(req, {}));
    if (!viewer) return sendJSON(res, 401, { error: '登录已失效，请重新登录', code: 'AUTH' });
    const st = ensureState(id);
    const gaps = ensureGaps(st);
    const g = gapStats(gaps);
    return sendJSON(res, 200, {
      asks: st.portalAsks || 0,
      miss: st.portalMiss || 0,
      gaps: { open: g.open + g.assigned, resolved: g.resolved, rate: g.rate },
      recentResolved: gaps.filter((x) => x.status === 'resolved').slice(0, 3).map((x) => x.q),
      feedback: feedbackStats(st.answerFeedback || []),
    });
  }

  /* --- 开启/暂停使用：交付完成后由客户自己按下的开关 ---
   * 不能只靠前端状态。员工是真的会打开这个链接提问的，
   * 所以这里再核一遍：十步都完成、有助手、知识库真有切片。
   * 缺任何一项就不给开，返回缺什么，前端照着提示去补。 */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/go-live$/)) && method === 'POST') {
    requireClient(m[1]);
    const b = await readJSONBody(req);
    const st = ensureState(m[1]);
    const project = st.project || {};
    const live = project.live || null;
    const on = b.on !== false;
    const at = new Date().toISOString();
    const by = String(b.by || '').slice(0, 40);

    if (on) {
      const steps = project.steps || {};
      const doneN = Object.keys(steps).filter((k) => steps[k] && steps[k].done).length;
      const asst = Array.isArray(st.assistants) ? st.assistants.length : 0;
      const chunks = (getIndex(m[1]) || {}).chunks?.length || 0;
      const blockers = [];
      if (doneN < 10) blockers.push({ key: 'steps', msg: `还有 ${10 - doneN} 个步骤没完成` });
      if (!asst) blockers.push({ key: 'assistants', msg: '还没有创建 AI 助手' });
      if (!chunks) blockers.push({ key: 'kb', msg: '知识库还没建好' });
      if (blockers.length) {
        return sendJSON(res, 409, { error: '还不能开启使用', blockers, live });
      }
    }

    st.project = { ...project, live: { on, at, by } };
    saveState(m[1], st);
    return sendJSON(res, 200, { ok: true, live: st.project.live });
  }

  /* --- 客户成员：后台和客户端共用同一份，改完立刻落盘 --- */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/members$/)) && method === 'GET') {
    requireClient(m[1]);
    return sendJSON(res, 200, {
      members: listMembers(m[1]).map(publicMember),
      cats: allCats(m[1]),
    });
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
    /* 员工登录设置：密码只存哈希，改密码会让已发出的令牌全部失效 */
    if (b.pwd !== undefined) {
      const pw = String(b.pwd);
      if (pw === '') {
        patch.pwdHash = '';
        patch.pwdAt = '';
        patch.portal = false;
      } else if (pw.length < 6) {
        return sendJSON(res, 400, { error: '登录密码至少 6 位' });
      } else {
        patch.pwdHash = hashPwd(pw);
        patch.pwdAt = new Date().toISOString();
      }
    }
    if (b.portal !== undefined) patch.portal = !!b.portal;
    if (b.login !== undefined) patch.login = String(b.login).trim().slice(0, 60);
    if (Array.isArray(b.cats)) {
      const allowed = allCats(id);
      patch.cats = b.cats.map(String).filter((c) => allowed.includes(c)).slice(0, 20);
    }
    if (patch.login && listMembers(id).some((x) => x.id !== m[2] && portalAccount(x) === patch.login.toLowerCase())) {
      return sendJSON(res, 400, { error: '这个登录账号已被其他成员占用' });
    }
    const member = updateMember(id, m[2], patch);
    return sendJSON(res, member ? 200 : 404, member ? { member: publicMember(member) } : { error: '成员不存在' });
  }

  /* --- 资料 --- */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/docs$/)) && method === 'GET') {
    requireClient(m[1]);
    const docs = getDocs(m[1]).map(publicDoc);
    return sendJSON(res, 200, { docs });
  }

  /* AI 分析分类：读正文判定属于哪类资料。前端分批调用（每批 ≤10 份），带进度 */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/docs\/classify$/)) && method === 'POST') {
    const id = m[1];
    requireClient(id);
    const b = await readJSONBody(req);
    const st = ensureState(id);
    const cfg = effectiveLLM(st);
    if (!cfg || !cfg.apiKey) {
      return sendJSON(res, 400, {
        error: '还没有配置模型 Key。先去第 5 步填一个（DeepSeek / 智谱都行），AI 才能读内容判断分类。',
        needKey: true,
      });
    }

    const all = getDocs(id);
    const limit = Math.min(Math.max(Number(b.limit) || 8, 1), 20);

    let pool;
    if (Array.isArray(b.ids) && b.ids.length) {
      const set = new Set(b.ids.map(String));
      pool = all.filter((d) => set.has(d.id));
    } else {
      /* 没指定就按「还没被 AI 判过、也没被人手动改过」的顺序补 */
      pool = all.filter((d) => {
        const s = catSourceOf(d);
        if (s === 'manual') return false;
        if (s === 'ai' && !b.force) return false;
        return true;
      });
    }

    const targets = pool.slice(0, limit);
    if (!targets.length) {
      return sendJSON(res, 200, { updated: [], failed: [], done: true, remaining: 0, total: all.length });
    }

    let result;
    try {
      result = await classifyDocs(id, cfg, targets);
    } catch (e) {
      return sendJSON(res, 502, { error: e.message || '模型调用失败', code: e.code || 'LLM' });
    }

    const remaining = getDocs(id).filter((d) => {
      const s = catSourceOf(d);
      return s !== 'manual' && s !== 'ai';
    }).length;

    return sendJSON(res, 200, {
      ...result,
      done: remaining === 0,
      remaining,
      total: all.length,
      llmSource: cfg.source || 'client',
    });
  }

  /* 扫描件 OCR：把没有文字层的 PDF 渲染成图片，交给视觉模型读字。
   * 前端按批调用（默认每批 2 份），跑完再用 /docs/classify 带上 ids 重判分类。 */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/docs\/ocr$/)) && method === 'POST') {
    const id = m[1];
    requireClient(id);
    const b = await readJSONBody(req);
    const st = ensureState(id);
    const cfg = effectiveLLM(st);
    if (!cfg || !cfg.apiKey) {
      return sendJSON(res, 400, {
        error: '还没有配置模型 Key。扫描件识别要用能读图片的模型，去第 5 步填一个（智谱 / 通义 / OpenAI 都行）。',
        needKey: true,
      });
    }
    const vision = LLM.visionModelFor(cfg);
    if (!vision) {
      return sendJSON(res, 400, { error: explainNoVision(cfg.provider), noVision: true, provider: cfg.provider });
    }

    const all = getDocs(id);
    const limit = Math.min(Math.max(Number(b.limit) || 2, 1), 4);
    const maxPages = Math.min(Math.max(Number(b.pages) || 2, 1), 3);
    /* 认两次还认不出的（条码页、纯照片页）就别再烧 token 了，留给人看 */
    const needOcr = (d) => !d.ocrPath && d.ext === 'pdf'
      && (d.scanned || d.status === 'empty' || (d.chars || 0) < 20)
      && (d.ocrTries || 0) < 2;

    let pool;
    if (Array.isArray(b.ids) && b.ids.length) {
      const set = new Set(b.ids.map(String));
      pool = all.filter((d) => set.has(d.id) && d.ext === 'pdf');
      /* 手动指定 = 明确要重试，把失败计数清零 */
      pool.forEach((d) => { d.ocrTries = 0; d.ocrFail = ''; });
    } else {
      pool = all.filter(needOcr);
    }

    const targets = pool.slice(0, limit);
    if (!targets.length) {
      return sendJSON(res, 200, { updated: [], failed: [], done: true, remaining: 0, total: all.length, visionModel: vision });
    }

    const queue = targets.slice();
    const updated = [];
    const failed = [];
    const skipped = [];
    let usageTotal = 0;

    /* 并发 2：单份要 10–20 秒，串行跑 86 份要半小时，太慢 */
    const worker = async () => {
      while (queue.length) {
        const d = queue.shift();
        try {
          const buf = fs.readFileSync(d.textPath);

          /* 先按文字层再解一次：补了 cMap 之后，一些「看着像扫描件」的中文 PDF
           * 其实能直接读出字来，这种情况不必调视觉模型，省钱也更准 */
          const again = await parseFile(buf, d.name);
          if ((again.chars || 0) >= 20) {
            Object.assign(d, {
              chars: again.chars,
              pages: again.pages,
              scanned: false,
              empty: false,
              status: 'ok',
              reparsedAt: new Date().toISOString(),
            });
            updated.push({ id: d.id, name: d.name, chars: again.chars, pages: again.pages, reparsed: true });
            continue;
          }

          const { images, totalPages } = await renderPdfImages(buf, { maxPages });
          const r = await ocrImages(cfg, images, { model: vision });

          /* 整页是产品照片/条码：模型明确说没有字。这不是失败，标出来别再重试 */
          if (r.noText) {
            d.ocrTries = 2;
            d.ocrNote = '整页是图片或产品照片，没有可读文字';
            d.ocrFailAt = new Date().toISOString();
            skipped.push({ id: d.id, name: d.name, reason: d.ocrNote });
            continue;
          }

          const text = String(r.text || '').trim();
          const chars = text.replace(/\s/g, '').length;
          if (chars < 10) throw new Error('识别不到文字，图片可能太模糊或是纯图片页');

          const ocrPath = path.join(path.dirname(d.textPath), `${d.id}.ocr.txt`);
          fs.writeFileSync(ocrPath, text, 'utf8');
          Object.assign(d, {
            ocrPath,
            ocrChars: chars,
            ocrAt: new Date().toISOString(),
            ocrModel: r.model,
            ocrPages: r.pages,
            ocrTotalPages: totalPages,
            status: 'ok',
            qaSkip: undefined,
          });
          usageTotal += r.usage?.total || 0;
          updated.push({ id: d.id, name: d.name, chars, pages: r.pages });
        } catch (e) {
          d.ocrTries = (d.ocrTries || 0) + 1;
          d.ocrFail = e.message || '识别失败';
          d.ocrFailAt = new Date().toISOString();
          failed.push({ id: d.id, name: d.name, reason: d.ocrFail, tries: d.ocrTries });
        }
      }
    };
    await Promise.all([worker(), worker()]);

    saveDocs(id, all);

    if (usageTotal) {
      addUsage(st, { total: usageTotal });
      st.activity = st.activity || [];
      st.activity.unshift({
        t: new Date().toISOString().slice(5, 16).replace('T', ' '),
        txt: `识别了 ${updated.length} 份扫描件的文字（${vision}）`,
        who: 'AI 助手',
      });
      saveState(id, st);
    }

    const after = getDocs(id);
    const remaining = after.filter(needOcr).length;
    const givenUp = after.filter((d) => !d.ocrPath && d.ext === 'pdf' && (d.ocrTries || 0) >= 2).length;
    return sendJSON(res, 200, {
      updated,
      failed,
      skipped,
      remaining,
      givenUp,
      done: remaining === 0,
      total: after.length,
      visionModel: vision,
      usage: { total: usageTotal },
    });
  }

  /* 老资料补跑「能回答什么问题」：不改分类，只生成 2–3 个员工真会问的问题 */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/docs\/qa$/)) && method === 'POST') {
    const id = m[1];
    requireClient(id);
    const b = await readJSONBody(req);
    const st = ensureState(id);
    const cfg = effectiveLLM(st);
    if (!cfg || !cfg.apiKey) return sendJSON(res, 400, { error: '还没有配置模型 Key', needKey: true });

    const all = getDocs(id);
    const limit = Math.min(Math.max(Number(b.limit) || 8, 1), 20);
    const hasQa = (d) => Array.isArray(d.qa) && d.qa.length > 0;
    /* 没有文字的资料（整页是照片）问不出东西，别让模型照着文件名编 */
    const hasText = (d) => !!d.ocrPath || (d.chars || 0) > 20;
    const pool = Array.isArray(b.ids) && b.ids.length
      ? all.filter((d) => b.ids.map(String).includes(d.id))
      : all.filter((d) => !hasQa(d) && hasText(d) && !d.qaSkip);
    const targets = pool.slice(0, limit);
    if (!targets.length) return sendJSON(res, 200, { updated: [], done: true, remaining: 0 });

    const items = [];
    const skipped = [];
    for (const d of targets) {
      const excerpt = await docExcerpt(d, 700);
      if (excerpt.replace(/\s/g, '').length < 20) {
        d.qaSkip = true;
        d.qaSkippedAt = new Date().toISOString();
        skipped.push({ id: d.id, name: d.name, reason: '没有可读文字' });
        continue;
      }
      items.push({ doc: d, excerpt });
    }
    if (!items.length) {
      saveDocs(id, all);
      const rest = getDocs(id).filter((d) => !hasQa(d) && hasText(d) && !d.qaSkip).length;
      return sendJSON(res, 200, { updated: [], skipped, remaining: rest, done: rest === 0 });
    }
    const body = items
      .map((it, i) => `【${i + 1}】文件名：${it.doc.name}\n内容：${it.excerpt || '（读不出文本）'}`)
      .join('\n\n');

    const callQa = (payload, n) => LLM.chat(cfg, [
      { role: 'system', content: QA_SYS },
      { role: 'user', content: payload },
    ], { maxTokens: Math.min(500 + n * 220, 2400), temperature: 0 });

    let r;
    try {
      r = await callQa(body, items.length);
    } catch (e) {
      return sendJSON(res, 502, { error: e.message || '模型调用失败', code: e.code || 'LLM' });
    }

    let map = parseQaJSON(r.content, items.length);
    let usageTotal = r.usage?.total || 0;

    /* 同样的坑：一批 12 份输出被截断就整批空手。拆单补跑，别让客户看着进度不动 */
    if (map.size === 0 && items.length > 1) {
      map = new Map();
      for (let i = 0; i < items.length; i++) {
        try {
          const rr = await callQa(`【1】文件名：${items[i].doc.name}\n内容：${items[i].excerpt}`, 1);
          usageTotal += rr.usage?.total || 0;
          const m1 = parseQaJSON(rr.content, 1);
          if (m1.has(1)) map.set(i + 1, m1.get(1));
        } catch { /* 单份失败就留着下次再补 */ }
      }
    }
    const updated = [];
    items.forEach((it, idx) => {
      const qs = map.get(idx + 1);
      if (!qs || !qs.length) return;
      const d = all.find((x) => x.id === it.doc.id);
      if (!d) return;
      d.qa = qs;
      d.qaAt = new Date().toISOString();
      updated.push({ id: d.id, name: d.name, qa: qs });
    });
    saveDocs(id, all);
    addUsage(st, { total: usageTotal });
    saveState(id, st);

    const remaining = getDocs(id).filter((d) => !hasQa(d) && hasText(d) && !d.qaSkip).length;
    return sendJSON(res, 200, { updated, skipped, remaining, done: remaining === 0, usage: { total: usageTotal }, model: r.model });
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
    /* 人改过就打上 manual，之后 AI 批量分类不会把人的判断冲掉 */
    d.catSource = 'manual';
    d.catWhy = '';
    saveDocs(id, docs);
    return sendJSON(res, 200, { ok: true, docs: docs.map(publicDoc) });
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
      added: result.added.map(publicDoc),
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
      if (d.ocrPath) { try { fs.unlinkSync(d.ocrPath); } catch { } }
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
    /* 带令牌 = 员工端。服务端自己验，不信任前端说自己是谁。
     * 没带令牌的是后台预览 / 内部验证（管理员口径，查全部资料）。 */
    const token = bearer(req, b);
    let viewer = null;
    if (token) {
      viewer = portalViewer(id, token);
      if (!viewer) return sendJSON(res, 401, { error: '登录已失效，请重新登录', code: 'AUTH' });
      if (!isLive(st)) return sendJSON(res, 409, { error: '员工门户已暂停使用', code: 'LOCKED' });
    }
    const vCats = viewerCats(viewer);
    const docsForScope = getDocs(id);
    const answerId = 'a_' + crypto.randomBytes(6).toString('hex');

    const idx = getIndex(id);
    if (!idx) return sendJSON(res, 400, { error: '知识库尚未构建' });

    // 员工传来的最近几轮对话。限量、限字，避免有人把整个聊天记录塞进来
    const history = (Array.isArray(b.history) ? b.history : []).slice(-6).map((h) => ({
      role: h?.role === 'user' ? 'user' : 'assistant',
      content: String(h?.content || '').slice(0, 400),
    })).filter((h) => h.content);

    // 助手决定"以谁的口吻、查哪些资料"——这是第 6 步配置真正生效的地方
    const asst = pickAssistant(st, b.assistantId);
    const cfg = effectiveLLM(st);
    const topK = b.topK || 5;

    /* 多轮对话的关键：不能拿「那它能给笔记本充吗」这种指代句去检索。
     * 先把追问改写成独立问题用于检索，回答时仍用员工原话 + 历史上下文。
     * 改写失败一律降级回原句，追问不会因为改写出错而答不出来。 */
    let rw = { query: q, rewritten: false, usage: null };
    if (cfg?.apiKey && history.length) rw = await LLM.rewriteFollowup(cfg, q, history);
    const searchQ = rw.query || q;
    if (rw.usage) addUsage(st, rw.usage);

    /* 检索层就把不该看的切片剔掉——这些片段不会进提示词、不会进引用、更不会到模型那边。
     * 助手范围与员工可见分类取交集；有限制时多取候选，过滤完再截断。 */
    const restricted = !!(asst?.scope?.length || vCats.length);
    let hits = search(idx.index, idx.chunks, searchQ, restricted ? topK * 6 : topK);
    if (asst?.scope?.length) hits = filterByScope(hits, asst, docsForScope);
    if (vCats.length) hits = filterByCats(hits, vCats, docsForScope);
    hits = hits.slice(0, topK);

    // 没检索到就直接告知，不浪费模型调用
    if (!hits.length) {
      st.portalAsks = (st.portalAsks || 0) + 1;
      st.portalMiss = (st.portalMiss || 0) + 1;
      recordGap(st, searchQ, asst);
      saveState(id, st);
      const scoped = vCats.length
        ? `你当前只能查 ${vCats.join('、')} 这几类资料，这个问题可能落在权限范围外。`
        : asst?.scope?.length
          ? `「${asst.name}」只查 ${asst.scope.join('、')} 这几类资料，这个问题可能落在它的范围外。`
          : '这个问题涉及的资料还没有上传，或者换一种说法再试试。';
      return sendJSON(res, 200, {
        answer: `知识库里没有找到相关内容。${scoped}`,
        citations: [],
        gap: true,
        hits: 0,
        answerId,
        rewritten: rw.rewritten ? rw.query : null,
        assistant: asst ? { id: asst.id, name: asst.name } : null,
        gaps: ensureGaps(st),
        stats: { asks: st.portalAsks, miss: st.portalMiss },
      });
    }

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
        rewritten: rw.rewritten ? rw.query : null,
        answerId,
        stats: { asks: st.portalAsks, miss: st.portalMiss },
      });
    }

    try {
      const r = await LLM.answerWithRag(cfg, { question: q, hits, assistant: asst, history });
      st.portalAsks = (st.portalAsks || 0) + 1;
      addUsage(st, r.usage);
      let resolved = null;
      if (r.gap) {
        st.portalMiss = (st.portalMiss || 0) + 1;
        recordGap(st, searchQ, asst);   // 销过账又答不上来时会自动重新打开
      } else if ((r.citations || []).length) {
        // 同一个问题现在答上来了 → 自动销账。改写前后两种问法都试一遍
        resolved = autoResolveGap(st, searchQ, r, asst?.id) || autoResolveGap(st, q, r, asst?.id);
      }
      const gaps = ensureGaps(st);
      saveState(id, st);

      return sendJSON(res, 200, {
        answer: r.answer,
        citations: r.citations,
        gap: r.gap,
        usage: r.usage,
        ms: r.ms,
        model: r.model,
        rewritten: rw.rewritten ? rw.query : null,
        tableMode: LLM.hasTableHits(hits),
        answerId,
        viewer: viewer ? { name: viewer.name, cats: vCats, allDocs: !vCats.length } : null,
        assistant: asst ? { id: asst.id, name: asst.name, scope: asst.scope } : null,
        resolved: resolved ? { id: resolved.id, q: resolved.q } : null,
        gaps,
        gapStats: gapStats(gaps),
        stats: { asks: st.portalAsks, miss: st.portalMiss },
      });
    } catch (e) {
      return sendJSON(res, 200, { error: e.message, code: e.code || 'ERROR' });
    }
  }

  /* --- 缺口任务闭环：查询 / 指派 / 销账 / 忽略 / 重新验证 --- */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/gaps$/)) && method === 'GET') {
    const id = m[1];
    requireClient(id);
    const st = ensureState(id);
    const gaps = ensureGaps(st);
    return sendJSON(res, 200, { gaps, stats: gapStats(gaps) });
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)\/gaps\/([\w]+)\/verify$/)) && method === 'POST') {
    const id = m[1], gid = m[2];
    requireClient(id);
    const st = ensureState(id);
    const gaps = ensureGaps(st);
    const g = gaps.find((x) => x.id === gid);
    if (!g) return sendJSON(res, 404, { error: '这条缺口不存在' });

    // 真跑一次检索 + 模型，答得上来才销账；不算员工提问，也不再记缺口
    // 用当初产生这条缺口的助手口径验证，避免换了范围更宽的助手误判「已经能答」
    const r = await probeQuestion(id, g.q, g.aid || '');
    const ok = !r.error && !r.gap && (r.citations || []).length > 0;
    const now = new Date().toISOString();
    g.verify = {
      at: now, ok, by: 'verify',
      answer: String(r.answer || r.error || '').slice(0, 240),
      docs: (r.citations || []).slice(0, 3).map((c) => c.doc),
    };
    if (ok) {
      g.status = 'resolved';
      g.resolvedAt = now;
      g.resolvedBy = 'verify';
    } else if (g.status === 'resolved') {
      g.status = 'open';
      g.reopenedAt = now.slice(0, 10);
      g.resolvedBy = '';
    }
    saveState(id, st);
    return sendJSON(res, 200, {
      ok, gap: g, gaps, stats: gapStats(gaps),
      answer: r.answer || '', citations: r.citations || [], error: r.error || null,
    });
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)\/gaps\/([\w]+)$/)) && (method === 'PATCH' || method === 'POST')) {
    const id = m[1], gid = m[2];
    requireClient(id);
    const b = await readJSONBody(req);
    const st = ensureState(id);
    const gaps = ensureGaps(st);
    const g = gaps.find((x) => x.id === gid);
    if (!g) return sendJSON(res, 404, { error: '这条缺口不存在' });

    const ALLOWED = ['open', 'assigned', 'resolved', 'ignored'];
    if (b.status !== undefined && !ALLOWED.includes(String(b.status))) {
      return sendJSON(res, 400, { error: '状态值不对' });
    }
    const now = new Date().toISOString();
    if (b.assignee !== undefined) {
      g.assignee = String(b.assignee).trim().slice(0, 30);
      if (g.assignee && (g.status || 'open') === 'open') g.status = 'assigned';
      if (!g.assignee && g.status === 'assigned') g.status = 'open';
    }
    if (b.note !== undefined) g.note = String(b.note).trim().slice(0, 200);
    if (b.status !== undefined) {
      g.status = String(b.status);
      if (g.status === 'resolved') { g.resolvedAt = now; g.resolvedBy = 'manual'; }
      else { g.resolvedAt = ''; g.resolvedBy = ''; }
    }
    saveState(id, st);
    return sendJSON(res, 200, { gap: g, gaps, stats: gapStats(gaps) });
  }

  /* --- 每条回答的 👍 / 👎 ---
   * 用服务端下发的 answerId 做主键，同一条回答改判/撤销都是 upsert，
   * 不会出现「一个人点五次、满意度翻倍」。 */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/answer-feedback$/)) && method === 'GET') {
    const id = m[1];
    requireClient(id);
    const list = ensureState(id).answerFeedback || [];
    return sendJSON(res, 200, { items: list.slice(0, 200), stats: feedbackStats(list) });
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)\/answer-feedback$/)) && method === 'POST') {
    const id = m[1];
    requireClient(id);
    const b = await readJSONBody(req);
    const aid = String(b.answerId || '').trim();
    if (!/^a_[\w]{6,20}$/.test(aid)) return sendJSON(res, 400, { error: '回答标识不对' });
    const vote = b.vote === null || b.vote === '' ? null : String(b.vote);
    if (vote && !['up', 'down'].includes(vote)) return sendJSON(res, 400, { error: '评价只能是 up / down' });

    const st = ensureState(id);
    st.answerFeedback = Array.isArray(st.answerFeedback) ? st.answerFeedback : [];
    const list = st.answerFeedback;
    const i = list.findIndex((x) => x.id === aid);
    if (!vote) {
      if (i >= 0) list.splice(i, 1);           // 撤销 = 删掉这条评价
    } else {
      const token = bearer(req, b);
      const viewer = token ? portalViewer(id, token) : null;
      const item = {
        id: aid,
        vote,
        reason: String(b.reason || '').trim().slice(0, 120),
        q: String(b.question || '').trim().slice(0, 200),
        answer: String(b.answer || '').trim().slice(0, 600),
        citations: (Array.isArray(b.citations) ? b.citations : []).slice(0, 6)
          .map((c) => String(c?.doc || c || '').slice(0, 120)),
        who: viewer ? viewer.name : '管理员预览',
        by: viewer ? viewer.id : 'preview',
        source: viewer ? 'portal' : 'preview',
        assistant: String(b.assistant || '').slice(0, 40),
        at: new Date().toISOString(),
        atDay: new Date().toISOString().slice(0, 10),
        gapId: i >= 0 ? (list[i].gapId || '') : '',
      };
      if (i >= 0) list[i] = item; else list.unshift(item);
      if (list.length > 300) list.length = 300;
    }
    saveState(id, st);
    return sendJSON(res, 200, { ok: true, stats: feedbackStats(list) });
  }

  if ((m = p.match(/^\/api\/clients\/([\w]+)\/answer-feedback\/([\w]+)\/to-gap$/)) && method === 'POST') {
    const id = m[1], aid = m[2];
    requireClient(id);
    const st = ensureState(id);
    const list = st.answerFeedback || [];
    const item = list.find((x) => x.id === aid);
    if (!item) return sendJSON(res, 404, { error: '这条评价不存在' });
    if (!item.q) return sendJSON(res, 400, { error: '这条评价没有对应问题' });
    recordGap(st, item.q, null);      // 已存在就自动重开，不会重复堆积
    const gaps = ensureGaps(st);
    const gap = gaps.find((g) => normGap(g.q) === normGap(item.q));
    item.gapId = gap?.id || '';
    saveState(id, st);
    return sendJSON(res, 200, { gap: gap || null, gaps, stats: feedbackStats(list) });
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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
