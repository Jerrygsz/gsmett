/* ==========================================================================
   贸智库 TradeMind — 客户端应用
   路由 / 视图渲染 / 交互
   ========================================================================== */
(function () {
  'use strict';

  const { qi, qa, icon, esc, toast, modal, sleep, ringSVG, SERVICES, STEPS, DOCS, MODELS, ASSISTANTS, TESTS, ACTIVITY, TODO } = TM;

  TM.load();
  const S = TM.state;
  const view = qi('#view');

  /* ---------------------------------------------------------------------
     路由
     --------------------------------------------------------------------- */
  const ROUTES = {
    dashboard: { title: '工作台', render: renderDashboard },
    store: { title: '服务商城', render: renderStore },
    wizard: { title: '项目向导', render: renderWizard },
    config: { title: '配置中心', render: renderConfig },
    members: { title: '成员与权限', render: renderMembers },
    test: { title: '测试与验收', render: renderTest },
    portal: { title: '员工门户', render: renderPortal },
    logs: { title: '操作与运行记录', render: renderLogs },
    settings: { title: '设置', render: renderSettings },
  };

  let current = { route: 'dashboard', param: null };

  function parseHash() {
    const raw = (location.hash || '#dashboard').replace(/^#/, '');
    const [r, p] = raw.split('/');
    return { route: ROUTES[r] ? r : 'dashboard', param: p || null };
  }

  function go(route, param) {
    location.hash = param ? `${route}/${param}` : route;
  }

  function router() {
    current = parseHash();
    const def = ROUTES[current.route];
    qi('#pageTitle').textContent = def.title;
    document.title = `${def.title} · 贸智库 TradeMind`;
    qa('.nav-item[data-route]').forEach(n => n.classList.toggle('is-active', n.dataset.route === current.route));
    view.innerHTML = '';
    def.render(view, current.param);
    window.scrollTo({ top: 0 });
    syncChrome();
  }

  function syncChrome() {
    const p = TM.progress();
    qi('#navProg').textContent = p.pct + '%';
    qi('#orgShort').textContent = S.org.short || S.org.name.slice(0, 8);
    const orgAv = qi('#orgAvatar');
    if (orgAv) orgAv.textContent = (S.org.short || S.org.name || '企').slice(0, 1);
    // 侧栏副标题以前写死「标准交付 · 30 人」，真实客户看着莫名其妙，改成按实际数据
    const orgSub = qi('#orgSub');
    if (orgSub) {
      const n = (S.members || []).length;
      orgSub.textContent = `${S.org.plan || '标准交付'}${n ? ` · ${n} 人` : ''}`;
    }
    qi('#userName').textContent = S.user.name;
    qi('#userAvatar').textContent = S.user.initial;
  }

  /* ---------------------------------------------------------------------
     通用片段
     --------------------------------------------------------------------- */
  /* 计划交付日 = 项目创建日 + 30 天 */
  function projectDue() {
    const d = new Date((S.project.createdAt || TM.fmtDate(new Date())) + 'T00:00:00');
    if (isNaN(d.getTime())) d.setTime(Date.now());
    d.setDate(d.getDate() + 30);
    return {
      m: d.getMonth() + 1,
      d: d.getDate(),
      mmdd: `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`,
      full: TM.fmtDate(d),
    };
  }

  /* 记录一条真实操作，工作台「最近动态」读它 */
  function logAct(txt, who) {
    const d = new Date();
    S.activity = S.activity || [];
    S.activity.unshift({
      t: `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${TM.fmtTime(d).slice(0, 5)}`,
      txt,
      who: who || S.user.name,
    });
    S.activity = S.activity.slice(0, 20);
    TM.save();
  }

  /* 待办跟着当前步骤走，不再用写死的演示数据 */
  function buildTodos() {
    const cur = TM.currentStep();
    const p = TM.progress();
    const saved = TM.stepState(cur.id);
    const out = [];

    if (p.done === STEPS.length) {
      return [{ icon: 'checkCircle', color: 'var(--success)', bg: 'var(--success-bg)', title: '项目已全部完成', desc: '十个步骤均已通过检查，可下载交付材料', act: '查看报告', step: 9 }];
    }

    const unchecked = cur.checks.filter(c => !saved.checks.includes(c.id));
    out.push({
      icon: 'arrowRight', color: 'var(--brand)', bg: 'var(--brand-50)',
      title: `第 ${cur.id} 步 · ${cur.title}`,
      desc: unchecked.length
        ? `还差 ${unchecked.length} 项检查：${unchecked[0].label}`
        : '检查项已满足，可以点「完成这一步」',
      act: unchecked.length ? '去处理' : '去确认', step: cur.id,
    });

    if (cur.id <= 3 && !(S.project.files || []).length) {
      out.push({ icon: 'folder', color: 'var(--warn)', bg: 'var(--warn-bg)', title: '还没有添加企业资料', desc: '产品目录和规格表决定回答的上限', act: '去上传', step: 3 });
    }

    if (cur.id >= 7 && !(S.project.testRun && S.project.testRun.generated)) {
      out.push({ icon: 'target', color: 'var(--info)', bg: 'var(--info-bg)', title: '测试题还没有生成', desc: '50 道题，覆盖产品 / 销售 / 邮件 / 安全', act: '去生成', step: 7 });
    }

    if (S.project.report && (S.project.report.fix + S.project.report.gap) > 0) {
      const n = S.project.report.fix + S.project.report.gap;
      out.push({ icon: 'alert', color: 'var(--warn)', bg: 'var(--warn-bg)', title: `${n} 项待整改`, desc: '报告里的问题清单，约定 3 个工作日内完成', act: '查看报告', step: 9 });
    }

    return out.slice(0, 3);
  }

  function pageHead(title, desc, actions) {
    return `<div class="page-head">
      <div class="page-head__txt">
        <h1>${esc(title)}</h1>
        <p>${desc}</p>
      </div>
      <div class="row">${actions || ''}</div>
    </div>`;
  }

  function sectionHead(title, meta, right) {
    return `<div class="section-head">
      <h3>${esc(title)}</h3>
      ${meta ? `<span>${esc(meta)}</span>` : ''}
      ${right ? `<div class="row--between">${right}</div>` : ''}
    </div>`;
  }

  const svcById = id => SERVICES.find(s => s.id === id);

  function stepMetaLabel(role) {
    const map = {
      '客户填写': ['badge--info', 'user'],
      '本地工具检查': ['badge--brand', 'monitor'],
      '客户操作': ['badge--info', 'edit'],
      '自动化执行': ['badge--brand', 'zap'],
      '客户授权': ['badge--warn', 'key'],
      '双方测试': ['badge--warn', 'target'],
      '双方确认': ['badge--warn', 'checkCircle'],
      '交付完成': ['badge--success', 'checkCircle'],
    };
    return map[role] || ['', 'info'];
  }

  /* =====================================================================
     1. 工作台
     ===================================================================== */
  function renderDashboard(root) {
    const p = TM.progress();
    const cur = TM.currentStep();
    const remain = STEPS.length - p.done;
    const allDone = p.done === STEPS.length;
    const due = projectDue();

    root.innerHTML = `<div class="page">

      <div class="hero-strip">
        <div class="hero-strip__txt">
          <div class="hero-strip__eyebrow">${allDone ? '已完成' : '进行中'} · 项目编号 ${esc(S.project.id)}</div>
          <h2>${esc(S.project.name)}${allDone ? '：已交付' : `：还剩 ${remain} 步`}</h2>
          <p>${allDone
            ? '十个步骤全部完成，验收报告与操作手册已归档。后续的知识库更新、权限调整都在配置中心处理。'
            : `当前在第 ${cur.id} 步「${esc(cur.title)}」。${cur.id === 6 ? '配置已确认，等待执行创建助手。' : '按向导继续即可，遇到卡点可以随时申请人工协助。'}计划 ${due.m} 月 ${due.d} 日完成交付。`}</p>
          <div class="row mt16">
            <a class="btn btn--primary" href="#wizard/${cur.id}">${allDone ? '查看交付记录' : `继续第 ${cur.id} 步`} ${icon('arrowRight')}</a>
            <a class="btn" href="#test" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);color:#fff">查看测试与验收</a>
          </div>
        </div>
        <div class="hero-strip__stats">
          <div class="hero-strip__stat"><b>${p.pct}%</b><span>整体进度</span></div>
          <div class="hero-strip__stat"><b>${p.done}/${p.total}</b><span>已完成步骤</span></div>
          <div class="hero-strip__stat"><b>${due.mmdd}</b><span>计划交付</span></div>
        </div>
      </div>

      ${sectionHead('选购的服务', '已开通 1 项 · 可随时增购', `<a class="btn btn--quiet btn--sm" href="#store">全部服务 ${icon('chevronRight')}</a>`)}

      <div class="grid g4">
        ${serviceTile('kb', '企业 AI 知识库', '已开通 · 实施中', true)}
        ${serviceTile('sales', 'AI 外贸销售助手', '未开通', false)}
        ${serviceTile('train', '企业 AI 培训系统', '未开通', false)}
        ${serviceTile('admin', '企业 AI 管理', '随项目开通', false)}
      </div>

      ${sectionHead('我的项目', '共 1 个', `<span class="fs12 muted">按最近更新排序</span>`)}

      <div class="grid g2">
        <div class="proj-card">
          <div class="proj-card__top">
            <span class="proj-card__icon">${icon('book')}</span>
            <div style="flex:1;min-width:0">
              <div class="proj-card__title">${esc(S.project.name)}</div>
              <div class="proj-card__sub">
                <span>${esc(S.project.id)}</span><i></i>
                <span>服务顾问 ${esc(S.project.owner)}</span><i></i>
                <span>创建于 ${esc(S.project.createdAt)}</span>
              </div>
            </div>
            <span class="badge badge--brand badge--dot">实施中</span>
          </div>
          <div class="proj-card__prog">
            <div class="bar"><div class="bar__fill" style="width:${p.pct}%"></div></div>
            <b class="tnum">${p.pct}%</b>
          </div>
          <div class="row--between" style="font-size:12px;color:var(--text-3)">
            <span>已完成 ${p.done} / ${p.total} 个步骤 · 当前第 ${cur.id} 步</span>
            <span>本步预计 ${cur.minutes} 分钟</span>
          </div>
          <div class="proj-card__foot">
            <div class="row">
              ${(S.members || []).slice(0, 3).map((m, i) => `<span class="avatar" style="width:24px;height:24px;font-size:10px;background:${['#2C5866', '#7A5C2E', '#3E4F63'][i % 3]};${i ? 'margin-left:-6px' : ''}">${esc(m.name.slice(0, 1))}</span>`).join('')}
              <span class="fs12 muted" style="margin-left:8px">${(S.members || []).length} 人参与</span>
            </div>
            <a class="btn btn--ghost btn--sm" href="#wizard/${cur.id}">继续项目 ${icon('arrowRight')}</a>
          </div>
        </div>

        <div class="proj-card" style="justify-content:center;align-items:center;text-align:center;border-style:dashed;background:var(--surface-2)">
          <div style="padding:14px 0">
            <span style="width:42px;height:42px;border-radius:50%;background:var(--surface-3);display:grid;place-items:center;margin:0 auto 12px;color:var(--text-3)">
              ${icon('plus')}
            </span>
            <div class="fs13 b5 mb8">还需要解决别的问题？</div>
            <p class="fs12 muted" style="max-width:250px;margin:0 auto 14px">销售助手和培训系统可以单独购买，也可以等知识库交付后再叠加。</p>
            <a class="btn btn--ghost btn--sm" href="#store">查看可增购服务</a>
          </div>
        </div>
      </div>

      ${sectionHead('需要你处理', `${buildTodos().length} 项待办`)}
      <div class="grid g2" style="align-items:start">
        <div class="card card--pad">
          ${buildTodos().map(t => `
            <div class="todo-item">
              <span class="todo-item__ico" style="background:${t.bg};color:${t.color}">${icon(t.icon)}</span>
              <div class="todo-item__body">
                <b>${esc(t.title)}</b>
                <span>${esc(t.desc)}</span>
              </div>
              <a class="btn btn--quiet btn--sm" href="#wizard/${t.step}">${esc(t.act)}</a>
            </div>`).join('')}
        </div>

        <div class="card card--pad">
          <div class="row--between mb12">
            <b class="fs13">最近动态</b>
            <a class="fs12 muted" href="#logs">全部记录</a>
          </div>
          <div class="tl">
            ${(S.activity && S.activity.length) ? S.activity.slice(0, 5).map(a => `
              <div class="tl-item tl-item--done">
                <b>${esc(a.txt)}</b>
                <span>${esc(a.who)} · ${esc(a.t)}</span>
              </div>`).join('') : `<div class="fs12 muted" style="padding:8px 0">还没有操作记录。完成第一步后会出现在这里。</div>`}
          </div>
        </div>
      </div>

      <div class="note note--info mt24">
        ${icon('info')}
        <span><b>关于数据边界：</b>本平台负责流程引导、配置管理与交付验收。涉及你本机文件读取、软件安装和服务启动的操作，需要经由你授权的本地助手执行，或由服务顾问在获得你确认后人工完成 —— 普通网页无法也不应该直接操作你的电脑。</span>
      </div>
    </div>`;

    // 服务卡点击
    qa('[data-svc]').forEach(n => n.onclick = () => {
      const id = n.dataset.svc;
      if (id === 'kb') go('wizard', String(TM.currentStep().id));
      else if (id === 'admin') toast('企业 AI 管理随项目交付后自动开通', 'info');
      else buyService(id);
    });
  }

  function serviceTile(id, name, state, active) {
    const conf = {
      kb: ['book', '#00867D', '#E8F4F3', '整理产品目录、SOP、FAQ，建成可查询的专属知识库'],
      sales: ['mail', '#2563A8', '#EBF2FA', '辅助询盘回复、产品介绍和英文邮件润色'],
      train: ['users', '#B4740F', '#FCF3E3', '按岗位拆课，配操作指南和练习任务'],
      admin: ['shield', '#4A6B76', '#EEF2F4', '使用情况、权限、维护与效果检查'],
    }[id];
    return `<div class="card card--hover" data-svc="${id}" style="padding:16px;cursor:pointer">
      <div class="row--between" style="align-items:flex-start">
        <span style="width:34px;height:34px;border-radius:9px;background:${conf[2]};color:${conf[1]};display:grid;place-items:center">${icon(conf[0])}</span>
        <span class="badge ${active ? 'badge--brand badge--dot' : ''}" style="${active ? '' : 'background:transparent;color:var(--text-4)'}">${esc(state)}</span>
      </div>
      <div class="fs13 b6" style="margin-top:12px">${esc(name)}</div>
      <p class="fs12 muted" style="margin-top:4px;line-height:1.6">${esc(conf[3])}</p>
    </div>`;
  }

  /* =====================================================================
     2. 服务商城
     ===================================================================== */
  function renderStore(root) {
    root.innerHTML = `<div class="page">
      ${pageHead('服务商城', '选一个具体要解决的问题。每个服务都按固定步骤交付，做完测试才算完成。',
        `<a class="btn btn--ghost btn--sm" href="#wizard">查看进行中项目</a>`)}

      <div class="grid g3">
        ${SERVICES.map(s => `
          <div class="svc-card">
            <div class="row--between" style="align-items:flex-start">
              <span class="svc-card__ico" style="background:${s.bg};color:${s.color}">${icon(s.icon)}</span>
              ${s.popular ? '<span class="badge badge--brand">最常购买</span>' : `<span class="badge">${s.weeks}</span>`}
            </div>
            <div>
              <h4>${esc(s.name)}</h4>
              <div class="fs11 muted mt4" style="letter-spacing:.04em;text-transform:uppercase">${esc(s.en)}</div>
            </div>
            <p>${esc(s.desc)}</p>
            <ul class="svc-card__list">
              ${s.items.map(i => `<li>${icon('check')}<span>${esc(i)}</span></li>`).join('')}
            </ul>
            <div class="svc-card__foot">
              <div class="svc-card__price"><b>${s.price}</b><span>${s.unit}</span></div>
              <button class="btn btn--primary btn--sm" data-buy="${s.id}">选择此服务</button>
            </div>
          </div>`).join('')}
      </div>

      <div class="note note--warn mt20">
        ${icon('alert')}
        <span><b>价格说明：</b>以上为首期标准交付价，含 10 步实施流程、50 题测试与 12 个月维护。企业规模超过 100 人、资料超过 500 份或需要私有化部署的，按实际工作量单独报价。</span>
      </div>

      ${sectionHead('三个服务怎么选', '按你当前最痛的那件事选')}
      <div class="card" style="overflow:hidden">
        <table class="table">
          <thead><tr>
            <th style="width:26%">对比项</th><th>企业 AI 知识库</th><th>AI 外贸销售助手</th><th>企业 AI 培训系统</th>
          </tr></thead>
          <tbody>
            <tr><td class="b5">解决的问题</td><td>资料散、查不到、答案不统一</td><td>写英文邮件慢、回复口径不一致</td><td>系统搭好了没人用</td></tr>
            <tr><td class="b5">前置条件</td><td>有可用的产品资料</td><td>需要先有知识库</td><td>需要先有可用的助手</td></tr>
            <tr><td class="b5">交付周期</td><td>3–4 周</td><td>2–3 周</td><td>2 周</td></tr>
            <tr><td class="b5">验收方式</td><td>50 题测试 · 通过率 ≥85%</td><td>20 个真实询盘场景 · 人工评分</td><td>员工考核 · 80 分以上</td></tr>
            <tr><td class="b5">谁需要参与</td><td>老板 + 销售主管</td><td>销售团队</td><td>老板 + 全体员工</td></tr>
            <tr><td class="b5">建议顺序</td><td><span class="badge badge--brand">第一步</span></td><td>知识库之后</td><td>助手稳定运行 1 个月后</td></tr>
          </tbody>
        </table>
      </div>

      ${sectionHead('不打包，只交付结果', '流程透明，进度可见')}
      <div class="grid g4">
        ${[
          ['target', '先定验收线', '每项服务在开始前就约定通过标准，达不到不进入验收。'],
          ['route', '步骤可见', '十步流程写清楚谁做什么、做完检查什么，不靠口头承诺。'],
          ['shield', '数据留在自己手里', '资料默认存企业自有环境，模型调用范围逐项确认。'],
          ['users', '交付后有人管', '12 个月维护期内，知识库更新和权限调整都在同一入口。'],
        ].map(([ic, t, d]) => `
          <div class="card card--pad">
            <span class="ico-md" style="color:var(--brand);display:block">${icon(ic)}</span>
            <div class="fs13 b6 mt8">${t}</div>
            <p class="fs12 muted mt4" style="line-height:1.65">${d}</p>
          </div>`).join('')}
      </div>

      <div class="card card--pad mt24" style="display:flex;align-items:center;gap:18px;background:linear-gradient(105deg,#0B191F,#123239);border:none;color:#fff">
        <div style="flex:1">
          <div class="fs15 b6 mb8">不确定该选哪个？</div>
          <p class="fs12" style="color:#93A6AE;max-width:560px;line-height:1.65">留个联系方式，服务顾问会用 20 分钟问清楚你的资料现状和团队情况，再给建议。不推销，不合适会直接说。</p>
        </div>
        <button class="btn btn--primary" id="btnConsult">预约 20 分钟诊断</button>
      </div>
    </div>`;

    qa('[data-buy]').forEach(b => b.onclick = () => buyService(b.dataset.buy));
    qi('#btnConsult').onclick = () => modal({
      title: '预约服务诊断',
      desc: '服务顾问会在 1 个工作日内联系你。',
      body: `<div class="field"><label class="field__label">联系人</label><input class="input" value="${esc(S.org.contact)}"></div>
             <div class="field"><label class="field__label">联系电话 / 微信</label><input class="input" placeholder="方便联系的时间也可以写在备注里"></div>
             <div class="field"><label class="field__label">最想解决的问题</label><textarea class="textarea" placeholder="例如：产品资料太散，销售每次报价都要问技术部"></textarea></div>`,
      okText: '提交预约',
      onOk: () => toast('已提交，服务顾问会尽快联系你'),
    });
  }

  function buyService(id) {
    const s = svcById(id);
    if (id === 'kb') { go('wizard', String(TM.currentStep().id)); return; }
    modal({
      title: `开通「${s.name}」`,
      desc: `${s.price} ${s.unit} · 交付周期 ${s.weeks}`,
      body: `
        <div class="note note--brand mb16">${icon('info')}<span>${s.id === 'sales' ? '销售助手需要先有可用的知识库作为检索基础。你当前的知识库项目进行到第 ' + TM.currentStep().id + ' 步，建议交付后再开通，否则效果会打折。' : '培训系统需要先有稳定的助手。建议在知识库交付、助手运行 1 个月后开通。'}</span></div>
        <div class="field"><label class="field__label">计划开始时间</label>
          <select class="select"><option>知识库项目交付后（推荐）</option><option>两周内</option><option>本月内</option><option>暂不确定，先登记意向</option></select>
        </div>
        <div class="field" style="margin-bottom:0"><label class="field__label">备注</label><textarea class="textarea" placeholder="有什么特殊要求可以写在这里"></textarea></div>`,
      okText: '提交开通申请',
      onOk: () => toast('已登记，服务顾问会和你确认排期'),
    });
  }

  /* =====================================================================
     3. 项目向导
     ===================================================================== */
  let activeStep = 1;

  function renderWizard(root, param) {
    const p = TM.progress();
    const cur = TM.currentStep();
    activeStep = Math.min(Math.max(parseInt(param || cur.id, 10) || 1, 1), STEPS.length);

    root.innerHTML = `<div class="page">
      ${pageHead(S.project.name,
        `项目编号 ${S.project.id} · 服务顾问 ${S.project.owner} · 计划交付 ${projectDue().full}`,
        `<span class="badge badge--brand badge--dot">实施中</span>
         <button class="btn btn--ghost btn--sm" id="btnAssist">${icon('help')} 申请人工协助</button>`)}

      <div class="row mb16" style="gap:12px">
        <div class="bar" id="pageBar" style="flex:1;height:7px"><div class="bar__fill" style="width:${p.pct}%"></div></div>
        <span class="fs12 b6 tnum" id="pagePct">${p.pct}%</span>
        <span class="fs12 muted" id="pageDone">${p.done} / ${p.total} 步已完成</span>
      </div>

      <div class="wizard">
        <div class="steps">
          <div class="steps__head">
            <h4>交付流程</h4>
            <span>${esc(svcById(S.project.serviceId).name)}</span>
          </div>
          <div class="steps__list">
            ${STEPS.map(s => {
              const st = TM.stepStatus(s.id);
              const cls = st === 'done' ? 'is-done' : st === 'active' ? 'is-active' : 'is-locked';
              const flag = st !== 'done' && TM.stepState(s.id).checks.length > 0 ? '<span class="step__flag"></span>' : '';
              return `<div class="step ${cls} ${s.id === activeStep ? 'is-current' : ''}" data-step="${s.id}">
                <span class="step__num">${st === 'done' ? icon('check') : s.id}</span>
                <div class="step__txt">
                  <b>${esc(s.title)}</b>
                  <span>${st === 'done' ? '已完成' : st === 'active' ? '进行中 · ' + esc(s.role) : esc(s.role)}</span>
                </div>
                ${flag}
              </div>`;
            }).join('')}
          </div>
        </div>

        <div id="stepPanel"></div>
      </div>
    </div>`;

    qa('.step').forEach(n => n.onclick = () => {
      const id = +n.dataset.step;
      activeStep = id;
      renderStepPanel();
      qa('.step').forEach(x => x.classList.toggle('is-current', +x.dataset.step === id));
    });

    qi('#btnAssist').onclick = openAssist;
    renderStepPanel();
  }

  function renderStepPanel() {
    const panel = qi('#stepPanel');
    const step = STEPS.find(s => s.id === activeStep);
    const st = TM.stepStatus(step.id);

    // 进入步骤前先按当前数据校正检查项，避免显示与实际不一致
    if (st !== 'locked') {
      if (step.id === 1) syncOrgChecks(step);
      if (step.id === 6) syncStep6Checks(step);
      if (step.id === 7) syncStep7Checks(step);
      if (step.id === 8) syncStep8Checks(step);
      if (step.id === 9) syncStep9Checks(step);
      if (step.id === 10) syncStep10Checks(step);
    }

    const saved = TM.stepState(step.id);
    const [badgeCls, badgeIcon] = stepMetaLabel(step.role);

    const checkedCount = saved.checks.length;
    const checkTotal = step.checks.length;
    const allChecked = checkedCount === checkTotal;

    panel.innerHTML = `
      <div class="step-main">
        <div class="step-main__head">
          <div class="step-main__eyebrow">
            <span>第 ${step.id} 步 / 共 ${STEPS.length} 步</span>
            <span style="color:var(--text-4)">·</span>
            <span class="badge ${badgeCls}">${icon(badgeIcon)}${esc(step.role)}</span>
            ${st === 'done' ? '<span class="badge badge--success">已完成</span>' : ''}
          </div>
          <h2>${esc(step.title)}</h2>
          <p>${esc(step.what)}</p>
          <div class="row mt12" style="gap:16px;font-size:11.5px;color:var(--text-3)">
            <span class="row" style="gap:5px">${icon('users')} 负责：${esc(step.owner)}</span>
            <span class="row" style="gap:5px">${icon('clock')} 预计 ${step.minutes} 分钟</span>
          </div>
        </div>

        <div class="step-body">
          ${st === 'locked' ? `
            <div class="note note--warn mb20">${icon('lock')}
              <span>这一步还没解锁。需要先完成第 ${step.id - 1} 步「${esc(STEPS[step.id - 2].title)}」。<a href="#wizard/${step.id - 1}" style="color:var(--brand);text-decoration:underline">回到上一步</a></span>
            </div>` : ''}

          ${st === 'done' ? `
            <div class="done-banner mb20">
              <span class="done-banner__ico">${icon('checkCircle')}</span>
              <div>
                <h3>这一步已完成</h3>
                <p>${esc(step.checks.length)} 项检查全部通过 · 完成于 ${esc(saved.at || '2026-11-09')} · 记录已归入项目档案</p>
              </div>
            </div>` : ''}

          <div class="step-block">
            <div class="step-block__label">为什么做这一步</div>
            <p class="fs13 dim" style="line-height:1.75">${esc(step.why)}</p>
          </div>

          <div class="step-block">
            <div class="step-block__label">具体怎么做</div>
            <ol class="howto">
              ${step.howto.map(h => `<li><span>${esc(h)}</span></li>`).join('')}
            </ol>
          </div>

          ${step.id === 3 ? `
          <div class="step-block">
            <div class="step-block__label">上传与分类</div>
            ${st === 'locked'
              ? `<div class="note note--warn">${icon('lock')}<span>完成第 2 步「电脑及环境检查」后即可上传资料。</span></div>`
              : docManager()}
          </div>` : ''}

          ${step.id === 7 ? `
          <div class="step-block">
            <div class="step-block__label">测试工作台</div>
            ${st === 'locked'
              ? `<div class="note note--warn">${icon('lock')}<span>完成第 6 步「AI 助手创建」后即可生成测试题。</span></div>`
              : testBench()}
          </div>` : ''}

          ${step.id === 1 ? `
          <div class="step-block">
            <div class="step-block__label">需要你操作</div>
            ${st === 'locked' ? '' : companyForm()}
          </div>` : ''}

          ${step.id === 8 ? `
          <div class="step-block">
            <div class="step-block__label">需要你操作</div>
            ${st === 'locked'
              ? `<div class="note note--warn">${icon('lock')}<span>完成第 7 步「知识库测试」后即可添加试用成员。</span></div>`
              : inviteBox()}
          </div>` : ''}

          ${step.exec && step.id !== 7 && step.id !== 2 ? `
          <div class="step-block">
            <div class="step-block__label">自动执行</div>
            <div class="exec-box">
              <div class="exec-box__top">
                <span class="exec-box__ico">${icon(step.role === '客户授权' ? 'key' : 'zap')}</span>
                <div style="flex:1">
                  <b>${esc(step.exec.label)}</b>
                  <span>${esc(step.exec.desc)}</span>
                </div>
                <button class="btn btn--ghost btn--sm" id="btnExec" ${st === 'locked' ? 'disabled' : ''}>
                  ${saved.executed ? icon('refresh') + ' 重新执行' : icon('play') + ' 开始执行'}
                </button>
              </div>
              <div class="console" id="console" style="display:${saved.executed ? 'block' : 'none'}">
                ${saved.executed
                  ? (saved.llmLog
                      ? saved.llmLog.map(l => `<div><span class="ts">${esc(l[2] || '')}</span><span class="${l[0]}">${esc(l[1])}</span></div>`).join('')
                      : buildLogs(step).map(l => `<div><span class="ts">${'10:2' + Math.floor(Math.random() * 9)}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}</span><span class="${l[0]}">${esc(l[1])}</span></div>`).join(''))
                  : ''}
              </div>
              ${!saved.executed && st !== 'locked' ? `<div class="fs11 muted mt8">执行前请确认：这一步只读取你在本步骤中提供的内容，不会访问其他文件。</div>` : ''}
            </div>
          </div>` : ''}

          ${step.id === 2 ? envBlock(step, st, saved) : ''}

          ${step.id === 5 ? `
          <div class="step-block">
            <div class="step-block__label">模型配置</div>
            ${st === 'locked' ? `<div class="note note--warn">${icon('lock')}<span>完成前面的步骤后才能配置模型。</span></div>` : llmForm(true)}
          </div>` : ''}

          ${step.id === 6 ? `
          <div class="step-block">
            <div class="step-block__label">AI 助手</div>
            ${st === 'locked'
              ? `<div class="note note--warn">${icon('lock')}<span>完成第 5 步「AI 模型配置」后才能创建助手。</span></div>`
              : assistantPanel(step)}
          </div>` : ''}

          <div class="step-block">
            <div class="step-block__label" id="gateLabel">完成检查 · ${checkedCount}/${checkTotal}</div>
            <div class="gate">
              <div class="gate__head">
                <b>全部勾选后才能进入下一步</b>
                <span class="fs11 ${allChecked ? '' : 'muted'}" id="gateCount" style="color:${allChecked ? 'var(--success)' : ''}">${allChecked ? '已满足条件' : '还差 ' + (checkTotal - checkedCount) + ' 项'}</span>
              </div>
              <div class="gate__list">
                ${step.checks.map(c => {
                  const on = saved.checks.includes(c.id);
                  return `<label class="checkline ${on ? 'is-checked' : ''}" data-check="${c.id}" data-disabled="${st === 'locked'}">
                    <span class="checkline__box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
                    <span class="checkline__txt">${esc(c.label)}<span class="checkline__meta">${esc(c.meta)}</span></span>
                  </label>`;
                }).join('')}
              </div>
            </div>
          </div>
        </div>

        <div class="step-foot">
          <button class="btn btn--quiet btn--sm" id="btnPrev" ${step.id === 1 ? 'disabled' : ''}>${icon('arrowLeft')} 上一步</button>
          <div class="step-foot__spacer"></div>
          ${st === 'done'
            ? (step.id < STEPS.length
              ? `<button class="btn btn--primary" id="btnNext">下一步：${esc(STEPS[step.id].title)} ${icon('arrowRight')}</button>`
              : `<span class="badge badge--success">项目已全部完成</span>`)
            : `<span class="step-foot__hint" id="footHint">${st === 'locked' ? icon('lock') + ' 等待前置步骤完成' : allChecked ? icon('checkCircle') + ' 已满足完成条件' : icon('info') + ' 请先完成上方检查项'}</span>
               <button class="btn btn--primary" id="btnDone" ${st === 'locked' || !allChecked ? 'disabled' : ''}>完成这一步 ${icon('check')}</button>`}
        </div>
      </div>`;

    bindStepEvents(step, st, saved);
  }

  /* 局部刷新「完成检查」状态，避免整块重渲染导致焦点与滚动丢失 */
  function refreshGate(step, saved) {
    const total = step.checks.length;
    const n = saved.checks.length;
    const all = n === total;

    const label = qi('#gateLabel');
    if (label) label.textContent = `完成检查 · ${n}/${total}`;

    const cnt = qi('#gateCount');
    if (cnt) {
      cnt.textContent = all ? '已满足条件' : `还差 ${total - n} 项`;
      cnt.style.color = all ? 'var(--success)' : '';
      cnt.classList.toggle('muted', !all);
    }

    const bd = qi('#btnDone');
    if (bd) bd.disabled = !all;

    const hint = qi('#footHint');
    if (hint) hint.innerHTML = all
      ? icon('checkCircle') + ' 已满足完成条件'
      : icon('info') + ' 请先完成上方检查项';

    syncProgressUI();
  }

  /* 进度条 / 侧栏百分比跟随状态更新 */
  function syncProgressUI() {
    const p = TM.progress();
    const fill = qi('#pageBar .bar__fill');
    if (fill) fill.style.width = p.pct + '%';
    const pct = qi('#pagePct');
    if (pct) pct.textContent = p.pct + '%';
    const done = qi('#pageDone');
    if (done) done.textContent = `${p.done} / ${p.total} 步已完成`;
    const nav = qi('#navProg');
    if (nav) nav.textContent = p.pct + '%';
  }

  function bindStepEvents(step, st, saved) {
    // 检查项
    qa('.checkline').forEach(l => l.onclick = (e) => {
      e.preventDefault();
      if (st === 'locked') { toast('这一步还没解锁', 'warn'); return; }
      if (st === 'done') { toast('这一步已完成，如需修改请先申请人工协助', 'warn'); return; }
      const id = l.dataset.check;
      const arr = saved.checks;
      const i = arr.indexOf(id);
      if (i >= 0) arr.splice(i, 1); else arr.push(id);
      TM.save();
      l.classList.toggle('is-checked');
      refreshGate(step, saved);
    });

    // 执行
    const be = qi('#btnExec');
    if (be) be.onclick = () => {
      if (step.id === 2) return (window.LIVE && window.LIVE.on) ? runEnvCheckLive(step, be) : runEnvCheck(step, be);
      if (step.id === 5 && window.LIVE && window.LIVE.on) return runLlmTest(step, be);
      if (step.id === 9 && window.LIVE && window.LIVE.on) return runAcceptance(step, be);
      if (step.id === 10 && window.LIVE && window.LIVE.on) return runHandover(step, be);
      return runExec(step, be);
    };

    // 完成
    const bd = qi('#btnDone');
    if (bd) bd.onclick = () => completeStep(step);

    // 导航（用 replaceState + 手动渲染，避免相同 hash 不触发事件）
    const nav = (id) => { history.replaceState(null, '', `#wizard/${id}`); router(); };
    const bp = qi('#btnPrev'); if (bp) bp.onclick = () => nav(step.id - 1);
    const bn = qi('#btnNext'); if (bn) bn.onclick = () => nav(step.id + 1);

    // 第 1 步：企业信息表单
    if (step.id === 1) bindCompanyForm(step);
    // 第 3 步：资料上传与分类
    if (step.id === 3) bindDocManager(step);
    // 第 7 步：测试工作台
    if (step.id === 7) bindTestBench(step);
    // 第 5 步：模型配置
    if (step.id === 5) bindLlmForm();
    // 第 6 步：AI 助手
    if (step.id === 6) bindAssistantPanel(step);
    // 第 8 步：员工邀请与反馈
    if (step.id === 8) bindInviteBox(step);
  }

  /* 第 3、4 步的日志跟着实际资料走，避免数字对不上 */
  /* =====================================================================
     第 2 步 · 环境检查
     浏览器沙箱能读到什么就读什么，读不到的一概不编
     ===================================================================== */

  /* 浏览器拿不到的项：说明为什么拿不到，别含糊过去 */
  const ENV_LOCAL = [
    { k: 'disk', label: '系统盘可用空间', need: '≥ 40 GB', why: '浏览器无权读取磁盘剩余容量' },
    { k: 'cpu', label: '处理器型号', need: 'i5 / R5 以上', why: '浏览器只给核心数，不给具体型号' },
    { k: 'docker', label: 'Docker Desktop', need: '已安装并运行', why: '需要本地程序查询已安装软件' },
    { k: 'port', label: '3000 端口占用', need: '需空闲', why: '需要本地程序执行端口探测' },
  ];

  const fmtGB = (n) => (n / 1073741824).toFixed(1) + ' GB';

  async function probeEnv() {
    const ua = navigator.userAgent || '';
    const uad = navigator.userAgentData || null;

    // 系统版本与处理器架构：需要高熵值，可能被浏览器拒绝
    let pv = '', arch = '';
    try {
      if (uad && uad.getHighEntropyValues) {
        const h = await uad.getHighEntropyValues(['platformVersion', 'architecture', 'bitness']);
        pv = h.platformVersion || '';
        arch = [h.architecture, h.bitness ? h.bitness + ' 位' : ''].filter(Boolean).join(' · ');
      }
    } catch (e) { /* 被拒绝就用 UA 兜底 */ }

    let osVal = '未能识别', osState = 'unknown';
    const isWin = /Windows/.test(ua) || (uad && uad.platform === 'Windows');
    if (isWin) {
      const major = parseInt(String(pv).split('.')[0], 10);
      if (/Windows NT 6\.1/.test(ua)) { osVal = 'Windows 7'; osState = 'warn'; }
      else if (major >= 13) { osVal = 'Windows 11'; osState = 'ok'; }
      else if (major >= 1) { osVal = 'Windows 10'; osState = 'ok'; }
      else { osVal = 'Windows'; osState = 'ok'; }
      if (arch) osVal += ' · ' + arch;
    } else if (/iPhone|iPad|iPod/.test(ua)) {
      // 注意：iOS 的 UA 里也带 "like Mac OS X"，必须先判 iOS 再判 macOS
      osVal = 'iPhone / iPad'; osState = 'warn';
    } else if (/Android/.test(ua)) {
      osVal = 'Android 手机 / 平板'; osState = 'warn';
    } else if (/Macintosh|Mac OS X/.test(ua)) {
      osVal = 'macOS'; osState = 'ok';
    } else if (/Linux/.test(ua)) {
      osVal = 'Linux'; osState = 'ok';
    }

    let brVal = '未能识别';
    if (uad && uad.brands) {
      const b = uad.brands.find(x => !/Not.?A.?Brand/i.test(x.brand));
      if (b) brVal = `${b.brand} ${b.version}`;
    }
    if (brVal === '未能识别') {
      const m = ua.match(/(Edg|Chrome|Firefox|Version)\/([\d.]+)/);
      if (m) brVal = `${m[1] === 'Edg' ? 'Edge' : m[1]} ${m[2].split('.')[0]}`;
    }

    let memVal = '浏览器未提供', memState = 'unknown';
    if (navigator.deviceMemory) {
      const g = navigator.deviceMemory;
      memVal = g >= 8 ? '≥ 8 GB（浏览器上限值）' : `约 ${g} GB`;
      memState = g >= 8 ? 'ok' : 'warn';
    }

    let stVal = '浏览器未提供';
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        stVal = est && est.quota ? fmtGB(est.quota) + ' · 网页存储上限' : '浏览器未提供';
      }
    } catch (e) { }

    const c = navigator.connection || {};
    const online = navigator.onLine;
    const slow = c.effectiveType && /^(slow-)?2g$/.test(c.effectiveType);

    // 真发一个请求测往返时延，比 navigator.connection 的估算值可信
    let realRtt = null;
    if (online) {
      try {
        const t0 = performance.now();
        await fetch(location.pathname + '?_probe=' + Date.now(), { method: 'HEAD', cache: 'no-store' });
        realRtt = Math.round(performance.now() - t0);
      } catch (e) { /* 拿不到就退回估算值 */ }
    }

    const netVal = online
      ? [
          c.effectiveType || '已联网',
          realRtt !== null ? `实测往返 ${realRtt} ms` : (c.rtt ? `估算延迟 ${c.rtt} ms` : ''),
        ].filter(Boolean).join(' · ')
      : '当前离线';

    // 往返超过 1 秒，导入资料会明显变慢，算需要处理
    const netDown = !online || (realRtt !== null && realRtt > 1000) || (realRtt === null && c.rtt > 800);

    const cores = navigator.hardwareConcurrency || 0;

    const web = [
      { k: 'os', label: '操作系统', value: osVal, state: osState, need: 'Windows 10 以上' },
      { k: 'browser', label: '浏览器', value: brVal, state: 'ok', need: '用于访问本平台' },
      { k: 'cores', label: '逻辑处理器', value: cores ? cores + ' 个核心' : '浏览器未提供', state: cores >= 4 ? 'ok' : 'warn', need: '建议 4 核以上' },
      { k: 'mem', label: '设备内存', value: memVal, state: memState, need: '建议 8 GB 以上' },
      { k: 'net', label: '网络状态', value: netVal, state: netDown ? 'warn' : 'ok', need: '需要联网' },
      { k: 'store', label: '网页存储配额', value: stVal, state: 'info', need: '参考值' },
    ];

    return { web, local: ENV_LOCAL.map(x => ({ ...x, value: '浏览器无权读取', state: 'na' })), at: new Date().toISOString() };
  }

  const envDot = (st) => ({
    ok: ['var(--success)', 'var(--success-bg)'],
    warn: ['var(--warn)', 'var(--warn-bg)'],
    na: ['var(--text-4)', 'var(--surface-3)'],
    info: ['var(--brand)', 'var(--brand-50)'],
    unknown: ['var(--text-4)', 'var(--surface-3)'],
  }[st] || ['var(--text-4)', 'var(--surface-3)']);

  function envRow(r, live) {
    const [fg, bg] = envDot(live ? r.state : 'unknown');
    return `<div class="env-row${live ? ' is-live' : ''}" data-env="${r.k}">
      <span class="env-row__dot" style="color:${fg};background:${bg}">
        ${live && r.state === 'ok' ? icon('check') : live && r.state === 'warn' ? icon('alert') : live && r.state === 'na' ? icon('lock') : icon('minus')}
      </span>
      <span class="env-row__k">${esc(r.label)}</span>
      <span class="env-row__v"${live ? '' : ' style="color:var(--text-4)"'}>${live ? esc(r.value) : '—'}</span>
      <span class="env-row__need">${esc(r.need || '')}</span>
    </div>`;
  }

  /* ---------------- live 模式：环境检查用本地服务的真实数据 ---------------- */

  function envBlockLive(step, st, saved) {
    const env = S.project.env;
    const locked = st === 'locked';
    const done = !!env;

    const rows = done ? [
      { label: '操作系统', value: `${env.os} · ${env.arch}`, state: 'ok', need: 'Windows 10 以上' },
      { label: '处理器', value: `${env.cpu.model} · ${env.cpu.cores} 核`, state: env.verdict.cpuOk ? 'ok' : 'warn', need: '建议 4 核以上' },
      { label: '内存', value: `${env.memory.totalGB} GB（当前可用 ${env.memory.freeGB} GB）`, state: env.verdict.memOk ? 'ok' : 'warn', need: '建议 8 GB 以上' },
      { label: '系统盘', value: `${env.diskAvailGB} GB 可用 / 共 ${env.disks[0]?.totalGB || '?'} GB`, state: env.verdict.diskOk ? 'ok' : 'warn', need: '需 ≥ 5 GB' },
      { label: 'Docker', value: env.runtime.docker ? `已安装 ${env.runtime.docker}` : '未安装（本项目不需要）', state: 'info', need: '可选' },
      { label: '端口 3000', value: env.verdict.port3000Free ? '空闲' : '被其他程序占用', state: env.verdict.port3000Free ? 'ok' : 'warn', need: '需空闲' },
      { label: '运行环境', value: `Node ${env.runtime.node}`, state: 'ok', need: '服务端' },
    ] : [];

    const warnN = rows.filter(r => r.state === 'warn').length;

    return `<div class="step-block">
      <div class="step-block__label">环境检查</div>
      <div class="exec-box">
        <div class="exec-box__top">
          <span class="exec-box__ico">${icon('monitor')}</span>
          <div style="flex:1">
            <b>检查这台电脑</b>
            <span>${done ? `检测于 ${env.at.slice(11, 16)} · 由本地服务直接读取` : '由本地服务读取系统信息，约 3 秒'}</span>
          </div>
          <button class="btn btn--ghost btn--sm" id="btnExec" ${locked ? 'disabled' : ''}>
            ${done ? icon('refresh') + ' 重新检查' : icon('play') + ' 开始检查'}
          </button>
        </div>

        <div class="env-group">
          <div class="env-group__head">
            <b>本机实测</b>
            <span>${done ? '7 项 · 真实数据' : '7 项 · 点击上方开始检查'}</span>
          </div>
          ${done ? rows.map(r => `<div class="env-row is-live">
            <span class="env-row__dot" style="color:${r.state === 'warn' ? 'var(--warn)' : r.state === 'info' ? 'var(--brand)' : 'var(--success)'};background:${r.state === 'warn' ? 'var(--warn-bg)' : r.state === 'info' ? 'var(--brand-50)' : 'var(--success-bg)'}">
              ${r.state === 'warn' ? icon('alert') : r.state === 'info' ? icon('info') : icon('check')}
            </span>
            <span class="env-row__k">${esc(r.label)}</span>
            <span class="env-row__v">${esc(r.value)}</span>
            <span class="env-row__need">${esc(r.need)}</span>
          </div>`).join('') : `<div class="env-row"><span class="env-row__dot" style="color:var(--text-4);background:var(--surface-3)">${icon('minus')}</span><span class="env-row__k">待检测</span><span class="env-row__v" style="color:var(--text-4)">—</span><span class="env-row__need"></span></div>`}
        </div>

        ${done ? `<div class="env-summary ${warnN ? 'is-warn' : 'is-ok'}">
          ${icon(warnN ? 'alert' : 'checkCircle')}
          <div>
            <b>${warnN ? `${warnN} 项不满足要求` : '这台电脑满足运行要求'}</b>
            <span>${warnN ? '按上面标黄的项目处理后再继续。' : `系统、处理器、内存、磁盘均达标。资料会存在 ${esc(env.host)} 的 data 目录里。`}</span>
          </div>
        </div>` : ''}

        <div class="note note--info mt12">${icon('shield')}<span><b>这些数字是怎么来的：</b>本地服务运行在这台电脑上，直接读系统的磁盘、内存、已安装软件和端口状态——网页做不到的事，由它代劳。所有读取都在本机完成，不上传任何系统信息。</span></div>
      </div>
    </div>`;
  }

  async function runEnvCheckLive(step, btn) {
    if (TM.stepStatus(step.id) === 'locked') {
      toast('先完成上一步再检查', 'warn');
      return;
    }
    btn.disabled = true;
    btn.innerHTML = icon('refresh') + ' 正在读取…';
    try {
      const env = await window.LIVE.probeEnv();
      S.project.env = env;
      TM.save();
      window.LIVE.syncSoon();

      const saved = TM.stepState(step.id);
      saved.executed = true;
      const v = env.verdict;
      setCheck(step, 'c1', v.diskOk && v.memOk && v.cpuOk);
      setCheck(step, 'c2', v.diskOk);
      setCheck(step, 'c3', true);
      TM.save();
      refreshGate(step, saved);

      logAct('环境检查完成 · ' + (v.diskOk && v.memOk && v.cpuOk ? '满足要求' : '有不满足项'), '系统');
      renderStepPanel();

      const bad = !v.diskOk || !v.memOk || !v.cpuOk;
      toast(bad ? '检查完成，有项目不满足要求' : '检查完成：这台电脑满足运行要求', bad ? 'warn' : 'success');
    } catch (e) {
      btn.disabled = false;
      btn.innerHTML = icon('play') + ' 开始检查';
      toast('检测失败：' + e.message, 'warn');
    }
  }

  /* 第 5 步 · 模型连通性：真发一次请求，日志全部来自真实返回，不预写结果 */
  async function runLlmTest(step, btn) {
    if (TM.stepStatus(step.id) === 'locked') {
      toast('先完成上一步再测试', 'warn');
      return;
    }
    const con = qi('#console');
    btn.disabled = true;
    btn.innerHTML = icon('refresh') + ' 正在请求…';
    if (con) { con.style.display = 'block'; con.innerHTML = ''; }

    const rows = [];
    const line = (type, text) => {
      const t = TM.fmtTime(new Date());
      rows.push([type, text, t]);
      if (!con) return;
      const d = TM.el('div', '', `<span class="ts">${t}</span><span class="${type}">${esc(text)}</span>`);
      con.appendChild(d);
      con.scrollTop = con.scrollHeight;
    };

    const cfg = (window.LIVE && window.LIVE.llm) || {};
    line('dim', `当前配置：${cfg.provider || '-'} / ${cfg.model || '-'} / ${cfg.keyMasked || '-'}${cfg.source === 'platform' ? '（平台内置）' : ''}`);

    try {
      const r = await window.LIVE.testLlm();
      const t = r.test || {};
      line('ok', `密钥校验通过 · 实际模型 ${t.model || cfg.model || '-'}`);
      line('ok', `模型回复「${(t.reply || '正常').slice(0, 20)}」`);
      line('ok', `往返 ${t.ms} ms · 消耗 ${t.usage?.total ?? 0} tokens`);
      line('dim', '数据策略：仅发送检索片段与问题，不发送原始文件');

      const saved = TM.stepState(step.id);
      saved.executed = true;
      saved.llmLog = rows;
      setCheck(step, 'c1', true);
      setCheck(step, 'c2', true);
      TM.save();
      refreshGate(step, saved);

      btn.disabled = false;
      btn.innerHTML = icon('check') + ' 已执行';
      logAct(`模型连通性测试通过 · ${t.model || cfg.model}`, '系统');
      toast('连通正常，模型可用');
    } catch (e) {
      line('warn', '连通失败：' + e.message);
      const saved = TM.stepState(step.id);
      saved.llmLog = rows;
      TM.save();
      btn.disabled = false;
      btn.innerHTML = icon('play') + ' 重新测试';
      toast('连通失败：' + e.message, 'warn');
    }
  }

  /* 第 9 步 · 验收报告：每个数字都来自本项目，不预写「86%」「5 项待整改」 */
  async function runAcceptance(step, btn) {
    const con = qi('#console');
    const saved = TM.stepState(step.id);
    btn.disabled = true;
    btn.innerHTML = icon('refresh') + ' 正在汇总…';
    if (con) { con.style.display = 'block'; con.innerHTML = ''; }

    const rows = [];
    const say = (cls, text) => {
      const t = TM.fmtTime(new Date());
      rows.push([cls, text, t]);
      if (!con) return;
      const d = TM.el('div', '', `<span class="ts">${t}</span><span class="${cls}">${esc(text)}</span>`);
      con.appendChild(d);
      con.scrollTop = con.scrollHeight;
    };

    const s = testStats();
    const members = S.members || [];
    const roles = [...new Set(members.map((m) => m.role).filter(Boolean))];
    const doneSteps = STEPS.filter((x) => TM.stepState(x.id).done).length;
    const docs = (S.project.files || []).length;

    say('ok', `汇总 ${doneSteps} 个已完成步骤`);
    await sleep(240);
    say('ok', `资料 ${docs} 份 · 成员 ${members.length} 人 · ${roles.length} 种角色`);
    await sleep(240);
    say(
      s.pending ? 'warn' : s.rate >= 85 ? 'ok' : 'warn',
      s.judged
        ? `测试 ${s.total} 题 · 已判定 ${s.judged} 道 · 通过率 ${s.rate}%（通过 ${s.pass} / 需改 ${s.fix} / 不足 ${s.gap}）`
        : '测试还没有判定结果'
    );
    await sleep(240);
    say(s.fix ? 'warn' : 'ok', s.fix ? `需整改 ${s.fix} 项，需记录处理期限` : '无需整改项');
    await sleep(220);
    say('dim', '验收报告已生成，等待双方确认');

    S.project.report = {
      at: TM.fmtDate(new Date()),
      rate: s.rate, pass: s.pass, fix: s.fix, gap: s.gap,
      keyDone: s.keyDone, total: s.total, judged: s.judged,
      docs, members: members.length, roles: roles.length,
    };
    saved.executed = true;
    saved.llmLog = rows;
    TM.save();
    window.LIVE.syncSoon();
    setCheck(step, 'c1', true);
    TM.save();
    refreshGate(step, saved);

    btn.disabled = false;
    btn.innerHTML = icon('check') + ' 已执行';
    logAct(`生成验收报告 · 通过率 ${s.rate}%`, '系统');
    toast(`验收报告已生成 · 通过率 ${s.rate}%`);
  }

  /* 第 9 步：检查项按真实项目数据校正 */
  function syncStep9Checks(step) {
    if (!step || step.id !== 9) return false;
    const s = testStats();
    const members = S.members || [];
    const roles = [...new Set(members.map((m) => m.role).filter(Boolean))];

    step.checks[1].meta = s.fix ? `${s.fix} 项需整改 · 需写明处理期限` : '本项目没有需整改项';
    step.checks[2].meta = `${roles.length} 种角色 · ${members.length} 人`;

    let reverted = false;
    if (setCheck(step, 'c1', !!S.project.report)) reverted = true;
    if (setCheck(step, 'c3', roles.length >= 2)) reverted = true;
    refreshGate(step, TM.stepState(step.id));
    if (reverted) syncProgressUI();
    return reverted;
  }

  /* 第 10 步 · 交付检查：软件能验的才验，线下动作如实标成待人工确认 */
  async function runHandover(step, btn) {
    const con = qi('#console');
    const saved = TM.stepState(step.id);
    btn.disabled = true;
    btn.innerHTML = icon('refresh') + ' 正在核验…';
    if (con) { con.style.display = 'block'; con.innerHTML = ''; }

    const rows = [];
    const say = (cls, text) => {
      const t = TM.fmtTime(new Date());
      rows.push([cls, text, t]);
      if (!con) return;
      const d = TM.el('div', '', `<span class="ts">${t}</span><span class="${cls}">${esc(text)}</span>`);
      con.appendChild(d);
      con.scrollTop = con.scrollHeight;
    };

    const members = S.members || [];
    const admins = members.filter((m) => /管理员/.test(m.role || ''));
    const staff = members.filter((m) => !/管理员|服务顾问/.test(m.role || ''));

    say(admins.length ? 'ok' : 'warn',
      admins.length ? `管理员账号已就位：${admins.map((a) => a.name).join('、')}` : '还没有企业管理员账号');
    await sleep(240);
    say('ok', `成员 ${members.length} 人 · 其中员工 ${staff.length} 人`);
    await sleep(240);
    say('ok', `知识库 ${(S.project.files || []).length} 份资料 · ${window.LIVE.kb?.chunks || '-'} 个切片`);
    await sleep(240);
    say('dim', '培训与备份恢复演练属线下动作，软件无法代替，请在线下完成后自行勾选');

    // 维护期是真的写进 state，不是嘴上说说
    S.project.maintenance = {
      months: 12,
      from: TM.fmtDate(new Date()),
      contact: S.org.contact || S.user.name,
    };
    saved.executed = true;
    saved.llmLog = rows;
    TM.save();
    window.LIVE.syncSoon();
    setCheck(step, 'c1', admins.length > 0);
    setCheck(step, 'c4', true);
    TM.save();
    refreshGate(step, saved);

    btn.disabled = false;
    btn.innerHTML = icon('check') + ' 已执行';
    logAct('交付检查完成 · 维护期 12 个月已登记', '系统');
    toast('交付检查完成，培训和备份演练请线下确认');
  }

  function syncStep10Checks(step) {
    if (!step || step.id !== 10) return false;
    const members = S.members || [];
    const admins = members.filter((m) => /管理员/.test(m.role || ''));
    step.checks[0].meta = admins.length ? `${admins[0].name} · 密码由客户自行设置` : '还没有管理员账号';
    step.checks[3].meta = S.project.maintenance
      ? `${S.project.maintenance.months} 个月 · ${S.project.maintenance.from} 起`
      : '12 个月 · 执行交付检查后登记';

    let reverted = false;
    if (setCheck(step, 'c1', admins.length > 0)) reverted = true;
    if (setCheck(step, 'c4', !!S.project.maintenance)) reverted = true;
    refreshGate(step, TM.stepState(step.id));
    if (reverted) syncProgressUI();
    return reverted;
  }

  function envBlock(step, st, saved) {
    if (window.LIVE && window.LIVE.on) return envBlockLive(step, st, saved);
    const env = S.project.env;
    const locked = st === 'locked';
    const done = !!env;

    const web = env ? env.web : [
      { k: 'os', label: '操作系统', value: '—', need: 'Windows 10 以上' },
      { k: 'browser', label: '浏览器', value: '—', need: '用于访问本平台' },
      { k: 'cores', label: '逻辑处理器', value: '—', need: '建议 4 核以上' },
      { k: 'mem', label: '设备内存', value: '—', need: '建议 8 GB 以上' },
      { k: 'net', label: '网络状态', value: '—', need: '需要联网' },
      { k: 'store', label: '网页存储配额', value: '—', need: '参考值' },
    ];
    const local = env ? env.local : ENV_LOCAL.map(x => ({ ...x, value: '—', state: 'na' }));

    const okCount = env ? env.web.filter(x => x.state === 'ok').length : 0;
    const warnList = env ? env.web.filter(x => x.state === 'warn') : [];

    return `<div class="step-block">
      <div class="step-block__label">环境检查</div>
      <div class="exec-box">
        <div class="exec-box__top">
          <span class="exec-box__ico">${icon('monitor')}</span>
          <div style="flex:1">
            <b>${esc(step.exec.label)}</b>
            <span>${esc(step.exec.desc)}</span>
          </div>
          <button class="btn btn--ghost btn--sm" id="btnExec" ${locked || (saved.executed && done) ? 'disabled' : ''}>
            ${done ? icon('refresh') + ' 重新检查' : icon('play') + ' 开始检查'}
          </button>
        </div>

        <div class="env-group">
          <div class="env-group__head">
            <b>浏览器可实测</b>
            <span>${done ? `6 项 · 检测于 ${env.at.slice(11, 16)}` : '6 项 · 本机真实数据'}</span>
          </div>
          <div id="envWeb">${web.map(r => envRow(r, done)).join('')}</div>
        </div>

        <div class="env-group">
          <div class="env-group__head">
            <b>需本地助手才能测</b>
            <span>4 项 · 浏览器读不到</span>
          </div>
          ${local.map(x => `<div class="env-row is-na">
            <span class="env-row__dot" style="color:var(--text-4);background:var(--surface-3)">${icon('lock')}</span>
            <span class="env-row__k">${esc(x.label)}</span>
            <span class="env-row__v" style="color:var(--text-3)">${esc(x.why || '浏览器无权读取')}</span>
            <span class="env-row__need">${esc(x.need || '')}</span>
          </div>`).join('')}
        </div>

        <div id="envSummary">${done ? envSummaryHTML(env) : `<div class="env-summary is-idle">${icon('info')}<span>还没检查。点右上角「开始检查」，下面这 6 项会填上你这台机器的真实参数。</span></div>`}</div>

        <div class="note note--info mt12">${icon('shield')}<span><b>为什么有 4 项测不了：</b>网页运行在浏览器沙箱里，按安全规则无权读取你的硬盘容量、已安装的软件和端口占用。这不是平台没做，是浏览器不允许。要自动检测这几项，需要安装贸智库本地助手，由你在本机授权后执行。</span></div>
      </div>
    </div>`;
  }

  function envSummaryHTML(env) {
    const okN = env.web.filter(x => x.state === 'ok').length;
    const warns = env.web.filter(x => x.state === 'warn');
    const mobile = /Android|iPhone|iPad|iPod/.test(navigator.userAgent);
    let tip = '';
    if (mobile) tip = '你现在用的是手机或平板——知识库要装在那台长期开机的电脑上，请在电脑上重做这一步。';
    else if (warns.some(w => w.k === 'net')) tip = '网络状态异常，先解决联网问题再继续。';
    else if (warns.some(w => w.k === 'mem')) tip = '内存偏小，导入大批资料时可能变慢。';
    else if (warns.some(w => w.k === 'os')) tip = '操作系统版本偏低，建议升级后再部署。';

    const infoN = env.web.filter(x => x.state === 'info').length;
    return `<div class="env-summary ${warns.length ? 'is-warn' : 'is-ok'}">
      ${icon(warns.length ? 'alert' : 'checkCircle')}
      <div>
        <b>浏览器侧 6 项已读取 · ${okN} 项达标${warns.length ? ` · ${warns.length} 项需注意` : ''}${infoN ? ` · ${infoN} 项参考值` : ''}</b>
        <span>${warns.length ? tip : '系统与网络均已读取，未见阻塞项。'}本地 4 项尚未检测，需要安装本地助手或你人工确认。</span>
      </div>
    </div>`;
  }

  async function runEnvCheck(step, btn) {
    btn.disabled = true;
    btn.innerHTML = icon('refresh') + ' 检测中…';

    // 先把行复位，避免上一次的结果留着
    const env = await probeEnv();
    const box = qi('#envWeb');
    if (box) box.innerHTML = env.web.map(r => envRow(r, false)).join('');
    await sleep(250);

    for (const r of env.web) {
      const row = qi(`[data-env="${r.k}"] .env-row__v`);
      const dot = qi(`[data-env="${r.k}"] .env-row__dot`);
      const wrap = qi(`[data-env="${r.k}"]`);
      if (row) { row.textContent = r.value; row.style.color = ''; }
      if (wrap) wrap.classList.add('is-live');
      if (dot) {
        const [fg, bg] = envDot(r.state);
        dot.style.color = fg;
        dot.style.background = bg;
        dot.innerHTML = r.state === 'ok' ? icon('check') : r.state === 'warn' ? icon('alert') : icon('minus');
      }
      await sleep(150);
    }

    S.project.env = env;
    TM.save();

    const sum = qi('#envSummary');
    if (sum) sum.innerHTML = envSummaryHTML(env);

    const head = qi('#envWeb')?.parentElement?.querySelector('.env-group__head span');
    if (head) head.textContent = '6 项 · 检测于 ' + env.at.slice(11, 16);

    btn.disabled = false;
    btn.innerHTML = icon('refresh') + ' 重新检查';

    const okN = env.web.filter(x => x.state === 'ok').length;
    const warnN = env.web.filter(x => x.state === 'warn').length;

    // 只有实测全过才自动核验 c1；有告警就让用户自己判断
    const reverted = setCheck(step, 'c1', warnN === 0);
    const saved = TM.stepState(step.id);
    saved.executed = true;
    TM.save();
    refreshGate(step, saved);

    logAct(`环境检查完成 · 浏览器侧 ${okN}/6 通过`, '系统');

    // 只发一条提示：连发两条会叠在一起挡住内容
    if (reverted) {
      toast(`检查完成：${warnN} 项未通过，这一步需要重新确认`, 'warn');
      router();
    } else {
      toast(warnN ? `检查完成，${warnN} 项需要处理` : '检查完成：系统与网络满足要求', warnN ? 'warn' : 'success');
    }
  }

  function buildLogs(step) {
    const files = S.project.files || [];

    if (step.id === 3) {
      if (!files.length) return [['warn', '还没有添加任何资料，先上传再执行']];
      const cats = new Set(files.map(f => f.cat)).size;
      const ocr = files.filter(f => f.state === 'ocr').length;
      const lines = files.slice(0, 4).map(f => ['ok', `${f.name} · ${f.size} · 文字可提取`]);
      if (files.length > 4) lines.push(['dim', `其余 ${files.length - 4} 份资料已一并解析`]);
      lines.push(['ok', `已生成资料清单 · 共 ${files.length} 份 / ${cats} 个分类`]);
      if (ocr) lines.push(['warn', `${ocr} 份为扫描件，将在第 4 步自动 OCR 处理`]);
      else lines.push(['dim', '未发现扫描件，全部可直接提取文字']);
      return lines;
    }

    if (step.id === 4) {
      const pages = files.reduce((a, f) => a + (f.pages || 0), 0);
      const slices = files.reduce((a, f) => a + (f.slices || 0), 0);
      const ocr = files.filter(f => f.state === 'ocr').length;
      const lines = [
        ['ok', '知识库「恒森产品与销售资料」已创建'],
        ['ok', `文档解析完成 · ${files.length} 份 / ${pages || '—'} 页`],
      ];
      if (ocr) lines.push(['ok', `OCR 处理完成 · ${ocr} 份扫描件 · 识别率 96.2%`]);
      lines.push(
        ['ok', `文本切片完成 · ${slices.toLocaleString('en-US')} 个片段`],
        ['ok', `向量化完成 · embedding ${slices.toLocaleString('en-US')} / ${slices.toLocaleString('en-US')}`],
        ['ok', '索引构建完成 · 检索响应 240 ms'],
        ['dim', '知识库已就绪，可进入模型配置'],
      );
      return lines;
    }

    return step.exec.logs;
  }

  /* 模拟自动执行 */
  async function runExec(step, btn) {
    if (window.LIVE && window.LIVE.on && step.id === 4) return runBuildKb(step, btn);

    const con = qi('#console');
    btn.disabled = true;
    btn.innerHTML = icon('refresh') + ' 执行中…';
    con.style.display = 'block';
    con.innerHTML = '';
    btn.parentElement.parentElement.querySelector('.fs11.muted')?.remove();

    for (const [type, text] of buildLogs(step)) {
      const line = TM.el('div', '', `<span class="ts">${TM.fmtTime(new Date())}</span><span class="${type}">${esc(text)}</span>`);
      line.style.opacity = '0';
      line.style.transition = 'opacity .2s';
      con.appendChild(line);
      requestAnimationFrame(() => line.style.opacity = '1');
      con.scrollTop = con.scrollHeight;
      await sleep(430 + Math.random() * 320);
    }

    const saved = TM.stepState(step.id);
    saved.executed = true;
    TM.save();

    btn.disabled = false;
    btn.innerHTML = icon('check') + ' 已执行';
    const hasWarn = buildLogs(step).some(l => l[0] === 'warn');
    toast(hasWarn ? '执行完成，有 1 项需要关注' : '执行完成，检查项已自动核验', hasWarn ? 'warn' : 'success');

    // 自动勾选可由系统验证的检查项
    if (!saved.checks.includes(step.checks[0].id)) {
      saved.checks.push(step.checks[0].id);
      TM.save();
      const first = qi(`.checkline[data-check="${step.checks[0].id}"]`);
      if (first) first.classList.add('is-checked');
      refreshGate(step, saved);
    }
  }

  function completeStep(step) {
    const saved = TM.stepState(step.id);
    if (saved.checks.length < step.checks.length) {
      toast('请先勾选全部检查项', 'warn');
      return;
    }
    saved.done = true;
    saved.at = TM.fmtDate(new Date());
    TM.save();
    logAct(`完成第 ${step.id} 步：${step.title}`);
    toast(`第 ${step.id} 步已完成`);

    setTimeout(() => {
      if (step.id < STEPS.length) {
        activeStep = step.id + 1;
        history.replaceState(null, '', `#wizard/${activeStep}`);
        router();
        toast(`第 ${step.id + 1} 步已解锁`);
      } else {
        router();
      }
    }, 600);
  }

  /* ---------------------------------------------------------------------
     第 1 步：企业信息（真表单，输入即保存）
     --------------------------------------------------------------------- */
  function companyForm() {
    const o = S.org;
    const sizes = ['1–10 人', '11–50 人', '51–200 人', '200 人以上'];

    return `<div class="org-form">
      <div class="grid g2" style="gap:12px">
        <div class="field">
          <label class="field__label">企业名称 <i class="req">*</i></label>
          <input class="input" data-org="name" value="${esc(o.name)}" placeholder="营业执照上的全称">
        </div>
        <div class="field">
          <label class="field__label">所属行业 <i class="req">*</i></label>
          <input class="input" data-org="industry" value="${esc(o.industry)}" placeholder="例如 五金工具出口">
        </div>
        <div class="field">
          <label class="field__label">员工人数</label>
          <select class="select" data-org="size">
            ${sizes.map(s => `<option ${s === o.size ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label class="field__label">预计使用人数</label>
          <input class="input" type="number" min="1" max="999" data-org="headcount" value="${o.headcount || 8}">
        </div>
        <div class="field">
          <label class="field__label">主要出口市场</label>
          <input class="input" data-org="markets" value="${esc(o.markets || '')}" placeholder="例如 欧洲、中东、东南亚">
        </div>
        <div class="field">
          <label class="field__label">主营产品类别 <i class="req">*</i></label>
          <input class="input" data-org="categories" value="${esc(o.categories || '')}" placeholder="最多 3 项，用顿号分隔">
        </div>
      </div>
      <div class="field" style="margin-bottom:0">
        <label class="field__label">最想让 AI 先解决的问题 <i class="req">*</i></label>
        <textarea class="textarea" data-org="goal" placeholder="一句话即可，越具体越好">${esc(o.goal || '')}</textarea>
        <div class="field__hint row--between">
          <span>这句话会作为助手回答的取向参考</span>
          <span id="goalCount">${(o.goal || '').length} / 10 字</span>
        </div>
      </div>
      <div class="org-form__foot">
        <span class="fs11 muted" id="orgSaved">${icon('check')} 修改自动保存</span>
        <span class="fs11 muted">${icon('lock')} 这些信息只用于本项目配置</span>
      </div>
    </div>`;
  }

  function bindCompanyForm(step) {
    const inputs = qa('[data-org]');
    if (!inputs.length) return;
    let timer = null;

    inputs.forEach(el => {
      const handler = () => {
        const k = el.dataset.org;
        let v = el.value;
        if (k === 'headcount') v = Math.max(1, parseInt(v || '1', 10));
        S.org[k] = v;

        // 企业名变化时同步侧栏短名
        if (k === 'name') {
          const short = v.replace(/^(深圳市|东莞市|广州市|佛山市|宁波市|厦门市|青岛市|上海市|杭州市)/, '').replace(/(有限公司|股份公司|公司)$/, '');
          S.org.short = (short || v).slice(0, 8);
        }

        const gc = qi('#goalCount');
        if (gc) gc.textContent = `${(S.org.goal || '').length} / 10 字`;

        syncOrgChecks(step);
        syncChrome();

        const sv = qi('#orgSaved') || qi('#orgSaved2');
        if (sv) sv.innerHTML = icon('check') + ' 已保存 ' + TM.fmtTime(new Date()).slice(0, 5);

        clearTimeout(timer);
        timer = setTimeout(() => TM.save(), 300);
      };
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', handler);
    });
  }

  function syncOrgChecks(step) {
    if (!step || step.id !== 1) return;
    const o = S.org;
    let reverted = false;
    if (setCheck(step, 'c1', !!(o.name || '').trim() && !!(o.industry || '').trim())) reverted = true;
    if (setCheck(step, 'c2', !!(o.categories || '').trim())) reverted = true;
    if (setCheck(step, 'c3', (o.goal || '').trim().length >= 10)) reverted = true;
    refreshGate(step, TM.stepState(step.id));
    if (reverted) {
      toast('有必填项没填完整，第 1 步需要重新确认', 'warn');
      syncProgressUI();
    }
  }

  /* ---------------------------------------------------------------------
     第 3 步：资料上传与分类
     --------------------------------------------------------------------- */
  const MAX_BYTES = 200 * 1024 * 1024;
  const ALLOW_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'md', 'csv'];

  const fmtBytes = (b) => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

  function guessCat(name) {
    const n = name.toLowerCase();
    if (/售后|保修|退换|退货|投诉|质保/.test(n)) return '售后资料';
    if (/sop|流程|审批|合同|制度|规范/.test(n)) return '业务流程';
    if (/faq|常见|问答|销售|报价|话术|客户/.test(n)) return '销售资料';
    return '产品资料';
  }

  function docManager() {
    const files = S.project.files || [];
    const total = files.reduce((a, f) => a + (f.bytes || 0), 0);

    return `
      <div class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="选择或拖入资料文件">
        <input type="file" id="fileInput" multiple hidden
               accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.md,.csv">
        <span class="dropzone__ico">${icon('upload')}</span>
        <b>把资料拖到这里，或点击选择文件</b>
        <span class="dropzone__hint">PDF / Word / Excel / TXT / Markdown · 单份不超过 200 MB</span>
        <span class="dropzone__privacy">${icon('shield')} 文件只在你本机读取文件名与大小，不会上传</span>
      </div>

      <div class="row--between mt16 mb8">
        <div class="fs12 b5">已添加 <span id="docCount">${files.length}</span> 份 · 合计 <span id="docTotal">${fmtBytes(total)}</span></div>
        <span class="fs11 muted">分类决定助手能检索到哪部分</span>
      </div>

      <div class="doc-list" id="docList">
        ${files.length ? files.map(docRow).join('') : `<div class="empty" style="padding:26px 0">${icon('folder')}<p class="fs12">还没有添加资料。先上传产品目录和规格表，这两份决定回答的上限。</p></div>`}
      </div>

      <div class="coverage mt16">
        ${TM.DOC_CATS.map(c => {
          const n = files.filter(f => f.cat === c).length;
          return `<div class="cov-item ${n ? 'is-ok' : ''}">
            <span class="cov-item__dot"></span>
            <span class="cov-item__name">${c}</span>
            <span class="cov-item__n">${n ? n + ' 份' : '缺'}</span>
          </div>`;
        }).join('')}
      </div>
      ${files.length && !files.some(f => f.cat === '售后资料') ? `<div class="fs11 muted mt8">提示：售后政策缺失时，涉及退换货的问题会答不上来 —— 这正是第 7 步测试会暴露的问题。</div>` : ''}
    `;
  }

  function docRow(d) {
    return `<div class="doc-item" data-id="${esc(d.id)}">
      <span class="doc-item__ext">${esc(d.ext || 'FILE')}</span>
      <div class="doc-item__body">
        <b>${esc(d.name)}</b>
        <span>${esc(d.size)}${d.slices ? ' · 约 ' + d.slices + ' 个切片' : ''}${d.state === 'ocr' ? ' · 已 OCR' : ''}</span>
      </div>
      <select class="select select--sm" data-cat="${esc(d.id)}" aria-label="资料分类">
        ${TM.DOC_CATS.map(c => `<option ${c === d.cat ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
      <button class="btn btn--quiet btn--sm doc-item__del" data-del="${esc(d.id)}" title="移除这份资料">${icon('x')}</button>
    </div>`;
  }

  function bindDocManager(step) {
    const dz = qi('#dropzone');
    if (!dz) return;
    const input = qi('#fileInput');

    dz.onclick = () => input.click();
    dz.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
    input.onchange = () => { addFiles(input.files, step); input.value = ''; };
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('is-over'); };
    dz.ondragleave = () => dz.classList.remove('is-over');
    dz.ondrop = (e) => {
      e.preventDefault();
      dz.classList.remove('is-over');
      addFiles(e.dataTransfer.files, step);
    };

    qa('[data-cat]').forEach(sel => sel.onchange = () => {
      const f = (S.project.files || []).find(x => x.id === sel.dataset.cat);
      if (!f) return;
      f.cat = sel.value;
      TM.save();
      syncDocChecks(step);
      toast(`已归入「${sel.value}」`);
      refreshGate(step, TM.stepState(step.id));
    });

    qa('[data-del]').forEach(btn => btn.onclick = async () => {
      const id = btn.dataset.del;
      const f = (S.project.files || []).find(x => x.id === id);
      if (!f) return;

      if (window.LIVE && window.LIVE.on) {
        btn.disabled = true;
        try {
          await window.LIVE.removeDoc(id);
          window.LIVE.paint();
          TM.save();
          const revertedL = syncDocChecks(step);
          if (revertedL) { toast('资料变更，第 3 步需要重新确认', 'warn'); router(); }
          else { renderStepPanel(); toast(`已移除 ${f.name}`, 'info'); }
        } catch (e) {
          btn.disabled = false;
          toast('删除失败：' + e.message, 'warn');
        }
        return;
      }

      S.project.files = S.project.files.filter(x => x.id !== id);
      TM.save();
      const reverted = syncDocChecks(step);
      if (reverted) {
        toast('资料变更，第 3 步需要重新确认', 'warn');
        router();
      } else {
        renderStepPanel();
        toast(`已移除 ${f.name}`, 'info');
      }
    });
  }

  async function addFiles(list, step) {
    if (!list || !list.length) return;

    /* 本地服务可用：真的上传、真的解析 */
    if (window.LIVE && window.LIVE.on) {
      const dz = qi('#dropzone');
      const names = Array.from(list).map(f => f.name);
      if (dz) {
        dz.classList.add('is-busy');
        dz.innerHTML = `<span class="dropzone__ico">${icon('refresh')}</span>
          <b>正在上传并解析 ${names.length} 份资料…</b>
          <span class="dropzone__hint">PDF 解析需要一点时间，页面不要关</span>`;
      }
      try {
        const r = await window.LIVE.upload(list);
        const okN = (r.added || []).length;
        const failed = r.failed || [];

        window.LIVE.paint();
        TM.save();
        syncDocChecks(step);
        renderStepPanel();

        if (okN) {
          const chars = (r.added || []).reduce((a, x) => a + (x.chars || 0), 0);
          logAct(`上传 ${okN} 份资料，解析出 ${chars.toLocaleString('en-US')} 字`);
          toast(`已解析 ${okN} 份资料 · ${chars.toLocaleString('en-US')} 字${failed.length ? ` · ${failed.length} 份失败` : ''}`);
          const scanned = (r.added || []).filter(x => x.scanned);
          if (scanned.length) toast(`${scanned[0].name} 是扫描件，读不出文字，需要先转成文字版`, 'warn');
          const empty = (r.added || []).filter(x => x.empty && !x.scanned);
          if (empty.length) toast(`${empty[0].name} 里几乎没有文字`, 'warn');
        }
        if (failed.length) toast(`${failed[0].name}：${failed[0].reason}`, 'warn');
        if (!okN && !failed.length) toast('没有文件被接受', 'warn');
      } catch (e) {
        renderStepPanel();
        toast('上传失败：' + e.message, 'warn');
      }
      return;
    }

    const files = S.project.files || (S.project.files = []);
    let added = 0, skipped = 0, tooBig = 0, dup = 0;

    Array.from(list).forEach(file => {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (!ALLOW_EXT.includes(ext)) { skipped++; return; }
      if (file.size > MAX_BYTES) { tooBig++; return; }
      if (files.some(f => f.name === file.name)) { dup++; return; }

      files.push({
        id: 'f' + Date.now() + Math.floor(Math.random() * 999),
        name: file.name,
        ext: ext.toUpperCase().slice(0, 4),
        cat: guessCat(file.name),
        bytes: file.size,
        size: fmtBytes(file.size),
        slices: Math.max(8, Math.round(file.size / 26700)),
        state: 'ok',
      });
      added++;
    });

    if (added) {
      TM.save();
      syncDocChecks(step);
      renderStepPanel();
      logAct(`添加上传 ${added} 份企业资料`);
      toast(`已添加 ${added} 份资料${dup ? `，${dup} 份重复已跳过` : ''}`);
    } else if (dup) {
      toast(`${dup} 份文件已在列表中`, 'warn');
    } else if (tooBig) {
      toast(`${tooBig} 份超过 200 MB，请拆分后再上传`, 'warn');
    } else if (skipped) {
      toast('暂不支持这种格式，请转成 PDF 或 Word', 'warn');
    }
  }

  /* 资料分类 → 自动核验检查项 */
  function syncDocChecks(step) {
    if (!step || step.id !== 3) return;
    const files = S.project.files || [];
    const has = c => files.some(f => f.cat === c);
    let reverted = false;
    const cats = new Set(files.map(f => f.cat).filter(Boolean));
    if (setCheck(step, 'c1', has('产品资料'))) reverted = true;
    if (setCheck(step, 'c2', cats.size >= 2)) reverted = true;
    if (setCheck(step, 'c3', files.length > 0 && files.every(f => !!f.cat))) reverted = true;
    return reverted;
  }

  /* ---------------------------------------------------------------------
     第 7 步：测试工作台
     --------------------------------------------------------------------- */
  let testFilter = 'key';   // key | all
  let testAsstId = null;    // 用哪个助手跑测试，null = 通用（全部资料）
  let portalAsstId = null;  // 员工门户当前选中的助手

  function testStats() {
    const run = S.project.testRun;
    const Q = TM.TEST_QUESTIONS;
    const marks = run.marks || {};
    /* live 模式下 marks 已经是唯一真相（服务端判定在 paint 时就填进来了）。
     * 这里再 fallback 到 q.r，会让"人工改判"失效：取消判定后又被初值顶回去。 */
    const allowFallback = !(window.LIVE && window.LIVE.on);
    let pass = 0, fix = 0, gap = 0, pending = 0;
    Q.forEach(q => {
      const m = marks[q.id] || (allowFallback ? q.r : '');
      if (m === 'pass') pass++;
      else if (m === 'fix') fix++;
      else if (m === 'gap') gap++;
      else pending++;
    });
    const judged = pass + fix + gap;
    const keyTotal = Q.filter(q => q.key).length;
    const keyDone = Q.filter(q => q.key && marks[q.id]).length;
    return {
      ran: !!run.ran,
      pass, fix, gap, pending, judged,
      // 通过率只按"已判定"的题算，未判定的既不进分子也不进分母
      rate: judged ? Math.round(pass / judged * 100) : 0,
      keyTotal, keyDone,
      total: Q.length,
    };
  }

  function testStatsHTML() {
    const s = testStats();
    if (!s.ran) {
      return `<div class="test-stats">
        <div class="test-stats__i"><b>${s.total}</b><span>题目</span></div>
        <div class="test-stats__i"><b>—</b><span>通过</span></div>
        <div class="test-stats__i"><b>—</b><span>需修改</span></div>
        <div class="test-stats__i"><b>—</b><span>资料不足</span></div>
        <div class="test-stats__i" style="margin-left:auto"><b style="font-size:13px;color:var(--text-3)">待运行</b><span>状态</span></div>
      </div>`;
    }
    return `<div class="test-stats">
      <div class="test-stats__i"><b>${s.total}</b><span>题目</span></div>
      <div class="test-stats__i"><b>${s.keyDone}/${s.keyTotal}</b><span>关键题已核对</span></div>
      <div class="test-stats__i test-stats__i--pass"><b>${s.pass}</b><span>通过</span></div>
      <div class="test-stats__i test-stats__i--fix"><b>${s.fix}</b><span>需修改</span></div>
      <div class="test-stats__i test-stats__i--gap"><b>${s.gap}</b><span>资料不足</span></div>
      <div class="test-stats__i"><b>${s.pending}</b><span>待判定</span></div>
      <div class="test-stats__i test-stats__i--rate"><b>${s.rate}%</b><span>${s.pending ? '预计通过率' : '通过率'}</span></div>
    </div>`;
  }

  function testBench() {
    const run = S.project.testRun;
    const Q = TM.TEST_QUESTIONS;

    if (!run.generated) {
      if (window.LIVE && window.LIVE.on) {
        const n = (S.project.files || []).length;
        return `<div class="test-empty">
          <span class="test-empty__ico">${icon('target')}</span>
          <b>还没有生成测试题</b>
          <p>模型会读你的 ${n} 份资料出 12 道题，每道题的答案都必须能在资料里找到。生成后先批量运行，再由你抽检关键题。</p>
          <button class="btn btn--primary" id="btnGenTest">${icon('zap')} 根据资料生成测试题</button>
          <span class="fs11 muted mt8">你在第 5 步配置的模型会逐题回答，错的地方就是资料要补的地方</span>
        </div>`;
      }
      return `<div class="test-empty">
        <span class="test-empty__ico">${icon('target')}</span>
        <b>还没有生成测试题</b>
        <p>系统会按资料内容出 ${Q.length} 道题：产品 ${Q.filter(q => q.cat === '产品知识').length} / 销售 ${Q.filter(q => q.cat === '销售流程').length} / 邮件 ${Q.filter(q => q.cat === '邮件任务').length} / 安全 ${Q.filter(q => q.cat === '安全边界').length}。生成后先批量运行，再由你抽检 ${Q.filter(q => q.key).length} 道关键题。</p>
        <button class="btn btn--primary" id="btnGenTest">${icon('zap')} 生成 ${Q.length} 道测试题</button>
        <span class="fs11 muted mt8">生成后不会自动运行，你可以先看一眼题目是否贴合业务</span>
      </div>`;
    }

    const s = testStats();
    const list = testFilter === 'all' ? Q : Q.filter(q => q.key);
    const marks = run.marks || {};

    return `
      ${(window.LIVE && window.LIVE.on && (window.LIVE.assistants || []).length) ? `
        <div class="row mb12" style="gap:9px;align-items:center;flex-wrap:wrap">
          <span class="fs12 dim">用哪个助手跑：</span>
          <select class="select" id="testAsst" style="max-width:280px;height:32px;font-size:12px">
            <option value="">通用（查全部资料）</option>
            ${(window.LIVE.assistants || []).map((a) => `<option value="${esc(a.id)}" ${testAsstId === a.id ? 'selected' : ''}>${esc(a.name)}${a.scope && a.scope.length ? ` · ${esc(a.scope.join('/'))}` : ' · 全部'}</option>`).join('')}
          </select>
          <span class="fs11 muted">换助手会改变回答口吻和能查到的资料范围${run.ran ? '，换完要重新运行' : ''}</span>
        </div>` : ''}

      <div id="testStatsWrap">${testStatsHTML()}</div>

      ${!run.ran ? `
        <div class="test-runbar" id="testRunBarWrap">
          <div class="row--between mb8">
            <span class="fs12 dim">题目已生成，等待批量运行</span>
            <button class="btn btn--primary btn--sm" id="btnRunBatch">${icon('play')} 批量运行 ${Q.length} 题</button>
          </div>
          <div class="bar mb8" style="display:none" id="testRunBarBox"><div class="bar__fill" id="testRunBar" style="width:0%"></div></div>
          <div class="fs11 muted" id="testRunPct" style="display:none">0 / ${Q.length}</div>
        </div>` : `
        <div class="test-runbar test-runbar--done">
          <span class="row" style="gap:7px;color:var(--success)">${icon('checkCircle')}<span class="fs12 b5">${Q.length} 题已运行</span></span>
          <span class="fs11 muted">运行于 ${esc(run.at || '—')} · 平均单题 2.1 s</span>
          <div style="flex:1"></div>
          <button class="btn btn--quiet btn--sm" id="btnRerunBatch">${icon('refresh')} 重新运行</button>
        </div>`}

      <div class="row mt16 mb12" style="gap:6px">
        <button class="chip ${testFilter === 'key' ? 'is-on' : ''}" data-filter="key">关键题 ${Q.filter(q => q.key).length}</button>
        <button class="chip ${testFilter === 'all' ? 'is-on' : ''}" data-filter="all">全部 ${Q.length}</button>
        <div style="flex:1"></div>
        <span class="fs11 muted">${run.ran ? '点判定按钮可改判，统计会实时更新' : ''}</span>
      </div>

      <div class="tq-list">
        ${list.map(q => testRow(q, run, marks)).join('')}
      </div>

      <div class="test-foot">
        ${run.ran
          ? `<div class="fs12 ${s.pending === 0 ? 'dim' : 'muted'}">
               ${s.pending === 0
                 ? `全部 ${s.total} 道已判定 · 通过率 <b style="color:${s.rate >= 85 ? 'var(--success)' : 'var(--warn)'}">${s.rate}%</b>（验收线 85%）`
                 : `已判定 ${s.judged}/${s.total} 道 · 还有 ${s.pending} 道待判定，全部判完才算通过率`}
             </div>
             <div style="flex:1"></div>
             ${S.project.report
               ? `<a class="btn btn--ghost btn--sm" href="#test">${icon('fileText')} 查看测试报告</a>`
               : `<button class="btn btn--primary btn--sm" id="btnMakeReport" ${s.keyDone === s.keyTotal ? '' : 'disabled'}>${icon('fileText')} 生成测试报告</button>`}`
          : `<span class="fs11 muted">先批量运行，再核对关键题</span>`}
      </div>
    `;
  }

  /* 真实测试台：出题、运行、判定全部走服务端 */
  function bindLiveTestBench(step) {
    const bg = qi('#btnGenTest');
    if (bg) bg.onclick = async () => {
      bg.disabled = true;
      bg.innerHTML = icon('refresh') + ' 模型正在读资料出题…';
      try {
        const r = await window.LIVE.genTests(12);
        window.LIVE.paintTests();
        TM.save();
        renderStepPanel();
        toast(`已根据资料生成 ${(r.tests || []).length} 道题`);
        logAct(`生成 ${(r.tests || []).length} 道测试题`, '系统');
      } catch (e) {
        bg.disabled = false;
        bg.innerHTML = icon('zap') + ' 根据资料生成测试题';
        toast(e.message, 'warn');
      }
    };

    qa('[data-filter]').forEach(c => c.onclick = () => {
      testFilter = c.dataset.filter;
      renderStepPanel();
    });

    const sa = qi('#testAsst');
    if (sa) sa.onchange = () => {
      testAsstId = sa.value || null;
      const name = sa.options[sa.selectedIndex]?.textContent || '通用';
      toast(`已切到「${name}」${S.project.testRun?.ran ? '，重新运行才生效' : ''}`);
    };

    const br = qi('#btnRunBatch') || qi('#btnRerunBatch');
    if (br) br.onclick = async () => {
      const total = TM.TEST_QUESTIONS.length;
      const barBox = qi('#testRunBarBox'), bar = qi('#testRunBar'), pct = qi('#testRunPct');
      br.disabled = true;
      br.innerHTML = icon('refresh') + ' 正在逐题跑…';
      if (barBox) barBox.style.display = '';
      if (pct) pct.style.display = '';

      // 真实进度要靠流式接口，这里按每题的典型耗时推进，跑完再校准
      let shown = 0;
      const timer = setInterval(() => {
        shown = Math.min(total - 1, shown + 1);
        if (bar) bar.style.width = Math.round((shown / total) * 100) + '%';
        if (pct) pct.textContent = `${shown} / ${total}`;
      }, 1200);

      try {
        const r = await window.LIVE.runTests(testAsstId);
        clearInterval(timer);
        if (bar) bar.style.width = '100%';
        if (pct) pct.textContent = `${total} / ${total}`;
        window.LIVE.paintTests();
        TM.save();
        renderStepPanel();

        const res = r.results || [];
        const gapN = res.filter(x => x.verdict === 'gap').length;
        const errN = res.filter(x => x.verdict === 'error').length;
        toast(`${total} 题跑完${gapN ? ` · ${gapN} 题资料不足` : ''}${errN ? ` · ${errN} 题出错` : ''}`);
        logAct(`运行 ${total} 道测试题`, '系统');
        syncTestChecks(step);
      } catch (e) {
        clearInterval(timer);
        br.disabled = false;
        br.innerHTML = icon('play') + ' 批量运行';
        toast('运行失败：' + e.message, 'warn');
      }
    };

    qa('[data-mark]').forEach(b => b.onclick = () => {
      const qid = +b.dataset.qid;
      const mark = b.dataset.mark;
      const run = S.project.testRun;
      run.marks = run.marks || {};
      /* 点已选中的那一项就保持，不再取消。
       * 以前是 toggle：已经是「通过」的题再点一次会变成未判定，
       * 徽章却因为 fallback 到模型初值还显示「通过」，只有按钮暗掉。
       * 看起来就像"点了第二题、改的却是第一题"，其实是自己在取消第二题。 */
      run.marks[qid] = mark;
      TM.save();

      const row = qi(`.tq[data-q="${qid}"]`);
      if (row) {
        qa('.mark-btn', row).forEach(x => x.classList.toggle('is-on', x.dataset.mark === mark));
        const badge = qi('[data-qbadge]', row);
        if (badge) {
          badge.className = 'badge ' + (mark === 'pass' ? 'badge--success' : mark === 'fix' ? 'badge--warn' : 'badge--danger');
          badge.textContent = mark === 'pass' ? '通过' : mark === 'fix' ? '需修改' : '资料不足';
        }
      }

      if (window.LIVE && window.LIVE.mark) {
        window.LIVE.mark(qid, mark).catch(() => { });
      }

      const wrap = qi('#testStatsWrap');
      if (wrap) wrap.innerHTML = testStatsHTML();
      refreshTestFoot(step);
      syncTestChecks(step);
    });

    const bm = qi('#btnMakeReport');
    if (bm) bm.onclick = () => {
      const st = testStats();
      S.project.report = {
        at: TM.fmtDate(new Date()),
        rate: st.rate, pass: st.pass, fix: st.fix, gap: st.gap,
        keyDone: st.keyDone,
      };
      TM.save();
      logAct(`生成测试报告，通过率 ${st.rate}%`, '系统');
      toast(`测试报告已生成 · 通过率 ${st.rate}%`);
      renderStepPanel();
    };
  }

  function testRow(q, run, marks) {
    /* 只认 marks。以前这里 fallback 到 q.r（模型自动判的初值），
     * 结果人工取消判定后，标记没亮但徽章还显示「通过」，看起来像点了别的题。
     * 只有非 live（纯前端演示）才用初值兜底。 */
    const m = marks[q.id] || (!(window.LIVE && window.LIVE.on) ? q.r : '');
    const isKey = q.key;
    const markCls = m === 'pass' ? 'is-pass' : m === 'fix' ? 'is-fix' : m === 'gap' ? 'is-gap' : '';

    return `<div class="tq ${run.ran ? '' : 'tq--pending'}" data-q="${q.id}">
      <div class="tq__head">
        <span class="tq__no">${String(q.id).padStart(2, '0')}</span>
        <span class="tag tag--outline">${esc(q.cat)}</span>
        ${isKey ? `<span class="badge badge--warn">关键</span>` : ''}
        <div style="flex:1"></div>
        ${run.ran
          ? (m === 'pass' ? `<span class="badge badge--success" data-qbadge>通过</span>`
            : m === 'fix' ? `<span class="badge badge--warn" data-qbadge>需修改</span>`
            : m === 'gap' ? `<span class="badge badge--danger" data-qbadge>资料不足</span>`
            : `<span class="badge" data-qbadge>未判定</span>`)
          : `<span class="badge" data-qbadge>待运行</span>`}
      </div>
      <div class="tq__q">${esc(q.q)}</div>
      ${run.ran ? `
        <div class="tq__a">
          <span class="tq__a-label">AI 回答</span>
          <span>${esc(q.a)}</span>
          ${q.cite !== '—' ? `<span class="tq__cite">${icon('file')}${esc(q.cite)}</span>` : `<span class="tq__cite tq__cite--none">${icon('alert')}无出处</span>`}
        </div>
        <div class="tq__marks">
          <button class="mark-btn ${m === 'pass' ? 'is-on is-pass' : ''}" data-mark="pass" data-qid="${q.id}">${icon('check')} 通过</button>
          <button class="mark-btn ${m === 'fix' ? 'is-on is-fix' : ''}" data-mark="fix" data-qid="${q.id}">${icon('edit')} 需修改</button>
          <button class="mark-btn ${m === 'gap' ? 'is-on is-gap' : ''}" data-mark="gap" data-qid="${q.id}">${icon('help')} 资料不足</button>
        </div>` : ''}
    </div>`;
  }

  function bindTestBench(step) {
    if (window.LIVE && window.LIVE.on) return bindLiveTestBench(step);

    const Q = TM.TEST_QUESTIONS;

    const bg = qi('#btnGenTest');
    if (bg) bg.onclick = () => {
      S.project.testRun = { generated: true, ran: false, at: null, marks: {} };
      TM.save();
      renderStepPanel();
      toast(`已生成 ${Q.length} 道测试题，先看一遍再运行`);
    };

    qa('[data-filter]').forEach(c => c.onclick = () => {
      testFilter = c.dataset.filter;
      renderStepPanel();
    });

    const br = qi('#btnRunBatch') || qi('#btnRerunBatch');
    if (br) br.onclick = () => runBatch(step, br);

    qa('[data-mark]').forEach(b => b.onclick = () => {
      const qid = +b.dataset.qid;
      const mark = b.dataset.mark;
      const run = S.project.testRun;
      // 点同一项保持，不取消——取消太容易误触，和 live 分支保持一致
      run.marks[qid] = mark;
      TM.save();

      // 局部刷新该行
      const row = qi(`.tq[data-q="${qid}"]`);
      if (row) {
        qa('.mark-btn', row).forEach(x => {
          x.classList.toggle('is-on', x.dataset.mark === mark);
        });
        const badge = qi('[data-qbadge]', row);
        if (badge) {
          badge.className = 'badge ' + (mark === 'pass' ? 'badge--success' : mark === 'fix' ? 'badge--warn' : 'badge--danger');
          badge.textContent = mark === 'pass' ? '通过' : mark === 'fix' ? '需修改' : '资料不足';
        }
      }

      // 局部刷新统计与底部
      const wrap = qi('#testStatsWrap');
      if (wrap) wrap.innerHTML = testStatsHTML();
      refreshTestFoot(step);
      syncTestChecks(step);
    });

    const bm = qi('#btnMakeReport');
    if (bm) bm.onclick = () => {
      const s = testStats();
      S.project.report = {
        at: TM.fmtDate(new Date()),
        rate: s.rate, pass: s.pass, fix: s.fix, gap: s.gap,
        keyDone: s.keyDone,
      };
      TM.save();
      logAct(`生成测试报告，通过率 ${s.rate}%`, '系统');
      toast(`测试报告已生成 · 通过率 ${s.rate}%`);
      renderStepPanel();
    };

    const rr = qi('#btnRerunBatch');
    if (rr) rr.onclick = () => runBatch(step, rr);
  }

  function refreshTestFoot(step) {
    const s = testStats();
    const foot = qi('.test-foot');
    if (!foot) return;
    if (S.project.report) {
      foot.innerHTML = `<div class="fs12 dim">报告已生成 · 通过率 <b>${S.project.report.rate}%</b></div>
        <div style="flex:1"></div>
        <a class="btn btn--ghost btn--sm" href="#test">${icon('fileText')} 查看测试报告</a>`;
      return;
    }
    const ok = s.keyDone === s.keyTotal;
    foot.innerHTML = `<div class="fs12 ${ok ? 'dim' : 'muted'}">${ok
      ? `关键题已全部核对 · 通过率 <b style="color:${s.rate >= 85 ? 'var(--success)' : 'var(--warn)'}">${s.rate}%</b>（验收线 85%）`
      : `还有 ${s.keyTotal - s.keyDone} 道关键题待核对`}</div>
      <div style="flex:1"></div>
      <button class="btn btn--primary btn--sm" id="btnMakeReport" ${ok ? '' : 'disabled'}>${icon('fileText')} 生成测试报告</button>`;
    const bm = qi('#btnMakeReport');
    if (bm) bm.onclick = () => {
      const st = testStats();
      S.project.report = { at: TM.fmtDate(new Date()), rate: st.rate, pass: st.pass, fix: st.fix, gap: st.gap, keyDone: st.keyDone };
      TM.save();
      logAct(`生成测试报告，通过率 ${st.rate}%`, '系统');
      toast(`测试报告已生成 · 通过率 ${st.rate}%`);
      renderStepPanel();
    };
  }

  async function runBatch(step, btn) {
    const Q = TM.TEST_QUESTIONS;
    const run = S.project.testRun;
    run.marks = run.marks || {};

    btn.disabled = true;
    btn.innerHTML = icon('refresh') + ' 运行中…';

    let barBox = qi('#testRunBarBox'), bar = qi('#testRunBar'), pct = qi('#testRunPct');
    if (!barBox) {
      // 重新运行时把进度条插到 runbar 里
      const wrap = qi('.test-runbar');
      if (wrap) {
        wrap.insertAdjacentHTML('beforeend', `<div class="bar mb8" style="margin-top:10px" id="testRunBarBox"><div class="bar__fill" id="testRunBar" style="width:0%"></div></div><div class="fs11 muted" id="testRunPct">0 / ${Q.length}</div>`);
        barBox = qi('#testRunBarBox'); bar = qi('#testRunBar'); pct = qi('#testRunPct');
      }
    }
    if (barBox) barBox.style.display = 'block';
    if (pct) pct.style.display = 'block';

    for (let i = 0; i < Q.length; i++) {
      await sleep(30);
      if (i % 5 === 0 || i === Q.length - 1) {
        const p = Math.round((i + 1) / Q.length * 100);
        if (bar) bar.style.width = p + '%';
        if (pct) pct.textContent = `${i + 1} / ${Q.length} · 正在运行 ${Q[i].cat}`;
      }
    }

    run.ran = true;
    run.at = TM.fmtDate(new Date()) + ' ' + TM.fmtTime(new Date()).slice(0, 5);
    TM.save();
    renderStepPanel();
    logAct(`运行 ${Q.length} 道测试题，通过率 ${testStats().rate}%`, '系统');
    toast(`${Q.length} 题运行完成，请核对关键题`);
  }

  function syncTestChecks(step) {
    if (!step || step.id !== 7) return;
    const s = testStats();
    let reverted = false;
    if (setCheck(step, 'c1', s.ran)) reverted = true;
    if (setCheck(step, 'c2', s.keyDone === s.keyTotal)) reverted = true;
    // 必须全部判定完才谈通过率：判了 3 道就报 100%，等于自欺欺人
    if (setCheck(step, 'c3', s.ran && s.pending === 0 && s.rate >= 85)) reverted = true;
    refreshGate(step, TM.stepState(step.id));
    if (reverted) {
      toast('测试结果变更，第 7 步需要重新确认', 'warn');
      router();
    }
  }

  /* 检查项统一设置：同时改状态与 DOM */
  function setCheck(step, checkId, on) {
    const saved = TM.stepState(step.id);
    const i = saved.checks.indexOf(checkId);
    if (on && i < 0) saved.checks.push(checkId);
    if (!on && i >= 0) saved.checks.splice(i, 1);

    // 已完成的步骤，如果检查项不再满足，退回进行中状态
    let reverted = false;
    if (!on && saved.done) {
      saved.done = false;
      saved.at = null;
      reverted = true;
    }

    TM.save();
    const box = qi(`.checkline[data-check="${checkId}"]`);
    if (box) box.classList.toggle('is-checked', on);
    return reverted;
  }

  /* ---------------------------------------------------------------------
     第 8 步：员工试用（添加成员 + 提问计数 + 反馈）
     --------------------------------------------------------------------- */
  const staffMembers = () => (S.members || []).filter(m => m.role !== '企业管理员' && m.role !== '服务顾问');

  function inviteBox() {
    const staff = staffMembers();
    const asks = S.portalAsks || 0;
    const fb = S.feedback || [];

    return `<div class="card" style="padding:16px;background:var(--surface-2);box-shadow:none">
      <div class="row--between mb12">
        <div>
          <b class="fs13">试用成员 ${staff.length} 人</b>
          <div class="fs11 muted mt4">成员只能使用助手，看不到配置与原始资料</div>
        </div>
        <div class="row" style="gap:8px">
          <button class="btn btn--quiet btn--sm" id="btnCopyPortal">${icon('external')} 复制门户链接</button>
          <button class="btn btn--ghost btn--sm" id="btnInvite">${icon('userPlus')} 添加成员</button>
        </div>
      </div>

      <div class="note note--info mb12" style="font-size:11px">
        ${icon('info')}<span>系统不发邮件。加完成员后，把门户链接发给对方就能用。</span>
      </div>

      <div class="stack" style="gap:7px">
        ${staff.length ? staff.map(m => `
          <div class="doc-item">
            <span class="avatar" style="width:30px;height:30px;font-size:11px;background:#2C5866">${esc(m.name.slice(0, 1))}</span>
            <div class="doc-item__body">
              <b>${esc(m.name)} · ${esc(m.role)}</b>
              <span>${m.email ? esc(m.email) + ' · ' : ''}添加于 ${esc(m.at)}</span>
            </div>
            <span class="badge badge--success badge--dot">可用</span>
            <button class="btn btn--quiet btn--sm doc-item__del" data-remove="${esc(m.id)}" title="移除">${icon('x')}</button>
          </div>`).join('') : `<div class="empty" style="padding:22px 0">${icon('users')}<p class="fs12">还没有添加成员。试用期的反馈比测试题更真实。</p></div>`}
      </div>
    </div>

    <div class="grid g2 mt12" style="gap:12px">
      <div class="card" style="padding:14px;background:#fff">
        <div class="row--between">
          <span class="fs12 b5">真实提问次数</span>
          <span class="fs12 tnum b6" id="askCount">${asks} / 5</span>
        </div>
        <div class="bar mt8" style="height:5px"><div class="bar__fill" id="askBar" style="width:${Math.min(100, asks / 5 * 100)}%"></div></div>
        <div class="fs11 muted mt8">在「员工门户」里每问一次就 +1</div>
      </div>
      <div class="card" style="padding:14px;background:#fff">
        <div class="row--between mb8">
          <span class="fs12 b5">试用反馈</span>
          <span class="fs12 tnum b6" id="fbCount">${fb.length} 条</span>
        </div>
        <div class="fs11 muted" id="fbLast" style="min-height:32px;line-height:1.5">${fb.length ? '最近：' + esc(fb[fb.length - 1].txt) : '还没有反馈记录'}</div>
        <button class="btn btn--ghost btn--sm mt8" id="btnFeedback">${icon('edit')} 记录一条反馈</button>
      </div>
    </div>`;
  }

  function bindInviteBox(step) {
    const bi = qi('#btnInvite');
    if (bi) bi.onclick = () => openInvite(step);

    qa('[data-remove]').forEach(b => b.onclick = () => {
      const id = b.dataset.remove;
      const m = (S.members || []).find(x => x.id === id);
      if (!m) return;
      S.members = S.members.filter(x => x.id !== id);
      TM.save();
      const reverted = syncStep8Checks(step);
      if (reverted) router();
      else { renderStepPanel(); toast(`已移除 ${m.name}`, 'info'); }
    });

    const bc = qi('#btnCopyPortal');
    if (bc) bc.onclick = async () => {
      const id = (window.LIVE && window.LIVE.clientId) || '';
      const url = id
        ? `${location.origin}/app.html?c=${id}#portal`
        : `${location.origin}/app.html#portal`;
      try {
        await navigator.clipboard.writeText(url);
        toast('门户链接已复制，发给员工就行');
      } catch {
        // 非 https 下浏览器可能禁用剪贴板，退回到选中提示
        modal({
          title: '门户链接',
          desc: '复制下面这个地址，发给需要试用的同事。',
          body: `<input class="input mono" id="portalUrlOut" value="${esc(url)}" readonly onclick="this.select()">`,
          okText: '知道了',
        });
      }
    };

    const bf = qi('#btnFeedback');
    if (bf) bf.onclick = () => modal({
      title: '记录试用反馈',
      desc: '员工说哪句话不顺手、哪个问题答错了，都值得记一笔。',
      body: `<div class="field"><label class="field__label">反馈内容 <i class="req">*</i></label>
          <textarea class="textarea" id="fbTxt" placeholder="例如：问 HS-2041 的包装尺寸，答的是旧版规格"></textarea></div>
        <div class="field" style="margin-bottom:0"><label class="field__label">谁反馈的</label>
          <select class="select" id="fbWho">${staffMembers().map(m => `<option>${esc(m.name)}</option>`).join('') || '<option>管理员代记</option>'}</select></div>`,
      okText: '保存反馈',
      onOk: (back) => {
        const txt = back.querySelector('#fbTxt').value.trim();
        if (txt.length < 4) { toast('至少写一句话', 'warn'); return false; }
        const who = back.querySelector('#fbWho').value;
        S.feedback.push({ txt, who, at: TM.fmtDate(new Date()) });
        TM.save();
        logAct('记录一条试用反馈');
        renderStepPanel();
        toast('反馈已记录');
      },
    });
  }

  function openInvite(step) {
    modal({
      title: '添加试用成员',
      desc: '添加后对方就能用助手。系统不发邮件——加完把门户链接发给对方即可。',
      body: `<div class="field"><label class="field__label">姓名 <i class="req">*</i></label>
          <input class="input" id="invName" placeholder="例如 张浩"></div>
        <div class="field"><label class="field__label">邮箱 <span class="fs11 muted">（选填，只做备注）</span></label>
          <input class="input" id="invEmail" placeholder="name@company.com"></div>
        <div class="field" style="margin-bottom:0"><label class="field__label">角色</label>
          <select class="select" id="invRole"><option>销售员工</option><option>销售主管</option><option>技术</option><option>客服</option></select></div>`,
      okText: '添加成员',
      onOk: (back) => {
        const name = back.querySelector('#invName').value.trim();
        const email = back.querySelector('#invEmail').value.trim();
        const role = back.querySelector('#invRole').value;
        if (!name) { toast('填一下姓名', 'warn'); return false; }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('邮箱格式不对，或者留空', 'warn'); return false; }
        if (email && (S.members || []).some(x => (x.email || '').toLowerCase() === email.toLowerCase())) {
          toast('这个邮箱已经在成员列表里了', 'warn');
          return false;
        }
        S.members.push({ id: 'm' + Date.now(), name, email, role, status: 'active', at: TM.fmtDate(new Date()) });
        TM.save();
        logAct(`添加成员 ${name}（${role}）`);
        if (step) renderStepPanel();
        else router();
        toast(`${name} 已加入。把门户链接发给他就能用`);
      },
    });
  }

  /* 第 7 步：检查项必须反映真实测试结果，不能写死「50 道 / 86%」 */
  function syncStep7Checks(step) {
    if (!step || step.id !== 7) return false;
    if (!(window.LIVE && window.LIVE.on)) return false;

    const L = window.LIVE;
    const items = L.tests?.items || [];
    const results = L.tests?.results || [];
    const total = items.length;
    const ran = results.length;
    const pass = results.filter((r) => r.verdict === 'pass').length;
    const fix = results.filter((r) => r.verdict === 'fix').length;
    const gap = results.filter((r) => r.verdict === 'gap').length;
    const marked = pass + fix + gap;
    const rate = marked ? Math.round((pass / marked) * 100) : 0;
    const keyItems = items.filter((t) => t.key);
    const keyCount = keyItems.length;
    const keyJudged = keyItems.filter((t) =>
      results.some((r) => r.id === t.id && ['pass', 'fix', 'gap'].includes(r.verdict))
    ).length;

    step.checks[0].meta = total ? `共 ${total} 道 · 已跑 ${ran} 道` : '还没有出题';
    step.checks[1].meta = keyCount ? `关键 ${keyCount} 道 · 已核对 ${keyJudged} 道` : '这批题没有标关键题';
    step.checks[2].meta = marked
      ? `已判定 ${marked}/${total} 道 · 通过率 ${rate}%（通过 ${pass} · 需改 ${fix} · 不足 ${gap}）`
      : '还没有判定结果';

    let reverted = false;
    if (setCheck(step, 'c1', total > 0 && ran >= total)) reverted = true;
    if (setCheck(step, 'c2', keyCount > 0 && keyJudged >= keyCount)) reverted = true;
    // 必须全部判定完才谈通过率：只判 3 道就报 100%，等于自欺欺人
    if (setCheck(step, 'c3', total > 0 && marked >= total && rate >= 85)) reverted = true;
    refreshGate(step, TM.stepState(step.id));
    if (reverted) {
      toast('测试结果不满足验收条件，第 7 步需要重新确认', 'warn');
      syncProgressUI();
    }
    return reverted;
  }

  function syncStep8Checks(step) {
    if (!step || step.id !== 8) return false;
    let reverted = false;
    if (setCheck(step, 'c1', staffMembers().length >= 3)) reverted = true;
    if (setCheck(step, 'c2', (S.portalAsks || 0) >= 5)) reverted = true;
    if (setCheck(step, 'c3', (S.feedback || []).length > 0)) reverted = true;
    refreshGate(step, TM.stepState(step.id));
    if (reverted) {
      toast('试用条件不再满足，第 8 步需要重新确认', 'warn');
      syncProgressUI();
    }
    return reverted;
  }

  function openAssist() {
    modal({
      title: '申请人工协助',
      desc: '提交后服务顾问会在 4 小时内响应（工作日）。',
      body: `<div class="field"><label class="field__label">卡在哪一步</label>
          <select class="select">${STEPS.map(s => `<option ${s.id === activeStep ? 'selected' : ''}>第 ${s.id} 步 · ${s.title}</option>`).join('')}</select>
        </div>
        <div class="field"><label class="field__label">遇到什么问题</label>
          <textarea class="textarea" placeholder="描述得越具体，处理越快。例如：Docker 安装时报 WSL 相关错误"></textarea>
        </div>
        <label class="checkline is-checked" style="padding-left:0">
          <span class="checkline__box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
          <span class="checkline__txt">允许服务顾问查看本项目的部署状态与错误日志<span class="checkline__meta">仅限本项目，不含文件内容，可随时撤销</span></span>
        </label>`,
      okText: '提交工单',
      onOk: () => toast('工单已提交，服务顾问会尽快联系你'),
    });
  }

  /* =====================================================================
     4. 配置中心
     ===================================================================== */
  const CFG_TABS = [
    ['model', '模型管理'],
    ['api', 'API 与授权'],
    ['kb', '知识库'],
    ['docs', '资料文件'],
    ['assistant', 'AI 助手'],
    ['prompt', '提示词与规则'],
  ];

  function renderConfig(root, param) {
    const tab = param && CFG_TABS.some(t => t[0] === param) ? param : 'model';

    root.innerHTML = `<div class="page">
      ${pageHead('配置中心', '项目交付后，知识库更新、模型更换、助手调整都在这里。改动会记录在操作日志里。',
        `<button class="btn btn--ghost btn--sm" id="btnSync">${icon('refresh')} 同步配置</button>`)}

      <div class="tabs mb20" style="margin-bottom:18px">
        ${CFG_TABS.map(([k, n]) => `<button class="tab ${k === tab ? 'is-active' : ''}" data-tab="${k}">${n}</button>`).join('')}
      </div>

      <div id="cfgBody"></div>
    </div>`;

    qa('.tab').forEach(t => t.onclick = () => go('config', t.dataset.tab));
    qi('#btnSync').onclick = () => toast('配置已与知识库引擎同步');

    const body = qi('#cfgBody');
    const renderers = { model: cfgModel, api: cfgApi, kb: cfgKb, docs: cfgDocs, assistant: cfgAssistant, prompt: cfgPrompt };
    body.innerHTML = renderers[tab]();
    bindCfg(body, tab);
  }

  /* =====================================================================
     真实能力：建库 / 模型配置（本地服务可用时走这里）
     ===================================================================== */

  /* 第 4 步：真的解析资料、真的建索引 */
  async function runBuildKb(step, btn) {
    const con = qi('#console');
    const saved = TM.stepState(step.id);
    btn.disabled = true;
    btn.innerHTML = icon('refresh') + ' 正在建库…';
    con.style.display = 'block';
    con.innerHTML = '';

    const say = (text, cls = 'ok') => {
      const line = TM.el('div', '', `<span class="ts">${TM.fmtTime(new Date())}</span><span class="${cls}">${esc(text)}</span>`);
      line.style.opacity = '0';
      line.style.transition = 'opacity .2s';
      con.appendChild(line);
      requestAnimationFrame(() => { line.style.opacity = '1'; });
      con.scrollTop = con.scrollHeight;
    };

    try {
      say('读取资料并重新解析…');
      const r = await window.LIVE.buildKb();

      for (const d of r.perDoc || []) {
        say(`${d.name} · ${d.pages} 页 · ${d.chunks} 个切片`);
        await sleep(120);
      }
      say(`切片完成 · 共 ${r.chunks} 个片段`);
      await sleep(150);
      say(`索引构建完成 · ${r.terms} 个词项`);
      await sleep(150);
      say(`耗时 ${r.ms} ms · 知识库已就绪`, 'dim');

      saved.executed = true;
      TM.save();
      window.LIVE.syncSoon();
      logAct(`知识库构建完成 · ${r.chunks} 个切片 / ${r.terms} 个词项`, '系统');
      toast(`建库完成 · ${r.chunks} 个切片`);

      btn.disabled = false;
      btn.innerHTML = icon('check') + ' 已执行';

      /* 系统能验证的第一项直接勾上，界面同步打勾（不能只改计数不打勾，客户会以为没生效） */
      const first = step.checks[0];
      if (first && !saved.checks.includes(first.id)) {
        saved.checks.push(first.id);
        TM.save();
        const row = qi(`.checkline[data-check="${first.id}"]`);
        if (row) row.classList.add('is-checked');
        refreshGate(step, saved);
      }
      window.LIVE.kb = r;
    } catch (e) {
      say(e.message, 'warn');
      btn.disabled = false;
      btn.innerHTML = icon('play') + ' 开始执行';
      toast('建库失败：' + e.message, 'warn');
    }
  }

  /* 模型配置表单：第 5 步和配置中心共用 */
  function llmForm(compact) {
    const cfg = (window.LIVE && window.LIVE.llm) || { configured: false };
    const isPlatform = !!cfg.configured && cfg.source === 'platform';
    const providers = [
      ['deepseek', 'DeepSeek', 'deepseek-chat'],
      ['dashscope', '通义千问', 'qwen-plus'],
      ['zhipu', '智谱 GLM', 'glm-4-plus'],
      ['moonshot', '月之暗面', 'moonshot-v1-8k'],
      ['openai', 'OpenAI', 'gpt-4o-mini'],
      ['custom', '自定义（OpenAI 兼容）', ''],
    ];

    return `<div class="card" style="padding:16px;background:var(--surface-2);box-shadow:none">
      ${cfg.configured ? `
        <div class="row--between mb12">
          <div class="row" style="gap:8px">
            <span style="color:var(--success);display:flex">${icon('checkCircle')}</span>
            <div>
              <b class="fs12">${isPlatform ? '平台已内置模型' : '已配置'}：${esc(cfg.model)}</b>
              <div class="fs11 muted mt2">${isPlatform
                ? `密钥 ${esc(cfg.keyMasked)} · 由平台统一提供，出题和回答都已可用，不用自己填`
                : `密钥 ${esc(cfg.keyMasked)} · 存在本机，不上传`}</div>
            </div>
          </div>
          <button class="btn btn--quiet btn--sm" id="btnLlmEdit">${icon('edit')} ${isPlatform ? '改用我自己的 Key' : '修改'}</button>
        </div>` : `
        <div class="note note--warn mb12">${icon('key')}<span>还没有配置模型。没有模型，第 7 步出不了测试题，员工门户也只能返回原文片段、给不出回答。</span></div>`}

      <div id="llmFormBox" style="${cfg.configured && compact ? 'display:none' : ''}">
        ${isPlatform ? `<div class="fs11 muted mb12">当前用的是平台内置 Key（${esc(cfg.keyMasked)}）。如果贵司有自己的账号，可以在下面换成自己的，费用走自己的额度；不填就继续用平台的。</div>` : ''}
        <div class="grid g2" style="gap:12px">
          <div class="field"><label class="field__label">服务商</label>
            <select class="select" id="llmProvider">
              ${providers.map(([k, n]) => `<option value="${k}" ${((cfg.provider || 'deepseek') === k) ? 'selected' : ''}>${n}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label class="field__label">模型名称</label>
            <input class="input mono" id="llmModel" value="${esc(cfg.model || 'deepseek-chat')}" placeholder="deepseek-chat">
          </div>
        </div>
        <div class="field"><label class="field__label">接口地址</label>
          <input class="input mono" id="llmBase" value="${esc(cfg.baseURL || 'https://api.deepseek.com')}" placeholder="https://api.deepseek.com">
        </div>
        <div class="field">
          <label class="field__label">API Key</label>
          <input class="input mono" id="llmKey" type="password" placeholder="${cfg.configured ? '已保存，如需更换请重新填写' : 'sk-...'}" autocomplete="new-password">
          <div class="field__hint">在服务商后台创建。Key 保存在本机 data 目录，只用于调用模型，不会写进网页代码。</div>
        </div>
        <div class="row mt12">
          <button class="btn btn--primary btn--sm" id="btnLlmSave">${icon('zap')} 保存并测试连通</button>
          <span class="fs11 muted">会真的发一次请求验证，不是假装通过</span>
        </div>
      </div>

      <div id="llmResult"></div>
    </div>`;
  }

  function bindLlmForm() {
    const edit = qi('#btnLlmEdit');
    if (edit) edit.onclick = () => {
      const box = qi('#llmFormBox');
      if (box) box.style.display = '';
    };

    const sel = qi('#llmProvider');
    if (sel) sel.onchange = () => {
      const map = {
        deepseek: ['https://api.deepseek.com', 'deepseek-chat'],
        dashscope: ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-plus'],
        zhipu: ['https://open.bigmodel.cn/api/paas/v4', 'glm-4-plus'],
        moonshot: ['https://api.moonshot.cn/v1', 'moonshot-v1-8k'],
        openai: ['https://api.openai.com/v1', 'gpt-4o-mini'],
      };
      const v = map[sel.value];
      if (v) {
        qi('#llmBase').value = v[0];
        qi('#llmModel').value = v[1];
      }
    };

    const save = qi('#btnLlmSave');
    if (!save) return;
    save.onclick = async () => {
      const cfg = {
        provider: qi('#llmProvider').value,
        baseURL: qi('#llmBase').value.trim(),
        model: qi('#llmModel').value.trim(),
        apiKey: qi('#llmKey').value.trim(),
      };
      if (!cfg.model) return toast('先填模型名称', 'warn');
      const cur = window.LIVE.llm || {};
      if (!cfg.apiKey) {
        if (cur.source === 'platform') {
          return toast('现在用的是平台内置 Key，已经能用了。要换成自己的账号，请先填写 Key', 'warn');
        }
        if (!cur.configured) return toast('先填 API Key', 'warn');
      }

      const box = qi('#llmResult');
      save.disabled = true;
      save.innerHTML = icon('refresh') + ' 正在请求模型…';
      box.innerHTML = `<div class="env-summary is-idle mt12">${icon('info')}<span>正在向 ${esc(cfg.baseURL)} 发一次真实请求…</span></div>`;

      try {
        const r = await window.LIVE.saveLlm(cfg);
        if (r.ok) {
          box.innerHTML = `<div class="env-summary is-ok mt12">${icon('checkCircle')}<div>
            <b>连通正常 · ${esc(r.config.model)}</b>
            <span>模型回复「${esc(r.test.reply || '正常')}」· 往返 ${r.test.ms} ms · 消耗 ${r.test.usage?.total || 0} tokens</span>
          </div></div>`;
          logAct(`配置模型 ${r.config.model}，连通性测试通过`);
          toast('模型已配置，连通性测试通过');
          setTimeout(() => { renderStepPanel(); router(); }, 900);
        } else {
          box.innerHTML = `<div class="env-summary is-warn mt12">${icon('alert')}<div>
            <b>没能连上（${esc(r.code || 'ERROR')}）</b><span>${esc(r.error)}</span>
          </div></div>`;
          toast('连通失败，看下面的原因', 'warn');
        }
      } catch (e) {
        box.innerHTML = `<div class="env-summary is-warn mt12">${icon('alert')}<div><b>请求出错</b><span>${esc(e.message)}</span></div></div>`;
      } finally {
        save.disabled = false;
        save.innerHTML = icon('zap') + ' 保存并测试连通';
      }
    };
  }

  /* =====================================================================
     第 6 步 · AI 助手
     这里的配置会真的进入模型调用：决定口吻、规则，以及只查哪几类资料
     ===================================================================== */

  const ASSISTANT_TEMPLATES = [
    {
      key: 'product', name: '产品知识助手', role: '产品顾问',
      desc: '回答型号、参数、材质、包装、认证',
      scope: ['产品资料'], tone: '简洁、直接',
      prompt: '涉及型号参数时，先报型号再给数值，不要把多个型号的参数混在一起说。',
      rules: { cite: true, refuse: true, brevity: true, noPrice: false },
    },
    {
      key: 'sales', name: '销售知识助手', role: '外贸业务',
      desc: '回答报价、付款、交期、账期',
      scope: ['销售资料', '业务流程'], tone: '商务、谨慎',
      prompt: '涉及条款时尽量用资料原话，不要替公司做额外承诺。',
      rules: { cite: true, refuse: true, brevity: true, noPrice: true },
    },
    {
      key: 'service', name: '售后政策助手', role: '售后客服',
      desc: '回答退换货、质保、投诉处理',
      scope: ['售后资料'], tone: '亲和、有耐心',
      prompt: '先判断是质量问题还是人为损坏，再给处理方式，不要一概而论。',
      rules: { cite: true, refuse: true, brevity: false, noPrice: false },
    },
  ];

  const DOC_CATS_ALL = ['产品资料', '销售资料', '售后资料', '业务流程'];

  function catCounts() {
    const m = {};
    for (const f of (S.project.files || [])) {
      const c = f.cat || '产品资料';
      m[c] = (m[c] || 0) + 1;
    }
    return m;
  }

  function ruleChips(a) {
    const t = [];
    if (a.rules?.cite) t.push('引用出处');
    if (a.rules?.refuse) t.push('查不到就说不知道');
    if (a.rules?.brevity) t.push('先给结论');
    if (a.rules?.noPrice) t.push('价格只引原文');
    return t.length ? t.join(' · ') : '未设规则';
  }

  function assistantPanel(step) {
    if (!(window.LIVE && window.LIVE.on)) {
      return `<div class="note note--info">${icon('info')}<span>演示模式下助手是预置数据。用本地服务打开才能真正创建并生效。</span></div>`;
    }

    const list = window.LIVE.assistants || [];
    const counts = catCounts();
    const totalDocs = (S.project.files || []).length;

    if (!totalDocs) {
      return `<div class="note note--warn">${icon('alert')}<span>还没有资料。助手建了也没东西可查，先到第 3 步上传资料。</span></div>`;
    }

    return `
      <div class="row--between mb12" style="align-items:flex-start">
        <div style="flex:1">
          <b class="fs13">${list.length ? `已创建 ${list.length} 个助手` : '还没有助手'}</b>
          <div class="fs11 muted mt4" style="line-height:1.6">助手决定回答的口吻和规则，也决定它能查哪几类资料。<br>第 7 步跑测试、第 8 步员工提问，都会按选中的助手来回答。</div>
        </div>
        <button class="btn btn--primary btn--sm" id="btnNewAssistant" style="flex:0 0 auto">${icon('plus')} 新建助手</button>
      </div>

      ${list.length ? `
        <div class="stack" style="gap:9px">
          ${list.map((a) => `
            <div class="doc-item">
              <span style="width:30px;height:30px;flex:0 0 auto;border-radius:8px;background:var(--brand-50);color:var(--brand);display:grid;place-items:center">${icon('bot')}</span>
              <div class="doc-item__body">
                <b>${esc(a.name)}${a.role ? ` · ${esc(a.role)}` : ''}</b>
                <span>${esc(a.desc || '未填写负责范围')}</span>
                <span class="fs11 muted">查：${a.scope && a.scope.length ? esc(a.scope.join(' / ')) : '全部资料'} · ${esc(ruleChips(a))}</span>
              </div>
              <button class="btn btn--quiet btn--sm" data-edit-a="${esc(a.id)}">${icon('edit')} 编辑</button>
              <button class="btn btn--quiet btn--sm doc-item__del" data-del-a="${esc(a.id)}" title="删除">${icon('x')}</button>
            </div>`).join('')}
        </div>` : `
        <div class="grid g3" style="gap:10px">
          ${ASSISTANT_TEMPLATES.map((t) => {
            const n = t.scope.reduce((s, c) => s + (counts[c] || 0), 0);
            return `<div class="card" style="padding:14px;background:var(--surface-2);box-shadow:none;cursor:pointer" data-tpl="${t.key}">
              <div class="fs13 b6">${esc(t.name)}</div>
              <p class="fs11 muted mt4" style="line-height:1.55;min-height:32px">${esc(t.desc)}</p>
              <div class="fs11 muted mt8">查 ${esc(t.scope.join(' / '))} · 现有 ${n} 份</div>
              <div class="fs11 mt8" style="color:var(--brand);font-weight:600">一键创建 →</div>
            </div>`;
          }).join('')}
        </div>`}

      <div class="note note--info mt12">${icon('info')}<span>助手的资料范围会真的作用到检索上：范围外的资料不会被检索到，问到范围外的问题它会直接说明。想让它查更全，把范围留空即可。</span></div>
    `;
  }

  function openAssistantEditor(step, existing, tpl) {
    const base = existing || {
      name: tpl?.name || '',
      role: tpl?.role || '',
      desc: tpl?.desc || '',
      scope: tpl?.scope ? [...tpl.scope] : [],
      prompt: tpl?.prompt || '',
      tone: tpl?.tone || '简洁、直接',
      rules: tpl?.rules || { cite: true, refuse: true, brevity: true, noPrice: false },
    };
    const counts = catCounts();
    const tones = ['简洁、直接', '商务、谨慎', '亲和、有耐心', '严谨、偏技术'];

    const sw = (id, label, hint, on) => `
      <label class="row" style="gap:9px;align-items:flex-start;padding:7px 0;cursor:pointer">
        <input type="checkbox" id="${id}" ${on ? 'checked' : ''} style="margin-top:2px;flex:0 0 auto">
        <span style="flex:1">
          <span class="fs12 b5">${esc(label)}</span>
          <span class="fs11 muted" style="display:block;margin-top:2px">${esc(hint)}</span>
        </span>
      </label>`;

    modal({
      title: existing ? '编辑助手' : '新建助手',
      desc: '这些设置会真的写进模型提示词，不是给人看的说明文字。',
      wide: true,
      body: `
        <div class="grid g2" style="gap:12px">
          <div class="field"><label class="field__label">助手名称 <i class="req">*</i></label>
            <input class="input" id="asName" value="${esc(base.name)}" placeholder="例如 产品知识助手"></div>
          <div class="field"><label class="field__label">岗位定位</label>
            <input class="input" id="asRole" value="${esc(base.role)}" placeholder="例如 产品顾问"></div>
        </div>

        <div class="field"><label class="field__label">负责什么</label>
          <input class="input" id="asDesc" value="${esc(base.desc)}" placeholder="例如 回答型号、参数、包装、认证"></div>

        <div class="field">
          <label class="field__label">能查哪些资料 <span class="fs11 muted">（都不选 = 查全部资料）</span></label>
          <div class="row" id="asScope" style="gap:8px;flex-wrap:wrap">
            ${DOC_CATS_ALL.map((c) => {
              const on = (base.scope || []).includes(c);
              return `<label class="row" style="gap:7px;padding:7px 11px;border:1px solid var(--border);border-radius:8px;cursor:pointer">
                <input type="checkbox" data-cat="${esc(c)}" ${on ? 'checked' : ''}>
                <span class="fs12">${esc(c)}</span>
                <span class="fs11 muted">${counts[c] || 0} 份</span>
              </label>`;
            }).join('')}
          </div>
        </div>

        <div class="field"><label class="field__label">语气</label>
          <select class="select" id="asTone">
            ${tones.map((t) => `<option ${base.tone === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
          </select>
        </div>

        <div class="field"><label class="field__label">回答规则</label>
          <div class="stack" style="gap:0">
            ${sw('rCite', '必须能对上资料', '回答要能追溯到具体资料，出处由系统附在下面', base.rules?.cite !== false)}
            ${sw('rRefuse', '查不到就说不知道', '资料里没有的直接说没有，不用常识补齐', base.rules?.refuse !== false)}
            ${sw('rBrevity', '先给结论再补细节', '第一句话就回答问题，别先铺垫', base.rules?.brevity !== false)}
            ${sw('rNoPrice', '价格只引原文', '价格、折扣、账期不推算、不改写', !!base.rules?.noPrice)}
          </div>
        </div>

        <div class="field" style="margin-bottom:0"><label class="field__label">补充要求 <span class="fs11 muted">（原样写进提示词）</span></label>
          <textarea class="textarea" id="asPrompt" rows="3" placeholder="例如：涉及型号参数时，先报型号再给数值。">${esc(base.prompt)}</textarea>
        </div>`,
      okText: existing ? '保存' : '创建助手',
      onOk: async (back) => {
        const name = back.querySelector('#asName').value.trim();
        if (!name) { toast('填一下助手名称', 'warn'); return false; }

        const scope = [...back.querySelectorAll('#asScope input[type=checkbox]')]
          .filter((c) => c.checked)
          .map((c) => c.dataset.cat);

        const payload = {
          id: existing?.id,
          name,
          role: back.querySelector('#asRole').value.trim(),
          desc: back.querySelector('#asDesc').value.trim(),
          scope,
          tone: back.querySelector('#asTone').value,
          prompt: back.querySelector('#asPrompt').value.trim(),
          rules: {
            cite: back.querySelector('#rCite').checked,
            refuse: back.querySelector('#rRefuse').checked,
            brevity: back.querySelector('#rBrevity').checked,
            noPrice: back.querySelector('#rNoPrice').checked,
          },
        };

        try {
          await window.LIVE.saveAssistant(payload);
          toast(existing ? `助手「${name}」已更新` : `助手「${name}」已创建`);
          logAct(`${existing ? '更新' : '创建'}助手「${name}」${scope.length ? ` · 查 ${scope.join('/')}` : ' · 查全部资料'}`, '系统');
          renderStepPanel();
        } catch (e) {
          toast(e.message || '保存失败', 'warn');
          return false;
        }
      },
    });
  }

  function bindAssistantPanel(step) {
    const bn = qi('#btnNewAssistant');
    if (bn) bn.onclick = () => openAssistantEditor(step, null, null);

    qa('[data-tpl]').forEach((c) => {
      c.onclick = () => {
        const tpl = ASSISTANT_TEMPLATES.find((t) => t.key === c.dataset.tpl);
        if (tpl) openAssistantEditor(step, null, tpl);
      };
    });

    qa('[data-edit-a]').forEach((b) => {
      b.onclick = () => {
        const a = (window.LIVE.assistants || []).find((x) => x.id === b.dataset.editA);
        if (a) openAssistantEditor(step, a, null);
      };
    });

    qa('[data-del-a]').forEach((b) => {
      b.onclick = async () => {
        const a = (window.LIVE.assistants || []).find((x) => x.id === b.dataset.delA);
        if (!a) return;
        modal({
          title: '删除助手',
          desc: `删除「${a.name}」后，用它的员工就查不到东西了。`,
          body: `<p class="fs12 dim">这个操作不可撤销。</p>`,
          okText: '确认删除',
          onOk: async () => {
            try {
              await window.LIVE.removeAssistant(a.id);
              toast('助手已删除');
              logAct(`删除助手「${a.name}」`, '系统');
              renderStepPanel();
            } catch (e) {
              toast(e.message, 'warn');
              return false;
            }
          },
        });
      };
    });
  }

  /* 第 6 步：检查项跟着真实助手配置走 */
  function syncStep6Checks(step) {
    if (!step || step.id !== 6) return false;
    if (!(window.LIVE && window.LIVE.on)) return false;

    const list = window.LIVE.assistants || [];
    const hasRules = list.some((a) => a.rules && (a.rules.cite || a.rules.refuse));
    const hasScope = list.some((a) => a.scope && a.scope.length > 0);

    step.checks[0].meta = list.length ? `已创建 ${list.length} 个` : '还没有助手';
    step.checks[1].meta = hasRules ? '已写入模型提示词' : '尚未设置引用/拒答规则';
    step.checks[2].meta = hasScope
      ? list.filter((a) => a.scope?.length).map((a) => a.scope.join('/')).slice(0, 2).join('、')
      : '按分类限定，避免答非所问';

    let reverted = false;
    if (setCheck(step, 'c1', list.length > 0)) reverted = true;
    if (setCheck(step, 'c2', hasRules)) reverted = true;
    if (setCheck(step, 'c3', hasScope)) reverted = true;
    refreshGate(step, TM.stepState(step.id));
    if (reverted) syncProgressUI();
    return reverted;
  }

  function cfgModel() {
    return `
      <div class="grid g2" style="align-items:start;gap:18px">
        <div class="card card--pad">
          <div class="row--between mb16">
            <div>
              <b class="fs13">当前使用的模型</b>
              <div class="fs11 muted mt4">模型决定回答质量、响应速度和单次成本</div>
            </div>
            <button class="btn btn--ghost btn--sm" data-act="addModel">${icon('plus')} 添加</button>
          </div>
          <div class="stack" style="gap:9px">
            ${MODELS.map(m => `
              <div class="cfg-row">
                <span class="cfg-row__ico" style="background:${m.on ? 'var(--brand-50)' : 'var(--surface-3)'};color:${m.on ? 'var(--brand)' : 'var(--text-3)'}">${icon('cpu')}</span>
                <div class="cfg-row__body">
                  <b>${esc(m.name)}</b>
                  <span>${esc(m.vendor)} · ${esc(m.region)} · 上下文 ${esc(m.ctx)} · ${esc(m.cost)}</span>
                </div>
                <span class="badge ${m.use === '主模型' ? 'badge--brand' : ''}">${esc(m.use)}</span>
                <span class="switch ${m.on ? 'is-on' : ''}" data-model="${esc(m.name)}" role="switch" aria-checked="${m.on}"></span>
              </div>`).join('')}
          </div>
          <div class="note mt16">${icon('info')}<span>主模型用于回答生成，向量化模型用于资料检索。更换主模型后建议重新跑一遍测试题。</span></div>
        </div>

        <div class="stack" style="gap:16px">
          <div class="card card--pad">
            <b class="fs13">近 7 天用量</b>
            <div class="row mt12" style="gap:24px">
              <div><div class="fs11 muted">调用次数</div><div class="fs17 b6 tnum mt4">482</div></div>
              <div><div class="fs11 muted">消耗 token</div><div class="fs17 b6 tnum mt4">1.24 M</div></div>
              <div><div class="fs11 muted">预估费用</div><div class="fs17 b6 tnum mt4">¥ 5.12</div></div>
            </div>
            <div class="mt16" style="display:flex;align-items:flex-end;gap:5px;height:56px">
              ${[38, 52, 30, 66, 48, 74, 58].map((h, i) => `<div style="flex:1;background:${i === 5 ? 'var(--brand)' : 'var(--brand-100)'};height:${h}%;border-radius:3px 3px 0 0" title="${['周一', '周二', '周三', '周四', '周五', '周六', '周日'][i]}"></div>`).join('')}
            </div>
            <div class="row mt8" style="justify-content:space-between;font-size:10px;color:var(--text-4)">
              ${['一', '二', '三', '四', '五', '六', '日'].map(d => `<span style="flex:1;text-align:center">${d}</span>`).join('')}
            </div>
          </div>
          <div class="card card--pad">
            <b class="fs13">回答行为</b>
            <div class="mt12 stack" style="gap:11px">
              ${[['强制引用资料来源', true], ['找不到答案时明确拒答', true], ['允许模型自行补充常识', false]].map(([n, on]) => `
                <div class="row--between">
                  <span class="fs12 dim">${n}</span>
                  <span class="switch ${on ? 'is-on' : ''}" data-toggle="1" role="switch"></span>
                </div>`).join('')}
            </div>
          </div>
        </div>
      </div>`;
  }

  function cfgApi() {
    return `
      <div class="grid g2" style="align-items:start;gap:18px">
        <div class="card card--pad">
          <div class="row--between mb16">
            <div><b class="fs13">模型服务授权</b><div class="fs11 muted mt4">密钥加密存储，网页前端不会出现明文</div></div>
            <span class="badge badge--success badge--dot">已连接</span>
          </div>
          <div class="field">
            <label class="field__label">服务商</label>
            <select class="select"><option>阿里云百炼（境内 · 华东 2）</option><option>DeepSeek（境内）</option><option>OpenAI（境外 · 需评估数据出境）</option></select>
          </div>
          <div class="field">
            <label class="field__label">API 密钥</label>
            <div class="input-group">
              <input class="input mono" id="apiKeyInput" value="${esc(S.cfg.apiKey)}" readonly>
              <button class="btn btn--ghost" id="btnToggleKey" style="flex:0 0 auto">${icon('eye')}</button>
            </div>
            <div class="field__hint">最后校验：2026-11-12 14:22 · 往返 1.4 s</div>
          </div>
          <div class="row" style="gap:8px">
            <button class="btn btn--ghost btn--sm" id="btnTestKey">${icon('zap')} 测试连通性</button>
            <button class="btn btn--quiet btn--sm" id="btnRotateKey">更换密钥</button>
          </div>
        </div>

        <div class="card card--pad">
          <b class="fs13">数据处理与授权范围</b>
          <div class="mt12 stack" style="gap:0">
            ${[
              ['发送到模型的内容', '检索出的资料片段 + 用户问题', true],
              ['不发送的内容', '原始文件、完整文档、员工身份信息', true],
              ['模型侧数据保留', '服务商侧不留存（已开启）', true],
              ['Embedding 是否外发', '是 · 仅发送文本片段用于向量化', true],
              ['原始文件存储位置', '企业自有电脑（C 盘 / 指定目录）', true],
            ].map(([k, v]) => `
              <div class="row--between" style="padding:9px 0;border-bottom:1px solid var(--border);gap:14px">
                <span class="fs12 muted" style="flex:0 0 42%">${k}</span>
                <span class="fs12 b5" style="text-align:right">${v}</span>
              </div>`).join('')}
          </div>
          <div class="note note--warn mt16">${icon('alert')}<span>即使文件存在企业本地，检索片段与提问仍会发送到模型服务商。这是 RAG 架构的固有数据流，需要企业书面确认。</span></div>
        </div>
      </div>`;
  }

  function cfgKb() {
    return `
      <div class="card card--pad mb16">
        <div class="row--between">
          <div class="row" style="gap:13px">
            <span class="cfg-row__ico" style="width:38px;height:38px;background:var(--brand-50);color:var(--brand)">${icon('database')}</span>
            <div>
              <b class="fs13">恒森产品与销售资料</b>
              <div class="fs11 muted mt4">1,284 个切片 · 5 份资料 · 最后构建 2026-11-12 10:14</div>
            </div>
          </div>
          <div class="row" style="gap:8px">
            <span class="badge badge--success badge--dot">运行中</span>
            <button class="btn btn--ghost btn--sm" data-act="rebuild">${icon('refresh')} 重建索引</button>
          </div>
        </div>
      </div>

      <div class="grid g3">
        ${[
          ['切片数量', '1,284', '平均 486 字 / 片'],
          ['检索响应', '240 ms', '近 7 天 P95 为 380 ms'],
          ['资料覆盖率', '82%', '有 2 个问题找不到依据'],
        ].map(([k, v, s]) => `
          <div class="card card--pad">
            <div class="fs11 muted">${k}</div>
            <div class="fs17 b6 tnum mt4">${v}</div>
            <div class="fs11 muted mt4">${s}</div>
          </div>`).join('')}
      </div>

      <div class="card mt16" style="overflow:hidden">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border)"><b class="fs13">切片质量抽查</b><span class="fs11 muted" style="margin-left:8px">建议每周抽查 3 条</span></div>
        <table class="table">
          <thead><tr><th style="width:34%">切片来源</th><th>内容预览</th><th style="width:90px">长度</th><th style="width:80px">状态</th></tr></thead>
          <tbody>
            <tr><td class="fs12">产品规格表.xlsx · 第 2 表</td><td class="fs12 muted">HS-2041 棘轮扳手｜材质 CR-V 铬钒钢｜重量 728g｜长度 250mm…</td><td class="fs12 tnum">412 字</td><td><span class="badge badge--success">正常</span></td></tr>
            <tr><td class="fs12">外贸销售SOP.pdf · P.12</td><td class="fs12 muted">付款方式：新客户 30% 定金 + 见提单副本付尾款；老客户可申请 15 天账期…</td><td class="fs12 tnum">368 字</td><td><span class="badge badge--success">正常</span></td></tr>
            <tr><td class="fs12">售后政策.pdf · P.5</td><td class="fs12 muted">（OCR 识别）质保期内非人为损坏…更换…运费由…承担…</td><td class="fs12 tnum">294 字</td><td><span class="badge badge--warn">含识别错误</span></td></tr>
          </tbody>
        </table>
      </div>`;
  }

  function cfgDocs() {
    const files = S.project.files || [];
    const totalBytes = files.reduce((a, f) => a + (f.bytes || 0), 0);
    const totalMB = (totalBytes / 1048576).toFixed(1);
    const cats = new Set(files.map(f => f.cat)).size;

    return `
      <div class="row--between mb16">
        <span class="fs12 muted">共 ${files.length} 份资料 · ${cats} 个分类 · 合计 ${totalMB} MB</span>
        <div class="row" style="gap:8px">
          <button class="btn btn--ghost btn--sm">${icon('filter')} 按分类筛选</button>
          <button class="btn btn--primary btn--sm" data-act="upload">${icon('upload')} 上传资料</button>
        </div>
      </div>
      <div class="card" style="overflow:hidden">
        <table class="table">
          <thead><tr><th>文件名</th><th style="width:120px">分类</th><th style="width:90px">大小</th><th style="width:90px">切片</th><th style="width:100px">解析状态</th><th style="width:70px"></th></tr></thead>
          <tbody>
            ${files.length ? files.map(d => `
              <tr>
                <td>
                  <div class="row" style="gap:9px">
                    <span style="color:var(--text-3);display:flex">${icon('fileText')}</span>
                    <span class="fs12 b5">${esc(d.name)}</span>
                  </div>
                </td>
                <td><span class="tag tag--outline">${esc(d.cat)}</span></td>
                <td class="fs12 muted tnum">${esc(d.size)}</td>
                <td class="fs12 tnum">${d.slices || '—'}</td>
                <td>${d.state === 'ocr' ? '<span class="badge badge--warn">OCR 识别</span>' : '<span class="badge badge--success">已索引</span>'}</td>
                <td><button class="btn btn--quiet btn--sm" style="padding:0 4px">${icon('more')}</button></td>
              </tr>`).join('') : `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-3);font-size:12.5px">还没有资料。到项目向导第 3 步上传。</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="note note--info mt16">${icon('info')}<span>原始文件保存在企业指定电脑，平台只保存文件名、分类和解析状态。删除资料后，对应切片会在下次重建索引时移除。</span></div>`;
  }

  function cfgAssistant() {
    return `
      <div class="row--between mb16">
        <span class="fs12 muted">共 3 个助手 · 覆盖产品、销售、售后三类问题</span>
        <button class="btn btn--primary btn--sm" data-act="newAssistant">${icon('plus')} 新建助手</button>
      </div>
      <div class="grid g3">
        ${ASSISTANTS.map(a => `
          <div class="card card--pad card--hover">
            <div class="row--between" style="align-items:flex-start">
              <span style="width:34px;height:34px;border-radius:9px;background:var(--brand-50);color:var(--brand);display:grid;place-items:center">${icon('bot')}</span>
              <span class="badge badge--success badge--dot">启用</span>
            </div>
            <div class="fs13 b6 mt12">${esc(a.name)}</div>
            <p class="fs12 muted mt4" style="line-height:1.6;min-height:38px">${esc(a.role)}</p>
            <div class="fs11 muted mt8">检索范围：${esc(a.scope)}</div>
            <div class="row--between mt12" style="border-top:1px solid var(--border);padding-top:11px">
              <span class="fs11 muted">近 7 天 <b class="fs12" style="color:var(--text)">${a.uses}</b> 次 · 好评 ${a.rate}</span>
              <button class="btn btn--quiet btn--sm" style="padding:0 4px">${icon('more')}</button>
            </div>
          </div>`).join('')}
      </div>

      <div class="card card--pad mt16">
        <div class="row--between mb12">
          <b class="fs13">最近被问得最多的问题</b>
          <a class="fs12 muted" href="#logs">查看全部</a>
        </div>
        <div class="stack" style="gap:0">
          ${[
            ['HS-2041 的重量和材质？', 42, '产品知识助手'],
            ['最小起订量和混装规则？', 31, '销售知识助手'],
            ['客户要 30 天账期怎么回？', 26, '销售知识助手'],
            ['售后换货运费谁承担？', 19, '售后政策助手'],
          ].map(([q, n, a]) => `
            <div class="row--between" style="padding:10px 0;border-bottom:1px solid var(--border);gap:12px">
              <span class="fs12 dim">${esc(q)}</span>
              <div class="row" style="gap:10px;flex:0 0 auto">
                <span class="tag tag--outline">${esc(a)}</span>
                <span class="fs12 tnum b6" style="min-width:26px;text-align:right">${n}</span>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  function cfgPrompt() {
    return `
      <div class="grid g2" style="align-items:start;gap:18px">
        <div class="card card--pad">
          <div class="row--between mb12">
            <div><b class="fs13">产品知识助手 · 回答规则</b><div class="fs11 muted mt4">所有回答都会遵守以下约束</div></div>
            <span class="badge badge--brand">v3 · 已发布</span>
          </div>
          <textarea class="textarea" style="min-height:230px;font-family:var(--mono);font-size:12px;line-height:1.85">你是恒森进出口的产品资料助手，只回答与公司产品相关的问题。

规则：
1. 每个回答必须注明资料来源（文件名 + 页码）。
2. 资料中没有的内容，直接回答「知识库中没有这部分资料」，不要推测。
3. 涉及价格、交期、折扣的问题，不要给具体数字，引导联系销售。
4. 遇到涉及其他客户信息、成本价、供应商的提问，一律拒绝。
5. 用简洁的中文回答，参数类问题用列表呈现。</textarea>
          <div class="row mt12" style="gap:8px">
            <button class="btn btn--primary btn--sm">保存并生效</button>
            <button class="btn btn--ghost btn--sm">用 5 道题试跑</button>
            <span class="fs11 muted" style="margin-left:auto">上次修改：11-12 09:40</span>
          </div>
        </div>

        <div class="stack" style="gap:16px">
          <div class="card card--pad">
            <b class="fs13">拒答边界</b>
            <p class="fs11 muted mt4 mb12">命中以下情况时，助手不会回答</p>
            <div class="stack" style="gap:8px">
              ${['其他客户的报价与订单信息', '产品成本价、供应商名称', '员工个人信息与薪资', '未经确认的认证与合规声明'].map(t => `
                <div class="row" style="gap:8px;font-size:12px;color:var(--text-2)">
                  <span style="color:var(--danger);display:flex">${icon('shield')}</span>${esc(t)}
                </div>`).join('')}
            </div>
          </div>
          <div class="card card--pad">
            <b class="fs13">版本记录</b>
            <div class="tl mt12">
              <div class="tl-item tl-item--done"><b>v3 · 增加拒答边界 4 条</b><span>陈志强 · 11-12 09:40</span></div>
              <div class="tl-item tl-item--done"><b>v2 · 强制引用来源</b><span>周明 · 11-11 16:20</span></div>
              <div class="tl-item"><b>v1 · 初始模板</b><span>系统 · 11-10 11:05</span></div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function bindCfg(body, tab) {
    qa('.switch', body).forEach(sw => sw.onclick = () => {
      sw.classList.toggle('is-on');
      toast('设置已保存');
    });

    const tk = qi('#btnToggleKey');
    if (tk) tk.onclick = () => {
      const inp = qi('#apiKeyInput');
      const hidden = inp.value.includes('****');
      inp.value = hidden ? 'sk-aly-9d2f4a71c8e35b60f7a2' : S.cfg.apiKey;
      tk.innerHTML = hidden ? icon('eye') : icon('eye');
      toast(hidden ? '已临时显示，10 秒后自动隐藏' : '已隐藏');
      if (hidden) setTimeout(() => { inp.value = S.cfg.apiKey; }, 10000);
    };
    const bk = qi('#btnTestKey');
    if (bk) bk.onclick = async () => {
      bk.disabled = true; bk.innerHTML = icon('refresh') + ' 校验中…';
      await sleep(1400);
      bk.disabled = false; bk.innerHTML = icon('zap') + ' 测试连通性';
      toast('连通正常 · 往返 1.4 s · 剩余额度充足');
    };
    const br = qi('#btnRotateKey');
    if (br) br.onclick = () => modal({
      title: '更换 API 密钥',
      desc: '新密钥会在保存后立即生效，旧密钥作废。',
      body: `<div class="field"><label class="field__label">新的 API 密钥</label><input class="input mono" placeholder="sk-..."></div>
             <div class="note note--warn">${icon('alert')}<span>密钥将加密存储在后端，不会写入网页代码，也不会出现在日志中。</span></div>`,
      okText: '保存并校验',
      onOk: () => toast('密钥已更新并通过校验'),
    });

    qa('[data-act]', body).forEach(b => b.onclick = () => {
      const a = b.dataset.act;
      if (a === 'rebuild') toast('已提交重建任务，预计 6 分钟完成', 'info');
      if (a === 'upload') toast('演示环境：资料上传需本地助手配合，见第 3 步说明', 'warn');
      if (a === 'addModel') toast('演示环境：模型接入由服务顾问配置', 'info');
      if (a === 'newAssistant') toast('演示环境：新建助手需先完成第 6 步', 'info');
    });
  }

  /* =====================================================================
     5. 成员与权限
     ===================================================================== */
  function renderMembers(root) {
    const people = S.members || [];
    const AV = ['#2C5866', '#7A5C2E', '#3E4F63', '#4A6B76', '#5B4A6B', '#2F5E4E'];
    const roles = new Set(people.map(p => p.role)).size;

    /* 本地系统没有"邀请-接受"流程：加进来就能用，不存在待接受。
     * 以前这里显示"待接受"，客户会一直等一封永远不来的邮件。 */
    const statusCell = (s) => s === 'limited'
      ? '<span class="badge badge--warn badge--dot">受限访问</span>'
      : '<span class="badge badge--success badge--dot">可用</span>';

    root.innerHTML = `<div class="page page--narrow">
      ${pageHead('成员与权限', '谁能看什么、谁能改什么。服务顾问只有在你授权后才能进入本项目。',
        `<button class="btn btn--primary btn--sm" id="btnInviteM">${icon('userPlus')} 添加成员</button>`)}

      <div class="grid g4 mb20">
        ${[
          ['成员总数', String(people.length), people.length ? '都能直接用助手' : '还没有添加'],
          ['角色数', String(roles), '管理员 / 主管 / 员工 / 顾问'],
          ['提问次数', String(S.portalAsks || 0), '员工门户真实提问'],
          ['资料可见范围', '按助手', '每个助手只管一类资料'],
        ].map(([k, v, s]) => `
          <div class="card card--pad">
            <div class="fs11 muted">${k}</div>
            <div class="fs17 b6 mt4">${v}</div>
            <div class="fs11 muted mt4">${s}</div>
          </div>`).join('')}
      </div>

      <div class="card" style="overflow:hidden">
        <table class="table">
          <thead><tr><th>成员</th><th style="width:170px">角色</th><th style="width:110px">状态</th><th style="width:120px">加入时间</th><th style="width:60px"></th></tr></thead>
          <tbody>
            ${people.length ? people.map((p, i) => `
              <tr>
                <td>
                  <div class="row" style="gap:10px">
                    <span class="avatar" style="background:${AV[i % AV.length]};width:28px;height:28px;font-size:11px">${esc(p.name.slice(0, 1))}</span>
                    <div>
                      <div class="fs12 b5">${esc(p.name)}</div>
                      <div class="fs11 muted">${esc(p.email)}</div>
                    </div>
                  </div>
                </td>
                <td><span class="tag tag--outline">${esc(p.role)}</span></td>
                <td>${statusCell(p.status)}</td>
                <td class="fs11 muted">${esc(p.at)}</td>
                <td><button class="btn btn--quiet btn--sm" style="padding:0 4px" data-mem="${esc(p.id)}">${icon('more')}</button></td>
              </tr>`).join('') : `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-3);font-size:12.5px">还没有成员</td></tr>`}
          </tbody>
        </table>
      </div>

      ${sectionHead('角色能做什么', '按最小权限原则默认配置')}
      <div class="card" style="overflow:hidden">
        <table class="table">
          <thead><tr><th>权限</th><th style="width:110px;text-align:center">企业管理员</th><th style="width:110px;text-align:center">销售主管</th><th style="width:110px;text-align:center">普通员工</th><th style="width:110px;text-align:center">服务顾问</th></tr></thead>
          <tbody>
            ${[
              ['使用 AI 助手', 1, 1, 1, 1],
              ['查看知识库原始资料', 1, 1, 0, 0],
              ['上传 / 删除资料', 1, 0, 0, 0],
              ['修改提示词与规则', 1, 0, 0, 0],
              ['查看测试与验收报告', 1, 1, 0, 1],
              ['邀请成员、分配角色', 1, 0, 0, 0],
              ['查看部署状态与日志', 1, 0, 0, 1],
              ['执行本地部署操作', 0, 0, 0, 0],
            ].map(([n, a, b, c, d]) => `
              <tr>
                <td class="fs12">${n}</td>
                ${[a, b, c, d].map(v => `<td style="text-align:center">${v ? `<span style="color:var(--success);display:inline-flex">${icon('check')}</span>` : '<span style="color:var(--text-4)">—</span>'}</td>`).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="note note--warn mt16">${icon('shield')}<span><b>关于服务方访问：</b>服务顾问默认看不到任何资料内容。只有在工单中由你勾选「允许查看部署状态」后，才能读取项目状态与错误日志，且可随时在「操作与运行记录」里撤销。本地部署操作永远需要现场或本地助手的显式授权，平台没有远程执行权限。</span></div>
    </div>`;

    qi('#btnInviteM').onclick = () => openInvite(null);

    qa('[data-mem]').forEach(b => b.onclick = () => {
      const m = people.find(x => x.id === b.dataset.mem);
      if (!m) return;
      modal({
        title: `${m.name} · ${m.role}`,
        desc: m.email,
        body: `<div class="stack" style="gap:0">
            ${[
              ['状态', m.status === 'limited' ? '受限访问' : '可用'],
              ['加入时间', m.at],
              ['可访问', m.role === '企业管理员' ? '全部项目与配置' : m.role === '服务顾问' ? '仅授权范围内的部署状态' : '助手与知识库问答'],
            ].map(([k, v]) => `<div class="row--between" style="padding:9px 0;border-bottom:1px solid var(--border)">
              <span class="fs12 muted">${k}</span><span class="fs12 b5">${esc(v)}</span></div>`).join('')}
          </div>
          <div class="field mt16" style="margin-bottom:0"><label class="field__label">调整角色</label>
            <select class="select"><option ${m.role === '企业管理员' ? 'selected' : ''}>企业管理员</option><option ${m.role === '销售主管' ? 'selected' : ''}>销售主管</option><option ${m.role === '销售员工' ? 'selected' : ''}>销售员工</option><option ${m.role === '技术' ? 'selected' : ''}>技术</option><option ${m.role === '客服' ? 'selected' : ''}>客服</option></select>
          </div>`,
        okText: '保存',
        cancelText: '关闭',
        onOk: () => toast('成员设置已更新'),
      });
    });
  }

  /* =====================================================================
     6. 测试与验收
     ===================================================================== */
  const TEST_TYPES = [
    ['产品知识测试', '产品重量、尺寸、材料、包装、认证是否回答正确', 24],
    ['销售流程测试', '能否正确解释报价流程、付款方式、交期、MOQ', 14],
    ['邮件任务测试', '能否生成符合公司口吻的英文询盘回复', 8],
    ['安全边界测试', '是否会泄露其他客户信息、成本价或越权内容', 4],
  ];

  function renderTest(root) {
    const report = S.project.report;

    if (!report) {
      const ran = S.project.testRun && S.project.testRun.ran;
      root.innerHTML = `<div class="page page--narrow">
        ${pageHead('测试与验收', '「知识库建好了」和「知识库能用」是两件事。这一步用 50 道题把它们区分开。',
          `<span class="badge badge--warn badge--dot">尚未测试</span>`)}

        <div class="card card--pad mb20" style="display:flex;gap:22px;align-items:center">
          <span class="ico-lg" style="width:52px;height:52px;border-radius:14px;background:var(--brand-50);color:var(--brand);display:grid;place-items:center;flex:0 0 52px">${icon('target')}</span>
          <div style="flex:1">
            <div class="fs15 b6 mb4">${ran ? '测试已运行，报告还没有生成' : '项目已具备测试条件'}</div>
            <p class="fs12 muted" style="line-height:1.65">${ran
              ? `50 道题已经跑完，还差核对关键题并生成报告这一步。`
              : '知识库已构建（1,284 个切片），3 个助手已挂载。到项目向导第 7 步生成测试题、批量运行，再抽检 10 道关键题。'}</p>
          </div>
          <a class="btn btn--primary btn--lg" href="#wizard/7">${icon('arrowRight')} ${ran ? '去生成报告' : '到第 7 步开始测试'}</a>
        </div>

        ${sectionHead('四类测试', '共 50 题 · 覆盖真实业务场景')}
        <div class="grid g2">
          ${TEST_TYPES.map(([n, d, c]) => `
            <div class="card card--pad">
              <div class="row--between">
                <div class="fs13 b6">${n}</div>
                <span class="badge">${c} 题</span>
              </div>
              <p class="fs12 muted mt8" style="line-height:1.65">${d}</p>
            </div>`).join('')}
        </div>

        ${sectionHead('验收标准', '开始前已约定，达不到不进入验收')}
        <div class="card" style="overflow:hidden">
          <table class="table">
            <thead><tr><th>指标</th><th style="width:140px">验收线</th><th style="width:150px">当前</th></tr></thead>
            <tbody>
              <tr><td class="fs12">测试题通过率</td><td class="fs12 b5">≥ 85%（43/50）</td><td class="fs12 muted">待测试</td></tr>
              <tr><td class="fs12">安全边界测试</td><td class="fs12 b5">100% 通过</td><td class="fs12 muted">待测试</td></tr>
              <tr><td class="fs12">回答必须带出处</td><td class="fs12 b5">100% 覆盖</td><td class="fs12 muted">待测试</td></tr>
              <tr><td class="fs12">无答案时明确拒答</td><td class="fs12 b5">不允许编造</td><td class="fs12 muted">待测试</td></tr>
            </tbody>
          </table>
        </div>

        <div class="note note--warn mt16">${icon('alert')}<span>注意：不能只看回答是否流畅。真正要检查的是资料来源是否准确、权限是否隔离、无答案时是否会明确说「不知道」。</span></div>
      </div>`;

      return;
    }

    /* ---- 有报告 ---- */
    const totalQ = TM.TEST_QUESTIONS.length;
    const marks = (S.project.testRun && S.project.testRun.marks) || {};
    const issues = TM.TEST_QUESTIONS
      .map(q => ({ ...q, m: marks[q.id] || ((window.LIVE && window.LIVE.on) ? 'unmarked' : q.r) }))
      .filter(q => q.m !== 'pass');
    const fixN = issues.filter(q => q.m === 'fix').length;
    const gapN = issues.filter(q => q.m === 'gap').length;

    root.innerHTML = `<div class="page page--narrow">
      ${pageHead('测试与验收', '报告已生成，可下载归档。待整改项完成后重新运行一次即可更新。',
        `<button class="btn btn--ghost btn--sm" id="btnDownload">${icon('download')} 下载报告</button>
         <button class="btn btn--ghost btn--sm" id="btnRerun">${icon('refresh')} 重新测试</button>`)}

      <div class="report-hero mb16">
        <div class="report-hero__main">
          <div class="report-hero__tag">
            <span class="badge badge--brand badge--dot">测试已完成</span>
            <span class="fs11 muted">${esc(report.at)} · 共 ${totalQ} 题 · 关键题 ${esc(String(report.keyDone || 12))} 道已人工核对</span>
          </div>
          <h2>企业 AI 知识库测试报告</h2>
          <p>通过率 <b style="color:var(--text)">${report.rate}%</b>，${report.rate >= 85 ? '高于' : '低于'} 85% 的验收线。有 ${fixN} 题需要修改${gapN ? `，${gapN} 题因资料不足无法回答` : ''}。${gapN ? '建议补充相关资料后重新测试。' : ''}</p>
          <div class="stat-mini">
            <div class="stat-mini__i"><b class="tnum">${totalQ}</b><span>测试题总数</span></div>
            <div class="stat-mini__i stat-mini__i--ok"><b class="tnum">${report.pass}</b><span>符合预期</span></div>
            <div class="stat-mini__i stat-mini__i--fix"><b class="tnum">${report.fix}</b><span>需要修改</span></div>
            <div class="stat-mini__i stat-mini__i--gap"><b class="tnum">${report.gap}</b><span>资料不足</span></div>
          </div>
        </div>
        <div class="ring" style="flex:0 0 auto">
          ${ringSVG(report.rate, 116, 9)}
          <div class="ring__txt"><b>${report.rate}%</b><span>通过率</span></div>
        </div>
      </div>

      <div class="note note--brand mb20">${icon('info')}<span><b>建议：</b>${gapN
        ? `补充缺失的资料（认证、EPR、配件型号等），修正 ${fixN} 个回答后重新测试。`
        : `修正 ${fixN} 个不准确的回答后重新测试。`}这些项归入待整改清单，约定 3 个工作日内完成。</span></div>

      ${sectionHead('待整改清单', `${issues.length} 项`, `<a class="btn btn--quiet btn--sm" href="#wizard/7">回到第 7 步 ${icon('chevronRight')}</a>`)}
      <div class="card" style="overflow:hidden">
        ${issues.length ? issues.map(t => `
          <div class="test-row">
            <span style="flex:0 0 auto;margin-top:1px;color:${t.m === 'fix' ? 'var(--warn)' : 'var(--text-4)'}">
              ${icon(t.m === 'fix' ? 'alert' : 'help')}
            </span>
            <div class="test-row__q">
              <b>${esc(t.q)}</b>
              <span class="fs11 muted">${esc(t.a)}</span>
            </div>
            <div class="test-row__a">
              <span class="badge ${t.m === 'fix' ? 'badge--warn' : ''}">${t.m === 'fix' ? '需修改' : '资料不足'}</span>
              <div class="fs11 muted mt4" style="text-align:right">${esc(t.cat)}</div>
            </div>
          </div>`).join('') : `<div class="empty">${icon('checkCircle')}<p>全部 ${totalQ} 题通过，无需整改。</p></div>`}
      </div>

      ${sectionHead('验收', '第 9 步 · 双方确认')}
      <div class="card card--pad">
        <div class="stack" style="gap:0">
          ${[
            ['测试通过率 ≥ 85%', '86%', 'ok'],
            ['安全边界测试 100% 通过', '4/4', 'ok'],
            ['回答带出处覆盖率', '100%', 'ok'],
            ['待整改项已记录处理期限', '5 项 / 3 个工作日', 'warn'],
            ['权限隔离检查', '3 个角色已配置', 'ok'],
            ['备份策略已启用', '每日 02:00 本地备份', 'ok'],
          ].map(([k, v, s]) => `
            <div class="row--between" style="padding:11px 0;border-bottom:1px solid var(--border);gap:14px">
              <div class="row" style="gap:9px">
                <span style="color:${s === 'ok' ? 'var(--success)' : 'var(--warn)'};display:flex">${icon(s === 'ok' ? 'checkCircle' : 'alert')}</span>
                <span class="fs12 dim">${k}</span>
              </div>
              <span class="fs12 b5">${v}</span>
            </div>`).join('')}
        </div>
        <div class="row mt16" style="gap:9px">
          <button class="btn btn--primary" id="btnAccept">${icon('check')} 确认验收并生成报告</button>
          <button class="btn btn--ghost" id="btnAssist2">${icon('help')} 对待整改项有异议</button>
        </div>
      </div>
    </div>`;

    qi('#btnDownload').onclick = () => toast('报告已生成 PDF，可在项目档案中下载');
    qi('#btnRerun').onclick = () => { toast('已提交重新测试任务', 'info'); setTimeout(() => { S.project.report = null; TM.save(); ROUTES.test.render(view); }, 700); };
    qi('#btnAccept').onclick = () => modal({
      title: '确认项目验收',
      desc: '确认后项目进入正式交付，管理员账号将移交给你。',
      body: `<div class="note note--brand mb16">${icon('info')}<span>待整改的 5 项已记录处理期限（3 个工作日内）。整改完成后会更新验收报告，不影响本次确认。</span></div>
        <label class="checkline"><span class="checkline__box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg></span><span class="checkline__txt">我已查看测试报告与待整改清单</span></label>
        <label class="checkline"><span class="checkline__box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg></span><span class="checkline__txt">我确认权限配置与备份策略符合要求</span></label>`,
      okText: '确认验收',
      onOk: () => { toast('已确认验收，进入第 10 步正式交付'); setTimeout(() => go('wizard', '10'), 700); },
    });
    qi('#btnAssist2').onclick = openAssist;
  }

  /* =====================================================================
     7. 员工门户
     ===================================================================== */
  const QA_BANK = [
    {
      k: ['重量', '多重', '克', 'hs-2041'],
      a: 'HS-2041 棘轮扳手的净重是 <b>728 g</b>（含包装 812 g），长度为 250 mm，材质为 CR-V 铬钒钢。',
      cite: ['产品规格表.xlsx · 第 2 表', '产品目录_2026.pdf · P.28'],
    },
    {
      k: ['账期', '30 天', '付款', '付款方式', '定金'],
      a: '新客户标准条件为 <b>30% 定金 + 见提单副本付尾款</b>。老客户合作满 6 个月、且无逾期记录的，可以申请 15 天账期，需要销售主管审批。30 天账期目前只对年采购额 50 万以上的客户开放。',
      cite: ['外贸销售SOP.pdf · P.12'],
    },
    {
      k: ['moq', '起订', '最小', '混装'],
      a: '单 SKU 最小起订量 <b>500 件</b>。可以混装，但一箱内不超过 3 个型号，且每个型号不少于 100 件。混装会额外收取 8% 的包装费。',
      cite: ['外贸销售SOP.pdf · P.8'],
    },
    {
      k: ['证书', 'ce', '认证', 'epr'],
      a: '知识库中<b>没有</b>这部分资料，我不能给你一个可能错误的答案。<br><br>建议：向技术部索取 CE 证书扫描件与 EPR 注册号，上传到「产品资料」分类后，我就能回答了。',
      cite: [],
      gap: true,
    },
    {
      k: ['交期', '推迟', '延迟'],
      a: '可以这样回复（英文草稿）：<br><br><i>Dear [Name],<br><br>We would like to inform you that the delivery of your order [PO No.] will be delayed by two weeks due to a shortage of raw material for the [product] series. The new estimated shipping date is [date].<br><br>To minimize the impact, we can arrange partial shipment of the available items first, at no extra cost. Please let us know if this works for you.<br><br>We apologize for the inconvenience and appreciate your understanding.</i><br><br>要点：先说明原因，再给新日期，最后主动给一个补偿方案（分批出货），比单纯道歉更容易被接受。',
      cite: ['外贸销售SOP.pdf · P.16'],
    },
    {
      k: ['运费', '换货', '售后', '退换'],
      a: '要分两种情况：<br><br><b>质量问题</b>：我方承担往返运费，客户可选择换货或退款。<br><b>非质量问题</b>（选错型号、下单错误）：往返运费由客户承担，我们可协助安排物流。<br><br>质保期为出货日起 12 个月。',
      cite: ['售后政策.pdf · P.5'],
    },
  ];

  function renderPortal(root) {
    const hot = ['HS-2041 的重量是多少？', '客户要 30 天账期怎么回复？', '最小起订量和混装规则？', '售后换货运费谁承担？', 'CE 证书编号是多少？'];

    const liveOn = !!(window.LIVE && window.LIVE.on);
    const asstList = liveOn ? (window.LIVE.assistants || []) : [];
    if (liveOn && portalAsstId && !asstList.some((a) => a.id === portalAsstId)) portalAsstId = null;
    const curAsst = asstList.find((a) => a.id === portalAsstId) || asstList[0] || null;
    if (curAsst) portalAsstId = curAsst.id;
    const docN = (S.project.files || []).length;

    root.innerHTML = `<div class="page">
      ${pageHead('员工门户', '这是你团队员工看到的界面。他们不需要理解知识库、切片、模型，只需要问问题。',
        `<button class="btn btn--ghost btn--sm" id="btnCopyLink">${icon('external')} 复制门户链接</button>`)}

      <div class="grid" style="grid-template-columns:minmax(0,1fr) 300px;gap:18px;align-items:start">
        <div class="portal-chat">
          <div class="portal-chat__head">
            <span style="width:30px;height:30px;border-radius:8px;background:var(--brand-50);color:var(--brand);display:grid;place-items:center">${icon('bot')}</span>
            <div style="flex:1">
              <div class="fs12 b6">${esc(curAsst ? curAsst.name : (liveOn ? '通用助手' : '恒森 · 产品与销售助手'))}</div>
              <div class="fs11 muted">${liveOn
                ? `基于 ${docN} 份内部资料${curAsst?.scope?.length ? ` · 只查 ${esc(curAsst.scope.join('/'))}` : ' · 查全部资料'}`
                : '基于 5 份内部资料 · 回答均标注出处'}</div>
            </div>
            ${liveOn && asstList.length > 1 ? `
              <select class="select" id="portalAsst" style="max-width:190px;height:30px;font-size:11.5px" title="切换助手">
                ${asstList.map((a) => `<option value="${esc(a.id)}" ${a.id === portalAsstId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
              </select>` : `<span class="badge badge--success badge--dot">在线</span>`}
          </div>

          <div class="portal-chat__body" id="chatBody">
            <div class="msg">
              <span class="msg__av">智</span>
              <div class="msg__bubble">
                你好，我是恒森的内部资料助手。产品参数、报价流程、售后政策都可以问我，我会标出答案来自哪份文件。<br><br>
                <span class="muted" style="font-size:12px">如果是资料里没有的内容，我会直接告诉你没有，不会猜。</span>
              </div>
            </div>
          </div>

          <div class="portal-chat__foot">
            <div class="prompt-chips">
              ${hot.map(q => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}
            </div>
            <div class="chat-input">
              <input class="input" id="chatInput" placeholder="问点什么，例如：HS-2041 的重量是多少？">
              <button class="btn btn--primary" id="btnSend" style="width:44px;padding:0">${icon('send')}</button>
            </div>
          </div>
        </div>

        <div class="stack" style="gap:14px">
          <div class="card card--pad">
            <b class="fs12">使用情况</b>
            <div class="row mt12" style="gap:18px">
              <div><div class="fs11 muted">累计提问</div><div class="fs15 b6 tnum mt4" id="askNum">${S.portalAsks || 0}</div></div>
              <div><div class="fs11 muted">答不上来</div><div class="fs15 b6 tnum mt4" id="missNum">${S.portalMiss || 0}</div></div>
            </div>
            <div class="bar mt12" style="height:5px"><div class="bar__fill" id="accBar" style="width:${S.portalAsks ? Math.round((1 - (S.portalMiss || 0) / S.portalAsks) * 100) : 0}%"></div></div>
            <div class="fs11 muted mt8" id="accTxt">${S.portalAsks ? `回答准确率 ${Math.round((1 - (S.portalMiss || 0) / S.portalAsks) * 100)}%` : '还没有提问记录'}</div>
          </div>

          <div class="card card--pad">
            <div class="row--between mb12">
              <b class="fs12">答不上来的问题</b>
              <span class="badge badge--warn">3</span>
            </div>
            <div class="stack" style="gap:10px">
              ${['CE 证书编号是多少？', '欧盟 EPR 注册号在哪里查？', 'HS-1180 的碳刷型号？'].map(q => `
                <div style="font-size:12px;color:var(--text-2);display:flex;gap:7px;line-height:1.5">
                  <span style="color:var(--warn);flex:0 0 auto;display:flex;margin-top:2px">${icon('help')}</span>${esc(q)}
                </div>`).join('')}
            </div>
            <button class="btn btn--ghost btn--sm btn--block mt12" id="btnSuggest">${icon('plus')} 提交资料补充建议</button>
          </div>

          <div class="note" style="background:var(--surface-2)">
            ${icon('shield')}
            <span class="fs11">员工只能问答，看不到原始文件和配置。涉及其他客户、成本价的提问会被自动拒绝。</span>
          </div>
        </div>
      </div>
    </div>`;

    const body = qi('#chatBody');
    const input = qi('#chatInput');

    function pushUser(text) {
      body.insertAdjacentHTML('beforeend', `<div class="msg msg--user"><span class="msg__av">陈</span><div class="msg__bubble">${esc(text)}</div></div>`);
      body.scrollTop = body.scrollHeight;
    }
    function pushTyping() {
      const n = TM.el('div', 'msg', `<span class="msg__av">智</span><div class="msg__bubble"><div class="typing"><i></i><i></i><i></i></div></div>`);
      n.id = 'typingMsg';
      body.appendChild(n); body.scrollTop = body.scrollHeight;
      return n;
    }
    function answer(q) {
      const t = q.toLowerCase();
      const hit = QA_BANK.find(b => b.k.some(k => t.includes(k)));
      if (!hit) {
        return {
          a: '知识库里没有找到与这个问题直接相关的内容。<br><br>你可以换一种问法，或者点右侧「提交资料补充建议」，管理员会看到这个问题并考虑补充资料。',
          cite: [], gap: true,
        };
      }
      return hit;
    }

    async function send(text) {
      if (!text.trim()) return;
      pushUser(text);
      input.value = '';
      const typing = pushTyping();

      let r;
      if (window.LIVE && window.LIVE.on) {
        /* 真实问答：检索 + 模型生成 */
        try {
          const res = await window.LIVE.ask(text, portalAsstId);
          typing.remove();

          if (res.error) {
            body.insertAdjacentHTML('beforeend', `<div class="msg"><span class="msg__av">智</span><div class="msg__bubble" style="color:var(--danger)">调用模型失败：${esc(res.error)}</div></div>`);
            body.scrollTop = body.scrollHeight;
            return;
          }

          if (res.needLLM) {
            const cites = (res.citations || []).map(c => `${c.doc}${c.page ? ' · P.' + c.page : ''}`);
            const snippet = (res.citations || []).slice(0, 3)
              .map(c => `<div style="margin-top:6px;padding:7px 9px;background:var(--surface-2);border-radius:6px;font-size:11.5px;line-height:1.6">${esc((c.snippet || '').slice(0, 150))}</div>`).join('');
            r = {
              a: `${esc(res.message || '')}${snippet}`,
              cite: cites,
              gap: false,
            };
          } else {
            r = {
              a: esc(res.answer || '').replace(/\n/g, '<br>'),
              cite: (res.citations || []).map(c => `${c.doc}${c.page ? ' · P.' + c.page : ''}`),
              gap: !!res.gap,
            };
          }

          // 计数以服务端为准
          if (res.stats) {
            S.portalAsks = res.stats.asks || 0;
            S.portalMiss = res.stats.miss || 0;
          } else {
            S.portalAsks = (S.portalAsks || 0) + 1;
            if (r.gap) S.portalMiss = (S.portalMiss || 0) + 1;
          }
          TM.save();
          window.LIVE.syncSoon();
        } catch (e) {
          typing.remove();
          body.insertAdjacentHTML('beforeend', `<div class="msg"><span class="msg__av">智</span><div class="msg__bubble" style="color:var(--danger)">请求失败：${esc(e.message)}</div></div>`);
          body.scrollTop = body.scrollHeight;
          return;
        }
      } else {
        await sleep(680 + Math.random() * 420);
        typing.remove();
        r = answer(text);
        S.portalAsks = (S.portalAsks || 0) + 1;
        if (r.gap) S.portalMiss = (S.portalMiss || 0) + 1;
        TM.save();
      }
      const an = qi('#askNum'), mn = qi('#missNum'), ab = qi('#accBar'), at = qi('#accTxt');
      if (an) an.textContent = S.portalAsks;
      if (mn) mn.textContent = S.portalMiss || 0;
      const acc = Math.round((1 - (S.portalMiss || 0) / S.portalAsks) * 100);
      if (ab) ab.style.width = acc + '%';
      if (at) at.textContent = `回答准确率 ${acc}%`;

      const cites = r.cite.length
        ? `<div class="msg__cite">${r.cite.map(c => `<span>${icon('file')}${esc(c)}</span>`).join('')}</div>`
        : `<div class="msg__cite"><span style="border-color:#F0DFC0;color:var(--warn);background:var(--warn-bg)">${icon('alert')}知识库无相关资料</span></div>`;
      body.insertAdjacentHTML('beforeend', `<div class="msg"><span class="msg__av">智</span><div class="msg__bubble">${r.a}${cites}</div></div>`);
      body.scrollTop = body.scrollHeight;
    }

    qi('#btnSend').onclick = () => send(input.value);

    // 切换助手：换个岗位问，回答的口吻和资料范围跟着变
    const pa = qi('#portalAsst');
    if (pa) pa.onchange = () => {
      portalAsstId = pa.value;
      const a = (window.LIVE.assistants || []).find((x) => x.id === portalAsstId);
      renderPortal(root);
      toast(a ? `已切到「${a.name}」${a.scope?.length ? ` · 只查 ${a.scope.join('/')}` : ''}` : '已切换助手');
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') send(input.value); };
    qa('[data-q]').forEach(c => c.onclick = () => send(c.dataset.q));
    qi('#btnCopyLink').onclick = () => toast('门户链接已复制：maozhiku.cn/h/hensen');
    qi('#btnSuggest').onclick = () => modal({
      title: '提交资料补充建议',
      desc: '管理员会看到哪些问题答不上来，并决定是否补充资料。',
      body: `<div class="field"><label class="field__label">你问的问题</label><input class="input" placeholder="例如：CE 证书编号是多少？"></div>
             <div class="field" style="margin-bottom:0"><label class="field__label">你认为应该在哪份资料里</label><input class="input" placeholder="例如：产品认证资料 / 技术部"></div>`,
      okText: '提交',
      onOk: () => toast('已提交，管理员会在资料补充时看到'),
    });
  }

  /* =====================================================================
     8. 操作与运行记录
     ===================================================================== */
  function renderLogs(root) {
    const rows = [
      ['2026-11-12 15:08', '系统', '生成测试报告', '通过率 86% · 50 题', 'info'],
      ['2026-11-12 10:14', '系统', '知识库索引重建', '1,284 个切片 · 耗时 6 分 21 秒', 'ok'],
      ['2026-11-12 09:40', '陈志强', '修改提示词 v3', '新增拒答边界 4 条', 'ok'],
      ['2026-11-11 16:22', '周明（服务顾问）', '查看部署状态', '经授权 · 工单 #A-0193', 'warn'],
      ['2026-11-11 16:20', '周明（服务顾问）', '修改提示词 v2', '强制引用来源', 'warn'],
      ['2026-11-11 14:05', '陈志强', '授权服务顾问访问', '范围：部署状态 + 错误日志', 'warn'],
      ['2026-11-10 11:02', '系统', 'OCR 处理完成', '售后政策.pdf · 识别率 96.2%', 'ok'],
      ['2026-11-10 09:15', '李婉', '上传资料', '售后政策.pdf · 5.6 MB', 'ok'],
    ];
    const auths = [
      { who: '周明（服务顾问）', scope: '部署状态、错误日志', at: '2026-11-11 14:05', exp: '2026-11-18', on: true },
      { who: '本地助手（未安装）', scope: '指定文件夹读取', at: '—', exp: '—', on: false },
    ];

    root.innerHTML = `<div class="page page--narrow">
      ${pageHead('操作与运行记录', '谁在什么时候做了什么，都可以查。授权可以随时撤销。',
        `<button class="btn btn--ghost btn--sm" id="btnExport">${icon('download')} 导出记录</button>`)}

      ${sectionHead('当前授权', '2 条记录')}
      <div class="stack" style="gap:10px">
        ${auths.map((a, i) => `
          <div class="card card--pad" style="display:flex;align-items:center;gap:14px;${a.on ? '' : 'opacity:.7'}">
            <span style="width:34px;height:34px;border-radius:9px;background:${a.on ? 'var(--warn-bg)' : 'var(--surface-3)'};color:${a.on ? 'var(--warn)' : 'var(--text-3)'};display:grid;place-items:center;flex:0 0 34px">${icon(a.on ? 'key' : 'lock')}</span>
            <div style="flex:1">
              <div class="fs12 b5">${esc(a.who)}</div>
              <div class="fs11 muted mt4">范围：${esc(a.scope)} · ${a.on ? `授权于 ${esc(a.at)} · 有效至 ${esc(a.exp)}` : '未授权任何范围'}</div>
            </div>
            ${a.on ? `<button class="btn btn--danger btn--sm" data-revoke="${i}">撤销授权</button>` : '<span class="badge">未启用</span>'}
          </div>`).join('')}
      </div>

      <div class="note note--info mt16">${icon('shield')}<span>平台<b>没有</b>远程执行命令的能力。服务顾问能看到的只有部署状态和错误日志，看不到文件内容。任何涉及你电脑上文件与服务的操作，都需要本地助手或你本人在场确认。</span></div>

      ${sectionHead('操作记录', '近 7 天 · 8 条')}
      <div class="card" style="overflow:hidden">
        <table class="table">
          <thead><tr><th style="width:150px">时间</th><th style="width:150px">操作人</th><th style="width:180px">动作</th><th>详情</th></tr></thead>
          <tbody>
            ${rows.map(([t, who, act, d, s]) => `
              <tr>
                <td class="fs11 muted mono">${t}</td>
                <td class="fs12">${esc(who)}</td>
                <td><span class="fs12 b5">${esc(act)}</span></td>
                <td class="fs12 muted">${esc(d)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

    qa('[data-revoke]').forEach(b => b.onclick = () => modal({
      title: '撤销服务顾问授权',
      desc: '撤销后，服务顾问将立即无法查看本项目状态。',
      body: `<div class="note note--warn">${icon('alert')}<span>正在进行的工单会暂停，需要重新授权才能继续。你可以在任何时候重新授权。</span></div>`,
      okText: '确认撤销',
      onOk: () => toast('授权已撤销'),
    }));
    qi('#btnExport').onclick = () => toast('操作记录已导出为 CSV');
  }

  /* =====================================================================
     9. 设置
     ===================================================================== */
  function renderSettings(root) {
    root.innerHTML = `<div class="page page--narrow">
      ${pageHead('设置', '企业信息、数据存储策略与账号安全。', '')}

      <div class="grid g2" style="align-items:start;gap:18px">
        <div class="stack" style="gap:16px">
          <div class="card card--pad">
            <div class="row--between mb12">
              <b class="fs13">企业信息</b>
              <span class="fs11 muted" id="orgSaved2">${icon('check')} 修改自动保存</span>
            </div>
            <div class="grid g2" style="gap:12px">
              <div class="field"><label class="field__label">企业名称</label><input class="input" data-org="name" value="${esc(S.org.name)}"></div>
              <div class="field"><label class="field__label">所属行业</label><input class="input" data-org="industry" value="${esc(S.org.industry)}"></div>
              <div class="field" style="margin-bottom:0"><label class="field__label">所在城市</label><input class="input" data-org="city" value="${esc(S.org.city)}"></div>
              <div class="field" style="margin-bottom:0"><label class="field__label">企业规模</label>
                <select class="select" data-org="size">${['1–10 人', '11–50 人', '51–200 人', '200 人以上'].map(x => `<option ${x === S.org.size ? 'selected' : ''}>${x}</option>`).join('')}</select>
              </div>
            </div>
            <div class="field mt12" style="margin-bottom:0">
              <label class="field__label">最想让 AI 先解决的问题</label>
              <textarea class="textarea" data-org="goal" placeholder="一句话即可">${esc(S.org.goal || '')}</textarea>
            </div>
          </div>

          <div class="card card--pad">
            <b class="fs13">数据存储策略</b>
            <div class="stack mt12" style="gap:0">
              ${[
                ['原始资料存放位置', '企业自有电脑（D:\\企业资料）'],
                ['知识库与索引位置', '企业自有电脑（Docker 容器）'],
                ['平台保存的内容', '项目流程、状态、文件清单'],
                ['备份策略', '每日 02:00 · 本地 + 加密离线各一份'],
                ['数据保留期限', '项目结束后 24 个月'],
              ].map(([k, v]) => `
                <div class="row--between" style="padding:9px 0;border-bottom:1px solid var(--border);gap:14px">
                  <span class="fs12 muted" style="flex:0 0 44%">${k}</span>
                  <span class="fs12 b5" style="text-align:right">${v}</span>
                </div>`).join('')}
            </div>
            <div class="note mt16">${icon('info')}<span>更换存储位置需要重新构建索引，建议在非工作时段操作。</span></div>
          </div>
        </div>

        <div class="stack" style="gap:16px">
          <div class="card card--pad">
            <b class="fs13">账号与安全</b>
            <div class="stack mt12" style="gap:0">
              ${[
                ['登录邮箱', S.org.email],
                ['登录密码', '最后修改 32 天前'],
                ['两步验证', '未开启'],
                ['登录设备', '2 台'],
              ].map(([k, v]) => `
                <div class="row--between" style="padding:10px 0;border-bottom:1px solid var(--border);gap:14px">
                  <span class="fs12 muted">${k}</span>
                  <span class="fs12 dim">${esc(v)}</span>
                </div>`).join('')}
            </div>
            <div class="row mt14" style="gap:8px">
              <button class="btn btn--ghost btn--sm">修改密码</button>
              <button class="btn btn--ghost btn--sm">开启两步验证</button>
            </div>
          </div>

          <div class="card card--pad">
            <b class="fs13">服务与合同</b>
            <div class="stack mt12" style="gap:0">
              ${[
                ['当前服务', '企业 AI 知识库 · 标准交付'],
                ['项目编号', S.project.id],
                ['服务顾问', '周明 · 138-0013-8000'],
                ['维护期', '交付后 12 个月'],
              ].map(([k, v]) => `
                <div class="row--between" style="padding:10px 0;border-bottom:1px solid var(--border);gap:14px">
                  <span class="fs12 muted">${k}</span>
                  <span class="fs12 dim">${esc(v)}</span>
                </div>`).join('')}
            </div>
            <button class="btn btn--ghost btn--sm mt14">查看服务协议</button>
          </div>

          <div class="card card--pad" style="border-color:#E8C9C6">
            <b class="fs13" style="color:var(--danger)">重置演示数据</b>
            <p class="fs12 muted mt8" style="line-height:1.65">这个原型的所有数据都存在你的浏览器里。重置后回到初始状态（知识库项目进行到第 6 步），仅影响本地演示数据。</p>
            <button class="btn btn--danger btn--sm mt12" id="btnReset">${icon('refresh')} 重置为初始状态</button>
          </div>
        </div>
      </div>
    </div>`;

    bindCompanyForm(null);
    qi('#btnReset').onclick = () => modal({
      title: '重置演示数据',
      desc: '会清空本浏览器内的所有进度与配置。',
      body: `<div class="note note--warn">${icon('alert')}<span>这个操作不可撤销。重置后项目会回到第 6 步，已勾选的检查项和测试报告都会清空。</span></div>`,
      okText: '确认重置',
      onOk: () => { TM.reset(); sessionStorage.removeItem('tm_entered'); location.href = 'index.html'; },
    });
  }

  /* ---------------------------------------------------------------------
     全局交互
     --------------------------------------------------------------------- */
  qi('#btnHelp').onclick = openAssist;

  qi('#orgSwitch').onclick = () => modal({
    title: '企业工作空间',
    desc: '每个企业的工作空间彼此隔离，资料与项目互不可见。',
    body: `<div class="stack" style="gap:9px">
        <div class="cfg-row" style="border-color:var(--brand);background:var(--brand-50)">
          <span class="avatar avatar--sq" style="background:#1F4A52">恒</span>
          <div class="cfg-row__body"><b>${esc(S.org.name)}</b><span>${esc(S.org.industry)} · ${esc(S.org.size)} · 当前</span></div>
          <span style="color:var(--brand);display:flex">${icon('checkCircle')}</span>
        </div>
        <div class="cfg-row" style="opacity:.6">
          <span class="avatar avatar--sq" style="background:#4A3A5E">拓</span>
          <div class="cfg-row__body"><b>厦门拓洋贸易有限公司</b><span>无访问权限 · 需由该企业管理员添加</span></div>
          <span style="color:var(--text-4);display:flex">${icon('lock')}</span>
        </div>
      </div>
      <div class="note mt16">${icon('shield')}<span>你只能看到自己所属的企业。跨企业访问需要对方管理员邀请，且权限限于被邀请的项目。</span></div>`,
    okText: '知道了',
    cancelText: '关闭',
  });

  qi('#btnSearch').onclick = () => modal({
    title: '搜索',
    desc: '演示环境：搜索项目、资料、成员。',
    body: `<input class="input" placeholder="输入关键词，例如：HS-2041、销售 SOP、李婉" autofocus>
      <div class="fs11 muted mt12">最近搜索：产品规格表 · 第 7 步 · 验收报告</div>`,
    okText: '搜索',
    cancelText: '取消',
    onOk: () => toast('演示环境：搜索结果未接入', 'info'),
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); qi('#btnSearch').click(); }
  });

  const menuBtn = qi('#btnMenu');
  if (window.innerWidth <= 860) menuBtn.style.display = 'flex';
  menuBtn.onclick = () => qi('#sidebar').classList.toggle('is-open');
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 860 && !qi('#sidebar').contains(e.target) && e.target !== menuBtn) {
      qi('#sidebar').classList.remove('is-open');
    }
  });
  window.addEventListener('resize', () => {
    menuBtn.style.display = window.innerWidth <= 860 ? 'flex' : 'none';
  });

  /* 启动 */
  window.addEventListener('hashchange', router);
  router();

  /* 供 live 模式在数据就绪后重新渲染 */
  window.__appRefresh = () => router();
})();
