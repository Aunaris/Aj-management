'use strict';
const fs = require('fs');
const express = require('express');
const { get } = require('../db');
const courseSvc = require('../services/course');
const assignSvc = require('../services/assignments');
const submissionsSvc = require('../services/submissions');
const notify = require('../services/notify');
const storage = require('../services/storage');
const filesSvc = require('../services/files');
const { allow, action } = require('./guard');

const router = express.Router();

router.get('/', allow(), (req, res) => {
  const r = req.user.role;
  res.redirect(r === 'student' ? '/student' : r === 'admin' ? '/admin' : '/teacher');
});

/** T-00 / S-00 Course Home */
router.get('/course', allow(), (req, res) => {
  const course = courseSvc.getCourse();
  const isStudent = req.user.role === 'student';
  const assignments = assignSvc.list(course.id, { studentView: isStudent });
  const upcoming = assignments.filter((a) => a.status === 'published' && a.due_date && Date.parse(a.due_date) > Date.now())
    .sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 5);
  let progress = null;
  if (isStudent) {
    const published = assignments.filter((a) => a.status !== 'draft' && a.submission_mode === 'online');
    const done = published.filter((a) => submissionsSvc.latest(a.id, req.user.user_id)).length;
    progress = { done, total: published.length };
  }
  res.page('course_home', {
    title: 'หน้าแรกของรายวิชา', clos: courseSvc.clos(course.id), categories: courseSvc.categories(course.id),
    sessions: isStudent ? courseSvc.sessionsForStudent(course.id, req.user.user_id).filter((s) => s.status !== 'draft') : courseSvc.sessions(course.id, { sectionId: req.section ? req.section.id : null }),
    announcements: courseSvc.announcements(course.id), documents: courseSvc.documents(course.id),
    next: courseSvc.nextSession(course.id, { sectionId: isStudent ? (res.locals.mySection || {}).id : (req.section || {}).id }), upcoming, progress,
    studentCount: courseSvc.students(course.id, { section: isStudent || !req.section ? null : req.section.section_code }).length,
    schedule: courseSvc.scheduleSummary(course.id),
  });
});

/** T-03A / S-02A Class Session Detail */
router.get('/sessions/:id', allow(), (req, res, next) => {
  const s = courseSvc.getSession(req.params.id);
  const isStudent = req.user.role === 'student';
  if (!s || (isStudent && (s.status === 'draft' || !courseSvc.sessionVisibleTo(s, s.course_id, req.user.user_id)))) return next();
  const assignments = assignSvc.list(s.course_id, { sessionId: s.id, studentView: isStudent });
  let myAttendance = null;
  if (isStudent) myAttendance = get().prepare('SELECT * FROM attendance_records WHERE session_id = ? AND student_id = ?').get(s.id, req.user.user_id);
  res.page('session_detail', {
    title: `สัปดาห์ ${s.week_number}`, s, lesson: courseSvc.lessonDetail(s.id), materials: courseSvc.materials(s.id, { includeTeacher: !isStudent }),
    assignments, myAttendance,
  });
});

router.get('/notifications', allow(), (req, res) => {
  res.page('notifications', { title: 'การแจ้งเตือน', items: notify.list(req.user.user_id), prefs: notify.preferences(req.user.user_id) });
});

router.post('/notifications/read', allow(), (req, res) => {
  notify.markRead(req.user.user_id, req.body.id || null);
  if (req.body.go && String(req.body.go).startsWith('/') && !String(req.body.go).startsWith('//')) return res.redirect(req.body.go);
  return res.redirect('/notifications');
});

router.post('/notifications/preferences', allow(), action((req, res) => {
  for (const key of Object.keys(notify.EVENT_TYPES)) notify.setPreference(req.user.user_id, key, !!req.body[`pref_${key}`]);
  res.flash('success', 'บันทึกการตั้งค่าการแจ้งเตือนแล้ว');
  res.redirect('/notifications');
}));

function sendStored(res, key, name, mime, download) {
  if (!storage.exists(key)) return res.status(404).send('ไม่พบไฟล์');
  const full = storage.resolve(key);
  const stat = fs.statSync(full);
  const kind = filesSvc.info(name).kind;
  const inline = !download && ['image', 'video', 'pdf'].includes(kind);
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  // รองรับ Range request สำหรับเลื่อน Timeline วิดีโอ
  const range = res.req.headers.range;
  if (range && kind === 'video') {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? Number(m[1]) : 0;
    const end = m && m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
    if (start >= stat.size || start > end) return res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', end - start + 1);
    return fs.createReadStream(full, { start, end }).pipe(res);
  }
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', stat.size);
  return fs.createReadStream(full).pipe(res);
}

/** ตรวจสิทธิ์ทุกการเข้าถึงไฟล์ */
router.get('/files/submission/:id', allow(), (req, res) => {
  const f = submissionsSvc.fileForUser(req.params.id, req.user);
  if (!f) return res.status(404).send('ไม่พบไฟล์หรือไม่มีสิทธิ์เข้าถึง');
  return sendStored(res, f.storage_key, f.file_name, f.mime_type, req.query.download === '1');
});

router.get('/files/material/:id', allow(), (req, res) => {
  const m = get().prepare('SELECT * FROM session_materials WHERE id = ?').get(req.params.id);
  if (!m || !m.file_storage_key || (req.user.role === 'student' && m.visibility !== 'students')) return res.status(404).send('ไม่พบไฟล์');
  return sendStored(res, m.file_storage_key, m.file_name, m.mime_type, req.query.download === '1');
});

router.get('/files/document/:id', allow(), (req, res) => {
  const d = get().prepare('SELECT * FROM course_documents WHERE id = ?').get(req.params.id);
  if (!d || !d.file_storage_key) return res.status(404).send('ไม่พบไฟล์');
  return sendStored(res, d.file_storage_key, d.file_name, d.mime_type, req.query.download === '1');
});

router.get('/healthz', (req, res) => res.json({ ok: true }));

module.exports = router;
