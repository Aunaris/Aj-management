'use strict';
/** ผู้สอน: เชื่อมต่ออีเมลรับงาน + กล่องอีเมลส่งงานที่รอจัดการ */
const fs = require('fs');
const express = require('express');
const { get } = require('../db');
const courseSvc = require('../services/course');
const assignSvc = require('../services/assignments');
const mailin = require('../services/mailin');
const storage = require('../services/storage');
const { allow, action } = require('./guard');

const router = express.Router();
const T = allow('teacher');

const PRESETS = {
  gmail: { label: 'Gmail / Google Workspace (เช่น @mju.ac.th ถ้าใช้ Google)', host: 'imap.gmail.com', port: 993 },
  outlook: { label: 'Outlook.com / Microsoft 365', host: 'outlook.office365.com', port: 993 },
  yahoo: { label: 'Yahoo Mail', host: 'imap.mail.yahoo.com', port: 993 },
};

router.get('/mail', T, (req, res) => {
  const c = courseSvc.getCourse();
  const status = ['unmatched', 'error', 'imported', 'ignored'].includes(req.query.status) ? req.query.status : undefined;
  const all = mailin.inbox(c.id);
  res.page('teacher/mail', {
    title: 'รับงานทางอีเมล', acc: mailin.publicAccount(c.id), items: status ? all.filter((e) => e.status === status) : all, status, presets: PRESETS,
    counts: all.reduce((m, e) => { m[e.status] = (m[e.status] || 0) + 1; return m; }, {}),
    students: courseSvc.students(c.id), assignments: assignSvc.list(c.id).filter((a) => a.status !== 'draft' && a.submission_mode === 'online'),
  });
});

router.post('/mail/settings', T, action((req, res) => {
  mailin.saveAccount(courseSvc.getCourse().id, req.body, req.user.user_id);
  res.flash('success', 'บันทึกการตั้งค่าอีเมลแล้ว');
  res.redirect('/teacher/mail');
}));

router.post('/mail/remove', T, action((req, res) => {
  mailin.removeAccount(courseSvc.getCourse().id, req.user.user_id);
  res.flash('success', 'ยกเลิกการเชื่อมต่ออีเมลแล้ว (อีเมลที่นำเข้าแล้วยังอยู่ในระบบ)');
  res.redirect('/teacher/mail');
}));

router.post('/mail/test', T, action(async (req, res) => {
  try {
    const r = await mailin.testConnection(courseSvc.getCourse().id);
    res.flash('success', `เชื่อมต่อสำเร็จ — กล่อง ${mailin.getAccount(courseSvc.getCourse().id).mailbox} มี ${r.messages} ฉบับ (ยังไม่อ่าน ${r.unseen})`);
  } catch (e) {
    if (e.status) throw e;
    res.flash('error', `เชื่อมต่อไม่สำเร็จ: ${e.responseText || e.message} — ตรวจสอบ host/อีเมล/App Password และเปิดใช้ IMAP ในบัญชีอีเมล`);
  }
  res.redirect('/teacher/mail');
}));

router.post('/mail/poll', T, action(async (req, res) => {
  const r = await mailin.poll(courseSvc.getCourse().id, { force: true });
  if (r.errorMessage) res.flash('error', `ตรวจอีเมลไม่สำเร็จ: ${r.errorMessage}`);
  else if (r.skipped) res.flash('warning', r.skipped === 'running' ? 'กำลังตรวจอีเมลอยู่ ลองใหม่อีกครั้ง' : 'ยังไม่ได้ตั้งค่าอีเมล');
  else res.flash('success', `ตรวจอีเมล ${r.fetched} ฉบับ: นำเข้า ${r.imported} · รอจัดการ ${r.unmatched} · ไม่ผ่านเงื่อนไข ${r.error} · ไม่เกี่ยวข้อง ${r.skipped}`);
  res.redirect('/teacher/mail');
}));

router.post('/mail/:id/import', T, action((req, res) => {
  const r = mailin.importEmail(req.params.id, { studentId: req.body.student_id, assignmentId: req.body.assignment_id, actorId: req.user.user_id });
  if (r.ok) res.flash('success', `นำเข้าเป็นงานเวอร์ชัน ${r.submission.version} แล้ว`);
  else res.flash('error', ['นำเข้าไม่สำเร็จ', ...r.errors]);
  res.redirect('/teacher/mail#inbox');
}));

router.post('/mail/:id/ignore', T, action((req, res) => {
  mailin.ignore(req.params.id, req.user.user_id);
  res.redirect('/teacher/mail#inbox');
}));

router.get('/mail/attachment/:id', T, (req, res) => {
  const f = get().prepare('SELECT * FROM inbound_email_attachments WHERE id = ?').get(req.params.id);
  if (!f || !storage.exists(f.storage_key)) return res.status(404).send('ไม่พบไฟล์');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.file_name)}`);
  return fs.createReadStream(storage.resolve(f.storage_key)).pipe(res);
});

module.exports = router;
