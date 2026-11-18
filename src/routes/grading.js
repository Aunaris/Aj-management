'use strict';
/** T-06 Submission Review + T-07 Quick Grading + Grid ให้คะแนนระหว่างคาบ + Gradebook + CLO Analytics */
const express = require('express');
const courseSvc = require('../services/course');
const assignSvc = require('../services/assignments');
const subSvc = require('../services/submissions');
const grading = require('../services/grading');
const scores = require('../services/scores');
const { allow, action, wantsJson } = require('./guard');

const router = express.Router();
const T = allow('teacher');
const TA = allow('teacher', 'admin');

function assignmentOr404(id) {
  const a = assignSvc.getAssignment(id);
  if (!a) { const e = new Error('ไม่พบงาน'); e.status = 404; throw e; }
  return a;
}

/** หน้าตรวจงาน: รายชื่อ + Preview + Rubric ในบริบทเดียวกัน */
router.get('/grading/:id', T, (req, res) => {
  const a = assignmentOr404(req.params.id);
  const overview = subSvc.overview(a.id, { section: req.section ? req.section.section_code : null });
  const filter = req.query.filter || 'all';
  const filtered = overview.filter((o) => {
    if (filter === 'to_review') return o.submission && (!o.grade || o.grade.status === 'draft');
    if (filter === 'not_submitted') return !o.submission;
    if (filter === 'published') return o.grade && ['published', 'locked'].includes(o.grade.status);
    return true;
  });
  const selectedId = req.query.student || (filtered.find((o) => o.submission && !o.grade) || filtered[0] || {}).student?.id;
  const selected = overview.find((o) => o.student.id === selectedId) || null;
  let versions = [];
  let grade = null;
  let history = [];
  let feedbacks = [];
  let viewVersion = null;
  if (selected) {
    versions = subSvc.versions(a.id, selected.student.id);
    viewVersion = versions.find((v) => String(v.version) === String(req.query.v)) || versions[0] || null;
    if (viewVersion && viewVersion.id === versions[0]?.id) subSvc.markUnderReview(viewVersion.id);
    grade = grading.getGrade(a.id, selected.student.id);
    history = grading.history(a.id, selected.student.id);
    feedbacks = grading.feedbackHistory(a.id, selected.student.id);
  }
  const idx = filtered.findIndex((o) => o.student.id === selectedId);
  res.page('teacher/grading', {
    title: `ตรวจงาน ${a.assignment_code}`, a, rubric: assignSvc.rubric(a.id), overview, filtered, filter, selected, versions, viewVersion, grade, history, feedbacks,
    prevId: idx > 0 ? filtered[idx - 1].student.id : null, nextId: idx >= 0 && idx < filtered.length - 1 ? filtered[idx + 1].student.id : null,
    maps: assignSvc.cloMaps(a.id), locked: !!courseSvc.getCourse().scores_locked_at,
  });
});

function gradeFromBody(a, studentId, body, actorId) {
  const rubric = assignSvc.rubric(a.id);
  const scoresIn = {};
  const comments = {};
  if (rubric) {
    for (const c of rubric.criteria) {
      const v = body.scores ? body.scores[c.id] : body[`score_${c.id}`];
      if (v !== undefined) scoresIn[c.id] = v;
      const cm = body.comments ? body.comments[c.id] : body[`comment_${c.id}`];
      if (cm !== undefined) comments[c.id] = cm;
    }
  }
  return grading.saveGrade({
    assignmentId: a.id, studentId, scores: scoresIn, comments, directScore: body.direct_score, feedback: body.feedback,
    action: ['draft', 'publish', 'revision'].includes(body.action) ? body.action : 'draft', reason: body.reason, actorId,
  });
}

router.post('/grading/:id/publish-all', T, action((req, res) => {
  const a = assignmentOr404(req.params.id);
  const n = grading.publishAll(a.id, req.user.user_id);
  res.flash('success', `เผยแพร่คะแนน ${n} รายการ`);
  res.back(`/teacher/grading/${a.id}`);
}));

router.post('/grading/:id/:studentId', T, action((req, res) => {
  const a = assignmentOr404(req.params.id);
  const g = gradeFromBody(a, req.params.studentId, req.body, req.user.user_id);
  if (wantsJson(req)) return res.json({ ok: true, grade: { total: g.total_score, status: g.status } });
  const msg = { publish: 'เผยแพร่คะแนนแล้ว', revision: 'ส่งคำขอให้แก้ไขงานแล้ว', draft: 'บันทึก Draft แล้ว' }[req.body.action] || 'บันทึกแล้ว';
  res.flash('success', msg);
  const go = req.body.next_student ? req.body.next_student : req.params.studentId;
  return res.redirect(`/teacher/grading/${a.id}?student=${encodeURIComponent(go)}&filter=${encodeURIComponent(req.body.filter || 'all')}`);
}));

router.post('/links/:id/status', T, action((req, res) => {
  subSvc.setLinkStatus(req.params.id, req.body.status, req.user.user_id);
  if (wantsJson(req)) return res.json({ ok: true });
  res.flash('success', 'บันทึกสถานะลิงก์แล้ว');
  return res.back('/teacher');
}));

/** Grid ให้คะแนนเร็วระหว่างคาบ — ทุกคนในหน้าเดียว บันทึกอัตโนมัติรายแถว */
router.get('/grading/:id/grid', T, (req, res) => {
  const a = assignmentOr404(req.params.id);
  const rubric = assignSvc.rubric(a.id);
  const session = req.query.session ? courseSvc.getSession(req.query.session) : null;
  // จากหน้าระหว่างคาบ: แสดงเฉพาะนักศึกษากลุ่มของคาบนั้น
  const section = session && session.section_code ? session.section_code : (req.section ? req.section.section_code : null);
  const overview = subSvc.overview(a.id, { section }).map((o) => ({ ...o, full: grading.getGrade(a.id, o.student.id) }));
  let attendance = {};
  if (session) {
    const att = require('../services/attendance');
    attendance = Object.fromEntries(att.roster(session.id).map((r) => [r.id, r.record ? r.record.attendance_status : null]));
  }
  res.page('teacher/grid', { title: `ให้คะแนนระหว่างคาบ — ${a.title}`, a, rubric, overview, session, attendance, locked: !!courseSvc.getCourse().scores_locked_at });
});

/* ---------------- Gradebook (FR-08) ---------------- */
router.get('/gradebook', TA, (req, res) => {
  const c = courseSvc.getCourse();
  res.page('teacher/gradebook', { title: 'สมุดคะแนน', gb: scores.gradebook(c.id, { section: req.section ? req.section.section_code : null }), structure: scores.structureCheck(c.id, { section: req.section ? req.section.section_code : null }), c });
});

router.post('/scores/lock', T, action((req, res) => {
  grading.lockCourse(courseSvc.getCourse().id, req.user.user_id);
  res.flash('success', 'ล็อกคะแนนรายวิชาแล้ว');
  res.redirect('/teacher/gradebook');
}));

router.post('/scores/unlock', allow('admin', 'teacher'), action((req, res) => {
  grading.unlockCourse(courseSvc.getCourse().id, req.user.user_id, req.body.reason);
  res.flash('success', 'ปลดล็อกคะแนนแล้ว');
  res.redirect('/teacher/gradebook');
}));

/* ---------------- T-09 CLO Analytics ---------------- */
router.get('/clo', TA, (req, res) => {
  const c = courseSvc.getCourse();
  const data = scores.cloScores(c.id, { section: req.section ? req.section.section_code : null });
  const assignments = assignSvc.list(c.id).map((a) => ({ ...a, maps: assignSvc.cloMaps(a.id) }));
  res.page('teacher/clo', { title: 'CLO Analytics', data, assignments });
});

module.exports = router;
