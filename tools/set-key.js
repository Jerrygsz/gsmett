/**
 * 更换平台模型 API Key（不用开浏览器）
 *
 * 用法：
 *   node tools/set-key.js                 交互输入（推荐，不会进命令历史）
 *   node tools/set-key.js sk-xxxxxxxx     直接传入（会留在 shell 历史里）
 *
 * 做的事：先真的发一次请求验证 Key 能用，通过后才加密写入 data/config.json。
 * 写入的是密文，文件被拷走也读不出 Key。
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { seal } from '../server/secrets.js';
import { testConnection } from '../server/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const CONFIG = path.join(DATA, 'config.json');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; }
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
  });
}

const argKey = process.argv[2];

console.log('');
console.log('  贸智库 · 更换平台 API Key');
console.log('  ─────────────────────────────');

const cur = readConfig();
if (cur?.llm?.model) console.log(`  当前模型：${cur.llm.provider} / ${cur.llm.model}`);

const apiKey = argKey || await ask('  粘贴新的 API Key（输入后回车）：');
if (!apiKey) {
  console.log('  没有输入，已取消。');
  process.exit(1);
}
if (!/^sk-[A-Za-z0-9_-]{16,}$/.test(apiKey)) {
  console.log('  这个格式不太像 API Key（一般以 sk- 开头）。确认无误可以再加 --force 重试。');
  if (!process.argv.includes('--force')) process.exit(1);
}

const cfg = {
  provider: cur?.llm?.provider || 'deepseek',
  baseURL: cur?.llm?.baseURL || 'https://api.deepseek.com',
  model: cur?.llm?.model || 'deepseek-chat',
  apiKey,
};

process.stdout.write('  正在验证（会真的发一次请求）… ');
let test;
try {
  test = await testConnection(cfg);
  console.log(`通过 · ${test.model} · ${test.ms}ms`);
} catch (e) {
  console.log('失败');
  console.log(`  ${e.message}`);
  console.log('');
  console.log('  Key 没有写入，原来的配置保持不变。');
  process.exit(1);
}

const next = { ...cur, llm: { ...cfg, apiKey: seal(apiKey, DATA) } };
fs.mkdirSync(DATA, { recursive: true });
const tmp = CONFIG + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
fs.renameSync(tmp, CONFIG);

console.log('');
console.log('  ✅ 已加密保存到 data/config.json');
console.log('  重启服务后生效（Ctrl+C 停掉再双击「启动服务.bat」）');
console.log('');
