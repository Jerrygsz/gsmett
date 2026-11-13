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
  uploadDir, clientDir, getConfig, saveConfig,
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
 * 两层：客户自己填的 Key 优先；没填就用平台内置的（管理员在 data/config.json 里配一次，
 * 所有客户共用，方便先跑通）。浏览器的任何请求都不会拿到明文 Key。
 */
function platformLLM() {
  const l = getConfig().llm;
  return l && l.apiKey ? l : null;
}

function effectiveLLM(st) {
  const own = st?.cfg?.llm;
  if (own && own.apiKey) return { ...own, source: 'client' };
  const p = platformLLM();
  return p ? { ...p, source: 'platform' } : null;
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

/* ---------------- 路由 ---------------- */

async function route(req, res, url) {
  const p = url.pathname;
  const method = req.method;

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
      owner: b.owner || '周明',
      createdAt: new Date().toISOString().slice(0, 10),
    };
    saveClient(client);
    saveState(client.id, defaultState(client));
    saveDocs(client.id, []);
    return sendJSON(res, 200, { client });
  }

  let m;

  if ((m = p.match(/^\/api\/clients\/([\w]+)$/)) && method === 'GET') {
    const c = requireClient(m[1]);
    return sendJSON(res, 200, { client: c, state: ensureState(c.id) });
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

  /* --- 知识库 --- */
  if ((m = p.match(/^\/api\/clients\/([\w]+)\/kb\/build$/)) && method === 'POST') {
    const id = m[1];
    requireClient(id);
    const docs = getDocs(id).filter((d) => d.status === 'ok');
    if (!docs.length) return sendJSON(res, 400, { error: '还没有可用的资料，先上传再建库' });

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
    saveIndex(id, {
      chunks,
      index: { ...index, postings: index.postings },
      builtAt: new Date().toISOString(),
    });

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

    return sendJSON(res, 200, {
      ok: true,
      chunks: chunks.length,
      docs: docs.length,
      terms: Object.keys(index.postings).length,
      perDoc,
      ms: Date.now() - started,
    });
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

  /* --- 平台内置模型配置（管理员用，Key 只在服务端） --- */
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
      source: eff?.source || null,          // client = 客户自己的 Key，platform = 平台内置
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

    if (!cfg?.apiKey) {
      // 没有模型就出不了真实的测试题。硬凑"原句抽查"没有判定价值，直接说清楚。
      return sendJSON(res, 400, {
        error: '生成测试题需要先配置模型。测试题要基于你的资料自动出，没有模型只能瞎编，那不如不出。请先到第 5 步填入 API Key。',
        needLLM: true,
      });
    }

    const sample = pickEvenly(idx.chunks, Math.min(12, idx.chunks.length))
      .map((c) => c.text.slice(0, 300))
      .join('\n---\n');

    try {
      const r = await LLM.chat(cfg, [
        { role: 'system', content: '你是企业知识库测试出题人。' },
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
