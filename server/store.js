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

export function getState(id) {
  return readJSON(statePath(id), null);
}

export function saveState(id, state) {
  writeJSON(statePath(id), state);
  return state;
}

export function patchState(id, patch) {
  const cur = getState(id) || {};
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  writeJSON(statePath(id), next);
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
  return readJSON(CONFIG_FILE, { llm: null });
}

export function saveConfig(cfg) {
  writeJSON(CONFIG_FILE, cfg);
  return cfg;
}

export { readJSON, writeJSON };
