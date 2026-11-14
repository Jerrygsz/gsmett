/**
 * 大模型调用层：OpenAI 兼容协议
 * DeepSeek / 通义 / 智谱 / 月之暗面 / OpenAI 都是这个格式，换 baseURL 和 model 就行
 */

const DEFAULTS = {
  provider: 'deepseek',
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  temperature: 0.2,
  maxTokens: 1200,
};

export const PROVIDERS = {
  deepseek: { baseURL: 'https://api.deepseek.com', models: ['deepseek-chat', 'deepseek-reasoner'], vision: [] },
  dashscope: {
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
    vision: ['qwen-vl-max', 'qwen-vl-plus'],
  },
  zhipu: {
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-flash'],
    // 扫描件 OCR 用这几个：glm-4v-flash 便宜、够认表格，glm-4v-plus 更准
    vision: ['glm-4v-flash', 'glm-4v-plus', 'glm-4v'],
  },
  moonshot: {
    baseURL: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k'],
    vision: ['moonshot-v1-8k-vision-preview'],
  },
  openai: {
    baseURL: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o'],
    vision: ['gpt-4o-mini', 'gpt-4o'],
  },
  custom: { baseURL: '', models: [], vision: [] },
};

/** 这个服务商有没有能读图片的模型；没有就得让客户换一家 */
export function visionModelFor(cfg = {}) {
  if (cfg.visionModel) return cfg.visionModel;
  return PROVIDERS[cfg.provider]?.vision?.[0] || '';
}

class LLMError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/* 把各家不同的错误信息翻译成人话 */
function explain(status, body) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body || {});
  if (status === 401 || /invalid.*key|api key/i.test(raw)) {
    return new LLMError('API Key 无效或已失效，请检查是否有空格、是否复制完整', 'AUTH', status);
  }
  if (status === 402 || /insufficient|balance|quota/i.test(raw)) {
    return new LLMError('账户余额不足，请到服务商后台充值', 'BALANCE', status);
  }
  if (status === 429) {
    return new LLMError('请求太频繁被限流，稍等几秒再试', 'RATE', status);
  }
  if (status === 404 || /model.*not.*found/i.test(raw)) {
    return new LLMError('模型名不存在，检查一下模型名称', 'MODEL', status);
  }
  if (/ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(raw)) {
    return new LLMError('连不上模型服务，检查网络或代理设置', 'NETWORK', status);
  }
  return new LLMError(`模型服务返回 ${status}：${raw.slice(0, 160)}`, 'HTTP', status);
}

export function normalizeCfg(cfg = {}) {
  return {
    provider: cfg.provider || DEFAULTS.provider,
    baseURL: (cfg.baseURL || PROVIDERS[cfg.provider]?.baseURL || DEFAULTS.baseURL).replace(/\/+$/, ''),
    model: cfg.model || DEFAULTS.model,
    apiKey: cfg.apiKey || '',
    temperature: cfg.temperature ?? DEFAULTS.temperature,
    maxTokens: cfg.maxTokens ?? DEFAULTS.maxTokens,
  };
}

export async function chat(cfg, messages, opts = {}) {
  const c = normalizeCfg(cfg);
  if (!c.apiKey) throw new LLMError('还没有配置 API Key', 'NO_KEY', 0);

  const url = `${c.baseURL}/chat/completions`;
  const body = {
    model: opts.model || c.model,
    messages,
    temperature: opts.temperature ?? c.temperature,
    max_tokens: opts.maxTokens ?? c.maxTokens,
    stream: false,
  };

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), opts.timeout || 60000);

  let res;
  const started = Date.now();
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${c.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new LLMError('模型响应超时（60 秒）', 'TIMEOUT', 0);
    throw explain(0, e.message);
  }
  clearTimeout(timeout);

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { }

  if (!res.ok) throw explain(res.status, json || text);

  const content = json?.choices?.[0]?.message?.content || '';
  const usage = json?.usage || {};

  return {
    content,
    usage: {
      prompt: usage.prompt_tokens || 0,
      completion: usage.completion_tokens || 0,
      total: usage.total_tokens || 0,
    },
    model: json?.model || c.model,
    ms: Date.now() - started,
  };
}

/** 连通性测试：真发一次请求，不是假装通过 */
export async function testConnection(cfg) {
  const t0 = Date.now();
  const r = await chat(cfg, [
    { role: 'system', content: '你是连通性测试助手。' },
    { role: 'user', content: '只回复两个字：正常' },
  ], { maxTokens: 16, timeout: 30000 });

  return {
    ok: true,
    reply: (r.content || '').trim().slice(0, 40),
    model: r.model,
    ms: Date.now() - t0,
    usage: r.usage,
  };
}

/* ---------------- RAG：检索片段 + 提示词 → 回答 ---------------- */

const SYSTEM = `你是企业内部的资料问答助手。规则：

1. 只根据【资料】里的内容回答，不要用你的常识补充，不要推测。
2. 资料里没有答案时，直接说"知识库里没有找到相关内容"，再用一句话说明建议补充什么资料。
3. 引用具体数字、型号、条款时，务必与资料原文一致，不要改写数值。
4. 回答简洁，用中文，2-4 句为主。不要罗列"根据资料1、资料2"这类编号。
5. 不要输出"作为AI"之类的话。`;

/* ---------------- 多轮对话：把追问改写成能单独检索的问题 ---------------- */

const REWRITE_SYS = `你在做多轮对话的查询改写。把用户最新的一句追问，改写成一句不依赖上下文、能单独拿去检索资料的完整问题。

规则：
- 只输出改写后的问题本身，不要解释、不要加引号、不要加前缀、不要换行。
- 保留原问题里的型号、数字、单位、专有名词，一个字都不要改。
- 把「它 / 这个 / 那款 / 上面 / 刚才 / 前者 / 后者」这类指代，换成历史里出现的具体对象。
- 如果最新那句本身已经是完整独立的问题，原样输出即可。
- 不要补充历史里没有的信息，不要推测答案，不要回答问题。`;

/** 追问特征：短句、指代词、比较词。完整长问题无需改写，省一次模型调用。 */
const FOLLOWUP_HINT = /它|它们|这款|那款|这个|那个|上面|刚才|前面|前者|后者|相比|对比|还有|另外|一样|再问|继续|呢\?|呢$|能不能|可以吗|支持吗|带不带|有没有/;

export function needsRewrite(question, history) {
  if (!Array.isArray(history) || !history.length) return false;
  const t = String(question || '').trim();
  return t.length <= 12 || FOLLOWUP_HINT.test(t);
}

/**
 * 把「那它能给笔记本充吗」改写成「GC25 车载充电器能给笔记本充电吗」。
 * 改写只用于检索，最终回答仍用员工原话 + 历史上下文，这样语气才自然。
 * 任何失败都降级回原问题——追问绝不能因为改写失败而答不出来。
 */
export async function rewriteFollowup(cfg, question, history) {
  const fallback = { query: question, rewritten: false, usage: null };
  if (!needsRewrite(question, history)) return fallback;

  const recent = history.slice(-6).map((h) => ({
    role: h.role === 'user' ? 'user' : 'assistant',
    content: String(h.content || '').slice(0, 320),
  })).filter((h) => h.content);
  if (!recent.length) return fallback;

  const messages = [
    { role: 'system', content: REWRITE_SYS },
    ...recent,
    { role: 'user', content: `最新追问：${question}` },
  ];

  try {
    const r = await chat(cfg, messages, { maxTokens: 120, temperature: 0, timeout: 15000 });
    let out = (r.content || '')
      .trim()
      .split('\n')[0]
      .replace(/^["'「『]|["'」』]$/g, '')
      .replace(/^(改写后|完整问题|问题|检索问题)\s*[:：]\s*/, '')
      .trim();
    if (!out || out.length < 2 || out.length > 160) return fallback;
    return { query: out, rewritten: out !== question, usage: r.usage };
  } catch {
    return fallback;
  }
}

/* ---------------- 结构化回答：表格资料要出表格，不要散文 ---------------- */

const TABLE_EXT = /\.(xlsx|xls|csv)$/i;

function isTableHit(h) {
  const name = h?.chunk?.doc || '';
  if (TABLE_EXT.test(name)) return true;
  const text = h?.chunk?.text || '';
  // OCR / Word 里的表格：有「工作表」表头且逗号密集
  return /【工作表[：:]/.test(text) && (text.match(/,/g) || []).length >= 6;
}

const WANTS_TABLE = /列|列出|都有哪些|有哪些|分别是|分别|对比|比较|参数|规格|清单|表格|全部|各|多少种|几种|明细|一览表|单价|价格|报价|型号/;

function structureBlock(hits, question) {
  const tableHits = (hits || []).filter(isTableHit);
  if (!tableHits.length) return '';

  const strong = WANTS_TABLE.test(String(question || ''));
  if (!strong) {
    return `\n\n【表格资料命中】\n检索到的资料里有参数表 / 报价表。若回答涉及多个字段或多个型号，优先用 Markdown 表格（表头与数值照抄资料原文），表格前用一句话给结论；只涉及单个值时一句话回答即可，不要硬凑表格。`;
  }

  return `\n\n【表格资料命中 · 本轮必须遵守，且覆盖上面第 4 条】
检索到的资料里含有表格 / 参数表，员工问的是多字段、多型号、参数或价格清单。本轮必须用 Markdown 表格回答：
  1. 表头直接用资料里的原文字段名，不要自己改名或改写。
  2. 一行一个对象 / 型号；数值、单位、型号逐字照抄资料，资料没写的格子填「—」，不要推测、不要补齐、不要换算。
  3. 表格前最多一句结论；表格后不要再用段落把同样内容重复一遍。
  4. 标准语法：首行 | 列 | 列 |，第二行必须 | --- | --- |，之后每行一条数据。
  5. 如果资料里确实只有单个值，直接一句话回答，不要硬凑表格。
  6. 表格是本轮主体，不受「2-4 句」限制。
  7. 如果凑不齐至少两行有实际数据的记录，或表格里多数格子都要填「—」，不要输出空表格：
     直接一句话说明资料里查到了什么、缺哪个字段，让管理员知道该补什么资料。`;
}

/** 前端渲染用的标记：这一轮是否命中了表格资料 */
export function hasTableHits(hits) {
  return (hits || []).some(isTableHit);
}

export function buildRagMessages(question, hits, assistant = {}, history = []) {
  const ctx = hits.length
    ? hits
        .map((h, i) => `[${i + 1}] ${h.chunk.doc}${h.chunk.page ? ` 第 ${h.chunk.page} 页` : ''}\n${h.chunk.text}`)
        .join('\n\n---\n\n')
    : '（没有检索到任何相关资料）';

  const messages = [
    { role: 'system', content: SYSTEM + structureBlock(hits, question) + assistantBlock(assistant) },
  ];

  /* 最近三轮对话原样带上，让「它」「那款」这类指代能被理解。
   * 只放历史，不放资料——资料每轮都重新检索最新的，避免旧片段污染。 */
  const recent = (Array.isArray(history) ? history : []).slice(-6)
    .map((h) => ({
      role: h.role === 'user' ? 'user' : 'assistant',
      content: String(h.content || '').slice(0, h.role === 'user' ? 300 : 400),
    }))
    .filter((h) => h.content);
  // 最后一条如果是 user，会和本轮问题连成两个 user，某些模型会报错
  if (recent.length && recent[recent.length - 1].role === 'user') recent.pop();
  messages.push(...recent);

  messages.push({ role: 'user', content: `【资料】\n${ctx}\n\n【问题】\n${question}` });
  return messages;
}

/**
 * 把第 6 步创建的助手配置翻译成模型能听懂的设定。
 * 没有助手时返回空串，行为和以前完全一致。
 */
export function assistantBlock(a) {
  if (!a || (!a.name && !a.role && !a.prompt && !a.desc)) return '';
  const L = [];
  if (a.name) L.push(`你的身份：${a.name}`);
  if (a.role) L.push(`岗位定位：${a.role}`);
  if (a.desc) L.push(`负责范围：${a.desc}`);

  const rules = [];
  if (a.rules?.cite !== false) rules.push('回答要能对上具体资料，正文不用自己标序号，出处由系统附上');
  if (a.rules?.refuse !== false) rules.push('资料里查不到就直接说不知道，不要用常识补齐');
  if (a.rules?.noPrice) rules.push('价格、折扣、账期只能引用资料原文，资料没写就说不确定');
  if (a.rules?.brevity !== false) rules.push('先用一句话给结论，需要时再补细节');
  if (rules.length) L.push('回答规则：\n' + rules.map((r, i) => `  ${i + 1}. ${r}`).join('\n'));

  if (a.scope?.length) L.push(`你只能依据这些资料分类回答：${a.scope.join('、')}。问到范围外的内容，说明该问题不属于你的范围`);
  if (a.tone) L.push(`语气：${a.tone}`);
  if (a.prompt) L.push(`补充要求：${a.prompt}`);

  return '\n\n【当前助手设定】\n' + L.join('\n');
}

/**
 * 输出护栏：模型偶尔会为了「必须出表格」硬凑一张全是「—」的空表。
 * 提示词约束不住所有模型，这里在返回前把只有一行、且几乎没有有效数据的表格删掉，
 * 保留模型后面写的那句「缺什么资料」，比一张空表有用得多。
 */
function stripEmptyTables(raw) {
  const lines = String(raw || '').split('\n');
  const out = [];
  const isBlank = (c) => !c || /^(—|-|–|N\/A|n\/a|暂无|无|未写|资料未写|\/|未知)$/.test(c);
  const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i].trim();
    const nxt = (lines[i + 1] || '').trim();
    if (cur.startsWith('|') && /^\|[\s:|\-]+$/.test(nxt) && nxt.includes('-')) {
      let k = i + 2;
      const rows = [];
      while (k < lines.length && lines[k].trim().startsWith('|')) { rows.push(cells(lines[k])); k++; }
      const filled = rows.flat().filter((c) => !isBlank(c)).length;
      if (rows.length < 2 && filled < 3) { i = k - 1; continue; }  // 丢掉空表
      for (let x = i; x < k; x++) out.push(lines[x]);
      i = k - 1;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 带检索的问答：返回回答 + 真实出处。history 为空时与单轮行为完全一致。 */
export async function answerWithRag(cfg, { question, hits, assistant, history }) {
  const messages = buildRagMessages(question, hits, assistant, history);
  const r = await chat(cfg, messages);

  const text = stripEmptyTables((r.content || '').trim());
  /* 模型明确说没有 = 资料缺口。
   * 以前是「全文出现『没有找到』+ 长度 < 320」就算缺口，实测会误判：
   * 模型给出一张完整参数表后顺带补一句「另有几个型号没找到单价」，明明答上来了却记成缺口，
   * 导致门户 miss 虚高、缺口验证也跟着误判。
   * 改成只看开头 45 字有没有拒答，且回答里没有表格才算缺口。 */
  const NO_ANSWER = /没有找到|未找到|没有相关|没有这部分|无法回答|资料中没有|知识库里没有|查不到/;
  const head = text.slice(0, 45);
  const hasTable = /^\s*\|[^\n]+\|/m.test(text);
  const isGap = NO_ANSWER.test(head) && text.length < 320 && !hasTable;

  return {
    answer: text,
    citations: hits.map((h) => ({
      doc: h.chunk.doc,
      page: h.chunk.page || null,
      score: h.score,
      snippet: h.chunk.text.slice(0, 120),
    })),
    gap: isGap,
    usage: r.usage,
    ms: r.ms,
    model: r.model,
  };
}

export { LLMError };
