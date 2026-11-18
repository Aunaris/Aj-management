'use strict';
/** Teacher screens: Dashboard, Sessions, Attendance (QR/Manual), Risk Review, Assignments, Students, Settings */
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const { get, uuid, now } = require('../db');
const courseSvc = require('../services/course');
const att = require('../services/attendance');
const assignSvc = require('../services/assignments');
const subSvc = require('../services/submissions');
const scores = require('../services/scores');
const auth = require('../services/auth');
const audit = require('../services/audit');
const notify = require('../services/notify');
const storage = require('../services/storage');
const filesSvc = require('../services/files');
const { allow, action, wantsJson, verifyCsrf } = require('./guard');
const util = require('../util');

const router = express.Router();
const T = allow('teacher');
const TA = allow('teacher', 'admin');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 5 } });

const course = () => courseSvc.getCourse();
const secCode = (req) => (req.section ? req.section.section_code : null);
const secId = (req) => (req.section ? req.section.id : null);

/** เลือกกลุ่มเรียนที่ต้องการจัดการ (เก็บใน cookie) */
router.get('/section', TA, (req, res) => {
  const sec = courseSvc.getSection(String(req.query.id || ''));
  if (sec) res.cookie('sec', sec.id, { httpOnly: true, sameSite: 'lax', maxAge: 180 * 86400000 });
  else res.clearCookie('sec');
  const back = String(req.query.back || '/teacher');
  // หน้ารายละเอียดของคาบใดคาบหนึ่งเปลี่ยนกลุ่มแล้วไม่ตรง — กลับไปหน้ารวม
  const safe = back.startsWith('/') && !back.startsWith('//') ? back.replace(/^\/teacher\/sessions\/[^/]+.*$/, '/teacher/sessions').replace(/^\/sessions\/.*/, '/teacher/sessions') : '/teacher';
  res.redirect(safe);
});

function sessionOr404(req) {
  const s = courseSvc.getSession(req.params.id);
  if (!s) { const e = new Error('ไม่พบคาบเรียน'); e.status = 404; throw e; }
  return s;
}

/** เงื่อนไข SQL: นักศึกษาอยู่ในกลุ่มที่เลือก (@sec เป็น NULL = ทุกกลุ่ม) */
const inSec = (col) => `(@sec IS NULL OR ${col} IN (SELECT user_id FROM course_enrollments WHERE course_id = @c AND section = @sec))`;

/** T-01 Teacher Dashboard */
router.get('/', TA, (req, res) => {
  const c = course();
  const code = secCode(req);
  const students = courseSvc.students(c.id, { section: code });
  const assignments = assignSvc.list(c.id);
  const open = assignments.filter((a) => a.status === 'published');
  const counts = get().prepare(`SELECT
      (SELECT COUNT(*) FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE a.course_id = @c AND a.deleted_at IS NULL AND ${inSec('s.student_id')}) total_subs,
      (SELECT COUNT(*) FROM submissions s JOIN assignments a ON a.id = s.assignment_id
        WHERE a.course_id = @c AND a.deleted_at IS NULL AND s.status IN ('submitted','late','resubmitted','under_review') AND ${inSec('s.student_id')}
        AND s.version = (SELECT MAX(version) FROM submissions x WHERE x.assignment_id = s.assignment_id AND x.student_id = s.student_id)) to_review,
      (SELECT COUNT(*) FROM attendance_risk_events WHERE review_status = 'pending' AND ${inSec('user_id')}) risks,
      (SELECT COUNT(*) FROM attendance_appeals WHERE status = 'pending' AND ${inSec('student_id')}) appeals`).get({ c: c.id, sec: code });
  const next = courseSvc.nextSession(c.id, { sectionId: secId(req) });
  const today = util.localToday();
  const all = courseSvc.sessions(c.id, { sectionId: secId(req) });
  const todaySessions = all.filter((s) => s.session_date === today || s.attendance_state === 'open');
  const gb = scores.gradebook(c.id, { section: code });
  const avg = gb.rows.length ? util.round2(gb.rows.reduce((s, r) => s + r.total, 0) / gb.rows.length) : null;
  const clo = scores.cloScores(c.id, { section: code }).summary;
  const lastSession = all.filter((s) => s.attendance_state !== 'not_started').sort((a, b) => String(a.attendance_opened_at).localeCompare(String(b.attendance_opened_at))).pop();
  const sectionStats = courseSvc.scheduleSummary(c.id);

  res.page('teacher/dashboard', {
    title: 'Teacher Dashboard', students, open, counts, next, todaySessions, avg, clo, structure: scores.structureCheck(c.id), sectionStats, schedule: sectionStats,
    lastSummary: lastSession ? { s: lastSession, sum: att.summary(lastSession.id) } : null,
  });
});

/* ---------------- Sessions ---------------- */
router.get('/sessions', TA, (req, res) => {
  const c = course();
  const list = courseSvc.sessions(c.id, { sectionId: secId(req) }).map((s) => ({ ...s, summary: s.attendance_state !== 'not_started' ? att.summary(s.id) : null }));
  res.page('teacher/sessions', { title: 'คาบเรียน', sessions: list });
});

/* ---------------- กลุ่มเรียน ---------------- */
router.get('/sections', TA, (req, res) => {
  const c = course();
  const list = courseSvc.sections(c.id).map((sec) => ({
    sec, students: courseSvc.students(c.id, { section: sec.section_code }).length,
    sessions: courseSvc.sessions(c.id, { sectionId: sec.id }).filter((x) => x.section_id === sec.id),
  }));
  res.page('teacher/sections', { title: 'กลุ่มเรียน', list, weekdays: courseSvc.WEEKDAYS, termStart: courseSvc.termStart(c.id), termSet: !!c.term_start_date });
});



router.post('/sections', T, action((req, res) => {
  const code = String(req.body.section_code || '').trim();
  if (!/^[0-9A-Za-z-]{1,10}$/.test(code)) throw Object.assign(new Error('รหัสกลุ่มเรียนต้องเป็นตัวเลข/ตัวอักษร ไม่เกิน 10 ตัว'), { status: 400 });
  if (courseSvc.sectionByCode(course().id, code)) throw Object.assign(new Error(`มีกลุ่ม ${code} อยู่แล้ว`), { status: 400 });
  courseSvc.ensureSection(course().id, code, { actorId: req.user.user_id });
  res.flash('success', `สร้างกลุ่ม ${code} พร้อมคาบเรียน 17 สัปดาห์แล้ว`);
  res.redirect('/teacher/sections');
}));

router.post('/sections/term', T, action((req, res) => {
  const moved = courseSvc.setTermStart(course().id, req.body.term_start_date, req.user.user_id);
  res.flash('success', `ตั้งวันเปิดภาคเป็น ${util.thaiDate(req.body.term_start_date)} แล้ว — ปรับวันที่คาบที่ยังไม่เริ่ม ${moved} คาบ`);
  res.redirect('/teacher/sections');
}));

router.post('/sections/:id', T, action((req, res) => {
  const moved = courseSvc.updateSection(req.params.id, req.body, req.user.user_id);
  res.flash('success', req.body.apply_sessions ? `บันทึกแล้ว และปรับวัน/เวลาคาบที่ยังไม่เริ่ม ${moved} คาบ` : 'บันทึกข้อมูลกลุ่มแล้ว');
  res.redirect('/teacher/sections');
}));

router.post('/sessions', T, action((req, res) => {
  const c = course();
  const week = Number(req.body.week_number);
  if (!(week >= 1 && week <= 30)) throw Object.assign(new Error('สัปดาห์ไม่ถูกต้อง'), { status: 400 });
  const id = uuid();
  const sec = courseSvc.getSection(req.body.section_id) || req.section;
  get().prepare(`INSERT INTO course_sessions (id, course_id, section_id, week_number, title, session_date, start_time, end_time, location, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?, 'draft', ?)`).run(id, c.id, sec ? sec.id : null, week, String(req.body.title || `คาบเพิ่มเติม สัปดาห์ ${week}`).trim(), req.body.session_date || null,
    req.body.start_time || null, req.body.end_time || null, req.body.location || null, now());
  get().prepare('INSERT INTO session_lesson_details (id, session_id) VALUES (?,?)').run(uuid(), id);
  audit.log(req.user.user_id, 'session.create', 'course_session', id);
  res.redirect(`/teacher/sessions/${id}/edit`);
}));

router.get('/sessions/:id/edit', T, (req, res) => {
  const s = sessionOr404(req);
  res.page('teacher/session_edit', { title: `แก้ไขคาบ สัปดาห์ ${s.week_number}`, s, lesson: courseSvc.lessonDetail(s.id), materials: courseSvc.materials(s.id, { includeTeacher: true }), clos: courseSvc.clos(s.course_id) });
});

router.post('/sessions/:id/edit', T, action((req, res) => {
  const s = sessionOr404(req);
  const b = req.body;
  const status = ['draft', 'published', 'completed', 'cancelled'].includes(b.status) ? b.status : s.status;
  get().prepare(`UPDATE course_sessions SET title = ?, week_number = ?, session_date = ?, start_time = ?, end_time = ?, location = ?, instructor = ?, status = ? WHERE id = ?`)
    .run(String(b.title || s.title).trim(), Number(b.week_number) || s.week_number, b.session_date || null, b.start_time || null, b.end_time || null, b.location || null, b.instructor || null, status, s.id);
  const clo = [].concat(b.clo_codes || []).join(', ');
  get().prepare(`INSERT INTO session_lesson_details (id, session_id, objectives, topics, theory_activities, practical_activities, teaching_method, clo_codes, post_class_notes, issues, next_session_notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET objectives = excluded.objectives, topics = excluded.topics, theory_activities = excluded.theory_activities,
    practical_activities = excluded.practical_activities, teaching_method = excluded.teaching_method, clo_codes = excluded.clo_codes, post_class_notes = excluded.post_class_notes,
    issues = excluded.issues, next_session_notes = excluded.next_session_notes`)
    .run(uuid(), s.id, b.objectives || null, b.topics || null, b.theory_activities || null, b.practical_activities || null, b.teaching_method || null, clo || null,
      b.post_class_notes || null, b.issues || null, b.next_session_notes || null);
  audit.log(req.user.user_id, 'session.update', 'course_session', s.id, { status });
  res.flash('success', 'บันทึกรายละเอียดคาบแล้ว');
  res.redirect(`/teacher/sessions/${s.id}/edit`);
}));

router.post('/sessions/:id/materials', T, upload.single('file'), (req, res, next) => verifyCsrf(req, res, next), action((req, res) => {
  const s = sessionOr404(req);
  const title = String(req.body.title || '').trim();
  let key = null; let name = null; let mime = null; let url = null;
  if (req.file) {
    name = filesSvc.sanitizeName(subSvc.fixName(req.file.originalname));
    const e = filesSvc.ext(name);
    if (filesSvc.BLOCKED.has(e) || !filesSvc.TYPES[e]) throw Object.assign(new Error(`ไม่รองรับไฟล์ชนิด .${e}`), { status: 400 });
    if (filesSvc.validate(req.file, [e], 100)) throw Object.assign(new Error(filesSvc.validate(req.file, [e], 100)), { status: 400 });
    key = storage.put(req.file.buffer, 'materials').key;
    mime = filesSvc.info(name).mime;
  }
  if (req.body.external_url) {
    const v = subSvc.validateUrl(req.body.external_url);
    if (v.error) throw Object.assign(new Error(v.error), { status: 400 });
    url = v.url;
  }
  if (!key && !url) throw Object.assign(new Error('กรุณาแนบไฟล์หรือ URL'), { status: 400 });
  get().prepare(`INSERT INTO session_materials (id, session_id, title, material_type, file_storage_key, file_name, mime_type, external_url, visibility, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(uuid(), s.id, title || name || url, key ? 'file' : 'link', key, name, mime, url, req.body.visibility === 'teachers' ? 'teachers' : 'students', now());
  res.flash('success', 'เพิ่มสื่อประกอบคาบแล้ว');
  res.redirect(`/teacher/sessions/${s.id}/edit`);
}));

router.post('/sessions/:id/materials/:mid/delete', T, (req, res) => {
  get().prepare('DELETE FROM session_materials WHERE id = ? AND session_id = ?').run(req.params.mid, req.params.id);
  res.redirect(`/teacher/sessions/${req.params.id}/edit`);
});

/* ---------- T-03 Classroom Session (หน้าจอระหว่างคาบ) ---------- */
router.get('/sessions/:id/live', TA, (req, res) => {
  const s = sessionOr404(req);
  const assignments = assignSvc.list(s.course_id).filter((a) => a.session_id === s.id || a.week_number === s.week_number || a.submission_mode === 'in_class');
  res.page('teacher/live', {
    title: `ระหว่างคาบ — สัปดาห์ ${s.week_number}`, s, roster: att.roster(s.id), summary: att.summary(s.id), assignments,
    risks: att.riskEvents({ sessionId: s.id, status: 'pending' }), templates: assignSvc.TEMPLATES, center: att.geoCenter(s, course()),
  });
});

router.get('/sessions/:id/projector', T, (req, res) => {
  const s = sessionOr404(req);
  res.page('teacher/projector', { title: 'QR เช็คชื่อ', s }, { bare: true });
});

function baseUrl(req) {
  return process.env.BASE_URL ? process.env.BASE_URL.replace(/\/$/, '') : `${req.protocol}://${req.get('host')}`;
}

/** JSON สำหรับจอ QR: หมุนเวียน token อัตโนมัติ */
router.get('/sessions/:id/qr.json', T, async (req, res) => {
  const s = sessionOr404(req);
  const summary = att.summary(s.id);
  if (s.attendance_state !== 'open') return res.json({ ok: true, open: false, state: s.attendance_state, summary });
  const ch = att.currentChallenge(s.id);
  const url = `${baseUrl(req)}/checkin?t=${ch.token}`;
  const qr = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: 520 });
  const verify = s.verify_code_expires_at && s.verify_code_expires_at > now() ? { expiresAt: s.verify_code_expires_at } : null;
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ ok: true, open: true, qr, code: ch.code, expiresAt: ch.expiresAt, serverNow: now(), ttl: ch.ttl, summary, verify, checkinUrl: `${baseUrl(req)}/checkin` });
});

router.get('/sessions/:id/roster.json', TA, (req, res) => {
  const s = sessionOr404(req);
  res.json({
    ok: true, summary: att.summary(s.id), state: s.attendance_state,
    roster: att.roster(s.id).map((r) => ({ id: r.id, code: r.student_code, name: r.full_name, status: r.record ? r.record.attendance_status : null,
      method: r.record ? r.record.checkin_method : null, time: r.record ? r.record.checkin_time : null, verified: !!(r.record && r.record.verified_at), risks: r.pendingRisks,
      ip: r.record ? r.record.ip_address : null, distance: r.record ? r.record.geo_distance_m : null })),
  });
});

router.post('/sessions/:id/attendance/open', T, action((req, res) => {
  const s = sessionOr404(req);
  att.openAttendance(s.id, req.user.user_id);
  if (wantsJson(req)) return res.json({ ok: true });
  return res.redirect(req.body.projector ? `/teacher/sessions/${s.id}/projector` : `/teacher/sessions/${s.id}/live`);
}));

router.post('/sessions/:id/attendance/close', T, action((req, res) => {
  const s = sessionOr404(req);
  att.closeAttendance(s.id, req.user.user_id, { markAbsent: !!req.body.mark_absent });
  res.flash('success', 'ปิดการเช็คชื่อแล้ว');
  if (wantsJson(req)) return res.json({ ok: true });
  return res.redirect(`/teacher/sessions/${s.id}/live`);
}));

router.post('/sessions/:id/attendance/manual', TA, action((req, res) => {
  const s = sessionOr404(req);
  const rec = att.manualSet({ sessionId: s.id, studentId: req.body.student_id, status: req.body.status, reason: req.body.reason, actorId: req.user.user_id });
  if (wantsJson(req)) return res.json({ ok: true, record: rec, summary: att.summary(s.id) });
  res.flash('success', 'บันทึกการเข้าเรียนแล้ว');
  return res.back(`/teacher/sessions/${s.id}/live`);
}));

/** บันทึก Manual ทั้งห้อง (เช่น ระบบล่ม/อินเทอร์เน็ตขัดข้อง) */
router.post('/sessions/:id/attendance/bulk', T, action((req, res) => {
  const s = sessionOr404(req);
  const status = req.body.status;
  const reason = String(req.body.reason || '').trim();
  let n = 0;
  for (const r of att.roster(s.id)) {
    if (r.record && req.body.only_unmarked) continue;
    if (r.record && r.record.attendance_status === status) continue;
    att.manualSet({ sessionId: s.id, studentId: r.id, status, reason: reason || 'บันทึกแบบกลุ่มโดยผู้สอน', actorId: req.user.user_id });
    n += 1;
  }
  res.flash('success', `บันทึก ${n} รายการ`);
  res.redirect(`/teacher/sessions/${s.id}/live`);
}));

/** ตั้งจุดศูนย์กลางห้องเรียนจากตำแหน่ง GPS ของเครื่องผู้สอน */
router.post('/sessions/:id/geo', T, action((req, res) => {
  const s = sessionOr404(req);
  const p = att.setSessionGeo(s.id, { lat: req.body.lat, lng: req.body.lng, accuracy: req.body.accuracy }, req.user.user_id, { asDefault: !!req.body.as_default });
  if (wantsJson(req)) return res.json({ ok: true, ...p });
  res.flash('success', 'ตั้งตำแหน่งห้องเรียนแล้ว');
  return res.redirect(`/teacher/sessions/${s.id}/live`);
}));

router.post('/sessions/:id/verify-code', T, action((req, res) => {
  const s = sessionOr404(req);
  const v = att.issueVerifyCode(s.id, req.user.user_id, Math.max(1, Math.min(10, Number(req.body.minutes) || 2)));
  if (wantsJson(req)) return res.json({ ok: true, ...v });
  res.flash('success', `รหัสยืนยันในห้องเรียน: ${v.code} (หมดอายุ ${util.thaiDate(v.expiresAt, { time: true })})`);
  return res.redirect(`/teacher/sessions/${s.id}/live`);
}));

/* ---------------- Risk events & appeals ---------------- */
router.get('/risk', TA, (req, res) => {
  const status = ['pending', 'dismissed', 'confirmed'].includes(req.query.status) ? req.query.status : undefined;
  res.page('teacher/risk', {
    title: 'ตรวจสอบเหตุการณ์เสี่ยง', events: att.riskEvents({ sessionId: req.query.session || undefined, status }), status,
    appeals: att.appeals(), sessionFilter: req.query.session || '',
  });
});

router.post('/risk/:id/review', T, action((req, res) => {
  att.reviewRisk(req.params.id, { decision: req.body.decision, note: req.body.note, actorId: req.user.user_id });
  res.flash('success', 'บันทึกผลการตรวจสอบแล้ว');
  res.back('/teacher/risk');
}));

router.post('/appeals/:id/review', T, action((req, res) => {
  att.reviewAppeal(req.params.id, {
    decision: req.body.decision, response: req.body.response, actorId: req.user.user_id,
    attendanceStatus: ['present', 'late', 'absent', 'leave'].includes(req.body.attendance_status) ? req.body.attendance_status : null,
  });
  res.flash('success', 'บันทึกผลการพิจารณาคำร้องแล้ว');
  res.redirect('/teacher/risk#appeals');
}));

/* ---------------- Assignments (T-05 Assignment Builder) ---------------- */
router.get('/assignments', TA, (req, res) => {
  const c = course();
  const list = assignSvc.list(c.id).map((a) => {
    const ov = subSvc.overview(a.id, { section: secCode(req) });
    return {
      ...a, submitted: ov.filter((o) => o.submission).length, toReview: ov.filter((o) => o.submission && (!o.grade || o.grade.status === 'draft')).length,
      published: ov.filter((o) => o.grade && ['published', 'locked'].includes(o.grade.status)).length, total: ov.length,
    };
  });
  res.page('teacher/assignments', { title: 'งานที่มอบหมาย', list, structure: scores.structureCheck(c.id), templates: assignSvc.TEMPLATES });
});

function formData(c, a, overrides = {}) {
  const clos = courseSvc.clos(c.id);
  const maps = a ? assignSvc.cloMaps(a.id) : [];
  const rubric = a ? assignSvc.rubric(a.id) : null;
  return {
    clos, categories: courseSvc.categories(c.id), sessions: courseSvc.sessions(c.id), maps, rubric, a: a || null,
    usage: Object.fromEntries(courseSvc.categories(c.id).map((cat) => [cat.id, assignSvc.categoryUsage(cat.id, a ? a.id : null)])),
    templates: assignSvc.TEMPLATES, ...overrides,
  };
}

router.get('/assignments/new', T, (req, res) => {
  const c = course();
  const tplKey = req.query.template;
  const tpl = assignSvc.TEMPLATES[tplKey];
  const cats = courseSvc.categories(c.id);
  const session = req.query.session ? courseSvc.getSession(req.query.session) : null;
  let draft = null;
  if (tpl || session) {
    const t = tpl || assignSvc.TEMPLATES.in_class_activity;
    const cat = cats.find((x) => x.code === t.category) || null;
    const n = get().prepare('SELECT COUNT(*) c FROM assignments WHERE course_id = ?').get(c.id).c + 1;
    draft = {
      title: t.title, assignment_code: `A${String(n).padStart(2, '0')}`, max_score: t.max, category_id: cat ? cat.id : '', instructions: t.instructions, template: tplKey || 'in_class_activity',
      week_number: session ? session.week_number : t.week, submission_mode: t.mode, allowed_types: t.types, allow_links: t.allowLinks || t.mode === 'online' ? 1 : 0, allow_resubmit: 1,
      max_versions: 5, late_policy: 'accept_mark', max_file_mb: 200, session_id: session ? session.id : null,
      criteria: t.criteria.map(([name, max, desc]) => ({ criterion_name: name, max_score: max, weight: max, description: desc, levels: [] })),
      cloCodes: cat ? cat.clo_reference.split(/,\s*/) : [],
    };
  }
  res.page('teacher/assignment_form', { title: 'สร้างงาน', ...formData(c, null, { draft }) });
});

function bodyToInput(req) {
  const b = { ...req.body };
  b.open_at = util.fromLocalInput(b.open_at);
  b.due_date = util.fromLocalInput(b.due_date);
  return b;
}

router.post('/assignments', T, action((req, res) => {
  const c = course();
  const id = assignSvc.save(c.id, bodyToInput(req), req.user.user_id);
  if (req.body.publish) assignSvc.setStatus(id, 'published', req.user.user_id);
  res.flash('success', req.body.publish ? 'สร้างและเผยแพร่งานแล้ว' : 'บันทึก Draft แล้ว');
  res.redirect(req.body.return_to && /^\/teacher\//.test(req.body.return_to) ? req.body.return_to : `/teacher/assignments/${id}/edit`);
}));

router.get('/assignments/:id/edit', T, (req, res, next) => {
  const c = course();
  const a = assignSvc.getAssignment(req.params.id);
  if (!a) return next();
  return res.page('teacher/assignment_form', { title: `แก้ไขงาน ${a.assignment_code}`, ...formData(c, a, { draft: null }) });
});

router.post('/assignments/:id', T, action((req, res) => {
  const c = course();
  assignSvc.save(c.id, bodyToInput(req), req.user.user_id, req.params.id);
  if (req.body.publish) assignSvc.setStatus(req.params.id, 'published', req.user.user_id);
  res.flash('success', 'บันทึกการแก้ไขแล้ว');
  res.redirect(`/teacher/assignments/${req.params.id}/edit`);
}));

router.post('/assignments/:id/status', T, action((req, res) => {
  assignSvc.setStatus(req.params.id, req.body.status, req.user.user_id);
  res.flash('success', `เปลี่ยนสถานะงานเป็น ${util.label('assignment', req.body.status)}`);
  res.back('/teacher/assignments');
}));

router.post('/assignments/:id/delete', T, action((req, res) => {
  assignSvc.softDelete(req.params.id, req.user.user_id);
  res.flash('success', 'ลบงานแล้ว');
  res.redirect('/teacher/assignments');
}));

/* ---------------- T-10 Student Management ---------------- */
router.get('/students', TA, (req, res) => {
  const c = course();
  const matrix = scores.attendanceMatrix(c.id, { section: secCode(req) });
  const rate = Object.fromEntries(matrix.rows.map((r) => [r.student.id, r]));
  const q = String(req.query.q || '').trim().toLowerCase();
  const list = courseSvc.students(c.id, { includeWithdrawn: true, section: secCode(req) })
    .filter((x) => !q || `${x.student_code} ${x.full_name} ${x.email || ''}`.toLowerCase().includes(q));
  const counts = courseSvc.sections(c.id).map((sec) => ({ sec, n: courseSvc.students(c.id, { section: sec.section_code }).length }));
  res.page('teacher/students', { title: 'รายชื่อนักศึกษา', students: list, rate, result: null, counts, q, total: courseSvc.students(c.id).length });
});

function importFlash(res, results) {
  const msgs = [];
  let bad = false;
  for (const r of results) {
    const where = r.meta && r.meta.section ? `กลุ่ม ${r.meta.section}` : Object.keys(r.sections).map((k) => `กลุ่ม ${k}`).join(', ') || 'ไม่ระบุกลุ่ม';
    msgs.push(`${r.file ? r.file + ': ' : ''}${where} — นำเข้า ${r.enrolled} คน (บัญชีใหม่ ${r.created} คน)`);
    msgs.push(...r.warnings, ...r.moved.map((m) => `ย้ายกลุ่ม ${m}`), ...r.errors);
    if (r.errors.length || r.warnings.length) bad = true;
  }
  res.flash(bad ? 'warning' : 'success', msgs);
}

router.post('/students/import', TA, action((req, res) => {
  const c = course();
  const result = courseSvc.importStudents(c.id, req.body.data, req.user.user_id, { section: req.body.section || secCode(req) });
  importFlash(res, [result]);
  res.redirect('/teacher/students');
}));

/** อัปโหลดไฟล์ ClassRoster จากระบบทะเบียน (หลายไฟล์/หลายกลุ่มพร้อมกัน) */
router.post('/students/import-file', TA, upload.array('files', 10), (req, res, next) => verifyCsrf(req, res, next), action((req, res) => {
  const files = req.files || [];
  if (!files.length) throw Object.assign(new Error('กรุณาเลือกไฟล์ CSV'), { status: 400 });
  const c = course();
  const results = files.map((f) => {
    let text = f.buffer.toString('utf8');
    if (text.includes('\ufffd')) text = new TextDecoder('windows-874').decode(f.buffer); // ไฟล์ภาษาไทยแบบ TIS-620/ANSI
    return { ...courseSvc.importStudents(c.id, text, req.user.user_id, { section: req.body.section || null }), file: subSvc.fixName(f.originalname) };
  });
  importFlash(res, results);
  res.redirect('/teacher/students');
}));

router.get('/students/:id', TA, (req, res, next) => {
  const c = course();
  const st = courseSvc.students(c.id, { includeWithdrawn: true }).find((s) => s.id === req.params.id);
  if (!st) return next();
  const gb = scores.gradebook(c.id, { studentId: st.id });
  res.page('teacher/student_detail', {
    title: st.full_name, st, sections: courseSvc.sections(c.id), history: att.studentHistory(c.id, st.id), gb, row: gb.rows[0], clo: scores.cloScores(c.id, { studentId: st.id }),
    devices: att.devices(st.id), risks: att.riskEvents().filter((e) => e.user_id === st.id), appeals: att.appeals({ studentId: st.id }),
  });
});

router.post('/students/:id/reset-password', TA, action((req, res) => {
  const u = auth.getUser(req.params.id);
  if (!u || u.role !== 'student') throw Object.assign(new Error('ไม่พบนักศึกษา'), { status: 404 });
  auth.changePassword(u.id, u.student_code || u.username);
  get().prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(u.id);
  get().prepare('UPDATE auth_sessions SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL').run(now(), u.id);
  audit.log(req.user.user_id, 'user.reset_password', 'user', u.id);
  res.flash('success', 'รีเซ็ตรหัสผ่านเป็นรหัสนักศึกษาแล้ว (บังคับเปลี่ยนเมื่อเข้าสู่ระบบ)');
  res.redirect(`/teacher/students/${u.id}`);
}));

router.post('/students/:id/revoke-devices', TA, action((req, res) => {
  att.revokeDevices(req.params.id, req.user.user_id, String(req.body.reason || 'ผู้สอนยกเลิกอุปกรณ์'));
  res.flash('success', 'ยกเลิกอุปกรณ์เดิมแล้ว นักศึกษาจะลงทะเบียนอุปกรณ์ใหม่เมื่อเช็คชื่อครั้งถัดไป');
  res.redirect(`/teacher/students/${req.params.id}`);
}));

router.post('/students/:id/enrollment', TA, action((req, res) => {
  const c = course();
  const status = req.body.status === 'withdrawn' ? 'withdrawn' : 'active';
  get().prepare('UPDATE course_enrollments SET enrollment_status = ? WHERE course_id = ? AND user_id = ?').run(status, c.id, req.params.id);
  audit.log(req.user.user_id, 'enrollment.update', 'user', req.params.id, { status });
  res.flash('success', status === 'withdrawn' ? 'เปลี่ยนสถานะเป็นถอนรายวิชาแล้ว' : 'คืนสถานะลงทะเบียนแล้ว');
  res.redirect(`/teacher/students/${req.params.id}`);
}));

/** ย้ายกลุ่มเรียน (ประวัติการเข้าเรียนเดิมยังอยู่ คาบใหม่จะเป็นของกลุ่มใหม่) */
router.post('/students/:id/section', TA, action((req, res) => {
  const c = course();
  const sec = courseSvc.getSection(req.body.section_id);
  if (!sec || sec.course_id !== c.id) throw Object.assign(new Error('ไม่พบกลุ่มเรียน'), { status: 400 });
  const old = courseSvc.studentSectionCode(c.id, req.params.id);
  get().prepare('UPDATE course_enrollments SET section = ? WHERE course_id = ? AND user_id = ?').run(sec.section_code, c.id, req.params.id);
  audit.log(req.user.user_id, 'enrollment.section', 'user', req.params.id, { old, new: sec.section_code });
  res.flash('success', `ย้ายไป${sec.name || 'กลุ่ม ' + sec.section_code}แล้ว`);
  res.redirect(`/teacher/students/${req.params.id}`);
}));

/* ---------------- Settings (ตั้งค่ารายวิชา / โครงสร้างคะแนน) ---------------- */
router.get('/settings', TA, (req, res) => {
  const c = course();
  res.page('teacher/settings', { title: 'ตั้งค่ารายวิชา', c, clientIp: att.normalizeIp(req.ip), categories: courseSvc.categories(c.id), clos: courseSvc.clos(c.id), structure: scores.structureCheck(c.id), documents: courseSvc.documents(c.id) });
});

router.post('/settings', TA, action((req, res) => {
  const c = course();
  const b = req.body;
  const ttl = Math.max(15, Math.min(600, Number(b.qr_ttl_seconds) || 45));
  const late = Math.max(0, Math.min(240, Number(b.late_after_minutes) || 0));
  const reminders = String(b.reminder_hours || '24,1').split(/[\s,]+/).map(Number).filter((n) => n > 0 && n <= 336).join(',') || '24,1';
  const allow = String(b.ip_allowlist || '').trim();
  const parsed = att.parseAllowlist(allow);
  if (parsed.errors.length) throw Object.assign(new Error(`รูปแบบเครือข่ายไม่ถูกต้อง: ${parsed.errors.join(', ')} (ตัวอย่าง 202.28.10.0/24)`), { status: 400 });
  const radius = Math.max(10, Math.min(5000, Number(b.geo_radius_m) || 150));
  const maxAcc = Math.max(10, Math.min(5000, Number(b.geo_max_accuracy_m) || 150));
  const lat = b.geo_lat === '' || b.geo_lat === undefined ? null : Number(b.geo_lat);
  const lng = b.geo_lng === '' || b.geo_lng === undefined ? null : Number(b.geo_lng);
  if ((lat !== null && !(Math.abs(lat) <= 90)) || (lng !== null && !(Math.abs(lng) <= 180)) || ((lat === null) !== (lng === null))) {
    throw Object.assign(new Error('พิกัดห้องเรียนไม่ถูกต้อง'), { status: 400 });
  }
  get().prepare(`UPDATE courses SET contact = ?, qr_ttl_seconds = ?, late_after_minutes = ?, device_binding = ?, clo_visible_to_students = ?, reminder_hours = ?,
    device_lock = ?, ip_allowlist = ?, geo_enabled = ?, geo_lat = ?, geo_lng = ?, geo_radius_m = ?, geo_max_accuracy_m = ?, checkin_mode = ? WHERE id = ?`)
    .run(String(b.contact || '').trim() || null, ttl, late, b.device_binding ? 1 : 0, b.clo_visible_to_students ? 1 : 0, reminders,
      b.device_lock ? 1 : 0, allow || null, b.geo_enabled ? 1 : 0, lat, lng, radius, maxAcc, b.checkin_mode === 'login' ? 'login' : 'student_code', c.id);
  audit.log(req.user.user_id, 'course.settings', 'course', c.id, {
    ttl, late, device_binding: !!b.device_binding, clo_visible: !!b.clo_visible_to_students, reminders, device_lock: !!b.device_lock, checkin_mode: b.checkin_mode === 'login' ? 'login' : 'student_code', ip_allowlist: allow || null, geo_enabled: !!b.geo_enabled, geo: lat !== null ? [lat, lng] : null, radius, maxAcc,
  });
  res.flash('success', 'บันทึกการตั้งค่าแล้ว');
  res.redirect('/teacher/settings');
}));

/** ผู้สอนยืนยันโครงสร้างคะแนนก่อนเปิดใช้งานจริง (Blueprint 2.3) */
router.post('/settings/course', TA, action((req, res) => {
  const c = course();
  const code = String(req.body.course_code || '').trim();
  const sem = String(req.body.semester || '').trim();
  const year = String(req.body.academic_year || '').trim();
  const name = String(req.body.course_name || '').trim();
  if (!/^[0-9A-Za-z-]{4,15}$/.test(code)) throw Object.assign(new Error('รหัสวิชาไม่ถูกต้อง'), { status: 400 });
  if (!/^[1-3]$/.test(sem) || !/^25\d{2}$/.test(year)) throw Object.assign(new Error('ภาคเรียน/ปีการศึกษาไม่ถูกต้อง (เช่น 2 / 2569)'), { status: 400 });
  get().prepare('UPDATE courses SET course_code = ?, semester = ?, academic_year = ?, course_name = ? WHERE id = ?').run(code, sem, year, name || c.course_name, c.id);
  audit.log(req.user.user_id, 'course.info', 'course', c.id, { old: [c.course_code, c.semester, c.academic_year], new: [code, sem, year] });
  res.flash('success', 'บันทึกข้อมูลรายวิชาแล้ว');
  res.redirect('/teacher/settings');
}));

router.post('/settings/confirm-structure', T, action((req, res) => {
  const c = course();
  const st = scores.structureCheck(c.id);
  if (!st.totalOk) throw Object.assign(new Error(`ผลรวมหมวดคะแนนต้องเท่ากับ 100 (ปัจจุบัน ${st.total})`), { status: 400 });
  get().prepare("UPDATE courses SET structure_confirmed_at = ?, structure_confirmed_by = ?, status = 'active' WHERE id = ?").run(now(), req.user.user_id, c.id);
  audit.log(req.user.user_id, 'course.confirm_structure', 'course', c.id, { categories: st.categories.map((x) => [x.code, x.max_score]) });
  res.flash('success', 'ยืนยันโครงสร้างคะแนนตาม OBE-3 แล้ว');
  res.redirect('/teacher/settings');
}));

router.post('/settings/categories', allow('admin'), action((req, res) => {
  const c = course();
  if (c.structure_confirmed_at) throw Object.assign(new Error('โครงสร้างคะแนนได้รับการยืนยันแล้ว ไม่สามารถแก้ไขได้'), { status: 400 });
  for (const cat of courseSvc.categories(c.id)) {
    const v = Number(req.body[`max_${cat.id}`]);
    if (v >= 0 && v !== cat.max_score) {
      get().prepare('UPDATE assessment_categories SET max_score = ? WHERE id = ?').run(v, cat.id);
      audit.log(req.user.user_id, 'category.update', 'assessment_category', cat.id, { old: cat.max_score, new: v });
    }
  }
  res.flash('success', 'บันทึกคะแนนเต็มของหมวดแล้ว (ต้องให้ผู้สอนยืนยันก่อนเปิดใช้)');
  res.redirect('/teacher/settings');
}));

router.post('/clo/criteria', T, action((req, res) => {
  const c = course();
  for (const clo of courseSvc.clos(c.id)) {
    const raw = req.body[`pass_${clo.clo_code}`];
    const v = raw === '' || raw === undefined ? null : Number(raw);
    if (v !== null && !(v >= 0 && v <= 100)) throw Object.assign(new Error(`เกณฑ์ผ่าน ${clo.clo_code} ต้องอยู่ระหว่าง 0–100`), { status: 400 });
    if (v !== clo.passing_criteria) {
      get().prepare('UPDATE clo_outcomes SET passing_criteria = ? WHERE id = ?').run(v, clo.id);
      audit.log(req.user.user_id, 'clo.criteria', 'clo_outcome', clo.id, { old: clo.passing_criteria, new: v });
    }
  }
  res.flash('success', 'บันทึกเกณฑ์ผ่าน CLO แล้ว');
  res.redirect('/teacher/clo');
}));

router.post('/announcements', T, action((req, res) => {
  const c = course();
  const title = String(req.body.title || '').trim();
  if (!title) throw Object.assign(new Error('กรุณาระบุหัวข้อประกาศ'), { status: 400 });
  const id = uuid();
  const mandatory = req.body.mandatory ? 1 : 0;
  get().prepare('INSERT INTO announcements (id, course_id, title, body, mandatory, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, c.id, title, String(req.body.body || '').trim() || null, mandatory, req.user.user_id, now());
  for (const s of courseSvc.students(c.id)) {
    notify.send(s.id, { eventType: 'announcement', title: `ประกาศ: ${title}`, link: '/course', entityType: 'announcement', entityId: id, dedupeKey: `ann:${id}`, mandatory: !!mandatory });
  }
  res.flash('success', 'เผยแพร่ประกาศแล้ว');
  res.redirect('/course');
}));

router.post('/announcements/:id/delete', T, (req, res) => {
  get().prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  res.redirect('/course');
});

router.post('/documents', T, upload.single('file'), (req, res, next) => verifyCsrf(req, res, next), action((req, res) => {
  const c = course();
  const title = String(req.body.title || '').trim();
  let key = null; let name = null; let mime = null; let url = null;
  if (req.file) {
    name = filesSvc.sanitizeName(subSvc.fixName(req.file.originalname));
    const e = filesSvc.ext(name);
    const err = filesSvc.TYPES[e] && !filesSvc.BLOCKED.has(e) ? filesSvc.validate(req.file, [e], 100) : `ไม่รองรับไฟล์ชนิด .${e}`;
    if (err) throw Object.assign(new Error(err), { status: 400 });
    key = storage.put(req.file.buffer, 'documents').key;
    mime = filesSvc.info(name).mime;
  }
  if (req.body.external_url) {
    const v = subSvc.validateUrl(req.body.external_url);
    if (v.error) throw Object.assign(new Error(v.error), { status: 400 });
    url = v.url;
  }
  if (!key && !url) throw Object.assign(new Error('กรุณาแนบไฟล์หรือ URL'), { status: 400 });
  get().prepare('INSERT INTO course_documents (id, course_id, title, external_url, file_storage_key, file_name, mime_type, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(uuid(), c.id, title || name || url, url, key, name, mime, now());
  res.flash('success', 'เพิ่มเอกสารรายวิชาแล้ว');
  res.redirect('/teacher/settings');
}));

router.post('/documents/:id/delete', T, (req, res) => {
  get().prepare('DELETE FROM course_documents WHERE id = ?').run(req.params.id);
  res.redirect('/teacher/settings');
});

router.get('/audit', TA, (req, res) => {
  res.page('teacher/audit', { title: 'Audit Log', logs: audit.list({ entityType: req.query.type || undefined, limit: 500 }), type: req.query.type || '' });
});

module.exports = router;
