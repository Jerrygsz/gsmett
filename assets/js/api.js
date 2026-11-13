/**
 * 前端 API 层
 *
 * 两种运行模式：
 *   live  —— 本地服务可用（node server/index.js），所有数据走真实接口
 *   demo  —— 本地服务不可用（例如直接打开 GitHub Pages），退回浏览器内演示数据
 *
 * 页面只需判断 API.mode，其余调用方式完全一致。
 */
(function () {
  const BASE = ''; // 与页面同源
  const KEY = 'tm_live_client';

  const API = {
    mode: 'demo',
    ready: false,
    clientId: localStorage.getItem(KEY) || null,
    lastError: null,

    /* ---------- 基础 ---------- */
    url(p) {
      const sep = p.includes('?') ? '&' : '?';
      return BASE + p;
    },

    async req(method, path, body, opts = {}) {
      const init = { method, headers: {} };
      if (body instanceof FormData) {
        init.body = body;
      } else if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), opts.timeout || 120000);
      init.signal = ac.signal;
      try {
        const res = await fetch(this.url(path), init);
        const text = await res.text();
        let json = {};
        try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
        if (!res.ok && !json.error) json.error = `HTTP ${res.status}`;
        return json;
      } finally {
        clearTimeout(timer);
      }
    },

    get(p, opts) { return this.req('GET', p, undefined, opts); },
    post(p, b, opts) { return this.req('POST', p, b, opts); },
    patch(p, b) { return this.req('PATCH', p, b); },
    del(p) { return this.req('DELETE', p); },

    /* ---------- 初始化 ---------- */
    async detect() {
      try {
        const h = await this.get('/api/health', { timeout: 2500 });
        if (h && h.ok) {
          this.mode = 'live';
          this.ready = true;
          return true;
        }
      } catch (e) {
        this.lastError = e.message;
      }
      this.mode = 'demo';
      return false;
    },

    setClient(id) {
      this.clientId = id;
      if (id) localStorage.setItem(KEY, id);
      else localStorage.removeItem(KEY);
    },

    /* ---------- 环境 ---------- */
    env() { return this.get('/api/env'); },

    /* ---------- 客户 ---------- */
    clients() { return this.get('/api/clients'); },
    createClient(data) { return this.post('/api/clients', data); },
    client(id) { return this.get(`/api/clients/${id}`); },
    state(id) { return this.get(`/api/clients/${id}/state`); },
    saveState(id, patch) { return this.patch(`/api/clients/${id}/state`, patch); },

    /* ---------- 资料 ---------- */
    docs(id) { return this.get(`/api/clients/${id}/docs`); },
    async upload(id, files) {
      const fd = new FormData();
      for (const f of files) fd.append('file', f, f.name);
      return this.post(`/api/clients/${id}/docs`, fd);
    },
    deleteDoc(id, docId) { return this.del(`/api/clients/${id}/docs/${docId}`); },
    setDocCat(id, docId, cat) { return this.patch(`/api/clients/${id}/docs/${docId}`, { cat }); },
    classifyDocs(id, body) { return this.post(`/api/clients/${id}/docs/classify`, body || {}, { timeout: 180000 }); },
    /* 扫描件识别：每份要渲染 + 调视觉模型，单次等 3 分钟 */
    ocrDocs(id, body) { return this.post(`/api/clients/${id}/docs/ocr`, body || {}, { timeout: 240000 }); },
    /* 为资料生成「能回答什么问题」 */
    docQa(id, body) { return this.post(`/api/clients/${id}/docs/qa`, body || {}, { timeout: 180000 }); },

    /* ---------- 本地文件夹扫描（真实读硬盘） ---------- */
    scan(id, dirs, recursive) { return this.post(`/api/clients/${id}/scan`, { dirs, recursive }, { timeout: 180000 }); },
    importPaths(id, payload) { return this.post(`/api/clients/${id}/import`, payload, { timeout: 600000 }); },
    folders(id) { return this.get(`/api/clients/${id}/folders`); },
    addFolders(id, dirs, recursive) { return this.post(`/api/clients/${id}/folders`, { dirs, recursive }); },
    removeFolder(id, dir) { return this.post(`/api/clients/${id}/folders/remove`, { dir }); },
    rescanFolders(id) { return this.post(`/api/clients/${id}/folders/rescan`, {}, { timeout: 600000 }); },
    /* 人话 → 真实路径 */
    resolveDirs(q) { return this.post('/api/fs/resolve', { q }, { timeout: 20000 }); },

    /* ---------- 知识库 ---------- */
    buildKb(id) { return this.post(`/api/clients/${id}/kb/build`, {}, { timeout: 300000 }); },
    kbStats(id) { return this.get(`/api/clients/${id}/kb/stats`); },
    search(id, q, topK) { return this.post(`/api/clients/${id}/kb/search`, { q, topK }); },

    /* ---------- 模型 ---------- */
    llm(id) { return this.get(`/api/clients/${id}/llm`); },
    saveLlm(id, cfg) { return this.post(`/api/clients/${id}/llm`, cfg); },
    testLlm(id) { return this.post(`/api/clients/${id}/llm/test`, {}); },

    /* ---------- AI 助手 ---------- */
    assistants(id) { return this.get(`/api/clients/${id}/assistants`); },
    saveAssistant(id, a) { return this.post(`/api/clients/${id}/assistants`, a); },
    deleteAssistant(id, aid) { return this.del(`/api/clients/${id}/assistants/${aid}`); },

    /* ---------- 问答 ---------- */
    chat(id, question, extra) { return this.post(`/api/clients/${id}/chat`, { question, ...(extra || {}) }, { timeout: 90000 }); },

    /* ---------- 测试 ---------- */
    genTests(id, count, assistantId) { return this.post(`/api/clients/${id}/tests/generate`, { count, assistantId }); },
    getTests(id) { return this.get(`/api/clients/${id}/tests`); },
    runTests(id, limit, assistantId) { return this.post(`/api/clients/${id}/tests/run`, { limit, assistantId }, { timeout: 300000 }); },
    markTest(id, testId, verdict, note) { return this.post(`/api/clients/${id}/tests/mark`, { id: testId, verdict, note }); },
    report(id) { return this.get(`/api/clients/${id}/tests/report`); },

    /* ---------- 成员（后台和客户端共用同一份） ---------- */
    members(id) { return this.get(`/api/clients/${id}/members`); },
    addMember(id, m) { return this.post(`/api/clients/${id}/members`, m); },
    editMember(id, mid, patch) { return this.patch(`/api/clients/${id}/members/${mid}`, patch); },
    removeMember(id, mid) { return this.del(`/api/clients/${id}/members/${mid}`); },

    /* ---------- 工单（申请协助 / 预约诊断 / 开通申请） ---------- */
    tickets() { return this.get('/api/tickets'); },
    newTicket(t) { return this.post('/api/tickets', t); },

    /* ---------- 服务商侧 ---------- */
    profile() { return this.get('/api/platform/profile'); },
    staff() { return this.get('/api/staff'); },
    editClient(id, patch) { return this.patch(`/api/clients/${id}`, patch); },
  };

  window.API = API;
})();
