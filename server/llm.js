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
  deepseek: { baseURL: 'https://api.deepseek.com', models: ['deepseek-chat', 'deepseek-reasoner'] },
  dashscope: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'] },
  zhipu: { baseURL: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4-plus', 'glm-4-flash'] },
  moonshot: { baseURL: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-8k', 'moonshot-v1-32k'] },
  openai: { baseURL: 'https://api.openai.com/v1', models: ['gpt-4o-mini', 'gpt-4o'] },
  custom: { baseURL: '', models: [] },
};

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

export function buildRagMessages(question, hits, assistant = {}) {
  const ctx = hits.length
    ? hits
        .map((h, i) => `[${i + 1}] ${h.chunk.doc}${h.chunk.page ? ` 第 ${h.chunk.page} 页` : ''}\n${h.chunk.text}`)
        .join('\n\n---\n\n')
    : '（没有检索到任何相关资料）';

  const role = assistant.prompt ? `\n\n当前岗位要求：${assistant.prompt}` : '';

  return [
    { role: 'system', content: SYSTEM + role },
    { role: 'user', content: `【资料】\n${ctx}\n\n【问题】\n${question}` },
  ];
}

/** 带检索的问答：返回回答 + 真实出处 */
export async function answerWithRag(cfg, { question, hits, assistant }) {
  const messages = buildRagMessages(question, hits, assistant);
  const r = await chat(cfg, messages);

  const text = (r.content || '').trim();
  // 模型明确说没有 -> 标为资料缺口，不算错误
  const isGap = /没有找到|未找到|没有相关|无法回答|资料中没有/.test(text) && hits.length === 0;

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
