'use strict';
/**
 * File storage abstraction — แยกไฟล์ออกจากฐานข้อมูล (ฐานข้อมูลเก็บเฉพาะ Metadata + Storage Key)
 * รุ่นนี้ใช้ดิสก์ภายในเครื่อง (STORAGE_DIR) สามารถเปลี่ยนเป็น S3-compatible Object Storage
 * ได้โดยเขียน driver ที่มี put/stream/remove ชุดเดียวกัน
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = () => process.env.STORAGE_DIR || path.join(__dirname, '..', '..', 'storage');

function put(buffer, prefix = 'misc') {
  const key = `${prefix}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}`;
  const full = path.join(ROOT(), key);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer, { flag: 'wx' }); // ไม่เขียนทับไฟล์เดิม
  return { key, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
}

function resolve(key) {
  const root = path.resolve(ROOT());
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error('invalid storage key');
  return full;
}

function exists(key) {
  try { return fs.statSync(resolve(key)).isFile(); } catch { return false; }
}

module.exports = { put, resolve, exists };
