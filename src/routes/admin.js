'use strict';
/** Admin — จัดการบัญชีผู้ใช้ (Permission Matrix: เฉพาะ Admin) */
const express = require('express');
const { get, now } = require('../db');
const auth = require('../services/auth');
const audit = require('../services/audit');
const courseSvc = require('../services/course');
const { allow, action } = require('./guard');

const router = express.Router();
const A = allow('admin');

router.get('/', A, (req, res) => {
  const users = get().prepare(`SELECT u.id, u.username, u.student_code, u.full_name, u.email, u.status, u.created_at, r.role_name AS role
    FROM users u JOIN roles r ON r.id = u.role_id ORDER BY r.role_name, u.student_code, u.username`).all();
  res.page('admin/users', { title: 'จัดการผู้ใช้', users });
});

router.post('/users', A, action((req, res) => {
  const role = ['teacher', 'admin', 'student'].includes(req.body.role) ? req.body.role : null;
  const username = String(req.body.username || '').trim();
  const fullName = String(req.body.full_name || '').trim();
  const password = String(req.body.password || '');
  const errors = [];
  if (!role) errors.push('กรุณาเลือกบทบาท');
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) errors.push('ชื่อผู้ใช้ต้องเป็นอักษรอังกฤษ/ตัวเลข 3–40 ตัว');
  if (!fullName) errors.push('กรุณาระบุชื่อ-นามสกุล');
  if (password.length < 8) errors.push('รหัสผ่านเริ่มต้นต้องมีอย่างน้อย 8 ตัวอักษร');
  if (get().prepare('SELECT 1 FROM users WHERE username = ? OR student_code = ?').get(username, username)) errors.push('ชื่อผู้ใช้นี้มีอยู่แล้ว');
  if (errors.length) throw Object.assign(new Error(errors.join('\n')), { status: 400, errors });
  const id = auth.createUser({ username, fullName, email: req.body.email, password, role, studentCode: role === 'student' ? username : null, mustChangePassword: 1 });
  if (role !== 'admin') courseSvc.enroll(courseSvc.getCourse().id, id);
  audit.log(req.user.user_id, 'user.create', 'user', id, { role, username });
  res.flash('success', `สร้างบัญชี ${username} แล้ว`);
  res.redirect('/admin');
}));

router.post('/users/:id/status', A, action((req, res) => {
  if (req.params.id === req.user.user_id) throw Object.assign(new Error('ไม่สามารถปิดบัญชีของตนเองได้'), { status: 400 });
  const status = req.body.status === 'disabled' ? 'disabled' : 'active';
  get().prepare('UPDATE users SET status = ? WHERE id = ?').run(status, req.params.id);
  if (status === 'disabled') get().prepare('UPDATE auth_sessions SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL').run(now(), req.params.id);
  audit.log(req.user.user_id, 'user.status', 'user', req.params.id, { status });
  res.flash('success', 'อัปเดตสถานะบัญชีแล้ว');
  res.redirect('/admin');
}));

router.post('/users/:id/password', A, action((req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 8) throw Object.assign(new Error('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'), { status: 400 });
  auth.changePassword(req.params.id, password);
  get().prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(req.params.id);
  get().prepare('UPDATE auth_sessions SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL').run(now(), req.params.id);
  audit.log(req.user.user_id, 'user.reset_password', 'user', req.params.id);
  res.flash('success', 'ตั้งรหัสผ่านใหม่แล้ว (ผู้ใช้ต้องเปลี่ยนเมื่อเข้าสู่ระบบ)');
  res.redirect('/admin');
}));

/** สำรองฐานข้อมูล (NFR-10) — ดาวน์โหลดสำเนา SQLite ที่สอดคล้อง */
router.get('/backup', A, async (req, res) => {
  const path = require('path');
  const os = require('os');
  const fs = require('fs');
  const file = path.join(os.tmpdir(), `classroom-backup-${Date.now()}.db`);
  await get().backup(file);
  audit.log(req.user.user_id, 'backup.download', 'system', null);
  res.download(file, `classroom-backup-${new Date().toISOString().slice(0, 10)}.db`, () => fs.unlink(file, () => {}));
});

module.exports = router;
