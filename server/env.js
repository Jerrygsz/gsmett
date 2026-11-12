/**
 * 真实环境检测（服务端执行）
 * 这里能读到的才是真的：磁盘、内存、CPU 型号、Docker、端口占用
 * 浏览器做不到的，正是由这个本地服务替客户做
 */
import os from 'node:os';
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';

const GB = 1024 ** 3;

/* 系统盘可用空间：Node 18.15+ 的 fs.statfs，不需要调外部命令 */
async function diskInfo() {
  const targets = process.platform === 'win32' ? ['C:\\'] : ['/'];
  const out = [];
  for (const t of targets) {
    try {
      const st = await fs.promises.statfs(t);
      const total = st.blocks * st.bsize;
      const free = st.bfree * st.bsize;
      const avail = st.bavail * st.bsize;
      out.push({
        drive: t.replace(/\\$/, ''),
        totalGB: +(total / GB).toFixed(1),
        freeGB: +(free / GB).toFixed(1),
        availGB: +(avail / GB).toFixed(1),
      });
    } catch (e) {
      out.push({ drive: t, error: e.message });
    }
  }
  return out;
}

/* 端口是否被占用：真去连一下，比查 netstat 可靠 */
function portBusy(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (busy) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(busy);
    };
    sock.setTimeout(500);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

/* 外部命令：有超时，失败就是没有 */
function which(cmd, args = ['--version'], timeout = 3000) {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const done = (ok, text) => {
      if (settled) return;
      settled = true;
      resolve({ ok, text: (text || '').trim() });
    };
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true, shell: false });
    } catch (e) {
      return done(false, '');
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch { }
      done(false, '');
    }, timeout);
    child.stdout?.on('data', (d) => { out += d.toString(); });
    child.stderr?.on('data', (d) => { out += d.toString(); });
    child.on('error', () => { clearTimeout(timer); done(false, ''); });
    child.on('close', (code) => {
      clearTimeout(timer);
      done(code === 0, out.split('\n')[0]);
    });
  });
}

export async function probeEnvironment() {
  const cpus = os.cpus() || [];
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const disks = await diskInfo();

  const cDrive = disks.find((d) => (d.drive || '').startsWith('C')) || disks[0] || {};
  const availGB = cDrive.availGB ?? 0;

  const [dockerVer, gitVer] = await Promise.all([
    which('docker', ['--version']),
    which('git', ['--version']),
  ]);

  const ports = await Promise.all([3000, 8787].map(async (p) => ({ port: p, busy: await portBusy(p) })));

  const osName =
    process.platform === 'win32'
      ? `Windows ${os.release().split('.')[0] >= 10 ? (Number(os.release().split('.')[2]) >= 22000 ? '11' : '10') : os.release()}`
      : process.platform === 'darwin'
        ? `macOS ${os.release()}`
        : `Linux ${os.release()}`;

  return {
    at: new Date().toISOString(),
    host: os.hostname(),
    platform: process.platform,
    os: osName,
    osDetail: `${os.type()} ${os.release()} ${os.arch()}`,
    arch: os.arch(),
    cpu: {
      model: cpus[0]?.model?.trim() || '未识别',
      cores: cpus.length,
      speedGHz: cpus[0]?.speed ? +(cpus[0].speed / 1000).toFixed(2) : null,
    },
    memory: {
      totalGB: +(totalMem / GB).toFixed(1),
      freeGB: +(freeMem / GB).toFixed(1),
    },
    disks,
    diskAvailGB: availGB,
    runtime: {
      node: process.version,
      docker: dockerVer.ok ? dockerVer.text.replace(/^Docker version /i, '') : null,
      git: gitVer.ok ? gitVer.text.replace(/^git version /i, '') : null,
    },
    ports,
    // 判定：这里只给出事实和结论，文案交给前端
    verdict: {
      diskOk: availGB >= 5,
      memOk: totalMem / GB >= 8,
      cpuOk: cpus.length >= 4,
      dockerOk: dockerVer.ok,
      port3000Free: !ports.find((p) => p.port === 3000)?.busy,
    },
  };
}
