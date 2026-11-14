/**
 * 真实模式适配层
 *
 * 作用：本地服务可用时，把服务端数据映射成现有 UI 使用的结构，
 * 让 app.js 的渲染逻辑一行不用改，只把"写"的路径换成真实接口。
 */
(function () {
  const LIVE = {
    on: false,
    ready: false,   // 服务端状态合并完成前，不往回写
    noClient: false, // 服务通但还没有客户
    clientId: null,
    client: null,
    docs: [],
    foldersList: [],
    kb: null,
    llm: null,
    tests: null,
    assistants: [],
    env: null,

    /* ---------------- 启动 ---------------- */

    async boot() {
      const ok = await API.detect();
      if (!ok) {
        console.info('[live] 本地服务不可用，使用演示数据');
        return false;
      }

      // 客户来源：URL ?c= → localStorage → 第一个客户
      const qs = new URLSearchParams(location.search);
      let cid = qs.get('c') || API.clientId;
      if (!cid) {
        const list = await API.clients();
        cid = list.clients?.[0]?.id || null;
      }
      if (!cid) {
        // 服务是通的，只是还没有客户。不能退回演示数据——那会把假客户当成真的
        console.info('[live] 服务可用，但还没有客户');
        this.noClient = true;
        return false;
      }

      API.setClient(cid);
      this.clientId = cid;

      const r = await API.client(cid);
      this.client = r.client;
      this.on = true;

      await this.reload();
      // 丢掉浏览器里的残留状态，重建一份干净的，再让服务端数据填进去。
      // 否则首次打开会继承 seed 的「1–5 步已完成」，新客户一进来就 50% 进度。
      TM.blank();

      // 服务端数据是唯一真相：首次合并直接以它为准，不能和本地演示种子取并集，
      // 否则新客户一打开就继承默认 seed 的「1–5 步已完成」
      this.firstPaint = true;
      this.paint();
      // 只有把服务端状态合并完，才允许回写。否则首屏渲染里的任何保存
      // 都会把"空进度"推回服务端，把客户已经做完的步骤覆盖成未完成
      this.ready = true;
      return true;
    },

    /* 拉取全部真实数据 */
    async reload() {
      const id = this.clientId;
      const [stateR, docsR, kbR, llmR, testsR, asstR, foldersR] = await Promise.all([
        API.state(id),
        API.docs(id),
        API.kbStats(id),
        API.llm(id),
        API.getTests(id),
        API.assistants(id),
        API.folders(id),
      ]);

      this.serverState = stateR.state || {};
      this.docs = docsR.docs || [];
      this.kb = kbR || {};
      this.llm = llmR || { configured: false };
      this.tests = testsR || { items: [] };
      this.assistants = asstR.assistants || [];
      this.foldersList = foldersR.folders || [];
    },

    /* 把服务端状态合并进 TM.state，供现有 UI 渲染 */
    paint() {
      const S = TM.state;
      const srv = this.serverState || {};

      if (srv.org) Object.assign(S.org, srv.org);

      // 登录人：演示数据里的「陈志强」要换成这家企业真实的联系人，否则侧边栏和步骤负责人全是陌生人
      if (srv.user?.name) {
        Object.assign(S.user, srv.user);
        for (const st of TM.STEPS) {
          if (st.owner) st.owner = st.owner.replace(/陈志强/g, srv.user.name);
        }
      }

      if (srv.members) {
        /* 老数据里 status: 'pending'（等一封永远不来的邮件）。
         * 本地系统加进来就能用，统一归成 active，避免界面一直显示"待接受"。 */
        S.members = srv.members.map((m) => ({ ...m, status: m.status === 'limited' ? 'limited' : 'active' }));
      }
      if (srv.project) {
        Object.assign(S.project, {
          id: srv.project.id || S.project.id,
          name: srv.project.name || S.project.name,
          createdAt: srv.project.createdAt || S.project.createdAt,
          // 服务端没填就是没指派，不能回落到本地默认的演示顾问名
          owner: srv.project.owner || '',
          // 首次加载以服务端为准；之后才做并集合并（防刚点完还没同步就被覆盖）
          steps: this.firstPaint
            ? (srv.project.steps || {})
            : mergeSteps(S.project.steps || {}, srv.project.steps || {}),
          env: srv.project.env || S.project.env || null,
          report: srv.project.report || S.project.report || null,
          maintenance: srv.project.maintenance || S.project.maintenance || null,
          accepted: srv.project.accepted || S.project.accepted || null,
          /* 是否已开启使用：这是服务端为准的开关，本地不能自己推 */
          live: srv.project.live || S.project.live || null,
        });
      }
      this.firstPaint = false;
      S.portalAsks = srv.portalAsks || 0;
      S.portalMiss = srv.portalMiss || 0;
      S.portalGaps = srv.portalGaps || [];
      S.usage = srv.usage || { calls: 0, tokens: 0, byDay: {} };
      S.feedback = Array.isArray(srv.feedback) ? srv.feedback : (S.feedback || []);
      S.activity = srv.activity || [];

      // 资料：服务端 docs → 现有 files 结构
      S.project.files = this.docs.map((d) => ({
        id: d.id,
        name: d.name,
        ext: (d.ext || '').toUpperCase().slice(0, 4),
        cat: d.cat || guessCat(d.name),
        catSource: d.catSource || 'rule',
        catWhy: d.catWhy || '',
        catLow: !!d.catLow,
        bytes: d.size,
        size: d.sizeText,
        pages: d.pages,
        chars: d.chars,
        slices: 0,
        state: d.status === 'empty' ? 'ocr' : 'ok',
        scanned: d.scanned,
        hasOcr: !!d.hasOcr,
        ocrChars: d.ocrChars || 0,
        ocrTries: d.ocrTries || 0,
        ocrFail: d.ocrFail || '',
        ocrNote: d.ocrNote || '',
        qa: Array.isArray(d.qa) ? d.qa : [],
        sourcePath: d.sourcePath || '',
        sourceDir: d.sourceDir || '',
      }));
      // 已纳入扫描的文件夹，供资料页展示与「重新扫描」
      S.project.folders = this.foldersList || [];

      // 测试题：服务端结果 → 现有 TEST_QUESTIONS 结构
      this.paintTests();

      TM.save();
    },

    paintTests() {
      const items = this.tests?.items || [];
      const results = this.tests?.results || [];
      const byId = Object.fromEntries(results.map((r) => [r.id, r]));

      if (!items.length) return;

      const mapped = items.map((t, i) => {
        const r = byId[t.id];
        const cite = r?.citations?.[0];
        return {
          id: i + 1,
          rid: t.id,
          cat: r ? (r.gap ? '资料不足' : '业务知识') : '待运行',
          key: !!t.key,
          q: t.q,
          a: r?.answer || (r ? '（没有生成回答）' : ''),
          cite: cite ? `${cite.doc}${cite.page ? ' · P.' + cite.page : ''}` : '—',
          // 没判定就是没判定，不能默认算通过——统计会虚高，客户一看就穿
          r: ['pass', 'fix', 'gap'].includes(r?.verdict) ? r.verdict : 'unmarked',
        };
      });

      const Q = TM.TEST_QUESTIONS;
      Q.length = 0;
      mapped.forEach((m) => Q.push(m));

      if (results.length) {
        const marks = {};
        /* 按题号（t0/t1…）对齐，不用数组下标。
         * results 的顺序不保证和 items 一致，一旦错位，
         * 点第 2 题就会存成第 1 题——正是客户反馈的那个现象 */
        results.forEach((r, i) => {
          if (!['pass', 'fix', 'gap'].includes(r.verdict)) return;
          const idx = items.findIndex((t) => t.id === r.id);
          const slot = (idx >= 0 ? idx : i) + 1;
          marks[slot] = r.verdict;
        });
        TM.state.project.testRun = {
          generated: true,
          ran: true,
          at: (this.tests.ranAt || '').slice(0, 16).replace('T', ' '),
          marks,
        };
      } else if (items.length) {
        TM.state.project.testRun = { generated: true, ran: false, at: null, marks: {} };
      }
    },

    /* 把本地勾选/进度同步到服务端（防抖） */
    syncSoon() {
      if (!this.on || !this.ready) return;
      clearTimeout(this._t);
      this._t = setTimeout(() => {
        const S = TM.state;
        API.saveState(this.clientId, {
          org: S.org,
          // 成员不再整块回写：后台也能改，一旦这里推旧值就会把后台的修改覆盖掉。
          // 客户端的成员增删改统一走 /members 接口。
          feedback: S.feedback || [],
          activity: S.activity,
          portalAsks: S.portalAsks,
          portalMiss: S.portalMiss,
          project: {
            steps: S.project.steps,
            env: S.project.env || null,
            report: S.project.report || null,
            maintenance: S.project.maintenance || null,
            accepted: S.project.accepted || null,
            /* 一定要带上：服务端是浅合并，project 整块替换，
             * 不带 live 就会把「已开启使用」又抹成未开启 */
            live: S.project.live || null,
          },
        }).catch(() => { });
      }, 600);
    },

    /* ---------------- 环境检测 ---------------- */

    async probeEnv() {
      const e = await API.env();
      this.env = e;
      return e;
    },

    /* ---------------- 资料 ---------------- */

    async upload(fileList) {
      const files = Array.from(fileList || []);
      if (!files.length) return { added: [], failed: [] };
      const r = await API.upload(this.clientId, files);
      if (r.error) throw new Error(r.error);
      this.docs = (await API.docs(this.clientId)).docs || [];
      return r;
    },

    async removeDoc(docId) {
      await API.deleteDoc(this.clientId, docId);
      this.docs = (await API.docs(this.clientId)).docs || [];
      return this.docs;
    },

    /* ---------------- 本地文件夹扫描 ---------------- */

    async scanDirs(dirs, recursive) {
      const r = await API.scan(this.clientId, dirs, recursive);
      if (r.error) throw new Error(r.error);
      return r;
    },

    async importPaths(payload) {
      const r = await API.importPaths(this.clientId, payload);
      if (r.error) throw new Error(r.error);
      this.docs = (await API.docs(this.clientId)).docs || [];
      return r;
    },

    async addFolders(dirs, recursive) {
      const r = await API.addFolders(this.clientId, dirs, recursive);
      if (r.error) {
        const e = new Error(r.error);
        e.data = r;
        throw e;
      }
      this.foldersList = r.folders || [];
      return r;
    },

    /* 把「桌面」「D盘的公司资料」这类说法解析成真实路径（只探测，不扫描） */
    async resolveDirs(q) {
      const r = await API.resolveDirs(q);
      return r || {};
    },

    async removeFolder(dir) {
      const r = await API.removeFolder(this.clientId, dir);
      if (r.error) throw new Error(r.error);
      this.foldersList = r.folders || [];
      return r;
    },

    async rescanFolders() {
      const r = await API.rescanFolders(this.clientId);
      if (r.error) throw new Error(r.error);
      this.foldersList = r.folders || this.foldersList;
      this.docs = (await API.docs(this.clientId)).docs || [];
      return r;
    },

    /* ---------------- 知识库 ---------------- */

    async buildKb() {
      const r = await API.buildKb(this.clientId);
      if (r.error) throw new Error(r.error);
      this.kb = r;
      return r;
    },

    /* ---------------- 模型 ---------------- */

    async saveLlm(cfg) {
      const r = await API.saveLlm(this.clientId, cfg);
      if (r.ok) this.llm = { configured: true, ...r.config, source: 'client' };
      return r;
    },

    /* 真发一次请求验证，不是假装通过 */
    async testLlm() {
      const r = await API.testLlm(this.clientId);
      if (!r.ok && r.error) throw new Error(r.error);
      return r;
    },

    /* ---------------- AI 助手 ---------------- */

    async saveAssistant(a) {
      const r = await API.saveAssistant(this.clientId, a);
      if (r.error) throw new Error(r.error);
      this.assistants = r.assistants || [];
      return r;
    },

    async removeAssistant(aid) {
      const r = await API.deleteAssistant(this.clientId, aid);
      if (r.error) throw new Error(r.error);
      this.assistants = r.assistants || [];
      return r;
    },

    async setDocCat(docId, cat) {
      const r = await API.setDocCat(this.clientId, docId, cat);
      if (r.error) throw new Error(r.error);
      this.docs = r.docs || this.docs;
      return r;
    },

    /* AI 按内容判定分类：一批最多 10 份，调用方循环直到 done */
    async classifyDocs(ids, limit) {
      const payload = {};
      if (ids && ids.length) payload.ids = ids;
      if (limit) payload.limit = limit;
      const r = await API.classifyDocs(this.clientId, payload);
      if (r.error) {
        const e = new Error(r.error);
        e.data = r;
        throw e;
      }
      this.docs = (await API.docs(this.clientId)).docs || [];
      return r;
    },

    /* 扫描件识别文字：一批最多 4 份，调用方循环直到 done */
    async ocrDocs(ids, limit, pages) {
      const payload = {};
      if (ids && ids.length) payload.ids = ids;
      if (limit) payload.limit = limit;
      if (pages) payload.pages = pages;
      const r = await API.ocrDocs(this.clientId, payload);
      if (r.error) {
        const e = new Error(r.error);
        e.data = r;
        throw e;
      }
      this.docs = (await API.docs(this.clientId)).docs || [];
      return r;
    },

    /* 补跑「能回答什么问题」，不改分类 */
    async docQa(ids, limit) {
      const payload = {};
      if (ids && ids.length) payload.ids = ids;
      if (limit) payload.limit = limit;
      const r = await API.docQa(this.clientId, payload);
      if (r.error) {
        const e = new Error(r.error);
        e.data = r;
        throw e;
      }
      this.docs = (await API.docs(this.clientId)).docs || [];
      return r;
    },

    /* ---------------- 测试 ---------------- */

    async genTests(count = 12, assistantId) {
      const r = await API.genTests(this.clientId, count, assistantId || undefined);
      if (r.error) throw new Error(r.error);
      this.tests = { items: r.tests || [], results: null };
      return r;
    },

    async runTests(assistantId) {
      const r = await API.runTests(this.clientId, undefined, assistantId || undefined);
      if (r.error) throw new Error(r.error);
      this.tests = { ...this.tests, results: r.results, ranAt: r.ranAt };
      return r;
    },

    async mark(rowId, verdict) {
      // 按本地序号找题，再拿服务端真实 id；不靠数组下标对齐
      const q = TM.TEST_QUESTIONS.find((x) => x.id === rowId);
      if (!q?.rid) return;
      return API.markTest(this.clientId, q.rid, verdict);
    },

    /* ---------------- 问答 ---------------- */

    async ask(question, assistantId) {
      return API.chat(this.clientId, question, assistantId ? { assistantId } : {});
    },

    /* ---------------- 成员 ---------------- */

    async refreshMembers() {
      const r = await API.members(this.clientId);
      TM.state.members = r.members || [];
      return TM.state.members;
    },

    async addMember(m) {
      const r = await API.addMember(this.clientId, m);
      if (r.error) throw new Error(r.error);
      await this.refreshMembers();
      return r.member;
    },

    async editMember(mid, patch) {
      const r = await API.editMember(this.clientId, mid, patch);
      if (r.error) throw new Error(r.error);
      await this.refreshMembers();
      return r.member;
    },

    async removeMember(mid) {
      const r = await API.removeMember(this.clientId, mid);
      if (r.error) throw new Error(r.error);
      await this.refreshMembers();
    },

    /* ---------------- 工单 ---------------- */

    async newTicket(t) {
      const r = await API.newTicket({ ...t, clientId: this.clientId });
      if (r.error) throw new Error(r.error);
      return r.ticket;
    },
  };

  /* 和服务端同一套归类规则 */
  function guessCat(name) {
    const n = name || '';
    if (/售后|退换|保修|维修|投诉/.test(n)) return '售后资料';
    if (/SOP|流程|规范|制度/.test(n)) return '业务流程';
    if (/FAQ|常见问题|话术|销售|报价/.test(n)) return '销售资料';
    return '产品资料';
  }

  /**
   * 步骤进度合并：服务端和本地取并集，只前进不后退。
   * 单人本地交付场景不存在"两个人同时改"，用并集最安全——
   * 宁可多保留一个勾，也不能把客户刚做完的步骤打回去。
   */
  function mergeSteps(local, remote) {
    const out = { ...local };
    for (const k of Object.keys(remote)) {
      const a = out[k] || { checks: [], done: false, executed: false };
      const b = remote[k] || {};
      out[k] = {
        ...a,
        ...b,
        done: !!(a.done || b.done),
        executed: !!(a.executed || b.executed),
        checks: [...new Set([...(a.checks || []), ...(b.checks || [])])],
        at: b.at || a.at || null,
        llmLog: b.llmLog || a.llmLog || null,
      };
    }
    return out;
  }

  window.LIVE = LIVE;
})();
