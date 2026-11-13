/**
 * 存储层：一个客户一个目录，全部落盘到 data/
 * data/
 *   clients.json              客户索引
 *   clients/<id>/state.json   该客户的工作空间状态
 *   clients/<id>/docs.json    资料元数据
 *   clients/<id>/index.json   切片与倒排索引
 *   clients/<id>/uploads/*    原始文件
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seal, unseal, sealCfg, unsealCfg, isSealed } from './secrets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');

const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/* 原子写：先写临时文件再改名，避免写一半断电把数据写坏 */
function writeJSON(file, obj) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function initStorage() {
  ensureDir(DATA_DIR);
  ensureDir(path.join(DATA_DIR, 'clients'));
  if (!fs.existsSync(CLIENTS_FILE)) writeJSON(CLIENTS_FILE, { seq: 2000, clients: [] });
  try { migratePlainKeys(); } catch (e) { console.warn('[store] 明文 Key 迁移失败：', e.message); }
}

/* ---------------- 客户 ---------------- */

export function listClients() {
  return readJSON(CLIENTS_FILE, { seq: 2000, clients: [] }).clients;
}

export function getClient(id) {
  return listClients().find((c) => c.id === id) || null;
}

export function saveClient(client) {
  const db = readJSON(CLIENTS_FILE, { seq: 2000, clients: [] });
  const i = db.clients.findIndex((c) => c.id === client.id);
  if (i >= 0) db.clients[i] = { ...db.clients[i], ...client };
  else db.clients.unshift(client);
  writeJSON(CLIENTS_FILE, db);
  return client;
}

export function nextProjectNo() {
  const db = readJSON(CLIENTS_FILE, { seq: 2000, clients: [] });
  db.seq = (db.seq || 2000) + 1;
  writeJSON(CLIENTS_FILE, db);
  return `P-${new Date().getFullYear()}-${String(db.seq).padStart(4, '0')}`;
}

export function deleteClient(id) {
  const db = readJSON(CLIENTS_FILE, { seq: 2000, clients: [] });
  db.clients = db.clients.filter((c) => c.id !== id);
  writeJSON(CLIENTS_FILE, db);
  fs.rmSync(clientDir(id), { recursive: true, force: true });
}

/* ---------------- 客户工作区 ---------------- */

export function clientDir(id) {
  return path.join(DATA_DIR, 'clients', id);
}

export function statePath(id) {
  return path.join(clientDir(id), 'state.json');
}

/* 客户 state 里的模型 Key 同样加密落盘。
 * 只在读写边界处理，上层代码拿到的永远是明文，不用改。 */
function sealState(st) {
  if (!st?.cfg?.llm?.apiKey) return st;
  return { ...st, cfg: { ...st.cfg, llm: { ...st.cfg.llm, apiKey: seal(st.cfg.llm.apiKey, DATA_DIR) } } };
}

function unsealState(st) {
  if (!st?.cfg?.llm?.apiKey) return st;
  const k = unseal(st.cfg.llm.apiKey, DATA_DIR);
  if (k === null) {
    console.warn('[store] 客户模型 Key 解不开（换过电脑或系统用户？），已停用，请重新填写');
    return { ...st, cfg: { ...st.cfg, llm: { ...st.cfg.llm, apiKey: '' } } };
  }
  return { ...st, cfg: { ...st.cfg, llm: { ...st.cfg.llm, apiKey: k } } };
}

export function getState(id) {
  return unsealState(readJSON(statePath(id), null));
}

export function saveState(id, state) {
  writeJSON(statePath(id), sealState(state));
  return state;
}

export function patchState(id, patch) {
  const cur = getState(id) || {};
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  writeJSON(statePath(id), sealState(next));
  return next;
}

export function getDocs(id) {
  return readJSON(path.join(clientDir(id), 'docs.json'), []);
}

export function saveDocs(id, docs) {
  writeJSON(path.join(clientDir(id), 'docs.json'), docs);
  return docs;
}

export function getIndex(id) {
  return readJSON(path.join(clientDir(id), 'index.json'), null);
}

export function saveIndex(id, index) {
  writeJSON(path.join(clientDir(id), 'index.json'), index);
  return index;
}

export function uploadDir(id) {
  const d = path.join(clientDir(id), 'uploads');
  ensureDir(d);
  return d;
}

/* ---------------- 全局配置（API Key 等，只在服务端） ---------------- */

const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

export function getConfig() {
  return unsealCfg(readJSON(CONFIG_FILE, { llm: null }), DATA_DIR);
}

export function saveConfig(cfg) {
  // 落盘前加密；文件被拷走也读不出 Key
  writeJSON(CONFIG_FILE, sealCfg(cfg, DATA_DIR));
  return cfg;
}

export { readJSON, writeJSON };

/**
 * 一次性迁移：把历史上以明文保存的 Key 加密。
 * 每次启动都跑，幂等——已经是密文的跳过。
 * 这样你之前留下的 data/config.json 会被自动升级，不用手动处理。
 */
export function migratePlainKeys() {
  let count = 0;

  const raw = readJSON(CONFIG_FILE, null);
  if (raw?.llm?.apiKey && !isSealed(raw.llm.apiKey)) {
    writeJSON(CONFIG_FILE, sealCfg(raw, DATA_DIR));
    count++;
  }

  for (const c of listClients()) {
    const p = statePath(c.id);
    const st = readJSON(p, null);
    if (st?.cfg?.llm?.apiKey && !isSealed(st.cfg.llm.apiKey)) {
      writeJSON(p, sealState(st));
      count++;
    }
  }

  if (count) console.log(`[store] 已将 ${count} 处明文 Key 加密存储`);
  return count;
}
