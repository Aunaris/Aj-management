'use strict';
/** Helpers สำหรับเวลา (เขตเวลาไทย) และการแสดงผล */

const TZ_OFFSET = process.env.APP_TZ_OFFSET || '+07:00';
const offsetMinutes = (() => {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(TZ_OFFSET);
  if (!m) return 420;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
})();

/** วันที่ปัจจุบันตามเวลาท้องถิ่น (YYYY-MM-DD) */
function localToday(date = new Date()) {
  return new Date(date.getTime() + offsetMinutes * 60000).toISOString().slice(0, 10);
}

/** แปลงวันที่+เวลาท้องถิ่น ('2026-06-15', '09:00') เป็น Date */
function localDateTime(dateStr, timeStr = '00:00') {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T${(timeStr || '00:00').slice(0, 5)}:00${TZ_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** แปลงค่าจาก <input type="datetime-local"> (เวลาท้องถิ่น) เป็น ISO UTC */
function fromLocalInput(value) {
  if (!value) return null;
  const [d, t] = String(value).split('T');
  const dt = localDateTime(d, t || '23:59');
  return dt ? dt.toISOString() : null;
}

/** แปลง ISO UTC เป็นค่าสำหรับ <input type="datetime-local"> */
function toLocalInput(iso) {
  if (!iso) return '';
  return new Date(Date.parse(iso) + offsetMinutes * 60000).toISOString().slice(0, 16);
}

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function thaiDate(value, { time = false } = {}) {
  if (!value) return '—';
  let d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) d = localDateTime(value);
  else d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const local = new Date(d.getTime() + offsetMinutes * 60000);
  const s = `${local.getUTCDate()} ${TH_MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear() + 543}`;
  if (!time) return s;
  return `${s} ${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')} น.`;
}

function fmtScore(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const n = Math.round(Number(v) * 10 ** digits) / 10 ** digits;
  return String(n);
}

function round2(v) {
  return Math.round(Number(v) * 100) / 100;
}

function fileSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** ข้อความและสีของสถานะต่าง ๆ (UX: ข้อความ + สีแตกต่างชัดเจน) */
const STATUS = {
  attendance: {
    present: ['มาเรียน', 'ok'], late: ['มาสาย', 'warn'], absent: ['ขาดเรียน', 'bad'], leave: ['ลา', 'info'], none: ['ยังไม่เช็คชื่อ', 'muted'],
  },
  method: { qr: ['QR', 'info'], code: ['รหัส', 'info'], manual: ['Manual', 'muted'] },
  session: {
    draft: ['ร่าง', 'muted'], published: ['เผยแพร่', 'info'], completed: ['สอนแล้ว', 'ok'], cancelled: ['ยกเลิก', 'bad'],
  },
  attendanceState: { not_started: ['ยังไม่เปิดเช็คชื่อ', 'muted'], open: ['เปิดเช็คชื่อ', 'ok'], closed: ['ปิดเช็คชื่อแล้ว', 'muted'] },
  assignment: { draft: ['Draft', 'muted'], published: ['เปิดรับงาน', 'ok'], closed: ['ปิดรับแล้ว', 'warn'] },
  submission: {
    none: ['ยังไม่ส่ง', 'muted'], draft: ['Draft', 'muted'], submitted: ['ส่งแล้ว', 'info'], late: ['ส่งล่าช้า', 'warn'],
    resubmitted: ['ส่งใหม่', 'info'], under_review: ['กำลังตรวจ', 'info'], reviewed: ['ตรวจแล้ว', 'ok'], revision_requested: ['ขอให้แก้ไข', 'bad'],
  },
  grade: {
    not_graded: ['ยังไม่ตรวจ', 'muted'], draft: ['Draft', 'warn'], published: ['เผยแพร่แล้ว', 'ok'], revision_requested: ['ขอให้แก้ไข', 'bad'], locked: ['ล็อกแล้ว', 'info'],
  },
  risk: { low: ['ต่ำ', 'info'], medium: ['กลาง', 'warn'], high: ['สูง', 'bad'] },
  review: { pending: ['รอตรวจสอบ', 'warn'], dismissed: ['ไม่พบปัญหา', 'ok'], confirmed: ['ยืนยันผิดปกติ', 'bad'] },
  appeal: { pending: ['รอพิจารณา', 'warn'], approved: ['อนุมัติ', 'ok'], rejected: ['ไม่อนุมัติ', 'bad'] },
  link: { unchecked: ['ยังไม่ตรวจ', 'muted'], accessible: ['เปิดได้', 'ok'], permission_required: ['ต้องขอสิทธิ์', 'warn'], invalid_url: ['URL ไม่ถูกต้อง', 'bad'] },
};

const RISK_TYPES = {
  multi_account_device: 'อุปกรณ์เดียวเช็คชื่อหลายบัญชี',
  multi_device_account: 'บัญชีเดียวใช้งานหลายอุปกรณ์พร้อมกัน',
  rapid_requests: 'ส่งคำขอเช็คชื่อถี่ผิดปกติ',
  after_close: 'พยายามเช็คชื่อหลังปิด Session',
  device_changed: 'เช็คชื่อจากอุปกรณ์ที่ไม่ใช่อุปกรณ์หลัก',
  token_reuse: 'พยายามใช้ Token ซ้ำ',
  geo_out_of_range: 'เช็คชื่อจากนอกพื้นที่ห้องเรียน (GPS)',
  same_fingerprint: 'ลักษณะเบราว์เซอร์ซ้ำกับบัญชีอื่น (อาจเป็นมือถือรุ่นเดียวกัน)',
};

function badge(group, key) {
  const def = (STATUS[group] && STATUS[group][key]) || [key || '—', 'muted'];
  return `<span class="badge ${def[1]}">${def[0]}</span>`;
}

function label(group, key) {
  const def = STATUS[group] && STATUS[group][key];
  return def ? def[0] : key;
}

function escapeCsv(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV พร้อม BOM เพื่อให้ Excel เปิดภาษาไทยได้ถูกต้อง */
function toCsv(headers, rows) {
  const lines = [headers.map(escapeCsv).join(',')];
  for (const r of rows) lines.push(r.map(escapeCsv).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = {
  localToday, localDateTime, fromLocalInput, toLocalInput, thaiDate, fmtScore, round2, fileSize,
  STATUS, RISK_TYPES, badge, label, toCsv, TZ_OFFSET,
};
