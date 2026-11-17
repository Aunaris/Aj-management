'use strict';
const express = require('express');
const auth = require('../services/auth');
const audit = require('../services/audit');
const { allow, action } = require('./guard');

const router = express.Router();
const SECURE = process.env.COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production';

// Rate limit การเข้าสู่ระบบ (ต่อ IP + ชื่อผู้ใช้)
const attempts = new Map();
function limited(key) {
  const nowMs = Date.now();
  const list = (attempts.get(key) || []).filter((t) => nowMs - t < 15 * 60000);
  attempts.set(key, list);
  return list.length >= 10;
}

function safeNext(n) {
  return typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/';
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect(safeNext(req.query.next));
  res.page('login', { title: 'เข้าสู่ระบบ', next: safeNext(req.query.next), error: null, login: '' }, { bare: false });
});

router.post('/login', (req, res) => {
  const login = String(req.body.login || '').trim();
  const password = String(req.body.password || '');
  const next = safeNext(req.body.next);
  const key = `${req.ip}:${login.toLowerCase()}`;
  if (limited(key)) {
    return res.status(429).page('login', { title: 'เข้าสู่ระบบ', next, login, error: 'พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาที' }, { status: 429 });
  }
  const user = login ? auth.findUserByLogin(login) : null;
  if (!user || user.status !== 'active' || !auth.verifyPassword(password, user.password_hash)) {
    attempts.get(key).push(Date.now());
    return res.page('login', { title: 'เข้าสู่ระบบ', next, login, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }, { status: 401 });
  }
  attempts.delete(key);
  const token = auth.createSession(user.id, { deviceId: req.deviceId, userAgent: req.get('user-agent') });
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: SECURE, maxAge: 12 * 3600 * 1000 });
  audit.log(user.id, 'auth.login', 'user', user.id);
  return res.redirect(next);
});

router.post('/logout', (req, res) => {
  auth.endSession(req.cookies.sid);
  res.clearCookie('sid');
  res.redirect('/login');
});

router.get('/account/password', allow(), (req, res) => res.page('password', { title: 'เปลี่ยนรหัสผ่าน' }));

router.post('/account/password', allow(), action((req, res) => {
  const user = auth.getUser(req.user.user_id);
  const { current, password, confirm } = req.body;
  const errors = [];
  if (!auth.verifyPassword(current || '', user.password_hash)) errors.push('รหัสผ่านปัจจุบันไม่ถูกต้อง');
  if (!password || password.length < 8) errors.push('รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
  if (password !== confirm) errors.push('ยืนยันรหัสผ่านไม่ตรงกัน');
  if (password && password === current) errors.push('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
  if (errors.length) { res.flash('error', errors); return res.redirect('/account/password'); }
  auth.changePassword(user.id, password);
  audit.log(user.id, 'auth.password_change', 'user', user.id);
  res.flash('success', 'เปลี่ยนรหัสผ่านเรียบร้อย');
  return res.redirect('/');
}));

module.exports = router;
