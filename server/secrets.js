/**
 * API Key 本地加密存储
 *
 * 目标：data/ 目录被拷走、被误传、被网盘同步时，里面的 Key 不是明文。
 *
 * 怎么做的：
 *   AES-256-GCM 加密，密钥由「本机指纹 + data/.machine-salt」用 scrypt 派生。
 *   本机指纹 = 主机名 + 当前系统用户名。少一个都算不出来。
 *
 * 能挡住什么：
 *   ✓ 备份目录被复制到别的电脑 / 别处打开 → 解不开
 *   ✓ 误把 data/ 传到网盘、Git、聊天工具 → 看到的是乱码
 *   ✓ 硬盘被单独拆走读盘 → 换机器解不开
 *
 * 挡不住什么（必须说清楚）：
 *   ✗ 你这台电脑上、用你这个 Windows 账号跑的任何程序，都能解密
 *     （要挡住这个得用系统级凭据库，Windows 上是 DPAPI/凭据管理器，
 *       需要额外装原生模块，本机装不上，所以没做）
 *   ✗ 进程内存里的明文（运行期间一定存在）
 *
 * 所以它降低的是"文件泄露"的风险，不是"本机被控"的风险。
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const PREFIX = 'enc1:';
const SALT_NAME = '.machine-salt';

let saltWarned = false;
/* 每个数据目录一份派生密钥。按目录缓存，不能只用单个全局变量，
 * 否则同一进程里对不同目录加解密会误用第一次算出的密钥。 */
const keyCache = new Map();

function saltPath(dataDir) {
  return path.join(dataDir, SALT_NAME);
}

/** 读或生成随机盐。盐不是秘密，作用是让每台机器/每个安装目录的密钥都不同 */
function readSalt(dataDir) {
  const p = saltPath(dataDir);
  try {
    const s = fs.readFileSync(p, 'utf8').trim();
    if (s.length >= 64) return s;
  } catch { /* 不存在，往下生成 */ }

  const s = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(p, s, { mode: 0o600 });
  } catch (e) {
    if (!saltWarned) {
      console.warn('[secrets] 无法写入盐文件，加密降级为内存随机盐（重启后需重填 Key）：', e.message);
      saltWarned = true;
    }
    return s;
  }
  return s;
}

/** 派生密钥：主机名 + 用户名 + 盐，换机器/换用户就解不开 */
function deriveKey(dataDir) {
  const dirKey = path.resolve(dataDir);
  const hit = keyCache.get(dirKey);
  if (hit) return hit;

  let user = '';
  let host = '';
  try { user = os.userInfo().username || ''; } catch { user = ''; }
  try { host = os.hostname() || ''; } catch { host = ''; }

  const salt = readSalt(dataDir);
  const material = `${host}|${user}|${salt}`;
  // scrypt 较慢，每台机器每个目录只付一次代价
  const key = crypto.scryptSync(material, Buffer.from(salt, 'hex'), 32, {
    N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
  });
  keyCache.set(dirKey, key);
  return key;
}

export function isSealed(v) {
  return typeof v === 'string' && v.startsWith(PREFIX);
}

/**
 * 加密。传入空值原样返回。
 * 已经是密文的直接返回，避免二次加密把数据搞坏。
 */
export function seal(plain, dataDir) {
  if (!plain || typeof plain !== 'string') return plain;
  if (isSealed(plain)) return plain;

  try {
    const key = deriveKey(dataDir);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
  } catch (e) {
    console.warn('[secrets] 加密失败，保留明文（功能优先）：', e.message);
    return plain;
  }
}

/**
 * 解密。非密文原样返回（兼容旧数据）。
 * 解密失败返回 null —— 说明换了机器或换了用户，只能重填。
 */
export function unseal(stored, dataDir) {
  if (!stored || typeof stored !== 'string') return stored;
  if (!isSealed(stored)) return stored;

  try {
    const body = stored.slice(PREFIX.length);
    const [ivB64, tagB64, ctB64] = body.split(':');
    if (!ivB64 || !tagB64 || !ctB64) throw new Error('格式不完整');

    const key = deriveKey(dataDir);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    return null;
  }
}

/** 把配置对象里的 llm.apiKey 就地加密，返回新对象 */
export function sealCfg(cfg, dataDir) {
  if (!cfg?.llm?.apiKey) return cfg;
  return { ...cfg, llm: { ...cfg.llm, apiKey: seal(cfg.llm.apiKey, dataDir) } };
}

/** 把配置对象里的 llm.apiKey 就地解密，返回新对象 */
export function unsealCfg(cfg, dataDir) {
  if (!cfg?.llm?.apiKey) return cfg;
  const k = unseal(cfg.llm.apiKey, dataDir);
  if (k === null) {
    console.warn('[secrets] 内置 Key 解不开（换过电脑或系统用户？），已停用，请重新填写');
    return { ...cfg, llm: { ...cfg.llm, apiKey: '' } };
  }
  return { ...cfg, llm: { ...cfg.llm, apiKey: k } };
}
