'use strict';
/**
 * S-03 QR Attendance — 2 รูปแบบ (ตั้งค่าได้ที่ ตั้งค่ารายวิชา)
 * - student_code (ค่าเริ่มต้น): นักศึกษาไม่ต้องมีบัญชี สแกน QR แล้วกรอกรหัสนักศึกษา
 * - login: นักศึกษาต้องเข้าสู่ระบบด้วยบัญชีตนเองก่อนเช็คชื่อ
 */
const crypto = require('crypto');
const express = require('express');
const { get, now } = require('../db');
const att = require('../services/attendance');
const courseSvc = require('../services/course');
const { sha256 } = require('../services/auth');
const { allow, wantsJson } = require('./guard');

const router = express.Router();
const SECURE = process.env.COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production';
const DEVICE_LIMIT = 10; // คำขอต่อเครื่องต่อนาที (กันการสุ่มรหัสนักศึกษา)

const codeMode = (course) => (course.checkin_mode || 'student_code') === 'student_code';
const isStudent = (req) => req.user && req.user.role === 'student';

function clientContext(req) {
  const b = req.body || {};
  const geo = b.lat !== undefined && b.lat !== '' ? { lat: b.lat, lng: b.lng, accuracy: b.acc } : null;
  return { ip: req.ip, fingerprint: b.fp ? String(b.fp).slice(0, 200) : null, localDeviceId: b.lsid ? String(b.lsid).slice(0, 100) : null, geo };
}

/** CSRF แบบ double-submit cookie สำหรับผู้ที่ไม่ได้เข้าสู่ระบบ */
function publicToken(req, res) {
  let t = req.cookies.cks;
  if (!t || !/^[A-Za-z0-9_-]{20,64}$/.test(t)) {
    t = crypto.randomBytes(18).toString('base64url');
    res.cookie('cks', t, { httpOnly: true, sameSite: 'strict', secure: SECURE, maxAge: 7 * 86400000 });
  }
  return t;
}

function checkPublicToken(req) {
  const a = String(req.body._ck || req.get('x-checkin-token') || '');
  const b = String(req.cookies.cks || '');
  if (!a || a.length !== b.length || !crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))) {
    throw new att.AttendanceError('bad_request', 'หน้าเว็บหมดอายุ กรุณาสแกน QR ใหม่อีกครั้ง', 403);
  }
}

function deviceRateLimit(req) {
  const since = new Date(Date.now() - 60000).toISOString();
  const n = get().prepare('SELECT COUNT(*) c FROM attendance_attempts WHERE device_id_hash = ? AND created_at >= ?').get(sha256(req.deviceId), since).c;
  if (n >= DEVICE_LIMIT) throw new att.AttendanceError('rate_limited', 'ส่งคำขอถี่เกินไป กรุณารอ 1 นาทีแล้วลองใหม่', 429);
}

function findStudentByCode(courseId, raw) {
  const code = String(raw || '').replace(/\s+/g, '').trim();
  if (!/^[0-9A-Za-z-]{3,20}$/.test(code)) throw new att.AttendanceError('invalid_student', 'กรุณากรอกรหัสนักศึกษาให้ถูกต้อง');
  const st = courseSvc.students(courseId).find((s) => s.student_code === code);
  if (!st) throw new att.AttendanceError('invalid_student', `ไม่พบรหัสนักศึกษา ${code} ในรายวิชานี้ — ตรวจสอบรหัสอีกครั้ง หรือแจ้งผู้สอน`, 404);
  return st;
}

/** แสดงชื่อแบบปิดบางส่วน (ให้ตรวจว่ากรอกรหัสถูกคน โดยไม่เปิดเผยชื่อเต็มให้ผู้อื่นที่เดารหัส) */
function maskName(name) {
  const parts = String(name || '').split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const first = parts[0];
  const last = parts.slice(1).join(' ');
  return `${first}${last ? ` ${[...last].slice(0, 1).join('')}${'•'.repeat(Math.max(2, Math.min(6, [...last].length - 1)))}` : ''}`;
}

router.get('/checkin', (req, res, next) => {
  const course = courseSvc.getCourse();
  const token = typeof req.query.t === 'string' ? req.query.t.slice(0, 100) : '';
  if (!codeMode(course) || isStudent(req)) {
    // โหมดเข้าสู่ระบบ (หรือนักศึกษาที่ล็อกอินอยู่แล้ว)
    return allow('student')(req, res, () => {
      const open = courseSvc.sessionsForStudent(course.id, req.user.user_id).filter((s) => s.attendance_state === 'open');
      const geo = !!course.geo_enabled && open.some((s) => att.geoCenter(s, course));
      res.page('student/checkin', { title: 'เช็คชื่อ', token, open, geo });
    });
  }
  const open = courseSvc.sessions(course.id).filter((s) => s.attendance_state === 'open');
  const geo = !!course.geo_enabled && open.some((s) => att.geoCenter(s, course));
  return res.page('student/checkin_public', { title: 'เช็คชื่อ', token, open, geo, ck: publicToken(req, res) });
});

function renderResult(req, res, { ok, result, err, publicMode }) {
  if (wantsJson(req)) {
    if (ok) return res.json({ ok: true, status: result.status, warnings: result.warnings, name: publicMode ? maskName(result.studentName) : undefined });
    return res.status(err.status).json({ ok: false, code: err.code, error: err.message });
  }
  if (ok) {
    return res.page('student/checkin_result', {
      title: 'ผลการเช็คชื่อ', ok: true, result, s: result.session, error: null, publicMode,
      who: publicMode ? { code: result.studentCode, name: maskName(result.studentName) } : null, ck: publicMode ? publicToken(req, res) : null,
    });
  }
  const s = err.record ? courseSvc.getSession(err.record.session_id) : null;
  return res.status(err.status).page('student/checkin_result', {
    title: 'ผลการเช็คชื่อ', ok: false, error: err, result: err.record ? { record: err.record } : null, s, publicMode, who: null, ck: null,
  }, { status: err.status });
}

router.post('/checkin', (req, res, next) => {
  const course = courseSvc.getCourse();
  const publicMode = codeMode(course) && !isStudent(req);
  try {
    let userId;
    let st = null;
    if (publicMode) {
      checkPublicToken(req);
      deviceRateLimit(req);
      st = findStudentByCode(course.id, req.body.student_code);
      userId = st.id;
    } else {
      if (!isStudent(req)) return allow('student')(req, res, next);
      userId = req.user.user_id;
    }
    const result = att.checkIn({
      userId,
      token: req.body.token ? String(req.body.token).slice(0, 100) : null,
      code: !req.body.token && req.body.code ? String(req.body.code).slice(0, 10) : null,
      deviceId: req.deviceId,
      ...clientContext(req),
    });
    if (st) { result.studentCode = st.student_code; result.studentName = st.full_name; }
    return renderResult(req, res, { ok: true, result, publicMode });
  } catch (err) {
    if (!(err instanceof att.AttendanceError)) return next(err);
    if (publicMode && err.code !== 'invalid_student' && err.code !== 'bad_request') {
      // บันทึกคำขอที่ล้มเหลวต่อเครื่อง (ใช้จำกัดความถี่)
      get().prepare('INSERT INTO attendance_attempts (id, session_id, user_id, device_id_hash, result, created_at, ip_address) VALUES (?,?,?,?,?,?,?)')
        .run(crypto.randomUUID(), null, 'anonymous', sha256(req.deviceId), `public_${err.code}`, now(), req.ip);
    } else if (publicMode && err.code === 'invalid_student') {
      get().prepare('INSERT INTO attendance_attempts (id, session_id, user_id, device_id_hash, result, created_at, ip_address) VALUES (?,?,?,?,?,?,?)')
        .run(crypto.randomUUID(), null, 'anonymous', sha256(req.deviceId), 'invalid_student', now(), req.ip);
    }
    return renderResult(req, res, { ok: false, err, publicMode });
  }
});

/** ยืนยันการอยู่ในห้อง: ต้องเป็นเครื่องเดียวกับที่ใช้เช็คชื่อ */
router.post('/checkin/verify', (req, res, next) => {
  const course = courseSvc.getCourse();
  const publicMode = codeMode(course) && !isStudent(req);
  try {
    if (publicMode) {
      checkPublicToken(req);
      deviceRateLimit(req);
      const st = findStudentByCode(course.id, req.body.student_code);
      const rec = get().prepare('SELECT * FROM attendance_records WHERE session_id = ? AND student_id = ?').get(req.body.session_id, st.id);
      if (!rec || rec.device_id_hash !== sha256(req.deviceId)) {
        throw new att.AttendanceError('device_mismatch', 'ต้องยืนยันจากเครื่องเดียวกับที่ใช้เช็คชื่อ');
      }
      att.verifyPresence(req.body.session_id, st.id, req.body.code);
      if (wantsJson(req)) return res.json({ ok: true });
      return res.page('student/checkin_result', {
        title: 'ยืนยันแล้ว', ok: true, verifiedOnly: true, publicMode, s: courseSvc.getSession(req.body.session_id), error: null,
        result: { record: get().prepare('SELECT * FROM attendance_records WHERE id = ?').get(rec.id), status: rec.attendance_status, warnings: [] },
        who: { code: st.student_code, name: maskName(st.full_name) }, ck: null,
      });
    }
    if (!isStudent(req)) return allow('student')(req, res, next);
    att.verifyPresence(req.body.session_id, req.user.user_id, req.body.code);
    res.flash('success', 'ยืนยันการอยู่ในห้องเรียนเรียบร้อย');
    return res.redirect(`/sessions/${encodeURIComponent(req.body.session_id)}`);
  } catch (err) {
    if (!(err instanceof att.AttendanceError)) return next(err);
    if (publicMode) return renderResult(req, res, { ok: false, err, publicMode });
    res.flash('error', err.message);
    return res.redirect(`/sessions/${encodeURIComponent(req.body.session_id)}`);
  }
});

module.exports = router;
module.exports.maskName = maskName;
