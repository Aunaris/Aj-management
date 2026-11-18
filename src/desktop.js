'use strict';
/**
 * ตัวเปิดโปรแกรมสำหรับ PC (Windows / macOS / Linux)
 * - เก็บข้อมูลทั้งหมดในโฟลเดอร์ "data" ข้างโปรแกรม (ย้ายทั้งโฟลเดอร์ไปเครื่องอื่นได้)
 * - เปิดเว็บเบราว์เซอร์ให้อัตโนมัติ
 * - ใช้ IP ของเครื่องในวง Wi-Fi/LAN ใส่ใน QR ให้นักศึกษาที่ต่อเครือข่ายเดียวกันสแกนได้
 */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const util = require('util');
const { spawn } = require('child_process');

process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') console.warn(w.message); });

const APP_DIR = path.resolve(__dirname, '..');
const ROOT = process.env.CLASSROOM_HOME || path.resolve(APP_DIR, '..');
const DATA = process.env.CLASSROOM_DATA || path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });
process.env.DB_FILE = process.env.DB_FILE || path.join(DATA, 'classroom.db');
process.env.STORAGE_DIR = process.env.STORAGE_DIR || path.join(DATA, 'storage');
const LOG_DIR = path.join(DATA, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, 'server.log');
process.env.REQUEST_LOG = process.env.REQUEST_LOG || LOG_FILE;
process.env.DESKTOP_MODE = '1';

function writeLog(level, args) {
  fs.appendFile(LOG_FILE, `[${new Date().toISOString()}] ${level} ${util.format(...args)}\n`, () => {});
}

/**
 * หลังเปิดโปรแกรมเสร็จ ห้ามเขียนข้อความลงหน้าต่าง Command Prompt อีก
 * เพราะถ้าผู้ใช้คลิกในหน้าต่าง (QuickEdit) Windows จะหยุดโปรแกรมทันทีที่มีการเขียน → ทั้งระบบค้าง
 * ข้อความทั้งหมดจึงเขียนลงไฟล์ data/logs/server.log แทน
 */
function consoleToFile() {
  console.log = (...a) => writeLog('INFO', a);
  console.info = console.log;
  console.warn = (...a) => writeLog('WARN', a);
  console.error = (...a) => writeLog('ERROR', a);
}
process.on('uncaughtException', (e) => writeLog('FATAL', [e && e.stack ? e.stack : e]));
process.on('unhandledRejection', (e) => writeLog('ERROR', ['unhandledRejection', e && e.stack ? e.stack : e]));

function lanAddress() {
  const all = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      if (/vEthernet|VirtualBox|VMware|docker|vbox|utun|Hyper-V|WSL/i.test(name)) continue;
      all.push(a.address);
    }
  }
  const pref = all.find((ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip));
  return pref || all[0] || null;
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '0.0.0.0');
  });
}

function isOurApp(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/healthz', timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(res.statusCode === 200 && body.includes('"ok":true')));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function openBrowser(url) {
  if (process.env.NO_BROWSER) return;
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* ignore */ }
}

async function main() {
  const preferred = Number(process.env.PORT || 3000);
  // เปิดซ้ำ: ถ้าโปรแกรมทำงานอยู่แล้ว แค่เปิดเบราว์เซอร์
  if (await isOurApp(preferred)) {
    console.log(`โปรแกรมเปิดอยู่แล้ว — กำลังเปิดเบราว์เซอร์ http://localhost:${preferred}`);
    openBrowser(`http://localhost:${preferred}`);
    setTimeout(() => process.exit(0), 1500);
    return;
  }
  let port = preferred;
  while (!(await portFree(port)) && port < preferred + 20) port += 1;
  process.env.PORT = String(port);
  const ip = lanAddress();
  if (!process.env.BASE_URL && ip) process.env.BASE_URL = `http://${ip}:${port}`;

  require('./server');

  const local = `http://localhost:${port}`;
  const line = '='.repeat(64);
  console.log(`\n${line}\n  2D Animation Classroom — โปรแกรมพร้อมใช้งาน\n${line}`);
  console.log(`  เปิดบนเครื่องนี้ : ${local}`);
  if (ip) console.log(`  นักศึกษา (Wi-Fi เดียวกัน) : http://${ip}:${port}`);
  else console.log('  ไม่พบเครือข่าย LAN/Wi-Fi — นักศึกษาจะสแกน QR ไม่ได้จนกว่าจะต่อเครือข่าย');
  console.log(`  ข้อมูลเก็บที่ : ${DATA}`);
  console.log('  ** ห้ามปิดหน้าต่างนี้ระหว่างใช้งาน — ปิดหน้าต่างนี้ = ปิดโปรแกรม **');
  console.log('  ** อย่าคลิกในหน้าต่างนี้ — ถ้าเผลอคลิกแล้วโปรแกรมค้าง ให้กด Esc หรือ Enter **');
  console.log(`  บันทึกการทำงาน : ${LOG_FILE}`);
  console.log(`${line}\n`);
  consoleToFile();
  writeLog('INFO', [`started on ${local} (LAN ${ip || '-'}) node ${process.version} ${process.platform}`]);
  setTimeout(() => openBrowser(local), 800);
}

main().catch((e) => {
  console.error('เปิดโปรแกรมไม่สำเร็จ:', e);
  process.exitCode = 1;
});
