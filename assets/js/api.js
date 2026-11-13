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

    /* ---------- 知识库 ---------- */
    buildKb(id) { return this.post(`/api/clients/${id}/kb/build`, {}); },
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
    genTests(id, count) { return this.post(`/api/clients/${id}/tests/generate`, { count }); },
    getTests(id) { return this.get(`/api/clients/${id}/tests`); },
    runTests(id, limit, assistantId) { return this.post(`/api/clients/${id}/tests/run`, { limit, assistantId }, { timeout: 300000 }); },
    markTest(id, testId, verdict, note) { return this.post(`/api/clients/${id}/tests/mark`, { id: testId, verdict, note }); },
    report(id) { return this.get(`/api/clients/${id}/tests/report`); },
  };

  window.API = API;
})();
