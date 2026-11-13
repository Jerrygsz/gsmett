/**
 * 知识库引擎：切片 + 中文 BM25 检索
 *
 * 说明：DeepSeek 不提供 embedding 接口，所以这里用 BM25（关键词检索）而不是向量检索。
 * 对"型号、规格、条款"这类查参数的业务场景，关键词精确匹配其实比语义近似更可靠；
 * 代价是同义词、口语化提问的召回不如向量。这一点在界面上要对客户讲清楚，不能吹成"语义搜索"。
 */

const MAX_CHARS = 380; // 单片目标字数
const OVERLAP = 60; // 相邻片重叠字数

/* 按段落 → 句子 → 硬切的顺序把长文切到目标长度 */
function splitParagraphs(text) {
  return text
    .split(/\n{2,}/)
    .flatMap((block) => (block.length > MAX_CHARS * 2 ? splitSentences(block) : [block]))
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitSentences(block) {
  // 中文句号、问号、感叹号、分号；英文句点后跟空格
  const parts = block.split(/(?<=[。！？；!?])\s*|(?<=\.)\s+/).filter(Boolean);
  const out = [];
  let buf = '';
  for (const p of parts) {
    if ((buf + p).length > MAX_CHARS) {
      if (buf) out.push(buf);
      buf = p;
    } else {
      buf += p;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function hardSplit(s) {
  const out = [];
  for (let i = 0; i < s.length; i += MAX_CHARS - OVERLAP) {
    out.push(s.slice(i, i + MAX_CHARS));
    if (i + MAX_CHARS >= s.length) break;
  }
  return out;
}

/**
 * 把一份文档切成片段
 * @returns [{ i, text, page }]
 */
export function chunkDoc(doc) {
  const chunks = [];

  const push = (t, page) => {
    const text = t.trim();
    if (text.length < 12) return; // 太碎的片段没有检索价值
    chunks.push({ i: chunks.length, text, page });
  };

  /* 把一段（或一页）文本切成不超过 MAX_CHARS 的片段，片间留重叠 */
  const feed = (block, page) => {
    const paragraphs = splitParagraphs(block);
    let buf = '';
    for (const p of paragraphs) {
      if (p.length > MAX_CHARS) {
        if (buf) { push(buf, page); buf = ''; }
        for (const part of hardSplit(p)) push(part, page);
        continue;
      }
      if ((buf + '\n' + p).length > MAX_CHARS) {
        push(buf, page);
        // 重叠：带上上一片末尾，避免句子被切断后两边都搜不到
        buf = buf.slice(Math.max(0, buf.length - OVERLAP)) + '\n' + p;
      } else {
        buf = buf ? buf + '\n' + p : p;
      }
    }
    if (buf) push(buf, page);
  };

  // 有分页信息就逐页切，这样引用能精确到"第几页"
  if (Array.isArray(doc.byPage) && doc.byPage.length) {
    for (const pg of doc.byPage) feed(pg.text || '', pg.page || 1);
  } else {
    feed(doc.text || '', 1);
  }

  return chunks;
}

/* ---------------- 分词：中文 bigram + 英文/数字词 ---------------- */

const STOP = new Set(['的', '了', '是', '在', '和', '与', '有', '吗', '呢', '啊', '请', '这', '那', '个', '我们', '你们', '多少', '什么', '怎么']);

export function tokenize(text) {
  const t = (text || '').toLowerCase();
  const tokens = [];

  // 英文单词、数字、型号（hs-1180 → hs, 1180, hs1180）
  const ascii = t.match(/[a-z0-9][a-z0-9\-_.]*/g) || [];
  for (const w of ascii) {
    if (w.length < 2) continue;
    tokens.push(w);
    const compact = w.replace(/[-_.]/g, '');
    if (compact !== w && compact.length >= 3) tokens.push(compact);
  }

  // 中文：连续汉字块取 bigram
  const cjkBlocks = t.match(/[\u4e00-\u9fa5]+/g) || [];
  for (const block of cjkBlocks) {
    if (block.length === 1) {
      if (!STOP.has(block)) tokens.push(block);
      continue;
    }
    for (let i = 0; i < block.length - 1; i++) {
      const bg = block.slice(i, i + 2);
      if (!STOP.has(bg)) tokens.push(bg);
    }
    // 三字以上的专有词也留一份，提升长词权重
    if (block.length >= 3 && block.length <= 8) tokens.push(block);
  }

  return tokens;
}

/* ---------------- 建索引 ---------------- */

export function buildIndex(chunks) {
  const postings = new Map(); // term -> Map(chunkIdx -> tf)
  const lengths = [];

  chunks.forEach((c, idx) => {
    const toks = tokenize(c.text);
    lengths[idx] = toks.length;
    for (const tk of toks) {
      let m = postings.get(tk);
      if (!m) { m = new Map(); postings.set(tk, m); }
      m.set(idx, (m.get(idx) || 0) + 1);
    }
  });

  const avgdl = lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1);

  // Map 不能直接 JSON，转成普通对象
  const post = {};
  for (const [term, m] of postings) {
    post[term] = Object.fromEntries(m);
  }

  return { postings: post, lengths, avgdl, n: chunks.length, builtAt: new Date().toISOString() };
}

/* ---------------- 检索 ---------------- */

const K1 = 1.4;
const B = 0.72;

/**
 * 业务同义词组。
 * BM25 是字面匹配：资料里写「MOQ」，员工问「起订量」就搜不到——这在真实走查里一定会发生。
 * 这里维护一份外贸/制造场景的高频黑话对照，查询命中任一词就把同组词按低权重一起检索，
 * 只补召回、不改排序主导权（扩展词权重 0.55，原始词仍是 1.0）。
 */
const SYNONYM_GROUPS = [
  ['moq', '最小起订量', '起订量', '最小订购量', '最低起订量', '最少订多少'],
  ['交期', '交货期', '交货时间', '生产周期', 'leadtime'],
  ['质保', '保修', '保修期', '保质期', 'warranty'],
  ['报价', '价格', '单价', '多少钱', '售价'],
  ['折扣', '优惠', '让利', 'discount'],
  ['规格', '参数', '型号', '规格书'],
  ['包装', '装箱', '外箱', '包装方式'],
  ['毛重', '净重', '重量'],
  ['付款', '支付', '结算', '定金', '尾款'],
  ['认证', '证书', '资质', 'rohs'],
  ['售后', '退换', '退货', '维修', '返修'],
  ['库存', '现货', '备货', '有没有货'],
  ['电池', '锂电', '电芯'],
  ['钻头', '钻咀'],
];

/* word(小写) → 所属组下标，启动时算一次 */
const SYN_LOOKUP = new Map();
SYNONYM_GROUPS.forEach((group, gi) => {
  for (const w of group) SYN_LOOKUP.set(w.toLowerCase(), gi);
});

/** 从查询里找出命中的同义组，返回该组其余词的 token（已去重） */
function expandQuery(query) {
  const q = (query || '').toLowerCase();
  const extra = new Set();
  const seenGroups = new Set();

  for (const [word, gi] of SYN_LOOKUP) {
    if (!q.includes(word)) continue;
    if (seenGroups.has(gi)) continue;
    seenGroups.add(gi);
    for (const w of SYNONYM_GROUPS[gi]) {
      if (q.includes(w.toLowerCase())) continue; // 查询里本来就有，不用再扩
      for (const tk of tokenize(w)) extra.add(tk);
    }
  }
  return [...extra];
}

export function search(index, chunks, query, topK = 6) {
  if (!index || !chunks?.length) return [];
  const qToks = tokenize(query);
  if (!qToks.length) return [];

  // 原始词权重 1.0，同义扩展词 0.55；同一个 token 取最高权重，避免重复加分
  const weight = new Map();
  for (const tk of qToks) weight.set(tk, 1);
  for (const tk of expandQuery(query)) {
    if (!weight.has(tk)) weight.set(tk, 0.55);
  }

  const scores = new Map();
  const { postings, lengths, avgdl, n } = index;

  for (const [tk, w] of weight) {
    const m = postings[tk];
    if (!m) continue;
    const df = Object.keys(m).length;
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));

    for (const [idxStr, tf] of Object.entries(m)) {
      const idx = +idxStr;
      const dl = lengths[idx] || 1;
      const s = w * idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (dl / avgdl))));
      scores.set(idx, (scores.get(idx) || 0) + s);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([idx, score]) => ({
      chunk: chunks[idx],
      score: Math.round(score * 100) / 100,
      // 归一化一个 0-1 的"相关度"给界面用
      rel: Math.min(1, score / (score + 6)),
    }));
}
