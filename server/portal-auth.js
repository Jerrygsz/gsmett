/**
 * 员工门户的密码与会话令牌。
 *
 * 设计取舍：
 * - 密码用 scrypt + 每账号独立盐，只存哈希，不存明文。
 * - 令牌是无状态签名（HMAC-SHA256），不落盘，服务重启仍有效。
 *   签名密钥存在 data/.portal-secret，与 API Key 的机器密钥分开。
 * - 令牌里带 pwdAt（设置密码的时间）。管理员改密码 / 停用账号后，
 *   旧令牌立刻失效，不需要维护一张会话黑名单。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './store.js';

const SECRET_FILE = path.join(DATA_DIR, '.portal-secret');
let CACHED_KEY = null;

function signingKey() {
  if (CACHED_KEY) return CACHED_KEY;
  try {
    const raw = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    const buf = Buffer.from(raw, 'hex');
    if (buf.length === 32) { CACHED_KEY = buf; return buf; }
  } catch { /* 第一次运行 */ }
  CACHED_KEY = crypto.randomBytes(32);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SECRET_FILE, CACHED_KEY.toString('hex'), { mode: 0o600 });
  return CACHED_KEY;
}

export function hashPwd(pwd) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pwd), salt, 32);
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}

export function verifyPwd(pwd, stored) {
  try {
    const [alg, saltHex, hashHex] = String(stored || '').split('$');
    if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
    const got = crypto.scryptSync(String(pwd), Buffer.from(saltHex, 'hex'), 32);
    const want = Buffer.from(hashHex, 'hex');
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

/** 有效期默认 7 天 */
export function signToken(payload, ttlSec = 7 * 24 * 3600) {
  const body = Buffer.from(JSON.stringify({
    ...payload,
    iat: Date.now(),
    exp: Date.now() + ttlSec * 1000,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', signingKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  try {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const want = crypto.createHmac('sha256', signingKey()).update(body).digest('base64url');
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p?.exp || p.exp < Date.now() || !p.mid || !p.cid) return null;
    return p;
  } catch {
    return null;
  }
}
