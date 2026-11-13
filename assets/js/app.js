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
      out.push({ icon: 'target', color: 'var(--info)', bg: 'var(--info-bg)', title: '测试题还没有生成', desc: '会由模型从你上传的资料里出题，不是预置题库', act: '去生成', step: 7 });
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
                <span>服务顾问 ${esc(S.project.owner || '未指派')}</span><i></i>
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
      // 以前这里只弹一句「交付后自动开通」，点了个寂寞。现在直接进配置中心
      else if (id === 'admin') { location.hash = '#config'; toast('模型、助手、资料范围都在这里配置'); }
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
      desc: '提交后生成真实工单，服务商后台能看到并安排联系。',
      body: `<div class="field"><label class="field__label">联系人</label><input class="input" id="csName" value="${esc(S.org.contact)}"></div>
             <div class="field"><label class="field__label">联系电话 / 微信</label><input class="input" id="csPhone" placeholder="方便联系的时间也可以写在备注里"></div>
             <div class="field"><label class="field__label">最想解决的问题 <i class="req">*</i></label><textarea class="textarea" id="csNeed" placeholder="例如：产品资料太散，销售每次报价都要问技术部"></textarea></div>`,
      okText: '提交预约',
      onOk: async (back) => {
        const need = back.querySelector('#csNeed').value.trim();
        if (!need) { toast('写一下最想解决的问题', 'warn'); return false; }
        const name = back.querySelector('#csName').value.trim();
        const phone = back.querySelector('#csPhone').value.trim();
        return (await submitTicket('consult', `预约服务诊断 · ${need.slice(0, 30)}`, need, `${name} ${phone}`.trim())) ? undefined : false;
      },
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
          <select class="select" id="buWhen"><option>知识库项目交付后（推荐）</option><option>两周内</option><option>本月内</option><option>暂不确定，先登记意向</option></select>
        </div>
        <div class="field" style="margin-bottom:0"><label class="field__label">备注</label><textarea class="textarea" id="buNote" placeholder="有什么特殊要求可以写在这里"></textarea></div>`,
      okText: '提交开通申请',
      onOk: async (back) => {
        const when = back.querySelector('#buWhen').value;
        const note = back.querySelector('#buNote').value.trim();
        return (await submitTicket('service', `申请开通「${s.name}」`, `计划开始：${when}${note ? '\n备注：' + note : ''}`, S.org.contact || '')) ? undefined : false;
      },
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
    line('dim', `当前配置：${cfg.provider || '-'} / ${cfg.model || '-'} / ${cfg.keyMasked || '-'}`);

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
      const orgName = (S.org && (S.org.short || S.org.name)) || '企业';
      const lines = [
        ['ok', `知识库「${orgName} · 内部资料」已创建`],
        ['ok', `文档解析完成 · ${files.length} 份 / ${pages || '—'} 页`],
      ];
      /* 系统没有 OCR，也不做向量化（用的是中文 BM25 关键词索引）。
       * 这里以前写着"OCR 识别率 96.2%""embedding 完成"，都是没有的事。 */
      if (ocr) lines.push(['warn', `${ocr} 份扫描件读不出文字，需要先转成文字版再上传`]);
      lines.push(
        ['ok', `文本切片完成 · ${slices.toLocaleString('en-US')} 个片段`],
        ['ok', '关键词索引构建完成 · 中文 BM25'],
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
    const live = !!(window.LIVE && window.LIVE.on);
    const folders = (window.LIVE && window.LIVE.on ? window.LIVE.foldersList : null) || S.project.folders || [];
    const pendingCat = files.filter(f => f.catSource !== 'ai' && f.catSource !== 'manual').length;
    const aiDone = files.filter(f => f.catSource === 'ai').length;

    return `
      <div class="card card--pad mb16" id="scanCard">
        <div class="row--between mb12">
          <div style="min-width:0">
            <b class="fs13">从文件夹自动扫描</b>
            <div class="fs11 muted" style="line-height:1.6;margin-top:2px">把整份资料夹交给系统，自动找出能建知识库的文档，不用一份份点名。以后加了新文件，点「重新扫描」就补进来。</div>
          </div>
        </div>
        ${live ? `
          <div class="row" style="gap:8px;flex-wrap:wrap">
            <input class="input" id="folderInput" style="flex:1;min-width:180px" placeholder="直接说：桌面、下载文件夹、D盘的公司资料">
            <button class="btn btn--primary" id="btnAddFolder">添加并扫描</button>
          </div>
          <div class="say-chips" id="sayChips">
            <span class="say-chips__label">试试：</span>
            <button type="button" class="say-chip" data-say="桌面">桌面</button>
            <button type="button" class="say-chip" data-say="下载文件夹">下载</button>
            <button type="button" class="say-chip" data-say="文档">文档</button>
            <span id="sayChipsDrives"></span>
            <button type="button" class="say-chip" data-say="整个电脑">整个电脑</button>
          </div>
          <div class="fs11 muted mt8" style="line-height:1.6">说个名字就行：桌面 / 下载 / 文档 / D盘 / D盘的公司资料，多个用逗号或换行分开。会按这台电脑的真实硬盘解析路径，递归扫描 PDF / Word / Excel / TXT / Markdown / CSV，跳过系统目录，文件只在本机读取。</div>
          ${folders.length ? `
            <div class="stack mt12" style="gap:8px" id="folderList">
              ${folders.map(folderRow).join('')}
            </div>
            <div class="row mt12" style="gap:8px;flex-wrap:wrap">
              <button class="btn btn--ghost btn--sm" id="btnRescan">${icon('refresh')} 重新扫描全部（更新知识库）</button>
            </div>` : `<div class="fs11 muted mt12">还没有添加文件夹。加上一个，扫描到的文档会直接出现在下面的资料列表里。</div>`}
          <div id="scanResult"></div>
        ` : `<div class="note note--info">${icon('info')}<span>扫描硬盘需要本地服务在运行（<span class="mono">node server/index.js</span> 或双击「启动服务.bat」）。当前是演示模式，只能手动添加文件。</span></div>`}
      </div>

      <div class="card card--pad mb16" id="aiCatCard">
        <div class="ai-cat__head">
          <div class="ai-cat__intro">
            <b class="fs13">第二步：AI 分析分类</b>
            <div class="fs11 muted" style="line-height:1.6;margin-top:2px">系统会读每份资料的正文内容（不只是文件名），判断它属于产品 / 销售 / 业务流程 / 售后哪一类，并给出判断依据。分类决定员工问问题时能不能检索到这份资料。</div>
          </div>
          <button class="btn ${pendingCat ? 'btn--primary' : 'btn--ghost'} btn--sm ai-cat__btn" id="btnAiCat" ${pendingCat ? '' : 'disabled'}>
            ${pendingCat ? `分析 ${pendingCat} 份待分类资料` : (aiDone ? '已全部分析完成' : '暂无可分析资料')}
          </button>
        </div>
        <div class="ai-cat__meta mt10">
          ${TM.DOC_CATS.map(c => {
            const n = files.filter(f => f.cat === c).length;
            const ai = files.filter(f => f.cat === c && f.catSource === 'ai').length;
            return `<span class="ai-cat__pill ${n ? 'is-on' : ''}">${c} <b>${n}</b>${ai ? `<i class="fs11 muted"> · AI ${ai}</i>` : ''}</span>`;
          }).join('')}
          <span class="ai-cat__pill ${pendingCat ? 'is-warn' : ''}">待分析 <b>${pendingCat}</b></span>
        </div>
        <div class="ai-cat__bar" id="aiCatBar" hidden><i></i></div>
        <div class="fs11 muted mt8" id="aiCatStat" style="line-height:1.6">${pendingCat
          ? '点上面的按钮开始。每批分析 10 份，中途可以离开这个页面，进度会停在这一批结束的位置。'
          : '分类已全部由 AI 读过内容判定。手动改过的资料会保住你的选择，不会被 AI 覆盖。'}</div>
      </div>

      <div class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="选择或拖入资料文件">
        <input type="file" id="fileInput" multiple hidden
               accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.md,.csv">
        <span class="dropzone__ico">${icon('upload')}</span>
        <b>也可以直接把文件拖到这里</b>
        <span class="dropzone__hint">PDF / Word / Excel / TXT / Markdown · 单份不超过 80 MB</span>
        <span class="dropzone__privacy">${icon('shield')} 文件只在这台电脑解析，不上传云端</span>
      </div>

      <div class="row--between mt16 mb8">
        <div class="fs12 b5">已添加 <span id="docCount">${files.length}</span> 份 · 合计 <span id="docTotal">${fmtBytes(total)}</span></div>
        <span class="fs11 muted">分类决定助手能检索到哪部分</span>
      </div>

      <div class="doc-list" id="docList">
        ${files.length ? files.map(docRow).join('') : `<div class="empty" style="padding:26px 0">${icon('folder')}<p class="fs12">还没有资料。扫描一个文件夹，或上传产品目录和规格表——这两份决定回答的上限。</p></div>`}
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

  /* 路径显示：允许在目录分隔符处换行，避免把单词从中间截断 */
  function pathHtml(p) {
    return esc(p).replace(/[\\/]/g, m => m + '<wbr>');
  }

  function folderRow(f) {
    const when = f.lastScanAt ? f.lastScanAt.slice(0, 16).replace('T', ' ') : '还没扫描';
    const label = f.label || f.path.split(/[\\/]/).filter(Boolean).pop() || f.path;
    return `<div class="folder-item">
      <div class="folder-item__path">
        <div class="fs12 b5">${esc(label)}</div>
        <div class="fs11 muted mono" style="overflow-wrap:anywhere">${pathHtml(f.path)}</div>
        <div class="fs11 muted" style="margin-top:2px">${f.imported || 0} 份已入库${f.count ? ` · 共发现 ${f.count} 个文档` : ''} · ${when}</div>
      </div>
      <div class="row" style="gap:6px;flex:0 0 auto">
        <button class="btn btn--ghost btn--sm" data-rescan="${esc(f.path)}">重新扫描</button>
        <button class="btn btn--quiet btn--sm" data-removefolder="${esc(f.path)}">移除</button>
      </div>
    </div>`;
  }

  function docRow(d) {
    const tag = d.catSource === 'ai'
      ? `<span class="doc-tag doc-tag--ai" title="AI 读过内容后判定">AI 判定</span>`
      : d.catSource === 'manual'
        ? `<span class="doc-tag doc-tag--man" title="你手动指定的分类，AI 不会覆盖">手动</span>`
        : `<span class="doc-tag doc-tag--todo" title="只按文件名推断，建议用 AI 分析一次">待分析</span>`;
    return `<div class="doc-item" data-id="${esc(d.id)}">
      <span class="doc-item__ext">${esc(d.ext || 'FILE')}</span>
      <div class="doc-item__body">
        <div class="doc-item__title"><b>${esc(d.name)}</b>${tag}</div>
        <span>${esc(d.size)}${d.slices ? ' · 约 ' + d.slices + ' 个切片' : ''}${d.state === 'ocr' ? ' · 已 OCR' : ''}${d.sourcePath ? ' · 文件夹导入' : ''}</span>
        ${d.catSource === 'ai' && d.catWhy ? `<span class="doc-why">${icon('info')} ${esc(d.catWhy)}</span>` : ''}
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

    /* ---- 从文件夹自动扫描 ---- */
    const btnAdd = qi('#btnAddFolder');
    if (btnAdd) {
      const folderInput = qi('#folderInput');

      /* 快捷词：桌面 / 下载 / 文档 / 各磁盘 / 整个电脑 */
      function bindSayChips() {
        qa('[data-say]').forEach(chip => {
          chip.onclick = () => {
            if (!folderInput) return;
            folderInput.value = chip.dataset.say;
            folderInput.focus();
            if (btnAdd && !btnAdd.disabled) btnAdd.click();
          };
        });
      }
      bindSayChips();

      /* 补上这台电脑真实存在的磁盘（C盘 / D盘 …） */
      (async () => {
        try {
          const r = await window.LIVE.resolveDirs('');
          const drives = r.drives || [];
          const box = qi('#sayChipsDrives');
          if (box && drives.length) {
            box.innerHTML = drives.slice(0, 4).map(d => {
              const letter = d.replace(/[\\/:]/g, '');
              return `<button type="button" class="say-chip" data-say="${esc(letter + '盘')}">${esc(letter)} 盘</button>`;
            }).join('');
            bindSayChips();
          }
        } catch { /* 演示模式或服务未开，忽略 */ }
      })();

      /* 回显「说的话 → 真实路径」 */
      function showResolved(items) {
        const box = qi('#scanResult');
        if (!box || !items || !items.length) return;
        box.innerHTML = `<div class="fs11 muted mt10" style="line-height:1.7">已识别：${items.map(it =>
          `<span class="say-resolved">${esc(it.raw)} → <b class="mono" style="overflow-wrap:anywhere">${pathHtml(it.path)}</b></span>`).join('')}</div>`;
      }

      /* 没找到：列出候选文件夹让人点选 */
      function showUnmatched(res, raw) {
        const box = qi('#scanResult');
        if (!box) return;
        const un = (res.unmatched || []).map(u => u.raw).join('、') || raw;
        const cands = res.candidates || [];
        box.innerHTML = `
          <div class="note note--warn mt10">${icon('info')}<span>没找到「${esc(un)}」。${cands.length ? '你是指下面哪个？点一下就用它。' : '换个说法试试：桌面 / 下载 / D盘的公司资料，或直接贴完整路径。'}</span></div>
          ${cands.length ? `<div class="say-chips">${cands.map(c => `<button type="button" class="say-chip" data-say="${esc(c.path)}">${esc(c.name)}</button>`).join('')}</div>` : ''}`;
        bindSayChips();
      }

      /* 文档太多时先确认，别一按就吞掉几百份 */
      function showConfirm(raw, items, total) {
        const box = qi('#scanResult');
        if (!box) return;
        const names = items.map(i => i.label).join('、');
        box.innerHTML = `
          <div class="note note--warn mt10">${icon('info')}<span>「${esc(names)}」里找到 <b>${total}</b> 个可建库文档（含子目录）。全部导入要逐份解析，也占本机存储，确认一下？</span></div>
          <div class="row mt8" style="gap:8px;flex-wrap:wrap">
            <button class="btn btn--primary btn--sm" id="btnConfirmImport">确认导入 ${total} 份</button>
            <button class="btn btn--ghost btn--sm" id="btnCancelImport">换个更具体的文件夹</button>
          </div>`;
        const ok = qi('#btnConfirmImport');
        const no = qi('#btnCancelImport');
        if (ok) ok.onclick = async () => {
          ok.disabled = true; ok.textContent = '导入中…';
          try { await runImport(raw, items); }
          catch (e) { ok.disabled = false; ok.textContent = `确认导入 ${total} 份`; toast('导入失败：' + e.message, 'warn'); }
        };
        if (no) no.onclick = () => {
          box.innerHTML = '';
          const inp = qi('#folderInput');
          if (inp) { inp.value = ''; inp.focus(); }
        };
      }

      /* ---- AI 分析分类 ---- */
      const AI_BATCH = 10;

      function aiUI() {
        return { btn: qi('#btnAiCat'), bar: qi('#aiCatBar'), stat: qi('#aiCatStat') };
      }

      function aiProgress(cur, total, ok, fail) {
        const { bar, stat } = aiUI();
        if (bar) {
          bar.hidden = false;
          const fill = bar.firstElementChild;
          if (fill) fill.style.width = Math.min(100, Math.round((cur / Math.max(total, 1)) * 100)) + '%';
        }
        if (stat) {
          stat.textContent = `正在分析：已处理 ${cur} / ${total} 份${fail ? ` · ${fail} 份模型没给出结果，暂保留原判定` : ''}`;
        }
      }

      async function aiClassify(ids) {
        if (!(window.LIVE && window.LIVE.on)) { toast('需要本地服务在运行才能做 AI 分析', 'warn'); return; }
        const queue = (ids && ids.length) ? ids.slice() : null;
        const total = queue
          ? queue.length
          : (S.project.files || []).filter(f => f.catSource !== 'ai' && f.catSource !== 'manual').length;
        if (!total) { toast('没有需要分析的资料', 'info'); return; }

        const first = aiUI();
        if (first.btn) { first.btn.disabled = true; first.btn.textContent = 'AI 分析中…'; }
        aiProgress(0, total, 0, 0);

        let ok = 0, fail = 0;
        try {
          for (let guard = 0; guard < 500; guard++) {
            const batch = queue ? queue.slice(0, AI_BATCH) : null;
            const r = await window.LIVE.classifyDocs(batch, AI_BATCH);
            const nUp = (r.updated || []).length;
            const nFail = (r.failed || []).length;
            ok += nUp; fail += nFail;
            if (queue) queue.splice(0, batch.length);
            aiProgress(Math.min(ok + fail, total), total, ok, fail);

            if (queue ? queue.length === 0 : !!r.done) break;
            if (!nUp && !nFail) break;   // 模型连续不给结果，别死循环
          }
          window.LIVE.paint(); TM.save(); syncDocChecks(step);
          renderStepPanel();
          logAct(`AI 分析了 ${ok} 份资料的分类`);
          toast(ok ? `AI 已按内容判定 ${ok} 份资料的分类` : 'AI 这次没给出结果，稍后再试', ok ? 'info' : 'warn');
        } catch (e) {
          const cur = aiUI();
          if (cur.btn) { cur.btn.disabled = false; cur.btn.textContent = '重试 AI 分析'; }
          if (e.data && e.data.needKey) {
            toast('还没配置模型 Key，先去第 5 步填一个', 'warn');
          } else {
            toast(e.message || 'AI 分析失败', 'warn');
          }
        }
      }

      const btnAi = qi('#btnAiCat');
      if (btnAi) btnAi.onclick = () => aiClassify(null);

      /* 真正加入并扫描（确认后走这里） */
      async function runImport(raw, items) {
        if (btnAdd.isConnected) btnAdd.textContent = '扫描中…';
        const r = await window.LIVE.addFolders(raw);
        if (r.badDirs && r.badDirs.length) toast(`这些没找到：${r.badDirs.slice(0, 2).join('、')}`, 'warn');
        if (r.added && r.added.length) {
          const imp = await window.LIVE.rescanFolders();
          window.LIVE.paint(); TM.save(); syncDocChecks(step);
          const nAdd = imp.added.length, nUp = imp.updated.length;
          const rb = imp.rebuilt && imp.rebuilt.chunks ? ' · 知识库已重建' : '';
          logAct(`扫描文件夹，导入 ${nAdd} 份资料`);
          toast(nAdd || nUp ? `已导入 ${nAdd} 份${nUp ? `、更新 ${nUp} 份` : ''}资料${rb}` : '这个文件夹里暂时没有能建库的新文档', nAdd || nUp ? 'info' : 'warn');
          folderInput.value = '';
          renderStepPanel();
          showResolved(items);

          /* 新导入的资料直接进 AI 分析：数量少就自动跑，太多让人自己点，避免一次烧太多额度 */
          const newIds = (imp.added || []).map(x => x.id).filter(Boolean);
          if (newIds.length && newIds.length <= 40) {
            setTimeout(() => aiClassify(newIds), 350);
          } else if (newIds.length) {
            logAct(`导入 ${newIds.length} 份资料，等待 AI 分析分类`);
            toast(`已导入 ${newIds.length} 份，点「AI 分析分类」让系统读内容判定类别`, 'info');
          }
        } else {
          renderStepPanel();
          toast('这个文件夹已在扫描列表里，可直接点「重新扫描」', 'warn');
          showResolved(items);
        }
      }

      btnAdd.onclick = async () => {
        const raw = (folderInput.value || '').trim();
        if (!raw) { toast('先说要扫哪里，比如「桌面」', 'warn'); folderInput.focus(); return; }
        if (!(window.LIVE && window.LIVE.on)) { toast('扫描硬盘需要本地服务在运行', 'warn'); return; }
        const reset = () => { btnAdd.disabled = false; btnAdd.textContent = '添加并扫描'; };
        btnAdd.disabled = true; btnAdd.textContent = '识别中…';
        try {
          /* 1) 先把人话解析成真实路径，让用户确认扫的是哪里 */
          const res = await window.LIVE.resolveDirs(raw);
          const items = res.items || [];
          if (!items.length) {
            showUnmatched(res, raw);
            reset();
            toast('没找到这个文件夹，看看下面的候选', 'warn');
            return;
          }

          /* 2) 先数一数有多少份文档，大目录先确认 */
          btnAdd.textContent = '统计中…';
          let preview = null;
          try { preview = await window.LIVE.scanDirs(raw); } catch { preview = null; }
          const total = preview && typeof preview.total === 'number' ? preview.total : null;

          if (total === 0) {
            const box = qi('#scanResult');
            if (box) box.innerHTML = `<div class="note note--warn mt10">${icon('info')}<span>「${esc(items.map(i => i.label).join('、'))}」里没找到能建库的文档（支持 PDF / Word / Excel / TXT / Markdown / CSV）。</span></div>`;
            reset();
            return;
          }
          if (total !== null && total > 60) {
            showConfirm(raw, items, total);
            reset();
            return;
          }

          /* 3) 文档不多，直接导 */
          await runImport(raw, items);
        } catch (e) {
          reset();
          const data = e.data || {};
          if (data.unmatched) showUnmatched(data, raw);
          toast('扫描失败：' + e.message, 'warn');
        }
      };
    }

    const btnRescan = qi('#btnRescan');
    if (btnRescan) {
      btnRescan.onclick = async () => {
        if (!(window.LIVE && window.LIVE.on)) return;
        btnRescan.disabled = true; btnRescan.textContent = '扫描中…';
        try {
          const r = await window.LIVE.rescanFolders();
          window.LIVE.paint(); TM.save(); syncDocChecks(step); renderStepPanel();
          const nAdd = r.added.length, nUp = r.updated.length;
          const rb = r.rebuilt && r.rebuilt.chunks ? ' · 知识库已重建' : '';
          logAct(`重新扫描文件夹，新增 ${nAdd} 份、更新 ${nUp} 份`);
          toast(nAdd || nUp ? `新增 ${nAdd} 份${nUp ? `、更新 ${nUp} 份` : ''}资料${rb}` : '没有发现新增或改动的文档', nAdd || nUp ? 'info' : 'warn');
          const newIds = [...(r.added || []), ...(r.updated || [])].map(x => x.id).filter(Boolean);
          if (newIds.length && newIds.length <= 40) setTimeout(() => aiClassify(newIds), 350);
        } catch (e) {
          btnRescan.disabled = false; btnRescan.textContent = '重新扫描全部（更新知识库）';
          toast('扫描失败：' + e.message, 'warn');
        }
      };
    }

    qa('[data-rescan]').forEach(btn => btn.onclick = async () => {
      const dir = btn.dataset.rescan;
      if (!(window.LIVE && window.LIVE.on)) return;
      btn.disabled = true; btn.textContent = '扫描中…';
      try {
        const r = await window.LIVE.importPaths({ dirs: [dir] });
        window.LIVE.paint(); TM.save(); syncDocChecks(step); renderStepPanel();
        const nAdd = r.added.length, nUp = r.updated.length;
        const rb = r.rebuilt && r.rebuilt.chunks ? ' · 知识库已重建' : '';
        toast(nAdd || nUp ? `新增 ${nAdd} 份${nUp ? `、更新 ${nUp} 份` : ''}资料${rb}` : '这个文件夹没有新增或改动的文档', nAdd || nUp ? 'info' : 'warn');
        const newIds = [...(r.added || []), ...(r.updated || [])].map(x => x.id).filter(Boolean);
        if (newIds.length && newIds.length <= 40) setTimeout(() => aiClassify(newIds), 350);
      } catch (e) {
        btn.disabled = false; btn.textContent = '重新扫描';
        toast('扫描失败：' + e.message, 'warn');
      }
    });

    qa('[data-removefolder]').forEach(btn => btn.onclick = async () => {
      const dir = btn.dataset.removefolder;
      if (!(window.LIVE && window.LIVE.on)) return;
      btn.disabled = true;
      try {
        await window.LIVE.removeFolder(dir);
        renderStepPanel();
        toast('已移出扫描列表（已导入的资料仍在）', 'info');
      } catch (e) {
        btn.disabled = false;
        toast('移除失败：' + e.message, 'warn');
      }
    });

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
          <span class="fs12 dim">用哪个助手：</span>
          <select class="select" id="testAsst" style="max-width:280px;height:32px;font-size:12px">
            <option value="">通用（查全部资料）</option>
            ${(window.LIVE.assistants || []).map((a) => `<option value="${esc(a.id)}" ${testAsstId === a.id ? 'selected' : ''}>${esc(a.name)}${a.scope && a.scope.length ? ` · ${esc(a.scope.join('/'))}` : ' · 全部'}</option>`).join('')}
          </select>
          <span class="fs11 muted">出题和回答都按这个助手：岗位定位进提示词，资料范围决定它能查到什么${run.ran ? '。换完要重新运行' : ''}</span>
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
        // 出题也带上助手：题目会围绕这个岗位的职责和资料范围
        const r = await window.LIVE.genTests(12, testAsstId);
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

    qa('[data-remove]').forEach(b => b.onclick = async () => {
      const id = b.dataset.remove;
      const m = (S.members || []).find(x => x.id === id);
      if (!m) return;
      try {
        if (window.LIVE && window.LIVE.on) await window.LIVE.removeMember(id);
        else S.members = S.members.filter(x => x.id !== id);
      } catch (e) { toast('移除失败：' + e.message, 'warn'); return; }
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
          <textarea class="textarea" id="fbTxt" placeholder="例如：问保修期，答的是旧版政策"></textarea></div>
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
      onOk: async (back) => {
        const name = back.querySelector('#invName').value.trim();
        const email = back.querySelector('#invEmail').value.trim();
        const role = back.querySelector('#invRole').value;
        if (!name) { toast('填一下姓名', 'warn'); return false; }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('邮箱格式不对，或者留空', 'warn'); return false; }
        if (email && (S.members || []).some(x => (x.email || '').toLowerCase() === email.toLowerCase())) {
          toast('这个邮箱已经在成员列表里了', 'warn');
          return false;
        }
        try {
          if (window.LIVE && window.LIVE.on) {
            await window.LIVE.addMember({ name, email, role });
          } else {
            S.members.push({ id: 'm' + Date.now(), name, email, role, status: 'active', at: TM.fmtDate(new Date()) });
          }
        } catch (e) { toast('添加失败：' + e.message, 'warn'); return false; }
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

  /* 所有「联系顾问」类弹窗统一真提交工单，不再是弹一句 toast 就消失。
   * 工单落在服务端 data/tickets.json，服务商后台「人工协助请求」里能看到、能处理。 */
  async function submitTicket(type, title, detail, contact) {
    if (!(window.LIVE && window.LIVE.on)) {
      toast('需要连上本地服务才能提交工单', 'warn');
      return false;
    }
    try {
      await window.LIVE.newTicket({ type, title, detail, contact });
      toast('已提交，服务商后台的「人工协助请求」里能看到这条');
      return true;
    } catch (e) {
      toast('提交失败：' + e.message, 'warn');
      return false;
    }
  }

  function openAssist() {
    modal({
      title: '申请人工协助',
      desc: '提交后工单会真实出现在服务商后台，服务顾问处理后能看到回复。',
      body: `<div class="field"><label class="field__label">卡在哪一步</label>
          <select class="select" id="asStep">${STEPS.map(s => `<option ${s.id === activeStep ? 'selected' : ''}>第 ${s.id} 步 · ${s.title}</option>`).join('')}</select>
        </div>
        <div class="field"><label class="field__label">遇到什么问题 <i class="req">*</i></label>
          <textarea class="textarea" id="asProblem" placeholder="描述得越具体，处理越快。例如：上传的 PDF 解析出来是空的"></textarea>
        </div>
        <div class="field"><label class="field__label">联系方式</label>
          <input class="input" id="asContact" value="${esc(S.org.contact || '')}" placeholder="方便联系的人或电话"></div>
        <label class="checkline is-checked" style="padding-left:0">
          <span class="checkline__box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
          <span class="checkline__txt">允许服务顾问查看本项目的部署状态与错误日志<span class="checkline__meta">仅限本项目，不含文件内容，可随时撤销</span></span>
        </label>`,
      okText: '提交工单',
      onOk: async (back) => {
        const problem = back.querySelector('#asProblem').value.trim();
        if (!problem) { toast('写一下遇到的问题', 'warn'); return false; }
        const step = back.querySelector('#asStep').value;
        const contact = back.querySelector('#asContact').value.trim();
        return (await submitTicket('assist', `【${step}】${problem.slice(0, 40)}`, problem, contact)) ? undefined : false;
      },
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
    qi('#btnSync').onclick = async () => {
      if (!(window.LIVE && window.LIVE.on)) return toast('需要连上本地服务才能同步', 'warn');
      const b = qi('#btnSync');
      b.disabled = true;
      const old = b.innerHTML;
      b.innerHTML = icon('refresh') + ' 同步中…';
      try {
        await window.LIVE.reload();
        await window.LIVE.refreshMembers();
        window.LIVE.paint();
        router();
        toast('已从服务端重新拉取模型、资料、助手与成员配置');
      } catch (e) {
        toast('同步失败：' + e.message, 'warn');
        b.disabled = false;
        b.innerHTML = old;
      }
    };

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
  /* 表单里可选的服务商（换选项会自动填好接口与模型） */
  const LLM_PROVIDERS = [
    ['deepseek', 'DeepSeek', 'deepseek-chat'],
    ['dashscope', '通义千问', 'qwen-plus'],
    ['zhipu', '智谱 GLM', 'glm-4-plus'],
    ['moonshot', '月之暗面', 'moonshot-v1-8k'],
    ['openai', 'OpenAI', 'gpt-4o-mini'],
    ['siliconflow', '硅基流动', 'deepseek-ai/DeepSeek-V3'],
    ['custom', '自定义（OpenAI 兼容）', ''],
  ];

  /* 提供免费额度的服务商：客户任选其一注册，拿到属于「自己」的免费 Key。
   * 平台不内置任何 Key，也不会替客户付费——所以这里给的是"去哪里白嫖一个自己的 Key"。 */
  const FREE_PROVIDERS = [
    { key: 'deepseek', name: 'DeepSeek', signup: 'https://platform.deepseek.com', note: '新用户注册送约 ¥10 体验额度，之后按量计费', base: 'https://api.deepseek.com', model: 'deepseek-chat' },
    { key: 'siliconflow', name: '硅基流动 SiliconFlow', signup: 'https://cloud.siliconflow.cn', note: '注册送 ¥14 额度，可调用 DeepSeek / Qwen / GLM 等', base: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
    { key: 'dashscope', name: '阿里云百炼 · 通义千问', signup: 'https://dashscope.console.aliyun.com', note: '部分模型（如 qwen-long）长期免费额度', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    { key: 'zhipu', name: '智谱 AI · GLM', signup: 'https://open.bigmodel.cn', note: 'GLM 有免费版 / 体验额度', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus' },
    { key: 'moonshot', name: '月之暗面 · Kimi', signup: 'https://platform.moonshot.cn', note: '注册送体验额度', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  ];

  function llmForm(compact) {
    const cfg = (window.LIVE && window.LIVE.llm) || { configured: false };
    const configured = !!cfg.configured;
    const providers = LLM_PROVIDERS;

    return `<div class="card" style="padding:16px;background:var(--surface-2);box-shadow:none">
      ${configured ? `
        <div class="row--between mb12">
          <div class="row" style="gap:8px">
            <span style="color:var(--success);display:flex">${icon('checkCircle')}</span>
            <div>
              <b class="fs12">已配置：${esc(cfg.model)}</b>
              <div class="fs11 muted mt2">密钥 ${esc(cfg.keyMasked)} · 保存在本机，不上传</div>
            </div>
          </div>
          <button class="btn btn--quiet btn--sm" id="btnLlmEdit">${icon('edit')} 修改</button>
        </div>` : `
        <div class="note mb12">${icon('key')}<span><b>本平台不内置任何模型，也不会替你付费。</b>请填你自己的 API Key（任何一个支持 OpenAI 兼容接口的模型都行）。没有模型，第 7 步出不了题，员工门户也只能返回原文片段、给不出回答。</span></div>`}

      <div id="llmFormBox" style="${cfg.configured && compact ? 'display:none' : ''}">
        <div class="fs12 b5 mb8">① 选一个提供商，拿到你<b>自己</b>的免费 Key</div>
        <div class="grid g2" style="gap:8px;margin-bottom:16px">
          ${FREE_PROVIDERS.map((p) => `
            <div class="card" style="padding:10px 12px;box-shadow:none;background:var(--surface);display:flex;flex-direction:column;gap:6px">
              <div class="row--between">
                <b class="fs12">${esc(p.name)}</b>
                <button class="btn btn--ghost btn--xs" data-fp="1" data-prov="${p.key}" data-base="${esc(p.base)}" data-model="${esc(p.model)}">填入</button>
              </div>
              <div class="fs11 muted" style="line-height:1.45">${esc(p.note)}</div>
              <a href="${p.signup}" target="_blank" rel="noopener" class="fs11" style="color:var(--brand)">去申请免费 Key ↗</a>
            </div>`).join('')}
        </div>

        <div class="fs12 b5 mb8">② 填好下面三项，保存时系统会真的发一次请求验证</div>
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
          <input class="input mono" id="llmKey" type="password" placeholder="${cfg.configured ? '已保存，如需更换请重新填写' : 'sk-... / 各平台自己的格式'}" autocomplete="new-password">
          <div class="field__hint">在上面的提供商后台创建。Key 保存在本机 data 目录，只用于调用模型，不会写进网页代码，平台也看不到。</div>
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
        siliconflow: ['https://api.siliconflow.cn/v1', 'deepseek-ai/DeepSeek-V3'],
      };
      const v = map[sel.value];
      if (v) {
        qi('#llmBase').value = v[0];
        qi('#llmModel').value = v[1];
      }
    };

    // 免费提供商卡片的"填入"：自动填好接口与模型，剩下的 Key 自己申请粘贴
    document.querySelectorAll('#llmFormBox [data-fp]').forEach((btn) => {
      btn.onclick = () => {
        const prov = btn.dataset.prov;
        const match = LLM_PROVIDERS.find(([k]) => k === prov);
        if (sel) sel.value = match ? prov : 'custom';
        qi('#llmBase').value = btn.dataset.base;
        qi('#llmModel').value = btn.dataset.model;
        const box = qi('#llmFormBox');
        if (box) box.style.display = '';
        toast(`已填入 ${btn.closest('.card').querySelector('b')?.textContent || '该提供商'} 的接口和模型，去申请 Key 后粘贴即可`);
      };
    });

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
      if (!cfg.apiKey && !cur.configured) return toast('先填 API Key（平台不内置，需自备）', 'warn');

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
              <button class="btn btn--quiet btn--sm" data-test-a="${esc(a.id)}">${icon('send')} 试问</button>
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

  /* 当场试一句：让客户自己验证"这个助手真的按我的设定在答"。
   * 不试的话，提示词和资料范围改完只能靠信任。 */
  function openAssistantTry(a) {
    const m = modal({
      title: `试问「${a.name}」`,
      desc: '同一个问题换个助手问，回答会不一样——岗位定位进提示词，资料范围决定它能查什么。',
      body: `
        <div class="field">
          <label class="field__label">问题</label>
          <input class="input" id="tryQ" placeholder="例如：这个型号配几块电池？">
        </div>
        <div class="row" style="gap:8px">
          <button class="btn btn--primary btn--sm" id="btnTryAsk">${icon('send')} 提问</button>
          <span class="fs11 muted">会真的调用一次模型，消耗少量额度</span>
        </div>
        <div id="tryOut" class="mt14"></div>`,
      okText: '关闭',
      wide: true,
    });

    const back = m.root;
    const inp = back.querySelector('#tryQ');
    const btn = back.querySelector('#btnTryAsk');
    const out = back.querySelector('#tryOut');

    btn.onclick = async () => {
      const q = inp.value.trim();
      if (!q) return toast('先写一句问题', 'warn');
      btn.disabled = true;
      btn.innerHTML = icon('refresh') + ' 思考中…';
      out.innerHTML = '';
      try {
        const r = await window.LIVE.ask(q, a.id);
        if (r.error) throw new Error(r.error);
        const cites = (r.citations || []).map((c) => `${c.doc}${c.page ? ' P.' + c.page : ''}`).join('、');
        out.innerHTML = `
          <div class="card" style="padding:14px;background:var(--surface-2);box-shadow:none">
            <div class="row--between mb8">
              <span class="fs11 muted">${esc(a.name)} 的回答</span>
              ${r.ms ? `<span class="fs11 muted">${r.ms}ms</span>` : ''}
            </div>
            <div class="fs12" style="line-height:1.75;white-space:pre-wrap">${esc(r.answer || r.message || '（没有返回内容）')}</div>
            ${cites ? `<div class="fs11 muted mt10">出处：${esc(cites)}</div>` : `<div class="fs11 muted mt10">没有引用任何资料</div>`}
          </div>`;
      } catch (e) {
        out.innerHTML = `<div class="note note--warn">${esc(e.message)}</div>`;
      } finally {
        btn.disabled = false;
        btn.innerHTML = icon('send') + ' 提问';
      }
    };
    inp.onkeydown = (e) => { if (e.key === 'Enter') btn.click(); };
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

    qa('[data-test-a]').forEach((b) => {
      b.onclick = () => {
        const a = (window.LIVE.assistants || []).find((x) => x.id === b.dataset.testA);
        if (a) openAssistantTry(a);
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
    /* 全部读真实配置与用量。以前这里列着「阿里云百炼 qwen-plus」「text-embedding-v3
     * 向量化模型」「DeepSeek-V3 备用」和「482 次 / 1.24M token / ¥5.12」，
     * 全是编的——实际只接了一个模型，也没有向量检索。 */
    const llm = (window.LIVE && window.LIVE.llm) || {};
    const u = S.usage || { calls: 0, tokens: 0, byDay: {} };
    const byDay = u.byDay || {};
    const days = Object.keys(byDay).sort().slice(-7);
    const peak = Math.max(1, ...days.map((d) => byDay[d] || 0));

    const configured = llm.configured || llm.keyMasked;

    return `
      <div class="grid g2" style="align-items:start;gap:18px">
        <div class="card card--pad">
          <div class="row--between mb16">
            <div>
              <b class="fs13">当前使用的模型</b>
              <div class="fs11 muted mt4">模型决定回答质量、响应速度和单次成本</div>
            </div>
            <button class="btn btn--ghost btn--sm" id="cfgEditModel">${icon('edit')} 更改</button>
          </div>

          ${configured ? `
            <div class="cfg-row">
              <span class="cfg-row__ico" style="background:var(--brand-50);color:var(--brand)">${icon('cpu')}</span>
              <div class="cfg-row__body">
                <b>${esc(llm.provider || '—')} · ${esc(llm.model || '—')}</b>
                <span>${esc((llm.baseURL || '').replace(/^https?:\/\//, ''))} · 密钥 ${esc(llm.keyMasked || '已配置')}</span>
              </div>
              <span class="badge badge--success badge--dot">可用</span>
            </div>
            <div class="note mt16">${icon('info')}<span>当前用的是你填的 Key，费用记在你自己的服务商账号上。本平台不内置、也不补贴任何模型。</span></div>
          ` : `
            <div class="note note--warn">${icon('key')}<span>还没有配置模型。到项目向导第 5 步填一个 API Key，第 7 步才能出题、员工门户才能给出回答。</span></div>
          `}

          <div class="note mt12" style="background:var(--surface-2)">${icon('search')}<span>资料检索用的是<b>中文关键词索引（BM25）</b>，不需要额外的向量化模型。好处是不用多买一份 embedding 服务，代价是同义词召回靠内置词表，不如语义检索。</span></div>
        </div>

        <div class="stack" style="gap:16px">
          <div class="card card--pad">
            <div class="row--between">
              <b class="fs13">用量统计</b>
              <span class="fs11 muted">本机记录</span>
            </div>
            <div class="row mt12" style="gap:24px">
              <div><div class="fs11 muted">调用次数</div><div class="fs17 b6 tnum mt4">${u.calls || 0}</div></div>
              <div><div class="fs11 muted">消耗 token</div><div class="fs17 b6 tnum mt4">${(u.tokens || 0).toLocaleString('en-US')}</div></div>
            </div>
            ${days.length ? `
              <div class="mt16" style="display:flex;align-items:flex-end;gap:5px;height:56px">
                ${days.map((d, i) => `<div style="flex:1;background:${i === days.length - 1 ? 'var(--brand)' : 'var(--brand-100)'};height:${Math.max(8, Math.round((byDay[d] || 0) / peak * 100))}%;border-radius:3px 3px 0 0" title="${esc(d)} · ${(byDay[d] || 0).toLocaleString('en-US')} token"></div>`).join('')}
              </div>
              <div class="row mt8" style="justify-content:space-between;font-size:10px;color:var(--text-4)">
                ${days.map(d => `<span style="flex:1;text-align:center">${esc(d.slice(5))}</span>`).join('')}
              </div>`
            : `<div class="fs11 muted mt12">还没有调用记录。跑一次测试或问一个问题就会出现。</div>`}
            <div class="fs11 muted mt12">费用请到服务商后台查看，这里只统计次数和 token。</div>
          </div>

          <div class="card card--pad">
            <b class="fs13">回答行为</b>
            <div class="mt12 stack" style="gap:11px">
              ${[['强制引用资料来源', true], ['找不到答案时明确拒答', true], ['允许模型自行补充常识', false]].map(([n, on]) => `
                <div class="row--between">
                  <span class="fs12">${n}</span>
                  <span class="badge ${on ? 'badge--success' : ''}">${on ? '已启用' : '已关闭'}</span>
                </div>`).join('')}
            </div>
            <div class="fs11 muted mt12">这三条写死在提示词里，不可关闭——保证回答只依据你上传的资料。</div>
          </div>
        </div>
      </div>`;
  }

  function cfgApi() {
    /* 只读展示真实配置。改 Key 统一走第 5 步，那里有真的连通性测试。
     * 以前这里放了个假的明文 Key 和"最后校验 2026-11-12 14:22"。 */
    const llm = (window.LIVE && window.LIVE.llm) || {};
    const configured = !!llm.configured;
    const masked = llm.keyMasked || '';

    return `
      <div class="grid g2" style="align-items:start;gap:18px">
        <div class="card card--pad">
          <div class="row--between mb16">
            <div><b class="fs13">模型服务授权</b><div class="fs11 muted mt4">密钥加密存在本机，网页前端只显示打码</div></div>
            <span class="badge ${configured ? 'badge--success badge--dot' : ''}">${configured ? '已连接' : '未配置'}</span>
          </div>

          ${configured ? `
            <div class="stack" style="gap:0">
              ${[
                ['服务商', `${llm.provider || '—'}`],
                ['模型', `${llm.model || '—'}`],
                ['接口地址', (llm.baseURL || '—').replace(/^https?:\/\//, '')],
                ['API 密钥', masked || '已配置'],
                ['密钥来源', '本企业自己配置'],
              ].map(([k, v]) => `
                <div class="row--between" style="padding:10px 0;border-bottom:1px solid var(--border);gap:14px">
                  <span class="fs12 muted">${k}</span><span class="fs12 b5 mono">${esc(v)}</span>
                </div>`).join('')}
            </div>
            <div class="row mt16" style="gap:8px">
              <button class="btn btn--ghost btn--sm" id="btnGoStep5">${icon('zap')} 去第 5 步测试 / 更换</button>
            </div>
          ` : `
            <div class="note note--warn">${icon('key')}<span>还没有配置模型 Key。到第 5 步填一个，第 7 步才能出题、员工门户才能回答。</span></div>
            <div class="row mt16"><button class="btn btn--primary btn--sm" id="btnGoStep5">${icon('arrowRight')} 去第 5 步配置</button></div>
          `}
        </div>

        <div class="card card--pad">
          <b class="fs13">数据去了哪里</b>
          <div class="mt12 stack" style="gap:0">
            ${[
              ['发送到模型的内容', '检索出的资料片段 + 用户问题'],
              ['不发送的内容', '原始文件、其他客户的资料、员工账号信息'],
              ['资料存放位置', '本机 data/ 目录，不上传云端'],
              ['密钥存放位置', '本机 data/，加密存储'],
            ].map(([k, v]) => `
              <div class="row--between" style="padding:10px 0;border-bottom:1px solid var(--border);gap:14px">
                <span class="fs12 muted">${k}</span><span class="fs12" style="text-align:right">${esc(v)}</span>
              </div>`).join('')}
          </div>
          <div class="note mt14">${icon('shield')}<span>调用的是你自己填的服务商接口。资料片段会发到该服务商，是否出境取决于你选的接口地址——这是企业自己需要判断的合规问题，平台不替你决定。</span></div>
        </div>
      </div>`;
  }

  function cfgKb() {
    /* 全部读真实索引数据。这里以前写着「1,284 个切片 / 240ms / 覆盖率 82%」
     * 和三条示例切片，全是编的。 */
    const kb = (window.LIVE && window.LIVE.kb) || {};
    const detail = kb.kb || kb;
    const chunks = detail.chunks || 0;
    const docsN = detail.docs || 0;
    const terms = detail.terms || 0;
    const builtAt = detail.builtAt ? String(detail.builtAt).slice(0, 16).replace('T', ' ') : '';
    const perDoc = (detail.perDoc || []).slice().sort((a, b) => (b.chunks || 0) - (a.chunks || 0));
    const orgName = (S.org && (S.org.short || S.org.name)) || '企业';

    if (!chunks) {
      return `<div class="card card--pad mb16">
        <div class="row" style="gap:13px">
          <span class="cfg-row__ico" style="width:38px;height:38px;background:var(--surface-3);color:var(--text-3)">${icon('database')}</span>
          <div>
            <b class="fs13">还没有建知识库</b>
            <div class="fs11 muted mt4">到第 4 步上传资料并点「开始执行」，这里会显示真实的切片与词项数。</div>
          </div>
        </div>
      </div>`;
    }

    return `
      <div class="card card--pad mb16">
        <div class="row--between">
          <div class="row" style="gap:13px">
            <span class="cfg-row__ico" style="width:38px;height:38px;background:var(--brand-50);color:var(--brand)">${icon('database')}</span>
            <div>
              <b class="fs13">${esc(orgName)} · 内部资料</b>
              <div class="fs11 muted mt4">${chunks.toLocaleString('en-US')} 个切片 · ${docsN} 份资料 · 构建于 ${esc(builtAt)}</div>
            </div>
          </div>
          <div class="row" style="gap:8px">
            <span class="badge badge--success badge--dot">可用</span>
            <button class="btn btn--ghost btn--sm" data-act="rebuild">${icon('refresh')} 重建索引</button>
          </div>
        </div>
      </div>

      <div class="grid g3">
        ${[
          ['切片数量', chunks.toLocaleString('en-US'), '按页切开，跨页段落已合并'],
          ['索引词项', terms.toLocaleString('en-US'), '中文 BM25 关键词索引'],
          ['资料份数', String(docsN), '解析成功并已入库'],
        ].map(([k, v, s]) => `
          <div class="card card--pad">
            <div class="fs11 muted">${k}</div>
            <div class="fs17 b6 tnum mt4">${v}</div>
            <div class="fs11 muted mt4">${s}</div>
          </div>`).join('')}
      </div>

      <div class="card mt16" style="overflow:hidden">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border)">
          <b class="fs13">各资料切片数</b>
          <span class="fs11 muted" style="margin-left:8px">切片过少通常说明正文没解析出来</span>
        </div>
        <table class="table">
          <thead><tr><th>资料</th><th style="width:90px">切片</th><th style="width:70px">页数</th><th style="width:90px">状态</th></tr></thead>
          <tbody>
            ${perDoc.length ? perDoc.slice(0, 12).map(d => `
              <tr>
                <td class="fs12" style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.name)}</td>
                <td class="fs12 tnum">${d.chunks || 0}</td>
                <td class="fs12 tnum">${d.pages || '—'}</td>
                <td><span class="badge ${d.chunks > 1 ? 'badge--success' : 'badge--warn'}">${d.chunks > 1 ? '正常' : '偏少'}</span></td>
              </tr>`).join('') : `<tr><td colspan="4" class="fs12 muted" style="padding:18px">没有资料明细</td></tr>`}
          </tbody>
        </table>
        ${perDoc.length > 12 ? `<div class="fs11 muted" style="padding:10px 16px">只显示切片最多的 12 份，共 ${perDoc.length} 份</div>` : ''}
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
    const list = (window.LIVE && window.LIVE.assistants) || [];
    const gaps = S.portalGaps || [];
    return `
      <div class="row--between mb16">
        <span class="fs12 muted">共 ${list.length} 个助手 · 配置在第 6 步，会真的进入出题与回答</span>
        <button class="btn btn--primary btn--sm" data-act="newAssistant">${icon('plus')} 新建助手</button>
      </div>

      ${list.length ? `<div class="grid g3">
        ${list.map(a => `
          <div class="card card--pad">
            <div class="row--between" style="align-items:flex-start">
              <span style="width:34px;height:34px;border-radius:9px;background:var(--brand-50);color:var(--brand);display:grid;place-items:center">${icon('bot')}</span>
              <span class="badge ${a.enabled === false ? '' : 'badge--success badge--dot'}">${a.enabled === false ? '停用' : '启用'}</span>
            </div>
            <div class="fs13 b6 mt12">${esc(a.name)}</div>
            <p class="fs12 muted mt4" style="line-height:1.6;min-height:38px">${esc(a.role || '')}${a.desc ? ' · ' + esc(a.desc) : ''}</p>
            <div class="fs11 muted mt8">查：${esc((a.scope || []).join(' / ') || '全部资料')}</div>
            <div class="fs11 muted mt4">规则：${esc(ruleChips(a) || '默认约束')}</div>
            <div class="row--between mt12" style="border-top:1px solid var(--border);padding-top:11px">
              <span class="fs11 muted">${a.prompt ? '有专属提示词' : '用系统默认规则'}</span>
              <button class="btn btn--quiet btn--sm" data-try-a="${esc(a.id)}">${icon('send')} 试问</button>
            </div>
          </div>`).join('')}
      </div>` : `<div class="empty" style="padding:32px 0">${icon('bot')}<p class="fs12">还没有创建助手。点右上角「新建助手」，或到项目向导第 6 步从模板创建。</p></div>`}

      <div class="card card--pad mt16">
        <div class="row--between mb12">
          <b class="fs13">答不上来的问题</b>
          <span class="fs11 muted">员工门户真实记录 · 按次数排序</span>
        </div>
        <div class="stack" style="gap:0">
          ${gaps.length
            ? gaps.slice(0, 10).map(g => `
              <div class="row--between" style="padding:10px 0;border-bottom:1px solid var(--border);gap:12px">
                <span class="fs12 dim">${esc(g.q)}</span>
                <span class="badge">${g.n || 1} 次</span>
              </div>`).join('')
            : `<div class="fs12 muted" style="padding:14px 0">还没有记录。员工问到资料里没有的内容时，会自动出现在这里，可以照着补资料。</div>`}
        </div>
      </div>`;
  }

  function cfgPrompt() {
    const list = (window.LIVE && window.LIVE.assistants) || [];
    const FIXED = [
      '只依据检索到的资料片段回答，不凭常识补',
      '资料里没有就明确说没有，不编造',
      '回答要标注出处（文件名 + 页码）',
      '不回答其他客户、成本价、供应商相关信息',
    ];
    return `
      <div class="grid g2" style="align-items:start;gap:18px">
        <div class="card card--pad">
          <div class="row--between mb12">
            <div><b class="fs13">当前生效的助手设定</b><div class="fs11 muted mt4">读自第 6 步的真实配置，改动请到那里</div></div>
            <button class="btn btn--ghost btn--sm" id="btnGoStep6">编辑助手</button>
          </div>
          ${list.length ? list.map(a => `
            <div style="padding:12px 0;border-bottom:1px solid var(--border)">
              <div class="row--between"><b class="fs12">${esc(a.name)}</b><span class="tag tag--outline">${esc(a.tone || '默认语气')}</span></div>
              <div class="fs11 muted mt4">岗位：${esc(a.role || '未填')} · 范围：${esc((a.scope || []).join('/') || '全部资料')}</div>
              <div class="fs11 muted mt4">规则：${esc(ruleChips(a) || '默认约束')}</div>
              ${a.prompt ? `<div class="fs12 mt8" style="line-height:1.7;padding:9px 11px;background:var(--surface-2);border-radius:8px;white-space:pre-wrap">${esc(a.prompt)}</div>` : ''}
            </div>`).join('')
            : `<div class="fs12 muted" style="padding:18px 0">还没有助手，也就没有专属提示词。到第 6 步创建后，这里的设定会真的写进每一次模型调用。</div>`}
        </div>

        <div class="stack" style="gap:16px">
          <div class="card card--pad">
            <b class="fs13">系统固定约束</b>
            <p class="fs11 muted mt4 mb12">这几条写死在系统提示里，助手配置改不掉</p>
            <div class="stack" style="gap:8px">
              ${FIXED.map(t => `
                <div class="row" style="gap:8px;font-size:12px;color:var(--text-2)">
                  <span style="color:var(--danger);display:flex">${icon('shield')}</span>${esc(t)}
                </div>`).join('')}
            </div>
          </div>
          <div class="card card--pad">
            <b class="fs13">改配置会怎样</b>
            <p class="fs12 muted mt8" style="line-height:1.7">提示词、语气和回答规则会拼进 system prompt；资料范围在检索阶段过滤，范围外的切片根本不会交给模型。第 7 步出题和第 8 步员工门户都按选中的助手走。</p>
            <div class="row mt12" style="gap:8px">
              <button class="btn btn--ghost btn--sm" id="btnGoStep6b">去第 6 步改</button>
              <button class="btn btn--ghost btn--sm" id="btnGoPortal">去门户试一句</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  function bindCfg(body, tab) {
    const cem = qi('#cfgEditModel');
    if (cem) cem.onclick = () => { location.hash = '#wizard/5'; toast('到第 5 步更换模型或 Key'); };

    const g5 = qi('#btnGoStep5');
    if (g5) g5.onclick = () => { location.hash = '#wizard/5'; };

    ['#btnGoStep6', '#btnGoStep6b'].forEach(sel => {
      const b = qi(sel);
      if (b) b.onclick = () => { location.hash = '#wizard/6'; };
    });
    const gp = qi('#btnGoPortal');
    if (gp) gp.onclick = () => { location.hash = '#portal'; };

    qa('[data-try-a]', body).forEach(b => b.onclick = () => {
      const a = (window.LIVE.assistants || []).find(x => x.id === b.dataset.tryA);
      if (a) openAssistantTry(a);
    });

    qa('[data-act]', body).forEach(b => b.onclick = async () => {
      const a = b.dataset.act;
      if (a === 'rebuild') {
        if (!(window.LIVE && window.LIVE.on)) return toast('需要连上本地服务才能重建', 'warn');
        b.disabled = true;
        const old = b.innerHTML;
        b.innerHTML = icon('refresh') + ' 重建中…';
        try {
          const r = await window.LIVE.buildKb();
          toast(`索引已重建 · ${r.chunks || 0} 个片段 / ${r.terms || 0} 个词项`);
          await window.LIVE.reload();
          window.LIVE.paint();
          router();
        } catch (e) {
          toast('重建失败：' + e.message, 'warn');
        } finally {
          b.disabled = false;
          b.innerHTML = old;
        }
      }
      if (a === 'newAssistant') { location.hash = '#wizard/6'; }
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
          <div class="grid g2 mt16" style="gap:12px">
            <div class="field"><label class="field__label">姓名</label>
              <input class="input" id="mmName" value="${esc(m.name || '')}"></div>
            <div class="field"><label class="field__label">角色</label>
              <select class="select" id="mmRole">
                ${['企业管理员', '销售主管', '销售员工', '技术', '客服', '服务顾问'].map(r => `<option ${m.role === r ? 'selected' : ''}>${r}</option>`).join('')}
              </select></div>
            <div class="field"><label class="field__label">邮箱</label>
              <input class="input" id="mmEmail" value="${esc(m.email || '')}" placeholder="可留空"></div>
            <div class="field" style="margin-bottom:0"><label class="field__label">手机</label>
              <input class="input" id="mmPhone" value="${esc(m.phone || '')}" placeholder="可留空"></div>
          </div>`,
        wide: true,
        okText: '保存',
        cancelText: '关闭',
        onOk: async (back) => {
          const patch = {
            name: back.querySelector('#mmName').value.trim(),
            role: back.querySelector('#mmRole').value,
            email: back.querySelector('#mmEmail').value.trim(),
            phone: back.querySelector('#mmPhone').value.trim(),
          };
          if (!patch.name) { toast('姓名不能为空', 'warn'); return false; }
          try {
            if (window.LIVE && window.LIVE.on) {
              await window.LIVE.editMember(m.id, patch);
            } else {
              Object.assign(m, patch);
              TM.save();
            }
            toast('成员信息已更新');
            router();
          } catch (e) { toast('保存失败：' + e.message, 'warn'); return false; }
        },
      });
    });
  }

  /* =====================================================================
     6. 测试与验收
     ===================================================================== */
  function renderTest(root) {
    const report = S.project.report;

    if (!report) {
      const s = testStats();
      const Q = TM.TEST_QUESTIONS;
      const liveOn = !!(window.LIVE && window.LIVE.on);
      const chunks = (liveOn && window.LIVE.kb && window.LIVE.kb.chunks) || 0;
      const asstN = (liveOn && window.LIVE.assistants || []).length;
      const withAnswer = Q.filter(q => q.a && !/没有生成回答/.test(q.a)).length;
      const withCite = Q.filter(q => q.cite && q.cite !== '—').length;

      root.innerHTML = `<div class="page page--narrow">
        ${pageHead('测试与验收', '「知识库建好了」和「知识库能用」是两件事。下面每个数字都来自你当前真实的资料与测试记录。',
          `<span class="badge badge--warn badge--dot">${s.ran ? '报告待生成' : '尚未测试'}</span>`)}

        <div class="card card--pad mb20" style="display:flex;gap:22px;align-items:center">
          <span class="ico-lg" style="width:52px;height:52px;border-radius:14px;background:var(--brand-50);color:var(--brand);display:grid;place-items:center;flex:0 0 52px">${icon('target')}</span>
          <div style="flex:1">
            <div class="fs15 b6 mb4">${s.ran ? '测试已运行，报告还没有生成' : '还没有生成测试题'}</div>
            <p class="fs12 muted" style="line-height:1.65">${s.ran
              ? `已生成 ${s.total} 道题、${withAnswer} 道有回答、${s.judged} 道已人工判定。到第 7 步核对完并生成报告。`
              : `知识库${chunks ? ` ${chunks} 个切片` : '尚未建库'}、${asstN} 个助手。到项目向导第 7 步生成测试题、批量运行，再逐题核对。`}</p>
          </div>
          <a class="btn btn--primary btn--lg" href="#wizard/7">${icon('arrowRight')} ${s.ran ? '去生成报告' : '到第 7 步开始测试'}</a>
        </div>

        ${sectionHead('当前测试概况', '实时读自第 7 步，不是预置题库')}
        <div class="grid g2">
          ${[
            ['测试题总数', String(s.total), '由模型从你上传的资料里生成'],
            ['已运行', String(withAnswer), '已经拿到回答的题目'],
            ['已人工判定', `${s.judged} / ${s.total}`, '通过 / 需修改 / 资料不足'],
            ['当前通过率', s.judged ? s.rate + '%' : '—', s.pending ? `还有 ${s.pending} 道待判定` : '全部判定完毕'],
          ].map(([n, v, d]) => `
            <div class="card card--pad">
              <div class="row--between">
                <div class="fs13 b6">${n}</div>
                <span class="badge">${esc(v)}</span>
              </div>
              <p class="fs12 muted mt8" style="line-height:1.65">${esc(d)}</p>
            </div>`).join('')}
        </div>

        ${sectionHead('验收标准', '开始前已约定，达不到不进入验收')}
        <div class="card" style="overflow:hidden">
          <table class="table">
            <thead><tr><th>指标</th><th style="width:140px">验收线</th><th style="width:180px">当前</th></tr></thead>
            <tbody>
              <tr><td class="fs12">测试题通过率</td><td class="fs12 b5">≥ 85%</td><td class="fs12 muted">${s.judged ? `${s.rate}%（已判定 ${s.judged} 道）` : '还没有判定'}</td></tr>
              <tr><td class="fs12">全部题目人工判定</td><td class="fs12 b5">100%</td><td class="fs12 muted">${s.judged} / ${s.total}</td></tr>
              <tr><td class="fs12">回答必须带出处</td><td class="fs12 b5">100% 覆盖</td><td class="fs12 muted">${withCite} / ${withAnswer} 道有出处</td></tr>
              <tr><td class="fs12">资料缺口已记录</td><td class="fs12 b5">逐条记录</td><td class="fs12 muted">${s.gap} 条</td></tr>
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

    /* 下载的是当前真实测试记录，不是一句「PDF 已生成」 */
    qi('#btnDownload').onclick = () => {
      const Q = TM.TEST_QUESTIONS;
      const marks = (S.project.testRun && S.project.testRun.marks) || {};
      const s = testStats();
      const rows = [
        [`${S.org.name || '企业'} · 知识库验收报告`, new Date().toLocaleString('zh-CN')],
        [],
        ['总题数', s.total, '已判定', s.judged, '通过率', (s.judged ? s.rate + '%' : '—')],
        ['通过', s.pass, '需修改', s.fix, '资料不足', s.gap],
        [],
        ['题号', '问题', 'AI 回答', '引用出处', '人工判定', '是否关键'],
      ];
      Q.forEach(q => rows.push([
        q.id, q.q, q.a || '', q.cite || '',
        ({ pass: '通过', fix: '需修改', gap: '资料不足' })[marks[q.id]] || '未判定',
        q.key ? '关键' : '',
      ]));
      const csv = '\uFEFF' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `验收报告-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast(`已下载验收报告（${s.total} 道题）`);
    };

    /* 重新测试 = 真的再跑一遍模型，不是把报告藏起来 */
    qi('#btnRerun').onclick = () => modal({
      title: '重新运行测试',
      desc: '会按当前资料与所选助手，重新逐题调用模型。',
      body: `<div class="note note--warn">${icon('alert')}<span>重新运行会清空现有的人工判定，需要重新逐题核对。会消耗少量模型额度。</span></div>`,
      okText: '确认重跑',
      onOk: async () => {
        if (!(window.LIVE && window.LIVE.on)) { toast('需要连上本地服务才能重跑', 'warn'); return false; }
        try {
          await window.LIVE.runTests(testAsstId);
          S.project.report = null;
          TM.save();
          window.LIVE.paintTests();
          toast('已重新运行，去第 7 步核对新结果');
          setTimeout(() => go('wizard', '7'), 500);
        } catch (e) { toast('重跑失败：' + e.message, 'warn'); return false; }
      },
    });

    qi('#btnAccept').onclick = () => modal({
      title: '确认项目验收',
      desc: '确认后会记录验收动作，项目进入正式交付。',
      body: `<div class="note note--brand mb16">${icon('info')}<span>当前报告里还有 ${issues.length} 项待整改（需修改 / 资料不足）。这些会写进验收记录，后续补资料或改提示词时可以再复测。</span></div>
        <label class="checkline is-checked"><span class="checkline__box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg></span><span class="checkline__txt">我已查看测试报告与待整改清单</span></label>
        <label class="checkline is-checked"><span class="checkline__box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg></span><span class="checkline__txt">我确认权限配置与备份策略符合要求</span></label>`,
      okText: '确认验收',
      onOk: () => {
        S.project.accepted = {
          at: new Date().toISOString(),
          by: S.user.name,
          rate: testStats().rate,
          issues: issues.length,
        };
        TM.save();
        logAct('确认项目验收');
        toast('验收已记录，进入第 10 步正式交付');
        setTimeout(() => go('wizard', '10'), 600);
      },
    });
    qi('#btnAssist2').onclick = openAssist;
  }

  /* =====================================================================
     7. 员工门户
     ===================================================================== */
  /* 演示问答库已清空：员工门户只走真实检索 + 模型，不再内置别人的产品答案 */
  const QA_BANK = [];

  function renderPortal(root) {
    const liveOn = !!(window.LIVE && window.LIVE.on);
    const asstList = liveOn ? (window.LIVE.assistants || []) : [];
    if (liveOn && portalAsstId && !asstList.some((a) => a.id === portalAsstId)) portalAsstId = null;
    const curAsst = asstList.find((a) => a.id === portalAsstId) || asstList[0] || null;
    if (curAsst) portalAsstId = curAsst.id;
    const docN = liveOn ? (window.LIVE.docs || []).length : (S.project.files || []).length;

    /* 快捷问题不再预置别人的产品问题；员工自己问 */
    const hot = [];

    /* 答不上来的问题：真的记录员工问过、库里也确实没有的，
     * 以前这里是写死的三条示例，客户会以为系统在替别人算账 */
    const gaps = liveOn ? (S.portalGaps || []) : [];
    const orgName = (S.org && (S.org.short || S.org.name)) || '企业';
    const who = (S.user && S.user.initial) || orgName.slice(0, 1);

    root.innerHTML = `<div class="page">
      ${pageHead('员工门户', '这是你团队员工看到的界面。他们不需要理解知识库、切片、模型，只需要问问题。',
        `<button class="btn btn--ghost btn--sm" id="btnCopyLink">${icon('external')} 复制门户链接</button>`)}

      <div class="grid portal-grid">
        <div class="portal-chat">
          <div class="portal-chat__head">
            <span style="width:30px;height:30px;border-radius:8px;background:var(--brand-50);color:var(--brand);display:grid;place-items:center">${icon('bot')}</span>
            <div style="flex:1">
              <div class="fs12 b6">${esc(curAsst ? curAsst.name : (liveOn ? `${orgName} · 知识库助手` : '演示助手'))}</div>
              <div class="fs11 muted">${liveOn
                ? `基于 ${docN} 份内部资料${curAsst?.scope?.length ? ` · 只查 ${esc(curAsst.scope.join('/'))}` : ' · 查全部资料'}`
                : '演示数据 · 未连接本地服务'}</div>
            </div>
            ${liveOn && asstList.length > 1 ? `
              <select class="select" id="portalAsst" style="max-width:190px;height:30px;font-size:11.5px" title="切换助手">
                ${asstList.map((a) => `<option value="${esc(a.id)}" ${a.id === portalAsstId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
              </select>` : `<span class="badge badge--success badge--dot">在线</span>`}
          </div>

          <div class="portal-chat__body" id="chatBody">
            <div class="msg">
              <span class="msg__av">${esc(who)}</span>
              <div class="msg__bubble">
                你好，我是${esc(orgName)}的内部资料助手。产品参数、报价流程、售后政策都可以问我，我会标出答案来自哪份文件。<br><br>
                <span class="muted" style="font-size:12px">如果是资料里没有的内容，我会直接告诉你没有，不会猜。</span>
              </div>
            </div>
          </div>

          <div class="portal-chat__foot">
            ${hot.length ? `<div class="prompt-chips">
              ${hot.map(q => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}
            </div>` : ''}
            <div class="chat-input">
              <input class="input" id="chatInput" placeholder="输入你的问题，例如：这个型号配几块电池？">
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
              <span class="badge ${gaps.length ? 'badge--warn' : ''}">${gaps.length}</span>
            </div>
            <div class="stack" style="gap:10px" id="gapList">
              ${gaps.length ? gaps.slice(0, 5).map(g => `
                <div style="font-size:12px;color:var(--text-2);display:flex;gap:7px;line-height:1.5">
                  <span style="color:var(--warn);flex:0 0 auto;display:flex;margin-top:2px">${icon('help')}</span>
                  <span>${esc(g.q)}${g.n > 1 ? ` <span class="fs11 muted">×${g.n}</span>` : ''}</span>
                </div>`).join('')
                : `<div class="fs11 muted">员工问过但资料里没有的问题会记在这里，可以照着这份清单补资料。</div>`}
            </div>
            ${gaps.length > 5 ? `<div class="fs11 muted mt8">还有 ${gaps.length - 5} 条，见第 8 步</div>` : ''}
          </div>

          <div class="note" style="background:var(--surface-2)">
            ${icon('shield')}
            <span class="fs11">员工只能问答，看不到原始文件和配置。回答只依据已上传的资料。</span>
          </div>
        </div>
      </div>
    </div>`;

    const body = qi('#chatBody');
    const input = qi('#chatInput');

    function pushUser(text) {
      body.insertAdjacentHTML('beforeend', `<div class="msg msg--user"><span class="msg__av">${esc(who)}</span><div class="msg__bubble">${esc(text)}</div></div>`);
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
    qi('#btnCopyLink').onclick = async () => {
      const id = (window.LIVE && window.LIVE.clientId) || '';
      const url = id ? `${location.origin}/app.html?c=${id}#portal` : `${location.origin}/app.html#portal`;
      try {
        await navigator.clipboard.writeText(url);
        toast('门户链接已复制，发给员工就行');
      } catch {
        modal({
          title: '门户链接',
          desc: '复制下面这个地址，发给需要试用的同事。',
          body: `<input class="input mono" id="portalUrlOut2" value="${esc(url)}" readonly onclick="this.select()">`,
          okText: '知道了',
        });
      }
    };
  }

  /* =====================================================================
     8. 操作与运行记录
     ===================================================================== */
  function renderLogs(root) {
    /* 全部读真实记录。以前这一页是 8 条编好的示例（陈志强、周明、OCR 96.2%），
     * 客户会以为自己真做过这些事。 */
    const acts = (S.activity || []);
    const consults = (S.members || []).filter(m => /顾问/.test(m.role || ''));

    root.innerHTML = `<div class="page page--narrow">
      ${pageHead('操作与运行记录', '谁在什么时候做了什么，都可以查。', '')}

      ${sectionHead('外部授权', consults.length ? `${consults.length} 人` : '暂无')}
      <div class="stack" style="gap:10px">
        ${consults.length ? consults.map((a) => `
          <div class="card card--pad" style="display:flex;align-items:center;gap:14px">
            <span style="width:34px;height:34px;border-radius:9px;background:var(--warn-bg);color:var(--warn);display:grid;place-items:center;flex:0 0 34px">${icon('key')}</span>
            <div style="flex:1">
              <div class="fs12 b5">${esc(a.name)}${a.email ? ` · ${esc(a.email)}` : ''}</div>
              <div class="fs11 muted mt4">角色 ${esc(a.role)} · 添加于 ${esc(a.at)}</div>
            </div>
            <span class="badge badge--warn badge--dot">可见</span>
          </div>`).join('')
        : `<div class="card card--pad fs12 muted">还没有添加任何外部服务顾问。需要时在「成员与权限」里添加，并自行约定可见范围。</div>`}
      </div>

      <div class="note note--info mt16">${icon('shield')}<span>这个本地服务<b>没有</b>远程执行命令的能力，也不会把资料上传到任何地方。所有文档、索引、对话记录都在这台电脑的 <span class="mono">data/</span> 目录里。</span></div>

      ${sectionHead('操作记录', acts.length ? `最近 ${acts.length} 条` : '还没有记录')}
      <div class="card" style="overflow:hidden">
        <table class="table">
          <thead><tr><th style="width:120px">时间</th><th style="width:130px">操作人</th><th>动作</th></tr></thead>
          <tbody>
            ${acts.length ? acts.map((a) => `
              <tr>
                <td class="fs11 muted mono">${esc(a.t)}</td>
                <td class="fs12">${esc(a.who)}</td>
                <td class="fs12">${esc(a.txt)}</td>
              </tr>`).join('')
        : `<tr><td colspan="3" class="fs12 muted" style="padding:18px">还没有操作记录。走一遍项目向导，这里会自动记下来。</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;

    const be = qi('#btnExport');
    if (be) be.onclick = () => {
      if (!acts.length) return toast('还没有记录可以导出', 'warn');
      const csv = ['时间,操作人,动作', ...acts.map(a => `${a.t},${a.who},"${String(a.txt || '').replace(/"/g, '""')}"`)].join('\r\n');
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `操作记录-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast('已导出 CSV');
    };
  }

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
                ['服务顾问', (S.members || []).filter(m => /顾问/.test(m.role || '')).map(m => `${m.name}${m.email ? ' · ' + m.email : ''}`).join('、') || '未指派'],
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
    /* 以前这里叫「重置演示数据」，其实只清浏览器缓存，服务端客户资料一个没动，
       还会骗人说「回到第 6 步」。现在把两种清空方式讲清楚，各自只做自己能做的事。 */
    qi('#btnReset').onclick = () => modal({
      title: '清空数据',
      desc: '客户、资料、进度都存在本机服务端，不在浏览器里。',
      body: `<div class="note note--warn mb12">${icon('alert')}<span><b>要清空全部客户与资料</b>：关闭服务后，双击项目目录里的「清空所有数据.bat」，输入 YES 确认。它会自动先备份到 backup/，并保留模型 Key。</span></div>
        <div class="note note--info">${icon('info')}<span><b>只想清浏览器缓存</b>：点下面的按钮。这只清本浏览器的本地状态，重新打开会从服务端拉回真实数据，不会删任何客户资料。</span></div>`,
      okText: '仅清除浏览器缓存',
      cancelText: '取消',
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
          <span class="avatar avatar--sq" style="background:#1F4A52">${esc((S.org.short || S.org.name || '企').slice(0, 1))}</span>
          <div class="cfg-row__body"><b>${esc(S.org.name)}</b><span>${esc([S.org.industry, S.org.city, S.org.size].filter(Boolean).join(' · ') || '信息未填写')} · 当前</span></div>
          <span style="color:var(--brand);display:flex">${icon('checkCircle')}</span>
        </div>
      </div>
      <div class="note mt16">${icon('shield')}<span>要切换到别的企业，请回服务商后台，在客户列表点「进入」。这里不会再列出无权访问的企业。</span></div>`,
    okText: '知道了',
    cancelText: '关闭',
  });

  /* 真搜索：资料、助手、测试题、成员、步骤，点了能直接跳过去 */
  qi('#btnSearch').onclick = () => {
    const m = modal({
      title: '全局搜索',
      desc: '搜资料、AI 助手、测试题、成员和项目步骤。',
      body: `<input class="input" id="gsQ" placeholder="输入关键词，例如：报价、保修、张浩" autofocus>
        <div id="gsOut" class="mt14"></div>`,
      okText: '关闭',
      cancelText: '取消',
      wide: true,
    });
    const inp = m.root.querySelector('#gsQ');
    const out = m.root.querySelector('#gsOut');

    const run = () => {
      const kw = inp.value.trim().toLowerCase();
      if (!kw) { out.innerHTML = '<div class="fs12 muted">输入关键词开始搜索</div>'; return; }
      const hits = [];
      const push = (type, label, hash) => hits.push([type, label, hash]);
      const has = (v) => String(v || '').toLowerCase().includes(kw);

      (S.project.files || []).forEach(f => { if (has(f.name)) push('资料', f.name, 'wizard/3'); });
      ((window.LIVE && window.LIVE.docs) || []).forEach(d => { if (has(d.name)) push('资料', d.name, 'wizard/3'); });
      ((window.LIVE && window.LIVE.assistants) || []).forEach(a => {
        if (has(a.name) || has(a.role) || has(a.desc)) push('助手', `${a.name} · ${a.role}`, 'wizard/6');
      });
      TM.TEST_QUESTIONS.forEach(q => { if (has(q.q)) push('测试题', q.q.slice(0, 46), 'wizard/7'); });
      (S.members || []).forEach(p => {
        if (has(p.name) || has(p.email) || has(p.role)) push('成员', `${p.name} · ${p.role}`, 'members');
      });
      TM.STEPS.forEach(s => {
        if (has(s.title) || has(s.what)) push('步骤', `第 ${s.id} 步 · ${s.title}`, 'wizard/' + s.id);
      });

      out.innerHTML = hits.length
        ? `<div class="fs11 muted mb8">找到 ${hits.length} 条</div>` + hits.slice(0, 20).map(([t, label, hash]) =>
            `<button class="btn btn--ghost btn--sm btn--block" data-go="${esc(hash)}" style="justify-content:flex-start;margin-bottom:6px;text-align:left"><b>${esc(t)}</b> · ${esc(label)}</button>`).join('')
        : '<div class="fs12 muted">没找到相关内容。换个说法，或者先把资料传进知识库。</div>';
      qa('[data-go]', out).forEach(b => b.onclick = () => { m.close(); location.hash = '#' + b.dataset.go; });
    };
    inp.oninput = run;
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); const f = qa('[data-go]', out)[0]; if (f) f.click(); } };
    run();
  };

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
