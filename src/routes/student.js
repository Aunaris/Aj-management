'use strict';
/** Student screens — นักศึกษาเห็นเฉพาะข้อมูลของตนเอง (NFR-04) */
const express = require('express');
const multer = require('multer');
const { get } = require('../db');
const courseSvc = require('../services/course');
const att = require('../services/attendance');
const assignSvc = require('../services/assignments');
const subSvc = require('../services/submissions');
const grading = require('../services/grading');
const scores = require('../services/scores');
const { allow, action, verifyCsrf } = require('./guard');

const router = express.Router();
const S = allow('student');
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 500);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 20, fields: 100 } });

/** งานของกลุ่มตนเอง พร้อมวันเปิดรับ/กำหนดส่งของกลุ่ม */
function myAssignments(courseId, studentId) {
  const sec = courseSvc.studentSectionCode(courseId, studentId);
  return assignSvc.list(courseId, { studentView: true, section: sec }).map((x) => assignSvc.forSection(x, sec)).map((a) => {
    const sub = subSvc.latest(a.id, studentId);
    const g = grading.studentView(a.id, studentId);
    const overdue = !sub && a.submission_mode === 'online' && a.due_date && Date.parse(a.due_date) < Date.now();
    return { ...a, sub, grade: g, overdue, canSubmit: assignSvc.isOpenForSubmission(a) };
  });
}

/** S-01 Student Dashboard */
router.get('/', S, (req, res) => {
  const c = courseSvc.getCourse();
  const list = myAssignments(c.id, req.user.user_id);
  const pending = list.filter((a) => a.status === 'published' && a.submission_mode === 'online' && (!a.sub || (a.grade && a.grade.status === 'revision_requested')));
  const graded = list.filter((a) => a.grade && a.grade.total_score !== null && a.grade.total_score !== undefined);
  const openSessions = courseSvc.sessionsForStudent(c.id, req.user.user_id).filter((s) => s.attendance_state === 'open');
  const myOpen = openSessions.map((s) => ({ s, rec: get().prepare('SELECT * FROM attendance_records WHERE session_id = ? AND student_id = ?').get(s.id, req.user.user_id) }));
  const gb = scores.gradebook(c.id, { studentId: req.user.user_id });
  const hist = att.studentHistory(c.id, req.user.user_id).filter((h) => h.attendance_state !== 'not_started');
  res.page('student/dashboard', {
    title: 'หน้าหลักนักศึกษา', pending, graded: graded.slice(-5).reverse(), myOpen, next: courseSvc.nextSession(c.id, { sectionId: (res.locals.mySection || {}).id || '__none__' }), row: gb.rows[0], gb,
    attendance: { total: hist.length, attended: hist.filter((h) => ['present', 'late'].includes(h.attendance_status)).length },
    announcements: courseSvc.announcements(c.id, 3), schedule: courseSvc.scheduleSummary(c.id),
  });
});

router.get('/attendance', S, (req, res) => {
  const c = courseSvc.getCourse();
  res.page('student/attendance', {
    title: 'ประวัติการเข้าเรียน', history: att.studentHistory(c.id, req.user.user_id), appeals: att.appeals({ studentId: req.user.user_id }),
    devices: att.devices(req.user.user_id), deviceBinding: !!c.device_binding,
  });
});

router.post('/appeals', S, action((req, res) => {
  const type = ['attendance', 'device_change'].includes(req.body.type) ? req.body.type : 'attendance';
  let sessionId = req.body.session_id || null;
  if (sessionId && !courseSvc.getSession(sessionId)) sessionId = null;
  att.createAppeal({ studentId: req.user.user_id, sessionId, type, message: req.body.message });
  res.flash('success', 'ส่งคำร้องถึงผู้สอนแล้ว');
  res.redirect('/student/attendance');
}));

router.get('/assignments', S, (req, res) => {
  const c = courseSvc.getCourse();
  res.page('student/assignments', { title: 'งานของฉัน', list: myAssignments(c.id, req.user.user_id) });
});

/** S-04 Assignment Detail + S-05/S-06 Upload & Preview + S-08 Feedback */
router.get('/assignments/:id', S, (req, res, next) => {
  const base = assignSvc.getAssignment(req.params.id);
  const sec = base ? courseSvc.studentSectionCode(base.course_id, req.user.user_id) : null;
  if (!base || base.status === 'draft' || !assignSvc.appliesTo(base, sec)) return next();
  const a = assignSvc.forSection(base, sec);
  const versions = subSvc.versions(a.id, req.user.user_id);
  const grade = grading.studentView(a.id, req.user.user_id);
  const prev = versions[0];
  const revision = grade && grade.status === 'revision_requested';
  let blocked = null;
  if (!assignSvc.isOpenForSubmission(a)) blocked = a.submission_mode === 'in_class' ? 'งานนี้ผู้สอนให้คะแนนในชั้นเรียน' : a.status === 'closed' ? 'ปิดรับงานแล้ว' : 'ยังไม่เปิดรับ/เลยกำหนดส่ง';
  else if (prev && !a.allow_resubmit && !revision) blocked = 'งานนี้ไม่อนุญาตให้ส่งซ้ำ';
  else if (prev && prev.version >= a.max_versions && !revision) blocked = `ส่งครบ ${a.max_versions} ครั้งแล้ว`;
  else if (grade && ['published', 'locked'].includes(grade.status)) blocked = 'งานนี้ตรวจและเผยแพร่คะแนนแล้ว';
  res.page('student/assignment', {
    title: a.title, a, versions, grade, rubric: assignSvc.rubric(a.id), maps: assignSvc.cloMaps(a.id), blocked,
    feedbacks: grade ? grading.feedbackHistory(a.id, req.user.user_id).filter(() => ['published', 'locked', 'revision_requested'].includes(grade.status)) : [],
    maxUpload: MAX_UPLOAD_MB, mailAccount: require('../services/mailin').publicAccount(a.course_id),
  });
});

router.post('/assignments/:id/submit', S, upload.array('files', 20), (req, res, next) => verifyCsrf(req, res, next), action((req, res) => {
  const urls = [].concat(req.body.link_url || []);
  const titles = [].concat(req.body.link_title || []);
  const links = urls.map((u, i) => ({ url: u, title: titles[i] }));
  const r = subSvc.submit({ assignmentId: req.params.id, studentId: req.user.user_id, files: req.files || [], links, note: req.body.note });
  res.flash('success', `ส่งงานเรียบร้อย (เวอร์ชัน ${r.version}${r.isLate ? ' — ส่งล่าช้า' : ''})`);
  res.redirect(`/student/assignments/${req.params.id}`);
}));

router.get('/grades', S, (req, res) => {
  const c = courseSvc.getCourse();
  const gb = scores.gradebook(c.id, { studentId: req.user.user_id });
  res.page('student/grades', { title: 'คะแนนของฉัน', gb, row: gb.rows[0], list: myAssignments(c.id, req.user.user_id) });
});

router.get('/clo', S, (req, res, next) => {
  const c = courseSvc.getCourse();
  if (!c.clo_visible_to_students) return next();
  return res.page('student/clo', { title: 'ความก้าวหน้า CLO', data: scores.cloScores(c.id, { studentId: req.user.user_id }) });
});

router.get('/portfolio', S, (req, res) => {
  res.page('student/portfolio', { title: 'My Portfolio', items: subSvc.portfolio(req.user.user_id) });
});

module.exports = router;
