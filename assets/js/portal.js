/* ==========================================================================
   贸智库 · 员工端（独立页面，不加载后台 app.js / data.js）
   - 只认服务端签发的会话令牌，服务端按员工可见分类在检索层过滤
   - 多轮追问、参数表格、引用出处、每条回答的 👍/👎 反馈
   ========================================================================== */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const app = $('#app');
  const CID = new URLSearchParams(location.search).get('c') || '';
  const TKEY = 'tm_portal_token_' + CID;

  let TOKEN = sessionStorage.getItem(TKEY) || '';
  let ME = null;            // { id, name, role, cats, allDocs }
  let META = null;          // /portal/meta
  let PROMPTS = [];
  let ASSISTANTS = [];
  let ASST_ID = '';
  let TURNS = [];
  let SUMMARY = null;
  let SENDING = false;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const ICONS = {
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4"/><circle cx="9" cy="14" r="1.1"/><circle cx="15" cy="14" r="1.1"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    up: '<path d="M7 10v11H3V10z"/><path d="M7 10l4-7a2 2 0 0 1 3 1.7V9h4.3a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17 20H7"/>',
    down: '<path d="M7 14V3H3v11z"/><path d="m7 14-4 7a2 2 0 0 0 3 1.7V15h4.3a2 2 0 0 0 2-2.4l1.4-7A2 2 0 0 0 11 4H7"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>`;

  let toastTimer;
  function toast(msg, kind) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'portal-toast is-on' + (kind ? ' is-' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'portal-toast'; }, 2800);
  }

  async function api(path, opts) {
    const o = opts || {};
    const headers = { 'Content-Type': 'application/json' };
    if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
    let r;
    try {
      r = await fetch(`/api/clients/${CID}${path}`, {
        method: o.method || 'GET',
        headers,
        body: o.body ? JSON.stringify(o.body) : undefined,
      });
    } catch (e) {
      return { error: '连不上服务，请检查网络', _status: 0 };
    }
    const j = await r.json().catch(() => ({}));
    j._status = r.status;
    if (r.status === 401 && j.code === 'AUTH') { logout(true); }
    return j;
  }

  function setToken(t) {
    TOKEN = t || '';
    if (TOKEN) sessionStorage.setItem(TKEY, TOKEN);
    else sessionStorage.removeItem(TKEY);
  }
  function logout(silent) {
    setToken('');
    ME = null; TURNS = []; SUMMARY = null;
    renderLogin(silent ? '登录已失效，请重新登录' : '');
  }

  /* ---------------- 三种页面状态 ---------------- */

  function renderLocked() {
    app.innerHTML = `<div class="portal-center">
      <div class="card card--pad locked-portal">
        <span class="locked-portal__ico">${icon('lock')}</span>
        <h2>${esc(META?.org?.name || '企业')}的内部助手还没开放</h2>
        <p>管理员还没按下「开启使用」。开放之后，用企业给你的账号登录就能提问。</p>
        <p class="fs11 muted mt14">如果这是你第一次打开，先找管理员确认账号和开放时间。</p>
      </div>
    </div>`;
  }

  function renderLogin(err) {
    app.innerHTML = `<div class="portal-center">
      <div class="portal-login">
        <div class="portal-login__brand">
          <span class="logo-mark"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h6a2.5 2.5 0 0 1 2.5 2.5v11a2 2 0 0 0-2-2H4z"/><path d="M20 5.5h-6A2.5 2.5 0 0 0 11.5 8v11a2 2 0 0 1 2-2H20z"/></svg></span>
          <div><b>${esc(META?.org?.short || META?.org?.name || '企业')}</b><span>内部资料助手</span></div>
        </div>
        <h1>登录后开始提问</h1>
        <p class="fs12 muted">账号由企业管理员分配。系统会按你的权限决定能查哪些资料。</p>
        <form id="loginForm" class="stack mt20" style="gap:12px">
          <label class="fs11 b6">登录账号（通常是企业邮箱）
            <input class="input mt6" id="loginAccount" autocomplete="username" placeholder="name@company.com" required>
          </label>
          <label class="fs11 b6">密码
            <input class="input mt6" id="loginPwd" type="password" autocomplete="current-password" placeholder="至少 6 位" required>
          </label>
          <div id="loginErr" class="portal-login__err" ${err ? '' : 'hidden'}>${esc(err || '')}</div>
          <button class="btn btn--primary" id="btnLogin" type="submit" style="width:100%;justify-content:center">进入助手</button>
        </form>
        <div class="fs11 muted mt16" style="line-height:1.7">${icon('shield')} 回答只依据企业已授权的资料，不会使用公开资料替你猜。</div>
      </div>
    </div>`;

    $('#loginForm').onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('#btnLogin'), errBox = $('#loginErr');
      const account = $('#loginAccount').value.trim(), pwd = $('#loginPwd').value;
      if (!account || !pwd) return;
      btn.disabled = true; btn.textContent = '正在登录…';
      errBox.hidden = true;
      const r = await api('/portal/login', { method: 'POST', body: { account, pwd } });
      btn.disabled = false; btn.textContent = '进入助手';
      if (r.error) {
        errBox.hidden = false;
        errBox.textContent = r.error;
        $('#loginPwd').value = '';
        return;
      }
      setToken(r.token);
      applySession(r);
      renderMain();
      loadSummary();
    };
  }

  function applySession(r) {
    ME = r.member;
    PROMPTS = r.prompts || [];
    // 这里的资料份数是「该员工可见」的，未登录时 meta 里的全库数字不能拿来用
    if (META && typeof r.docCount === 'number') META.docCount = r.docCount;
    if (r.assistants) ASSISTANTS = r.assistants;
    if (!ASST_ID && ASSISTANTS.length) ASST_ID = ASSISTANTS[0].id;
  }

  /* ---------------- Markdown → 安全 HTML（先转义再解析表格） ---------------- */
  function renderAnswer(md) {
    const inline = (s) => esc(s || '')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/`(.+?)`/g, '<code>$1</code>');
    const lines = String(md || '').replace(/\r/g, '').split('\n');
    const blocks = [];
    let para = [];
    const flush = () => {
      if (!para.length) return;
      blocks.push(`<div class="md-p">${para.map(inline).join('<br>')}</div>`);
      para = [];
    };
    const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    for (let i = 0; i < lines.length; i++) {
      const cur = lines[i].trim(), nxt = (lines[i + 1] || '').trim();
      if (cur.startsWith('|') && /^\|[\s:|\-]+$/.test(nxt) && nxt.includes('-')) {
        flush();
        const head = cells(lines[i]);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(cells(lines[i])); i++; }
        const th = head.map((c) => `<th>${inline(c)}</th>`).join('');
        const tb = rows.map((r) => `<tr>${head.map((_, k) => `<td>${inline(r[k] || '')}</td>`).join('')}</tr>`).join('');
        blocks.push(`<div class="md-table-wrap"><table class="md-table"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`);
        i--;
        continue;
      }
      if (!cur) { flush(); continue; }
      para.push(cur);
    }
    flush();
    return blocks.join('');
  }

  function feedbackHtml(t) {
    if (!t.aid) return '';
    return `<div class="ans-fb ${t.vote ? 'is-voted' : ''}" data-aid="${esc(t.aid)}">
      <span class="ans-fb__label">这个回答帮到你了吗？</span>
      <button type="button" class="ans-fb__btn ${t.vote === 'up' ? 'is-active' : ''}" data-vote="up">${icon('up')} 有用</button>
      <button type="button" class="ans-fb__btn ${t.vote === 'down' ? 'is-active' : ''}" data-vote="down">${icon('down')} 没帮上</button>
      <span class="ans-fb__hint">${t.vote ? '已记录，谢谢反馈' : ''}</span>
    </div>
    <div class="ans-fb__reason" data-reason-for="${esc(t.aid)}" ${t.vote === 'down' && !t.reasonSent ? '' : 'hidden'}>
      <input class="input" placeholder="哪里不对？（选填，例如：价格没更新 / 少了型号）" maxlength="120">
      <button type="button" class="btn btn--ghost btn--sm" data-send-reason="${esc(t.aid)}">提交</button>
    </div>`;
  }

  function turnHtml(t, includeUser) {
    const cites = t.cite && t.cite.length
      ? `<div class="msg__cite">${t.cite.map((c) => `<span>${icon('file')}${esc(c)}</span>`).join('')}</div>`
      : (t.noCite ? '' : `<div class="msg__cite"><span style="border-color:#F0DFC0;color:var(--warn);background:var(--warn-bg)">${icon('alert')}知识库无相关资料</span></div>`);
    const userMsg = includeUser
      ? `<div class="msg msg--user"><span class="msg__av">${esc(ME?.name?.slice(0, 1) || '我')}</span><div class="msg__bubble">${esc(t.q)}</div></div>`
      : '';
    return `${userMsg}<div class="msg"><span class="msg__av">智</span><div class="msg__bubble">${t.a || ''}${t.rewritten ? `<div class="msg__rewrite">接着上一轮理解为：${esc(t.rewritten)}</div>` : ''}${cites}${feedbackHtml(t)}</div></div>`;
  }

  /* ---------------- 主界面 ---------------- */
  function renderMain() {
    const org = META?.org?.short || META?.org?.name || '企业';
    const curAsst = ASSISTANTS.find((a) => a.id === ASST_ID) || ASSISTANTS[0] || null;
    const scopeTxt = ME?.allDocs ? '全部已授权资料' : `仅 ${ME.cats.join('、')}`;
    const sm = SUMMARY || {};
    const fb = sm.feedback || {};

    app.innerHTML = `<div class="portal-shell">
      <header class="portal-top">
        <div class="portal-top__brand">
          <span class="logo-mark logo-mark--sm"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h6a2.5 2.5 0 0 1 2.5 2.5v11a2 2 0 0 0-2-2H4z"/><path d="M20 5.5h-6A2.5 2.5 0 0 0 11.5 8v11a2 2 0 0 1 2-2H20z"/></svg></span>
          <div><b>${esc(org)} · 内部助手</b><span>${esc(scopeTxt)}</span></div>
        </div>
        <div class="portal-top__right">
          <span class="portal-who">${esc(ME?.name || '')}<span class="muted"> · ${esc(ME?.role || '')}</span></span>
          <button class="btn btn--quiet btn--sm" id="btnLogout" title="退出登录">${icon('logout')}<span>退出</span></button>
        </div>
      </header>

      <div class="page portal-main">
        <div class="grid portal-grid">
          <div class="portal-chat">
            <div class="portal-chat__head">
              <span style="width:30px;height:30px;border-radius:8px;background:var(--brand-50);color:var(--brand);display:grid;place-items:center">${icon('bot')}</span>
              <div style="flex:1;min-width:0">
                <div class="fs12 b6">${esc(curAsst ? curAsst.name : `${org} · 知识库助手`)}</div>
                <div class="fs11 muted">基于 ${META?.docCount || 0} 份资料 · ${esc(scopeTxt)}${curAsst?.scope?.length ? ` · 只查 ${esc(curAsst.scope.join('/'))}` : ''}</div>
              </div>
              ${ASSISTANTS.length > 1 ? `<select class="select" id="portalAsst" style="max-width:170px;height:30px;font-size:11.5px">${ASSISTANTS.map((a) => `<option value="${esc(a.id)}" ${a.id === ASST_ID ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>` : ''}
              <button class="portal-newchat" id="btnNewChat" ${TURNS.length ? '' : 'disabled'}>${icon('refresh')}<span>新对话</span></button>
            </div>

            <div class="portal-chat__body" id="chatBody">
              <div class="msg">
                <span class="msg__av">智</span>
                <div class="msg__bubble">
                  你好${ME?.name ? `，${esc(ME.name)}` : ''}。我是${esc(org)}的内部资料助手，产品参数、报价流程、售后政策都可以问，我会标出答案来自哪份文件。<br><br>
                  <span class="muted" style="font-size:12px">可以接着上一句直接追问，不用把型号再写一遍。资料里没有的内容，我会直接说没有，不会猜。</span>
                </div>
              </div>
              ${TURNS.map((t) => turnHtml(t, true)).join('')}
            </div>

            <div class="portal-chat__foot">
              ${PROMPTS.length ? `<div class="prompt-chips">
                <span class="fs11 muted" style="align-self:center;margin-right:2px">试试这样问</span>
                ${PROMPTS.map((q) => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}
              </div>` : ''}
              <div class="chat-input">
                <input class="input" id="chatInput" placeholder="输入问题，也可以直接追问：那它呢？">
                <button class="btn btn--primary" id="btnSend" style="width:44px;padding:0">${icon('send')}</button>
              </div>
            </div>
          </div>

          <div class="stack" style="gap:14px">
            <div class="card card--pad">
              <b class="fs12">我的使用</b>
              <div class="row mt12" style="gap:18px">
                <div><div class="fs11 muted">团队累计提问</div><div class="fs15 b6 tnum mt4">${sm.asks || 0}</div></div>
                <div><div class="fs11 muted">答不上来</div><div class="fs15 b6 tnum mt4">${sm.miss || 0}</div></div>
              </div>
              <div class="fs11 muted mt10">${fb.rate == null ? '还没有人评价过回答' : `回答满意度 ${fb.rate}%（${fb.rated || 0} 次评价）`}</div>
            </div>

            <div class="card card--pad">
              <div class="row--between mb12"><b class="fs12">资料补录进展</b><span class="badge ${(sm.gaps?.open || 0) ? 'badge--warn' : ''}">${sm.gaps?.open || 0} 待补</span></div>
              <div class="fs11 muted">已补 ${sm.gaps?.resolved || 0} 条 · 转化率 ${sm.gaps?.rate || 0}%</div>
              ${(sm.recentResolved || []).length ? `<div class="fs11 mt10" style="color:var(--success);line-height:1.7">${icon('check')} 最近补上：${esc(sm.recentResolved[0])}</div>` : ''}
            </div>

            <div class="note" style="background:var(--surface-2)">
              ${icon('shield')}
              <span class="fs11">你只能查到管理员授权给你的资料。看不到的内容不会出现在回答里，也不会被拿去生成答案。</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;

    bindMain();
  }

  function redrawTurns() {
    const body = $('#chatBody');
    if (!body) return;
    // 只重画问答气泡，保留最上面的欢迎语
    $$('.msg--user, .msg:not(:first-child)', body).forEach((n) => n.remove());
    TURNS.forEach((t) => body.insertAdjacentHTML('beforeend', turnHtml(t, true)));
    body.scrollTop = body.scrollHeight;
  }

  function bindMain() {
    const body = $('#chatBody'), input = $('#chatInput');
    if (TURNS.length) body.scrollTop = body.scrollHeight;

    $('#btnLogout').onclick = () => logout();
    $('#btnNewChat').onclick = () => {
      TURNS = [];
      renderMain();
      toast('已开始新对话');
    };
    const pa = $('#portalAsst');
    if (pa) pa.onchange = () => { ASST_ID = pa.value; TURNS = []; renderMain(); };

    $$('.chip[data-q]').forEach((b) => { b.onclick = () => send(b.dataset.q); });
    $('#btnSend').onclick = () => send(input.value);
    input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); } };

    /* 反馈用事件委托：气泡重绘后不用重新绑 */
    body.onclick = async (e) => {
      const voteBtn = e.target.closest('.ans-fb__btn');
      const reasonBtn = e.target.closest('[data-send-reason]');
      if (voteBtn) {
        const box = voteBtn.closest('.ans-fb');
        const aid = box.dataset.aid;
        const t = TURNS.find((x) => x.aid === aid);
        if (!t) return;
        const vote = voteBtn.dataset.vote;
        if (t.vote === vote) return submitVote(t, null, '');   // 再点一次 = 撤销
        if (vote === 'down') {
          const r = $(`[data-reason-for="${aid}"]`);
          // 第一次点：展开「哪里不对」；再点一次 = 不填原因直接提交
          if (r && r.hidden) { r.hidden = false; r.querySelector('input').focus(); return; }
          return submitVote(t, 'down', '');
        }
        return submitVote(t, 'up', '');
      }
      if (reasonBtn) {
        const aid = reasonBtn.dataset.sendReason;
        const t = TURNS.find((x) => x.aid === aid);
        if (!t) return;
        const box = $(`[data-reason-for="${aid}"]`);
        const reason = box ? box.querySelector('input').value.trim() : '';
        return submitVote(t, 'down', reason);
      }
    };

    async function submitVote(t, vote, reason) {
      const r = await api('/answer-feedback', {
        method: 'POST',
        body: {
          answerId: t.aid, vote, reason,
          question: t.q, answer: (t.raw || '').slice(0, 600),
          citations: (t.cite || []).slice(0, 6).map((c) => ({ doc: c })),
          assistant: t.assistant || '',
        },
      });
      if (r.error) { toast(r.error, 'warn'); return; }
      t.vote = vote;
      t.reasonSent = !!reason;
      redrawTurns();
      toast(vote ? (vote === 'up' ? '已记录：这个回答有用' : '已记录，管理员会看到') : '已撤销评价');
      loadSummary();
    }
  }

  /* ---------------- 问答 ---------------- */
  function historyFor() {
    const out = [];
    for (const t of TURNS.slice(-3)) {
      out.push({ role: 'user', content: t.q });
      if (t.raw) out.push({ role: 'assistant', content: t.raw.slice(0, 400) });
    }
    return out;
  }

  async function send(text) {
    const q = String(text || '').trim();
    if (!q || SENDING) return;
    SENDING = true;
    const input = $('#chatInput'), body = $('#chatBody'), btn = $('#btnSend');
    if (input) input.value = '';
    if (btn) btn.disabled = true;
    body.insertAdjacentHTML('beforeend', `<div class="msg msg--user"><span class="msg__av">${esc(ME?.name?.slice(0, 1) || '我')}</span><div class="msg__bubble">${esc(q)}</div></div>`);
    body.insertAdjacentHTML('beforeend', `<div class="msg" id="typingMsg"><span class="msg__av">智</span><div class="msg__bubble"><div class="typing"><i></i><i></i><i></i></div></div></div>`);
    body.scrollTop = body.scrollHeight;

    const r = await api('/chat', {
      method: 'POST',
      body: { question: q, history: historyFor(), assistantId: ASST_ID || undefined },
    });
    $('#typingMsg')?.remove();
    SENDING = false;
    if (btn) btn.disabled = false;

    if (r._status === 401 || r._status === 409) { toast(r.error || '会话已失效', 'warn'); return; }
    if (r.error) {
      body.insertAdjacentHTML('beforeend', `<div class="msg"><span class="msg__av">智</span><div class="msg__bubble" style="color:var(--danger)">${esc(r.error)}</div></div>`);
      body.scrollTop = body.scrollHeight;
      return;
    }

    let html, raw = '';
    if (r.needLLM) {
      const snippet = (r.citations || []).slice(0, 3)
        .map((c) => `<div style="margin-top:6px;padding:7px 9px;background:var(--surface-2);border-radius:6px;font-size:11.5px;line-height:1.6">${esc((c.snippet || '').slice(0, 150))}</div>`).join('');
      html = `<div class="md-p">${esc(r.message || '')}</div>${snippet}`;
    } else {
      raw = r.answer || '';
      html = renderAnswer(raw);
    }
    const cite = r.needLLM
      ? (r.citations || []).map((c) => `${c.doc}${c.page ? ' · P.' + c.page : ''}`)
      : (r.citations || []).map((c) => `${c.doc}${c.page ? ' · P.' + c.page : ''}`);
    const t = {
      q, a: html, raw,
      cite,
      noCite: !!r.needLLM || !!(r.citations || []).length,
      rewritten: r.rewritten || '',
      aid: r.needLLM ? '' : (r.answerId || ''),
      vote: null, reasonSent: false,
      assistant: r.assistant?.name || '',
    };
    TURNS.push(t);
    body.insertAdjacentHTML('beforeend', turnHtml(t, false));
    body.scrollTop = body.scrollHeight;
    const nc = $('#btnNewChat'); if (nc) nc.disabled = false;

    if (r.resolved) toast('你之前问过的问题，资料已经补上了');
    loadSummary();
  }

  async function loadSummary() {
    const r = await api('/portal/summary');
    if (r.error || !$('#btnLogout')) return;
    SUMMARY = r;
    // 只更新右侧数字，不重绘整个页面（否则输入框焦点会丢）
    const cards = $$('.portal-grid > .stack > .card');
    if (cards[0]) {
      const nums = $$('.tnum', cards[0]);
      if (nums[0]) nums[0].textContent = r.asks || 0;
      if (nums[1]) nums[1].textContent = r.miss || 0;
      const line = $('.fs11.muted.mt10', cards[0]);
      if (line) line.textContent = r.feedback?.rate == null
        ? '还没有人评价过回答'
        : `回答满意度 ${r.feedback.rate}%（${r.feedback.rated} 次评价）`;
    }
    if (cards[1]) {
      const badge = $('.badge', cards[1]);
      if (badge) { badge.textContent = `${r.gaps?.open || 0} 待补`; badge.className = 'badge ' + ((r.gaps?.open || 0) ? 'badge--warn' : ''); }
      const txt = $('.fs11.muted', cards[1]);
      if (txt) txt.textContent = `已补 ${r.gaps?.resolved || 0} 条 · 转化率 ${r.gaps?.rate || 0}%`;
    }
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    if (!CID) {
      app.innerHTML = `<div class="portal-center"><div class="card card--pad locked-portal">
        <span class="locked-portal__ico">${icon('alert')}</span><h2>链接不完整</h2>
        <p>缺少企业标识。请向管理员要完整的员工端链接（带 ?c= 参数）。</p></div></div>`;
      return;
    }
    META = await api('/portal/meta');
    if (META.error) {
      app.innerHTML = `<div class="portal-center"><div class="card card--pad locked-portal">
        <span class="locked-portal__ico">${icon('alert')}</span><h2>打不开</h2><p>${esc(META.error)}</p></div></div>`;
      return;
    }
    if (!META.live) { renderLocked(); return; }

    if (TOKEN) {
      const me = await api('/portal/me');
      if (me.error) { logout(me.code === 'AUTH' ? '登录已失效，请重新登录' : me.error); return; }
      applySession(me);
      renderMain();
      loadSummary();
      return;
    }
    renderLogin('');
  }

  boot();
})();
