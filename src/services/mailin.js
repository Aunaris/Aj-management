'use strict';
/**
 * รับงานที่นักศึกษาส่งทางอีเมล — เชื่อมกล่องอีเมลของอาจารย์ผ่าน IMAP (อ่านอย่างเดียว ไม่ลบ/ไม่ย้าย/ไม่ทำเครื่องหมายว่าอ่าน)
 * - เก็บเฉพาะอีเมลที่เกี่ยวกับรายวิชา: ผู้ส่งเป็นอีเมลของนักศึกษาในรายวิชา หรือหัวเรื่องมีรหัสวิชา/รหัสงาน/รหัสนักศึกษา
 * - จับคู่นักศึกษา: รหัสนักศึกษาในหัวเรื่อง > อีเมลผู้ส่ง
 * - จับคู่งาน: รหัสงาน (เช่น A01) ในหัวเรื่อง
 * - จับคู่ได้ครบ → สร้าง Submission (ไฟล์แนบ + ลิงก์ในเนื้อหา) โดยใช้เวลาที่เซิร์ฟเวอร์อีเมลได้รับ
 * - จับคู่ไม่ได้/ส่งไม่ผ่านเงื่อนไข → อยู่ในกล่อง "รอจัดการ" ให้อาจารย์เลือกนักศึกษา/งานเอง
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { simpleParser } = require('mailparser');
const { get, uuid, now } = require('../db');
const audit = require('./audit');
const notify = require('./notify');
const storage = require('./storage');
const filesSvc = require('./files');
const courseSvc = require('./course');
const assignSvc = require('./assignments');
const subSvc = require('./submissions');

const MAX_ATTACHMENT = 60 * 1024 * 1024;

/* ---------- เข้ารหัสรหัสผ่านอีเมล (AES-256-GCM) ---------- */
function secretKey() {
  if (process.env.APP_SECRET) return crypto.createHash('sha256').update(process.env.APP_SECRET).digest();
  const dbFile = process.env.DB_FILE || path.join(__dirname, '..', '..', 'data', 'classroom.db');
  const file = path.join(path.dirname(dbFile), 'secret.key');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

function decrypt(blob) {
  if (!blob) return null;
  const [, iv, tag, data] = blob.split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

/* ---------- ตั้งค่าบัญชี ---------- */
function getAccount(courseId) {
  return get().prepare('SELECT * FROM mail_accounts WHERE course_id = ?').get(courseId) || null;
}

function publicAccount(courseId) {
  const a = getAccount(courseId);
  if (!a) return null;
  const { password_enc: pw, ...rest } = a;
  return { ...rest, has_password: !!pw };
}

function saveAccount(courseId, input, actorId) {
  const errors = [];
  const host = String(input.imap_host || '').trim();
  const username = String(input.username || '').trim();
  const port = Number(input.imap_port) || 993;
  if (!/^[A-Za-z0-9.-]+$/.test(host)) errors.push('IMAP host ไม่ถูกต้อง');
  if (!/^[^\s@]+@[^\s@]+$/.test(username)) errors.push('กรุณาระบุอีเมลของอาจารย์');
  if (!(port > 0 && port < 65536)) errors.push('พอร์ตไม่ถูกต้อง');
  const existing = getAccount(courseId);
  if (!existing && !input.password) errors.push('กรุณาระบุรหัสผ่าน (App Password)');
  if (errors.length) throw Object.assign(new Error(errors.join('\n')), { status: 400, errors });
  const row = {
    imap_host: host, imap_port: port, imap_secure: input.imap_secure ? 1 : 0, username,
    mailbox: String(input.mailbox || 'INBOX').trim() || 'INBOX',
    days_back: Math.max(1, Math.min(120, Number(input.days_back) || 14)),
    poll_minutes: Math.max(1, Math.min(120, Number(input.poll_minutes) || 5)),
    enabled: input.enabled ? 1 : 0,
  };
  const pw = input.password ? encrypt(input.password) : existing.password_enc;
  const reset = existing && (existing.imap_host !== host || existing.username !== username || existing.mailbox !== row.mailbox);
  if (existing) {
    get().prepare(`UPDATE mail_accounts SET imap_host = ?, imap_port = ?, imap_secure = ?, username = ?, password_enc = ?, mailbox = ?, days_back = ?, poll_minutes = ?, enabled = ?,
      uid_validity = CASE WHEN ? THEN NULL ELSE uid_validity END, last_uid = CASE WHEN ? THEN NULL ELSE last_uid END, updated_by = ?, updated_at = ? WHERE course_id = ?`)
      .run(row.imap_host, row.imap_port, row.imap_secure, row.username, pw, row.mailbox, row.days_back, row.poll_minutes, row.enabled, reset ? 1 : 0, reset ? 1 : 0, actorId, now(), courseId);
  } else {
    get().prepare(`INSERT INTO mail_accounts (id, course_id, imap_host, imap_port, imap_secure, username, password_enc, mailbox, days_back, poll_minutes, enabled, updated_by, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(uuid(), courseId, row.imap_host, row.imap_port, row.imap_secure, row.username, pw, row.mailbox, row.days_back, row.poll_minutes, row.enabled, actorId, now());
  }
  audit.log(actorId, 'mail.settings', 'course', courseId, { host, username, mailbox: row.mailbox, enabled: !!row.enabled, passwordChanged: !!input.password });
}

function removeAccount(courseId, actorId) {
  get().prepare('DELETE FROM mail_accounts WHERE course_id = ?').run(courseId);
  audit.log(actorId, 'mail.remove', 'course', courseId);
}

/* ---------- การจับคู่ ---------- */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const token = (code) => new RegExp(`(^|[^A-Za-z0-9])${escapeRe(code)}([^A-Za-z0-9]|$)`, 'i');

function extractUrls(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) out.add(m[0].replace(/[.,;:!?]+$/, ''));
  return [...out].slice(0, 10);
}

function match(courseId, { fromAddress, subject }) {
  const students = courseSvc.students(courseId);
  const subj = String(subject || '');
  let student = null;
  let studentBy = null;
  const byCode = students.filter((s) => s.student_code && token(s.student_code).test(subj));
  if (byCode.length === 1) { student = byCode[0]; studentBy = 'code'; }
  if (!student && fromAddress) {
    const byMail = students.filter((s) => s.email && s.email.toLowerCase() === fromAddress.toLowerCase());
    if (byMail.length === 1) { student = byMail[0]; studentBy = 'email'; }
  }
  const assignments = assignSvc.list(courseId).filter((a) => a.status !== 'draft' && a.submission_mode === 'online');
  const hits = assignments.filter((a) => token(a.assignment_code).test(subj));
  const assignment = hits.length === 1 ? hits[0] : null;
  const course = get().prepare('SELECT course_code FROM courses WHERE id = ?').get(courseId);
  const relevant = !!student || hits.length > 0 || (course && subj.includes(course.course_code));
  return { student, studentBy, assignment, ambiguousAssignment: hits.length > 1, relevant };
}

function attachmentsOf(emailId) {
  return get().prepare('SELECT * FROM inbound_email_attachments WHERE email_id = ? ORDER BY rowid').all(emailId);
}

/** นำอีเมลเข้าเป็น Submission */
function importEmail(emailId, { studentId, assignmentId, actorId = null }) {
  const e = get().prepare('SELECT * FROM inbound_emails WHERE id = ?').get(emailId);
  if (!e) throw Object.assign(new Error('ไม่พบอีเมล'), { status: 404 });
  if (e.status === 'imported') throw Object.assign(new Error('อีเมลนี้นำเข้าแล้ว'), { status: 400 });
  const a = assignSvc.getAssignment(assignmentId);
  const links = a && a.allow_links ? extractUrls(e.body_text).map((url) => ({ url, title: 'ลิงก์จากอีเมล' })) : [];
  const files = attachmentsOf(emailId).map((f) => {
    const buffer = fs.readFileSync(storage.resolve(f.storage_key));
    return { originalname: f.file_name, buffer, size: buffer.length };
  });
  try {
    const r = subSvc.submit({
      assignmentId, studentId, files, links, at: new Date(e.received_at), source: 'email',
      note: `ส่งทางอีเมล: ${e.subject || '(ไม่มีหัวเรื่อง)'}${e.body_text ? `\n${e.body_text.slice(0, 1500)}` : ''}`,
    });
    get().prepare("UPDATE inbound_emails SET status = 'imported', student_id = ?, assignment_id = ?, submission_id = ?, note = NULL, handled_by = ? WHERE id = ?")
      .run(studentId, assignmentId, r.id, actorId, emailId);
    audit.log(actorId, 'mail.import', 'inbound_email', emailId, { studentId, assignmentId, submissionId: r.id, version: r.version });
    return { ok: true, submission: r };
  } catch (err) {
    if (!err.errors) throw err;
    get().prepare("UPDATE inbound_emails SET status = 'error', student_id = ?, assignment_id = ?, note = ?, handled_by = ? WHERE id = ?")
      .run(studentId, assignmentId, err.errors.join('; '), actorId, emailId);
    return { ok: false, errors: err.errors };
  }
}

/**
 * ประมวลผลอีเมลดิบ 1 ฉบับ
 * @param {Buffer|string} raw RFC822
 * @param {{uid?:number, receivedAt?:Date}} meta receivedAt = เวลาที่เซิร์ฟเวอร์อีเมลได้รับ (ใช้ตัดสินส่งล่าช้า)
 */
async function ingestRaw(courseId, raw, { uid = null, receivedAt = null, ownAddress = null } = {}) {
  const mail = await simpleParser(raw);
  const messageId = mail.messageId || `no-id:${crypto.createHash('sha256').update(raw).digest('hex')}`;
  if (get().prepare('SELECT 1 FROM inbound_emails WHERE message_id = ?').get(messageId)) return { status: 'duplicate' };
  const from = mail.from && mail.from.value && mail.from.value[0] ? mail.from.value[0] : {};
  const fromAddress = (from.address || '').toLowerCase();
  if (ownAddress && fromAddress === ownAddress.toLowerCase()) return { status: 'skipped' };
  const subject = mail.subject || '';
  const m = match(courseId, { fromAddress, subject });
  if (!m.relevant) return { status: 'skipped' };

  const received = receivedAt || mail.date || new Date();
  const id = uuid();
  const body = String(mail.text || '').replace(/\r/g, '').slice(0, 20000);
  get().prepare(`INSERT INTO inbound_emails (id, course_id, message_id, imap_uid, from_address, from_name, subject, body_text, received_at, status, student_id, assignment_id, created_at)
    VALUES (?,?,?,?,?,?,?,?,?, 'unmatched', ?, ?, ?)`)
    .run(id, courseId, messageId, uid, fromAddress || null, from.name || null, subject.slice(0, 500), body, new Date(received).toISOString(),
      m.student ? m.student.id : null, m.assignment ? m.assignment.id : null, now());
  for (const att of mail.attachments || []) {
    const inlineSig = att.related || (att.contentDisposition === 'inline' && att.cid && !att.filename);
    if (inlineSig || !att.content || att.size > MAX_ATTACHMENT) continue;
    const name = filesSvc.sanitizeName(att.filename || `attachment.${(att.contentType || '').split('/')[1] || 'bin'}`);
    const s = storage.put(att.content, 'email');
    get().prepare('INSERT INTO inbound_email_attachments (id, email_id, file_name, storage_key, mime_type, file_size) VALUES (?,?,?,?,?,?)')
      .run(uuid(), id, name, s.key, att.contentType || null, att.content.length);
  }

  if (m.student && m.assignment) {
    const r = importEmail(id, { studentId: m.student.id, assignmentId: m.assignment.id });
    if (!r.ok) notifyTeachers(courseId, id, `อีเมลส่งงานไม่ผ่านเงื่อนไข: ${subject}`, r.errors.join('; '));
    return { status: r.ok ? 'imported' : 'error', id };
  }
  const why = [!m.student ? 'ไม่พบนักศึกษา (ใส่รหัสนักศึกษาในหัวเรื่อง หรือส่งจากอีเมลที่ลงทะเบียน)' : null,
    !m.assignment ? (m.ambiguousAssignment ? 'พบรหัสงานมากกว่า 1 รายการ' : 'ไม่พบรหัสงานในหัวเรื่อง') : null].filter(Boolean).join('; ');
  get().prepare('UPDATE inbound_emails SET note = ? WHERE id = ?').run(why, id);
  notifyTeachers(courseId, id, `อีเมลส่งงานที่ต้องจัดการ: ${subject || fromAddress}`, why);
  return { status: 'unmatched', id };
}

function notifyTeachers(courseId, emailId, title, message) {
  notify.sendMany(courseSvc.teacherIds(courseId), {
    eventType: 'submission_new', title, message, link: '/teacher/mail#inbox', entityType: 'inbound_email', entityId: emailId, dedupeKey: `mail:${emailId}`,
  });
}

/* ---------- IMAP ---------- */
function client(acc) {
  const { ImapFlow } = require('imapflow');
  return new ImapFlow({
    host: acc.imap_host, port: acc.imap_port, secure: !!acc.imap_secure,
    auth: { user: acc.username, pass: decrypt(acc.password_enc) }, logger: false, socketTimeout: 60000,
  });
}

async function testConnection(courseId) {
  const acc = getAccount(courseId);
  if (!acc) throw Object.assign(new Error('ยังไม่ได้ตั้งค่าบัญชีอีเมล'), { status: 400 });
  const c = client(acc);
  try {
    await c.connect();
    const st = await c.status(acc.mailbox, { messages: true, unseen: true });
    return { ok: true, messages: st.messages, unseen: st.unseen };
  } finally {
    await c.logout().catch(() => {});
  }
}

let running = false;
/** ดึงอีเมลใหม่ (เรียกจาก scheduler ทุก poll_minutes หรือกดจากหน้าเว็บ) */
async function poll(courseId, { force = false } = {}) {
  const acc = getAccount(courseId);
  if (!acc || (!acc.enabled && !force)) return { skipped: 'disabled' };
  if (!force && acc.last_checked_at && Date.now() - Date.parse(acc.last_checked_at) < acc.poll_minutes * 60000) return { skipped: 'not_due' };
  if (running) return { skipped: 'running' };
  running = true;
  const result = { fetched: 0, imported: 0, unmatched: 0, error: 0, skipped: 0 };
  const c = client(acc);
  try {
    await c.connect();
    const lock = await c.getMailboxLock(acc.mailbox, { readOnly: true });
    try {
      const validity = String(c.mailbox.uidValidity);
      let lastUid = acc.uid_validity === validity ? acc.last_uid : null;
      const since = new Date(Date.now() - acc.days_back * 86400000);
      let uids;
      const firstRun = !lastUid;
      if (lastUid) {
        uids = ((await c.search({ uid: `${lastUid + 1}:*` }, { uid: true })) || []).filter((u) => u > lastUid);
      } else {
        uids = (await c.search({ since }, { uid: true })) || [];
        // บางเซิร์ฟเวอร์ไม่รองรับ SINCE — ใช้ UID ล่าสุดแล้วกรองด้วยวันที่ได้รับแทน
        if (!uids.length) uids = ((await c.search({ all: true }, { uid: true })) || []).slice(-300);
      }
      uids.sort((a, b) => a - b);
      for (const uid of uids.slice(0, 500)) {
        const msg = await c.fetchOne(String(uid), { source: true, internalDate: true }, { uid: true });
        lastUid = Math.max(lastUid || 0, uid);
        if (!msg || !msg.source) continue;
        if (firstRun && msg.internalDate && new Date(msg.internalDate) < since) continue;
        result.fetched += 1;
        try {
          const r = await ingestRaw(courseId, msg.source, { uid, receivedAt: msg.internalDate, ownAddress: acc.username });
          if (result[r.status] !== undefined) result[r.status] += 1;
        } catch (e) { result.error += 1; console.error('mail ingest error', e.message); }
      }
      get().prepare('UPDATE mail_accounts SET uid_validity = ?, last_uid = ?, last_checked_at = ?, last_error = NULL WHERE course_id = ?')
        .run(validity, lastUid, now(), courseId);
    } finally {
      lock.release();
    }
  } catch (e) {
    get().prepare('UPDATE mail_accounts SET last_checked_at = ?, last_error = ? WHERE course_id = ?').run(now(), String(e.responseText || e.message).slice(0, 500), courseId);
    result.errorMessage = String(e.responseText || e.message);
  } finally {
    running = false;
    await c.logout().catch(() => {});
  }
  return result;
}

function inbox(courseId, { status } = {}) {
  return get().prepare(`SELECT e.*, u.full_name AS student_name, u.student_code, a.assignment_code, a.title AS assignment_title
    FROM inbound_emails e LEFT JOIN users u ON u.id = e.student_id LEFT JOIN assignments a ON a.id = e.assignment_id
    WHERE e.course_id = ? ${status ? 'AND e.status = ?' : ''} ORDER BY e.received_at DESC LIMIT 300`).all(...(status ? [courseId, status] : [courseId]))
    .map((e) => ({ ...e, attachments: attachmentsOf(e.id) }));
}

function ignore(emailId, actorId) {
  get().prepare("UPDATE inbound_emails SET status = 'ignored', handled_by = ? WHERE id = ? AND status != 'imported'").run(actorId, emailId);
  audit.log(actorId, 'mail.ignore', 'inbound_email', emailId);
}

module.exports = {
  encrypt, decrypt, getAccount, publicAccount, saveAccount, removeAccount, match, extractUrls, ingestRaw, importEmail, testConnection, poll, inbox, ignore, attachmentsOf,
};
