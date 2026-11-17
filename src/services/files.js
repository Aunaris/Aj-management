'use strict';
/** ตรวจสอบชนิดไฟล์จากนามสกุล + magic bytes (ป้องกันการปลอมนามสกุลไฟล์อันตราย) */
const path = require('path');

const TYPES = {
  jpg: { mime: 'image/jpeg', kind: 'image' },
  jpeg: { mime: 'image/jpeg', kind: 'image' },
  png: { mime: 'image/png', kind: 'image' },
  gif: { mime: 'image/gif', kind: 'image' },
  webp: { mime: 'image/webp', kind: 'image' },
  mp4: { mime: 'video/mp4', kind: 'video' },
  mov: { mime: 'video/quicktime', kind: 'video' },
  webm: { mime: 'video/webm', kind: 'video' },
  pdf: { mime: 'application/pdf', kind: 'pdf' },
  zip: { mime: 'application/zip', kind: 'archive' },
  doc: { mime: 'application/msword', kind: 'document' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'document' },
  ppt: { mime: 'application/vnd.ms-powerpoint', kind: 'document' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'document' },
  xls: { mime: 'application/vnd.ms-excel', kind: 'document' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'document' },
  // ไฟล์ต้นฉบับงานแอนิเมชัน (ไม่รองรับ Preview — แสดงข้อมูลไฟล์และปุ่มดาวน์โหลด)
  fla: { mime: 'application/octet-stream', kind: 'source' },
  xfl: { mime: 'application/octet-stream', kind: 'source' },
  tbh: { mime: 'application/octet-stream', kind: 'source' },
  kra: { mime: 'application/octet-stream', kind: 'source' },
  psd: { mime: 'image/vnd.adobe.photoshop', kind: 'source' },
  aep: { mime: 'application/octet-stream', kind: 'source' },
  clip: { mime: 'application/octet-stream', kind: 'source' },
};

const BLOCKED = new Set(['exe', 'bat', 'cmd', 'com', 'sh', 'js', 'mjs', 'msi', 'ps1', 'vbs', 'jar', 'html', 'htm', 'svg', 'php', 'scr', 'dll', 'app', 'dmg']);

function ext(name) {
  return path.extname(String(name || '')).slice(1).toLowerCase();
}

const starts = (buf, bytes, offset = 0) => bytes.every((b, i) => buf[offset + i] === b);

/** คืนค่า true หากเนื้อไฟล์สอดคล้องกับนามสกุล (สำหรับชนิดที่มี signature ชัดเจน) */
function signatureMatches(extension, buf) {
  if (!buf || buf.length < 4) return false;
  const ZIP = [0x50, 0x4b];
  const OLE = [0xd0, 0xcf, 0x11, 0xe0];
  switch (extension) {
    case 'jpg': case 'jpeg': return starts(buf, [0xff, 0xd8, 0xff]);
    case 'png': return starts(buf, [0x89, 0x50, 0x4e, 0x47]);
    case 'gif': return starts(buf, [0x47, 0x49, 0x46, 0x38]);
    case 'webp': return starts(buf, [0x52, 0x49, 0x46, 0x46]) && buf.slice(8, 12).toString() === 'WEBP';
    case 'pdf': return starts(buf, [0x25, 0x50, 0x44, 0x46]);
    case 'zip': case 'docx': case 'pptx': case 'xlsx': case 'kra': case 'xfl': return starts(buf, ZIP);
    case 'doc': case 'ppt': case 'xls': return starts(buf, OLE);
    case 'mp4': case 'mov': return buf.length > 12 && ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(buf.slice(4, 8).toString());
    case 'webm': return starts(buf, [0x1a, 0x45, 0xdf, 0xa3]);
    case 'psd': return starts(buf, [0x38, 0x42, 0x50, 0x53]);
    case 'fla': return starts(buf, OLE) || starts(buf, ZIP);
    default: return true; // ไฟล์ต้นฉบับอื่น ๆ ไม่มี signature มาตรฐาน — อนุญาตตามรายการที่ผู้สอนกำหนด
  }
}

/**
 * @param {{originalname:string, buffer:Buffer, size:number}} file
 * @param {string[]} allowed รายการนามสกุลที่ Assignment อนุญาต
 * @param {number} maxMb
 */
function validate(file, allowed, maxMb) {
  const e = ext(file.originalname);
  if (!e || BLOCKED.has(e)) return `ไม่อนุญาตไฟล์ชนิด .${e || '?'}`;
  if (!allowed.includes(e)) return `ไฟล์ ${file.originalname}: ไม่อยู่ในชนิดที่อนุญาต (${allowed.join(', ')})`;
  if (!TYPES[e]) return `ไฟล์ ${file.originalname}: ระบบยังไม่รองรับชนิดนี้`;
  if (file.size > maxMb * 1024 * 1024) return `ไฟล์ ${file.originalname}: ขนาดเกิน ${maxMb} MB`;
  if (file.size === 0) return `ไฟล์ ${file.originalname}: ไฟล์ว่าง`;
  if (!signatureMatches(e, file.buffer)) return `ไฟล์ ${file.originalname}: เนื้อไฟล์ไม่ตรงกับนามสกุล`;
  return null;
}

function info(name) {
  const e = ext(name);
  return { ext: e, ...(TYPES[e] || { mime: 'application/octet-stream', kind: 'other' }) };
}

function sanitizeName(name) {
  return String(name || 'file').replace(/[\\/\0<>:"|?*\u0000-\u001f]/g, '_').slice(0, 180);
}

module.exports = { TYPES, validate, info, ext, sanitizeName, BLOCKED };
