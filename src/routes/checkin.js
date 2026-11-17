'use strict';
/** S-03 QR Attendance — นักศึกษาต้อง Login ด้วยบัญชีตนเองก่อนเช็คชื่อ */
const express = require('express');
const att = require('../services/attendance');
const courseSvc = require('../services/course');
const { allow, wantsJson } = require('./guard');

const router = express.Router();
const S = allow('student');

router.get('/checkin', S, (req, res) => {
  const course = courseSvc.getCourse();
  const open = courseSvc.sessionsForStudent(course.id, req.user.user_id).filter((s) => s.attendance_state === 'open');
  const geo = !!course.geo_enabled && open.some((s) => att.geoCenter(s, course));
  res.page('student/checkin', { title: 'เช็คชื่อ', token: typeof req.query.t === 'string' ? req.query.t.slice(0, 100) : '', open, geo });
});

function clientContext(req) {
  const b = req.body || {};
  const geo = b.lat !== undefined && b.lat !== '' ? { lat: b.lat, lng: b.lng, accuracy: b.acc } : null;
  return { ip: req.ip, fingerprint: b.fp ? String(b.fp).slice(0, 200) : null, localDeviceId: b.lsid ? String(b.lsid).slice(0, 100) : null, geo };
}

router.post('/checkin', S, (req, res, next) => {
  try {
    const result = att.checkIn({
      userId: req.user.user_id,
      token: req.body.token ? String(req.body.token).slice(0, 100) : null,
      code: !req.body.token && req.body.code ? String(req.body.code).slice(0, 10) : null,
      deviceId: req.deviceId,
      ...clientContext(req),
    });
    if (wantsJson(req)) return res.json({ ok: true, status: result.status, warnings: result.warnings });
    return res.page('student/checkin_result', { title: 'ผลการเช็คชื่อ', ok: true, result, s: result.session, error: null });
  } catch (err) {
    if (!(err instanceof att.AttendanceError)) return next(err);
    if (wantsJson(req)) return res.status(err.status).json({ ok: false, code: err.code, error: err.message });
    const s = err.record ? courseSvc.getSession(err.record.session_id) : null;
    return res.status(err.status).page('student/checkin_result', { title: 'ผลการเช็คชื่อ', ok: false, error: err, result: err.record ? { record: err.record } : null, s }, { status: err.status });
  }
});

router.post('/checkin/verify', S, (req, res, next) => {
  try {
    att.verifyPresence(req.body.session_id, req.user.user_id, req.body.code);
    res.flash('success', 'ยืนยันการอยู่ในห้องเรียนเรียบร้อย');
  } catch (err) {
    if (!(err instanceof att.AttendanceError)) return next(err);
    res.flash('error', err.message);
  }
  return res.redirect(`/sessions/${encodeURIComponent(req.body.session_id)}`);
});

module.exports = router;
