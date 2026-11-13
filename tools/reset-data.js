/**
 * 清空所有客户数据，回到刚装好的状态。
 *
 * 保留：data/config.json（模型 Key）、data/platform.json（后台账号与服务商人员）
 * 清空：data/clients/ 客户目录、data/clients.json 客户列表、data/tickets.json 工单
 * 备份：清空前自动打包到 backup/data-<时间戳>/
 *
 * 用法：
 *   node tools/reset-data.js            备份后清空
 *   node tools/reset-data.js --no-backup 不备份直接清空（慎用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const CLIENTS = path.join(DATA, 'clients');
const INDEX = path.join(DATA, 'clients.json');
const CONFIG = path.join(DATA, 'config.json');
const SALT = path.join(DATA, '.machine-salt');
const PLATFORM = path.join(DATA, 'platform.json');
const TICKETS = path.join(DATA, 'tickets.json');

const noBackup = process.argv.includes('--no-backup');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function countClients() {
  try {
    return JSON.parse(fs.readFileSync(INDEX, 'utf8')).clients?.length || 0;
  } catch {
    return 0;
  }
}

function dirSize(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

const before = countClients();
const sizeMB = (dirSize(CLIENTS) / 1024 / 1024).toFixed(1);

console.log('');
console.log('  贸智库 · 清空客户数据');
console.log('  ──────────────────────────');
console.log(`  当前客户：${before} 个，占用 ${sizeMB} MB`);

// 1. 备份
if (!noBackup && fs.existsSync(CLIENTS)) {
  const dir = path.join(ROOT, 'backup', `data-${stamp()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(CLIENTS, path.join(dir, 'clients'), { recursive: true });
  if (fs.existsSync(INDEX)) fs.copyFileSync(INDEX, path.join(dir, 'clients.json'));
  if (fs.existsSync(CONFIG)) fs.copyFileSync(CONFIG, path.join(dir, 'config.json'));
  /* 盐必须跟配置一起备份。Key 是用「本机指纹 + 盐」加密的，
   * 只备份 config.json 不备份盐，恢复时解不开 Key，只能重填。 */
  if (fs.existsSync(SALT)) fs.copyFileSync(SALT, path.join(dir, '.machine-salt'));
  if (fs.existsSync(PLATFORM)) fs.copyFileSync(PLATFORM, path.join(dir, 'platform.json'));
  if (fs.existsSync(TICKETS)) fs.copyFileSync(TICKETS, path.join(dir, 'tickets.json'));
  console.log(`  已备份到：backup/${path.basename(dir)}`);
}

// 2. 清空客户目录
fs.rmSync(CLIENTS, { recursive: true, force: true });
fs.mkdirSync(CLIENTS, { recursive: true });

// 3. 重置客户列表，编号从 2000 重新开始；工单跟着客户一起清掉
fs.writeFileSync(INDEX, JSON.stringify({ seq: 2000, clients: [] }, null, 2), 'utf8');
if (fs.existsSync(TICKETS)) fs.rmSync(TICKETS, { force: true });

// 4. 确认模型 Key 还在
let keyState = '未配置（第 5 步需要自己填）';
try {
  const c = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  if (c.llm?.apiKey) {
    keyState = String(c.llm.apiKey).startsWith('enc1:')
      ? `已保留（加密存储，${c.llm.model}）`
      : `已保留（⚠ 明文存储，重启服务后会自动加密）`;
  }
} catch { }

console.log('');
console.log('  ✅ 已清空所有客户、项目数据与工单');
console.log(`  模型 Key：${keyState}`);
console.log('  保留：后台登录账号与服务商人员名单（data/platform.json）');
console.log('  想连账号和人员一起重置，就手动删掉这个文件，重启服务会生成初始账号');
console.log('');
console.log('  下一步：打开 http://localhost:8787/admin.html 新建客户');
console.log('  浏览器请按 Ctrl + Shift + R 强制刷新一次，避免加载旧缓存');
console.log('');
