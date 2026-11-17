'use strict';
const { get, uuid, now, tx } = require('../db');
const auth = require('./auth');
const audit = require('./audit');

/** ระบบสำหรับรายวิชาเดียว (Single Course) ตาม Blueprint 2.6 */
function getCourse() {
  return get().prepare('SELECT * FROM courses ORDER BY rowid LIMIT 1').get();
}

function clos(courseId) {
  return get().prepare('SELECT * FROM clo_outcomes WHERE course_id = ? ORDER BY clo_code').all(courseId);
}

function categories(courseId) {
  return get().prepare('SELECT * FROM assessment_categories WHERE course_id = ? ORDER BY sort_order').all(courseId);
}

/* ---------- กลุ่มเรียน (Section) ---------- */
function sections(courseId) {
  return get().prepare(`SELECT * FROM course_sections WHERE course_id = ? ORDER BY CAST(section_code AS INTEGER), section_code`).all(courseId);
}

function getSection(id) {
  return id ? get().prepare('SELECT * FROM course_sections WHERE id = ?').get(id) : null;
}

function sectionByCode(courseId, code) {
  return get().prepare('SELECT * FROM course_sections WHERE course_id = ? AND section_code = ?').get(courseId, String(code));
}

function sectionLabel(sec) {
  return sec ? (sec.name || `กลุ่ม ${sec.section_code}`) : 'ทุกกลุ่ม';
}

/** กลุ่มเรียนของคาบ (คืนค่า section_code หรือ null ถ้าเป็นคาบรวม) */
function sessionSectionCode(session) {
  const sec = session && session.section_id ? getSection(session.section_id) : null;
  return sec ? sec.section_code : null;
}

function studentSectionCode(courseId, userId) {
  const r = get().prepare('SELECT section FROM course_enrollments WHERE course_id = ? AND user_id = ?').get(courseId, userId);
  return r ? r.section : null;
}

/** นักศึกษาเห็น/เช็คชื่อคาบนี้ได้หรือไม่ (คาบของกลุ่มตนเอง หรือคาบรวม) */
function sessionVisibleTo(session, courseId, userId) {
  const code = sessionSectionCode(session);
  return !code || code === studentSectionCode(courseId, userId);
}

const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

/**
 * สร้างกลุ่มเรียน + คาบเรียน 17 สัปดาห์ (คัดลอกเนื้อหาจากกลุ่มแรกที่มีอยู่ หรือจากแผนการสอน OBE-3)
 */
/** วันเปิดภาค (จันทร์ของสัปดาห์ที่ 1) */
function termStart(courseId) {
  const { DEFAULT_TERM_START } = require('../plan');
  const c = get().prepare('SELECT term_start_date FROM courses WHERE id = ?').get(courseId);
  return (c && c.term_start_date) || process.env.TERM_START_DATE || DEFAULT_TERM_START;
}

function ensureSection(courseId, code, { actorId = null, startDate } = {}) {
  const existing = sectionByCode(courseId, code);
  if (existing) return existing;
  const { PLAN, addDays, SECTION_SCHEDULE, firstOnOrAfter } = require('../plan');
  const sched = SECTION_SCHEDULE[String(code)] || null;
  const term = startDate || termStart(courseId);
  const start = sched ? firstOnOrAfter(term, sched.day) : term;
  const st = sched ? sched.start : '13:00';
  const en = sched ? sched.end : '17:00';
  const room = sched ? sched.location : 'InC 204';
  const id = uuid();
  tx(() => {
    get().prepare('INSERT INTO course_sections (id, course_id, section_code, name, first_date, meeting_day, start_time, end_time, location, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, courseId, String(code), `กลุ่ม ${code}`, start, new Date(`${start}T00:00:00Z`).getUTCDay(), st, en, room, now());
    const source = sections(courseId).find((x) => x.id !== id);
    const template = source ? get().prepare('SELECT * FROM course_sessions WHERE section_id = ? ORDER BY week_number, session_date').all(source.id) : [];
    const ins = get().prepare(`INSERT INTO course_sessions (id, course_id, section_id, week_number, title, session_date, start_time, end_time, location, instructor, hours, status, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insL = get().prepare(`INSERT INTO session_lesson_details (id, session_id, objectives, topics, theory_activities, practical_activities, teaching_method, clo_codes)
      VALUES (?,?,?,?,?,?,?,?)`);
    if (template.length) {
      for (const t of template) {
        const sid = uuid();
        const l = lessonDetail(t.id);
        ins.run(sid, courseId, id, t.week_number, t.title, addDays(start, (t.week_number - 1) * 7), st, en, room, t.instructor, t.hours, t.status === 'cancelled' ? 'cancelled' : 'published', now());
        insL.run(uuid(), sid, l.objectives || null, l.topics || null, l.theory_activities || null, l.practical_activities || null, l.teaching_method || null, l.clo_codes || null);
      }
    } else {
      for (const [week, title, clo, objectives, method, theory, practical] of PLAN) {
        const sid = uuid();
        ins.run(sid, courseId, id, week, title, addDays(start, (week - 1) * 7), st, en, room, 'อาจารย์ทักษิณ อินตะพิงค์', week === 17 ? null : 4, 'published', now());
        insL.run(uuid(), sid, objectives, title, theory, practical, method, clo);
      }
    }
  });
  audit.log(actorId, 'section.create', 'course_section', id, { code });
  return getSection(id);
}

/** ตั้งตารางเรียนของกลุ่ม แล้วเลื่อนวันที่ของคาบที่ยังไม่เริ่มเช็คชื่อให้ตรง (สัปดาห์ละ 1 คาบ) */
function updateSection(sectionId, input, actorId) {
  const sec = getSection(sectionId);
  if (!sec) throw Object.assign(new Error('ไม่พบกลุ่มเรียน'), { status: 404 });
  const { addDays, firstOnOrAfter } = require('../plan');
  // วันเรียนสัปดาห์ที่ 1: ระบุเอง หรือคำนวณจากวันในสัปดาห์ + วันเปิดภาค
  const wd = input.meeting_day === undefined || input.meeting_day === '' ? null : Number(input.meeting_day);
  let firstDate = sec.first_date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.first_date || '')) firstDate = input.first_date;
  else if (wd !== null && wd >= 0 && wd <= 6) firstDate = firstOnOrAfter(termStart(sec.course_id), wd);
  const time = (v, d) => (/^\d{2}:\d{2}$/.test(v || '') ? v : d);
  const row = {
    name: String(input.name || '').trim() || `กลุ่ม ${sec.section_code}`, first_date: firstDate,
    start_time: time(input.start_time, sec.start_time), end_time: time(input.end_time, sec.end_time),
    location: String(input.location || '').trim() || null, instructor: String(input.instructor || '').trim() || null,
  };
  const day = firstDate ? new Date(`${firstDate}T00:00:00Z`).getUTCDay() : null;
  let moved = 0;
  tx(() => {
    get().prepare('UPDATE course_sections SET name = ?, first_date = ?, meeting_day = ?, start_time = ?, end_time = ?, location = ?, instructor = ? WHERE id = ?')
      .run(row.name, row.first_date, day, row.start_time, row.end_time, row.location, row.instructor, sectionId);
    if (input.apply_sessions) {
      for (const s of get().prepare("SELECT * FROM course_sessions WHERE section_id = ? AND attendance_state = 'not_started'").all(sectionId)) {
        get().prepare('UPDATE course_sessions SET session_date = ?, start_time = ?, end_time = ?, location = COALESCE(?, location), instructor = COALESCE(?, instructor) WHERE id = ?')
          .run(firstDate ? addDays(firstDate, (s.week_number - 1) * 7) : s.session_date, row.start_time, row.end_time, row.location, row.instructor, s.id);
        moved += 1;
      }
    }
  });
  audit.log(actorId, 'section.update', 'course_section', sectionId, { ...row, moved });
  return moved;
}

/** ตั้งวันเปิดภาค แล้วคำนวณวันเรียนของทุกกลุ่มใหม่ (เฉพาะคาบที่ยังไม่เริ่มเช็คชื่อ) */
function setTermStart(courseId, date, actorId) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw Object.assign(new Error('วันเปิดภาคไม่ถูกต้อง'), { status: 400 });
  get().prepare('UPDATE courses SET term_start_date = ? WHERE id = ?').run(date, courseId);
  let moved = 0;
  for (const sec of sections(courseId)) {
    if (sec.meeting_day === null || sec.meeting_day === undefined) continue;
    moved += updateSection(sec.id, { ...sec, first_date: '', meeting_day: sec.meeting_day, apply_sessions: 1 }, actorId);
  }
  audit.log(actorId, 'course.term_start', 'course', courseId, { date, moved });
  return moved;
}

/** ใส่ตารางเรียนตามตาราง 2/2569 ให้กลุ่มที่ยังไม่มีวันเรียนและยังไม่เริ่มเช็คชื่อ */
function applyDefaultSchedule(courseId) {
  const { SECTION_SCHEDULE } = require('../plan');
  for (const sec of sections(courseId)) {
    const sched = SECTION_SCHEDULE[sec.section_code];
    if (!sched || (sec.meeting_day !== null && sec.meeting_day !== undefined && sec.start_time === sched.start && sec.location === sched.location)) continue;
    const started = get().prepare("SELECT 1 FROM course_sessions WHERE section_id = ? AND attendance_state != 'not_started'").get(sec.id);
    if (started) continue;
    updateSection(sec.id, { name: sec.name, meeting_day: sched.day, start_time: sched.start, end_time: sched.end, location: sched.location, instructor: sec.instructor, apply_sessions: 1 }, null);
  }
}

/** ย้ายฐานข้อมูลรุ่นก่อน (คาบไม่มีกลุ่ม) ให้เป็นโครงสร้างแบบกลุ่มเรียน */
function migrateSections(courseId) {
  if (sections(courseId).length) { applyDefaultSchedule(courseId); return; }
  const legacy = get().prepare('SELECT COUNT(*) c FROM course_sessions WHERE course_id = ? AND section_id IS NULL').get(courseId).c;
  const id = uuid();
  tx(() => {
    get().prepare('INSERT INTO course_sections (id, course_id, section_code, name, first_date, start_time, end_time, location, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, courseId, '1', 'กลุ่ม 1', process.env.SEED_START_DATE || '2026-06-15', '09:00', '13:00', 'ห้องปฏิบัติการคอมพิวเตอร์', now());
    if (legacy) get().prepare('UPDATE course_sessions SET section_id = ? WHERE course_id = ? AND section_id IS NULL').run(id, courseId);
    get().prepare(`UPDATE course_enrollments SET section = '1' WHERE course_id = ? AND (section IS NULL OR section = '')
      AND user_id IN (SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.role_name = 'student')`).run(courseId);
  });
  if (!legacy) ensureSection(courseId, '1');
  const codes = get().prepare("SELECT DISTINCT section FROM course_enrollments WHERE course_id = ? AND section IS NOT NULL AND section != ''").all(courseId).map((r) => r.section);
  for (const c of codes) ensureSection(courseId, c);
  applyDefaultSchedule(courseId);
}

function sessions(courseId, { sectionId } = {}) {
  return get().prepare(`SELECT s.*, cs.section_code, cs.name AS section_name FROM course_sessions s LEFT JOIN course_sections cs ON cs.id = s.section_id
    WHERE s.course_id = ? ${sectionId ? 'AND (s.section_id = ? OR s.section_id IS NULL)' : ''}
    ORDER BY s.week_number, CAST(cs.section_code AS INTEGER), s.session_date, s.created_at`).all(...(sectionId ? [courseId, sectionId] : [courseId]));
}

/** คาบที่นักศึกษาคนนี้เห็น (กลุ่มของตนเอง + คาบรวม) */
function sessionsForStudent(courseId, userId) {
  const sec = sectionByCode(courseId, studentSectionCode(courseId, userId) || '');
  return sec ? sessions(courseId, { sectionId: sec.id }) : sessions(courseId).filter((s) => !s.section_id);
}

function getSession(id) {
  return get().prepare(`SELECT s.*, cs.section_code, cs.name AS section_name FROM course_sessions s LEFT JOIN course_sections cs ON cs.id = s.section_id WHERE s.id = ?`).get(id);
}

function lessonDetail(sessionId) {
  return get().prepare('SELECT * FROM session_lesson_details WHERE session_id = ?').get(sessionId) || {};
}

/** @param {{includeWithdrawn?: boolean, section?: string|null}} opts section = section_code (ไม่ระบุ = ทุกกลุ่ม) */
function students(courseId, { includeWithdrawn = false, section = null } = {}) {
  return get()
    .prepare(`SELECT u.id, u.student_code, u.full_name, u.email, u.username, u.status, u.program, u.faculty, e.section, e.enrollment_status
      FROM course_enrollments e JOIN users u ON u.id = e.user_id JOIN roles r ON r.id = u.role_id
      WHERE e.course_id = ? AND r.role_name = 'student' ${includeWithdrawn ? '' : "AND e.enrollment_status = 'active'"}
      ${section ? 'AND e.section = ?' : ''}
      ORDER BY CAST(e.section AS INTEGER), u.student_code, u.full_name`)
    .all(...(section ? [courseId, String(section)] : [courseId]));
}

function isEnrolled(courseId, userId) {
  return !!get().prepare("SELECT 1 FROM course_enrollments WHERE course_id = ? AND user_id = ? AND enrollment_status = 'active'").get(courseId, userId);
}

function teacherIds(courseId) {
  return get()
    .prepare(`SELECT u.id FROM course_enrollments e JOIN users u ON u.id = e.user_id JOIN roles r ON r.id = u.role_id
      WHERE e.course_id = ? AND r.role_name = 'teacher' AND e.enrollment_status = 'active'`)
    .all(courseId).map((r) => r.id);
}

function enroll(courseId, userId, section) {
  get().prepare(`INSERT INTO course_enrollments (id, course_id, user_id, section) VALUES (?,?,?,?)
    ON CONFLICT(course_id, user_id) DO UPDATE SET enrollment_status = 'active', section = COALESCE(excluded.section, course_enrollments.section)`)
    .run(uuid(), courseId, userId, section || null);
}

/** แยกคอลัมน์ CSV หนึ่งบรรทัด (รองรับ "..." และแท็บจากการคัดลอก Excel) */
function splitRow(line) {
  if (line.includes('\t') && !line.includes('"')) return line.split('\t').map((c) => c.trim());
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === '\t') { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * อ่านรายชื่อนักศึกษา รองรับ 2 รูปแบบ
 * 1) ไฟล์ ClassRoster จากระบบทะเบียน: ส่วนหัว "รหัสวิชา,ชื่อวิชา,ปีการศึกษา,ภาคเรียน,กลุ่มเรียน" ตามด้วย
 *    "ลำดับ,รหัสนักศึกษา,ชื่อ-สกุล,สาขาวิชา,คณะ"
 * 2) ข้อความ/CSV ทั่วไป: รหัสนักศึกษา, ชื่อ-นามสกุล, อีเมล, กลุ่มเรียน
 */
function parseRoster(text, defaultSection = null) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  const rows = [];
  const meta = {};
  const errors = [];
  if (/^\s*"?รหัสวิชา/.test(lines[0] || '')) {
    const head = splitRow(lines[0]);
    const vals = splitRow(lines[1] || '');
    const at = (k) => vals[head.findIndex((h) => h.includes(k))];
    Object.assign(meta, { courseCode: at('รหัสวิชา'), courseName: at('ชื่อวิชา'), year: at('ปีการศึกษา'), term: at('ภาคเรียน'), section: at('กลุ่มเรียน') });
    const start = lines.findIndex((l) => /^\s*"?ลำดับ/.test(l));
    if (start < 0) errors.push('ไม่พบหัวตาราง "ลำดับ,รหัสนักศึกษา,ชื่อ-สกุล"');
    const cols = start >= 0 ? splitRow(lines[start]) : [];
    const ci = (k, d) => { const i = cols.findIndex((h) => h.includes(k)); return i >= 0 ? i : d; };
    const iCode = ci('รหัสนักศึกษา', 1); const iName = ci('ชื่อ', 2); const iProg = ci('สาขา', 3); const iFac = ci('คณะ', 4);
    for (let i = start + 1; start >= 0 && i < lines.length; i += 1) {
      if (!lines[i].trim()) continue;
      const c = splitRow(lines[i]);
      rows.push({ line: i + 1, code: c[iCode], name: c[iName], program: c[iProg] || null, faculty: c[iFac] || null, section: meta.section || defaultSection });
    }
  } else {
    lines.forEach((line, idx) => {
      if (!line.trim()) return;
      const [code, name, email, section] = splitRow(line);
      if (idx === 0 && /รหัส|student|code/i.test(code)) return;
      rows.push({ line: idx + 1, code, name, email: email || null, section: section || defaultSection });
    });
  }
  return { meta, rows, errors };
}

/**
 * นำเข้ารายชื่อ — รหัสผ่านเริ่มต้น = รหัสนักศึกษา และบังคับเปลี่ยนเมื่อเข้าสู่ระบบครั้งแรก
 * กลุ่มเรียนที่ยังไม่มีในระบบจะถูกสร้างพร้อมคาบเรียน 17 สัปดาห์โดยอัตโนมัติ
 */
function importStudents(courseId, text, actorId, { section = null } = {}) {
  const course = get().prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
  const { meta, rows, errors } = parseRoster(text, section);
  const result = { created: 0, enrolled: 0, updated: 0, moved: [], skipped: [], errors: [...errors], warnings: [], meta, sections: {} };
  if (meta.courseCode && meta.courseCode !== course.course_code) {
    result.warnings.push(`ไฟล์เป็นรหัสวิชา ${meta.courseCode} แต่ระบบตั้งไว้ ${course.course_code} (ปรับได้ที่ ตั้งค่ารายวิชา)`);
  }
  if (meta.term && meta.year && `${meta.term}/${meta.year}` !== `${course.semester}/${course.academic_year}`) {
    result.warnings.push(`ไฟล์เป็นภาคเรียน ${meta.term}/${meta.year} แต่ระบบตั้งไว้ ${course.semester}/${course.academic_year}`);
  }
  const codes = [...new Set(rows.map((r) => r.section).filter(Boolean))];
  for (const c of codes) ensureSection(courseId, c, { actorId });
  tx(() => {
    for (const r of rows) {
      const code = String(r.code || '').trim();
      const name = String(r.name || '').trim();
      if (!/^[0-9A-Za-z-]{3,20}$/.test(code)) { result.errors.push(`บรรทัด ${r.line}: รหัสนักศึกษาไม่ถูกต้อง`); continue; }
      if (!name) { result.errors.push(`บรรทัด ${r.line}: ไม่มีชื่อ-นามสกุล`); continue; }
      let user = get().prepare('SELECT u.id, u.full_name, r.role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.student_code = ? OR u.username = ?').get(code, code);
      if (user && user.role_name !== 'student') { result.errors.push(`บรรทัด ${r.line}: ${code} เป็นบัญชีที่ไม่ใช่นักศึกษา`); continue; }
      if (!user) {
        const id = auth.createUser({ username: code, studentCode: code, fullName: name, email: r.email, password: code, role: 'student', mustChangePassword: 1 });
        user = { id };
        result.created += 1;
      } else {
        result.skipped.push(code);
        if (user.full_name !== name) result.updated += 1;
        get().prepare('UPDATE users SET full_name = ?, email = COALESCE(?, email) WHERE id = ?').run(name, r.email || null, user.id);
      }
      if (r.program || r.faculty) get().prepare('UPDATE users SET program = ?, faculty = ? WHERE id = ?').run(r.program, r.faculty, user.id);
      const prev = studentSectionCode(courseId, user.id);
      if (prev && r.section && prev !== String(r.section)) result.moved.push(`${code}: กลุ่ม ${prev} → ${r.section}`);
      enroll(courseId, user.id, r.section ? String(r.section) : null);
      result.enrolled += 1;
      if (r.section) result.sections[r.section] = (result.sections[r.section] || 0) + 1;
    }
  });
  audit.log(actorId, 'students.import', 'course', courseId, { created: result.created, enrolled: result.enrolled, sections: result.sections, errors: result.errors.length, file: meta });
  return result;
}

function announcements(courseId, limit = 20) {
  return get().prepare('SELECT a.*, u.full_name AS author FROM announcements a LEFT JOIN users u ON u.id = a.created_by WHERE course_id = ? ORDER BY created_at DESC LIMIT ?').all(courseId, limit);
}

function documents(courseId) {
  return get().prepare('SELECT * FROM course_documents WHERE course_id = ? ORDER BY created_at').all(courseId);
}

function materials(sessionId, { includeTeacher = false } = {}) {
  return get().prepare(`SELECT * FROM session_materials WHERE session_id = ? ${includeTeacher ? '' : "AND visibility = 'students'"} ORDER BY created_at`).all(sessionId);
}

function nextSession(courseId, { sectionId } = {}) {
  const today = require('../util').localToday();
  return get().prepare(`SELECT s.*, cs.section_code, cs.name AS section_name FROM course_sessions s LEFT JOIN course_sections cs ON cs.id = s.section_id
    WHERE s.course_id = ? AND s.status != 'cancelled' AND (s.session_date >= ? OR s.attendance_state = 'open')
    ${sectionId ? 'AND (s.section_id = ? OR s.section_id IS NULL)' : ''}
    ORDER BY CASE s.attendance_state WHEN 'open' THEN 0 ELSE 1 END, s.session_date, s.start_time, s.week_number LIMIT 1`).get(...(sectionId ? [courseId, today, sectionId] : [courseId, today]));
}

module.exports = {
  sections, getSection, sectionByCode, sectionLabel, sessionSectionCode, studentSectionCode, sessionVisibleTo, ensureSection, updateSection, migrateSections,
  sessionsForStudent, parseRoster, WEEKDAYS, termStart, setTermStart, applyDefaultSchedule,
  getCourse, clos, categories, sessions, getSession, lessonDetail, students, isEnrolled, teacherIds,
  enroll, importStudents, announcements, documents, materials, nextSession,
};
