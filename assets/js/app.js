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
    qi('#userName').textContent = S.user.name;
    qi('#userAvatar').textContent = S.user.initial;
  }

  /* ---------------------------------------------------------------------
     通用片段
     --------------------------------------------------------------------- */
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

    root.innerHTML = `<div class="page">

      <div class="hero-strip">
        <div class="hero-strip__txt">
          <div class="hero-strip__eyebrow">进行中 · 项目编号 ${esc(S.project.id)}</div>
          <h2>${esc(S.project.name)}：还剩 ${remain} 步</h2>
          <p>当前在第 ${cur.id} 步「${esc(cur.title)}」。${cur.id === 6 ? '配置已确认，等待执行创建助手。' : '按向导继续即可，遇到卡点可以随时申请人工协助。'}计划 12 月 8 日完成交付。</p>
          <div class="row mt16">
            <a class="btn btn--primary" href="#wizard/${cur.id}">继续第 ${cur.id} 步 ${icon('arrowRight')}</a>
            <a class="btn" href="#test" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);color:#fff">查看测试与验收</a>
          </div>
        </div>
        <div class="hero-strip__stats">
          <div class="hero-strip__stat"><b>${p.pct}%</b><span>整体进度</span></div>
          <div class="hero-strip__stat"><b>${p.done}/${p.total}</b><span>已完成步骤</span></div>
          <div class="hero-strip__stat"><b>12-08</b><span>计划交付</span></div>
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
            <span>预计 3 天完成当前阶段</span>
          </div>
          <div class="proj-card__foot">
            <div class="row" style="gap:-6px">
              <span class="avatar" style="width:24px;height:24px;font-size:10px;background:#2C5866">陈</span>
              <span class="avatar" style="width:24px;height:24px;font-size:10px;background:#7A5C2E;margin-left:-6px">李</span>
              <span class="avatar" style="width:24px;height:24px;font-size:10px;background:#3E4F63;margin-left:-6px">周</span>
              <span class="fs12 muted" style="margin-left:8px">3 人参与</span>
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

      ${sectionHead('需要你处理', `${TODO.length} 项待办`)}
      <div class="grid g2" style="align-items:start">
        <div class="card card--pad">
          ${TODO.map(t => `
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
            ${ACTIVITY.slice(0, 5).map(a => `
              <div class="tl-item ${a.type === 'warn' ? '' : 'tl-item--done'}">
                <b>${esc(a.txt)}</b>
                <span>${esc(a.who)} · ${esc(a.t)}</span>
              </div>`).join('')}
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
        `项目编号 ${S.project.id} · 服务顾问 ${S.project.owner} · 计划交付 2026-12-08`,
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
      if (step.id === 8) syncStep8Checks(step);
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
              ? `<div class="note note--warn">${icon('lock')}<span>完成第 7 步「知识库测试」后即可邀请员工试用。</span></div>`
              : inviteBox()}
          </div>` : ''}

          ${step.exec && step.id !== 7 ? `
          <div class="step-block">
            <div class="step-block__label">自动执行</div>
            <div class="exec-box">
              <div class="exec-box__top">
                <span class="exec-box__ico">${icon(step.role === '客户授权' ? 'key' : 'zap')}</span>
                <div style="flex:1">
                  <b>${esc(step.exec.label)}</b>
                  <span>${esc(step.exec.desc)}</span>
                </div>
                <button class="btn btn--ghost btn--sm" id="btnExec" ${st === 'done' || saved.executed || st === 'locked' ? 'disabled' : ''}>
                  ${saved.executed ? icon('check') + ' 已执行' : icon('play') + ' 开始执行'}
                </button>
              </div>
              <div class="console" id="console" style="display:${saved.executed ? 'block' : 'none'}">
                ${saved.executed ? buildLogs(step).map(l => `<div><span class="ts">${'10:2' + Math.floor(Math.random() * 9)}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}</span><span class="${l[0]}">${esc(l[1])}</span></div>`).join('') : ''}
              </div>
              ${!saved.executed && st !== 'locked' ? `<div class="fs11 muted mt8">执行前请确认：这一步只读取你在本步骤中提供的内容，不会访问其他文件。</div>` : ''}
            </div>
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
    if (be) be.onclick = () => runExec(step, be);

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
    // 第 8 步：员工邀请与反馈
    if (step.id === 8) bindInviteBox(step);
  }

  /* 第 3、4 步的日志跟着实际资料走，避免数字对不上 */
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

    qa('[data-del]').forEach(btn => btn.onclick = () => {
      const id = btn.dataset.del;
      const f = (S.project.files || []).find(x => x.id === id);
      if (!f) return;
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

  function addFiles(list, step) {
    if (!list || !list.length) return;
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
    if (setCheck(step, 'c1', has('产品资料'))) reverted = true;
    if (setCheck(step, 'c2', has('业务流程') || has('销售资料'))) reverted = true;
    if (setCheck(step, 'c3', files.length > 0)) reverted = true;
    return reverted;
  }

  /* ---------------------------------------------------------------------
     第 7 步：测试工作台
     --------------------------------------------------------------------- */
  let testFilter = 'key';   // key | all

  function testStats() {
    const run = S.project.testRun;
    const Q = TM.TEST_QUESTIONS;
    const marks = run.marks || {};
    let pass = 0, fix = 0, gap = 0;
    Q.forEach(q => {
      const m = marks[q.id] || q.r;
      if (m === 'pass') pass++;
      else if (m === 'fix') fix++;
      else gap++;
    });
    const keyTotal = Q.filter(q => q.key).length;
    const keyDone = Q.filter(q => q.key && marks[q.id]).length;
    return {
      ran: !!run.ran,
      pass, fix, gap,
      rate: Math.round(pass / Q.length * 100),
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
      <div class="test-stats__i test-stats__i--rate"><b>${s.rate}%</b><span>${s.keyDone === s.keyTotal ? '通过率' : '预计通过率'}</span></div>
    </div>`;
  }

  function testBench() {
    const run = S.project.testRun;
    const Q = TM.TEST_QUESTIONS;

    if (!run.generated) {
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
          ? `<div class="fs12 ${s.keyDone === s.keyTotal ? 'dim' : 'muted'}">
               ${s.keyDone === s.keyTotal
                 ? `关键题已全部核对 · 通过率 <b style="color:${s.rate >= 85 ? 'var(--success)' : 'var(--warn)'}">${s.rate}%</b>（验收线 85%）`
                 : `还有 ${s.keyTotal - s.keyDone} 道关键题待核对`}
             </div>
             <div style="flex:1"></div>
             ${S.project.report
               ? `<a class="btn btn--ghost btn--sm" href="#test">${icon('fileText')} 查看测试报告</a>`
               : `<button class="btn btn--primary btn--sm" id="btnMakeReport" ${s.keyDone === s.keyTotal ? '' : 'disabled'}>${icon('fileText')} 生成测试报告</button>`}`
          : `<span class="fs11 muted">先批量运行，再核对关键题</span>`}
      </div>
    `;
  }

  function testRow(q, run, marks) {
    const m = marks[q.id] || (run.ran ? q.r : '');
    const isKey = q.key;
    const markCls = m === 'pass' ? 'is-pass' : m === 'fix' ? 'is-fix' : m === 'gap' ? 'is-gap' : '';

    return `<div class="tq ${run.ran ? '' : 'tq--pending'}" data-q="${q.id}">
      <div class="tq__head">
        <span class="tq__no">${String(q.id).padStart(2, '0')}</span>
        <span class="tag tag--outline">${esc(q.cat)}</span>
        ${isKey ? `<span class="badge badge--warn">关键</span>` : ''}
        <div style="flex:1"></div>
        ${run.ran
          ? `<span class="badge ${m === 'pass' ? 'badge--success' : m === 'fix' ? 'badge--warn' : 'badge--danger'}" data-qbadge>${m === 'pass' ? '通过' : m === 'fix' ? '需修改' : '资料不足'}</span>`
          : `<span class="badge">待运行</span>`}
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
      // 再点一次同一判定 = 取消，回落到系统判定
      if (run.marks[qid] === mark) delete run.marks[qid];
      else run.marks[qid] = mark;
      TM.save();

      // 局部刷新该行
      const row = qi(`.tq[data-q="${qid}"]`);
      if (row) {
        qa('.mark-btn', row).forEach(x => {
          x.classList.toggle('is-on', x.dataset.mark === run.marks[qid]);
        });
        const badge = qi('[data-qbadge]', row);
        const q = Q.find(x => x.id === qid);
        const eff = run.marks[qid] || q.r;
        if (badge) {
          badge.className = 'badge ' + (eff === 'pass' ? 'badge--success' : eff === 'fix' ? 'badge--warn' : 'badge--danger');
          badge.textContent = eff === 'pass' ? '通过' : eff === 'fix' ? '需修改' : '资料不足';
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
    toast(`${Q.length} 题运行完成，请核对关键题`);
  }

  function syncTestChecks(step) {
    if (!step || step.id !== 7) return;
    const s = testStats();
    let reverted = false;
    if (setCheck(step, 'c1', s.ran)) reverted = true;
    if (setCheck(step, 'c2', s.keyDone === s.keyTotal)) reverted = true;
    if (setCheck(step, 'c3', s.ran && s.rate >= 85)) reverted = true;
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
     第 8 步：员工试用（邀请成员 + 提问计数 + 反馈）
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
          <div class="fs11 muted mt4">受邀成员只能使用助手，看不到配置与原始资料</div>
        </div>
        <button class="btn btn--ghost btn--sm" id="btnInvite">${icon('userPlus')} 邀请员工</button>
      </div>
      <div class="stack" style="gap:7px">
        ${staff.length ? staff.map(m => `
          <div class="doc-item">
            <span class="avatar" style="width:30px;height:30px;font-size:11px;background:${m.status === 'active' ? '#2C5866' : '#7A5C2E'}">${esc(m.name.slice(0, 1))}</span>
            <div class="doc-item__body">
              <b>${esc(m.name)} · ${esc(m.role)}</b>
              <span>${esc(m.email)} · 邀请于 ${esc(m.at)}</span>
            </div>
            <span class="badge ${m.status === 'active' ? 'badge--success badge--dot' : ''}">${m.status === 'active' ? '已激活' : '待接受'}</span>
            ${m.status !== 'active' ? `<button class="btn btn--quiet btn--sm" data-reinvite="${esc(m.id)}">重发</button>` : ''}
            <button class="btn btn--quiet btn--sm doc-item__del" data-remove="${esc(m.id)}" title="移除">${icon('x')}</button>
          </div>`).join('') : `<div class="empty" style="padding:22px 0">${icon('users')}<p class="fs12">还没有邀请员工。试用期的反馈比测试题更真实。</p></div>`}
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

    qa('[data-reinvite]').forEach(b => b.onclick = () => {
      const m = (S.members || []).find(x => x.id === b.dataset.reinvite);
      toast(`邀请邮件已重发给 ${m ? m.email : '对方'}`);
    });

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
        renderStepPanel();
        toast('反馈已记录');
      },
    });
  }

  function openInvite(step) {
    modal({
      title: '邀请员工试用',
      desc: '受邀成员只能使用助手，看不到配置与原始资料。',
      body: `<div class="field"><label class="field__label">姓名 <i class="req">*</i></label>
          <input class="input" id="invName" placeholder="例如 张浩"></div>
        <div class="field"><label class="field__label">企业邮箱 <i class="req">*</i></label>
          <input class="input" id="invEmail" placeholder="name@hensen-tools.com"></div>
        <div class="field" style="margin-bottom:0"><label class="field__label">角色</label>
          <select class="select" id="invRole"><option>销售员工</option><option>销售主管</option><option>技术</option><option>客服</option></select></div>`,
      okText: '发送邀请',
      onOk: (back) => {
        const name = back.querySelector('#invName').value.trim();
        const email = back.querySelector('#invEmail').value.trim();
        const role = back.querySelector('#invRole').value;
        if (!name) { toast('填一下姓名', 'warn'); return false; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('邮箱格式不对', 'warn'); return false; }
        if ((S.members || []).some(x => x.email.toLowerCase() === email.toLowerCase())) {
          toast('这个邮箱已经在成员列表里了', 'warn');
          return false;
        }
        S.members.push({ id: 'm' + Date.now(), name, email, role, status: 'pending', at: TM.fmtDate(new Date()) });
        TM.save();
        if (step) renderStepPanel();
        else router();
        toast(`邀请已发送给 ${name}`);
      },
    });
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
    const active = people.filter(p => p.status === 'active').length;
    const pending = people.filter(p => p.status === 'pending').length;
    const roles = new Set(people.map(p => p.role)).size;

    const statusCell = (s) => s === 'active'
      ? '<span class="badge badge--success badge--dot">在线</span>'
      : s === 'limited'
        ? '<span class="badge badge--warn badge--dot">受限访问</span>'
        : '<span class="badge">待接受</span>';

    root.innerHTML = `<div class="page page--narrow">
      ${pageHead('成员与权限', '谁能看什么、谁能改什么。服务顾问只有在你授权后才能进入本项目。',
        `<button class="btn btn--primary btn--sm" id="btnInviteM">${icon('userPlus')} 邀请成员</button>`)}

      <div class="grid g4 mb20">
        ${[
          ['成员总数', String(people.length), `含 1 位外部服务顾问`],
          ['已激活', String(active), pending ? `${pending} 人待接受邀请` : '全部已接受'],
          ['角色数', String(roles), '管理员 / 主管 / 员工 / 顾问'],
          ['数据隔离', '已启用', '企业间不可互访'],
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
              ['状态', m.status === 'active' ? '已激活' : m.status === 'limited' ? '受限访问' : '待接受邀请'],
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
      .map(q => ({ ...q, m: marks[q.id] || q.r }))
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

    root.innerHTML = `<div class="page">
      ${pageHead('员工门户', '这是你团队员工看到的界面。他们不需要理解知识库、切片、模型，只需要问问题。',
        `<button class="btn btn--ghost btn--sm" id="btnCopyLink">${icon('external')} 复制门户链接</button>`)}

      <div class="grid" style="grid-template-columns:minmax(0,1fr) 300px;gap:18px;align-items:start">
        <div class="portal-chat">
          <div class="portal-chat__head">
            <span style="width:30px;height:30px;border-radius:8px;background:var(--brand-50);color:var(--brand);display:grid;place-items:center">${icon('bot')}</span>
            <div style="flex:1">
              <div class="fs12 b6">恒森 · 产品与销售助手</div>
              <div class="fs11 muted">基于 5 份内部资料 · 回答均标注出处</div>
            </div>
            <span class="badge badge--success badge--dot">在线</span>
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
      await sleep(680 + Math.random() * 420);
      typing.remove();
      const r = answer(text);

      // 提问计数回流到第 8 步的试用检查
      S.portalAsks = (S.portalAsks || 0) + 1;
      if (r.gap) S.portalMiss = (S.portalMiss || 0) + 1;
      TM.save();
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
          <div class="cfg-row__body"><b>厦门拓洋贸易有限公司</b><span>无访问权限 · 需由该企业管理员邀请</span></div>
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
})();
