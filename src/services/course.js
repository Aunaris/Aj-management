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

function sessions(courseId) {
  return get().prepare('SELECT * FROM course_sessions WHERE course_id = ? ORDER BY week_number, session_date, created_at').all(courseId);
}

function getSession(id) {
  return get().prepare('SELECT * FROM course_sessions WHERE id = ?').get(id);
}

function lessonDetail(sessionId) {
  return get().prepare('SELECT * FROM session_lesson_details WHERE session_id = ?').get(sessionId) || {};
}

function students(courseId, { includeWithdrawn = false } = {}) {
  return get()
    .prepare(`SELECT u.id, u.student_code, u.full_name, u.email, u.username, u.status, e.section, e.enrollment_status
      FROM course_enrollments e JOIN users u ON u.id = e.user_id JOIN roles r ON r.id = u.role_id
      WHERE e.course_id = ? AND r.role_name = 'student' ${includeWithdrawn ? '' : "AND e.enrollment_status = 'active'"}
      ORDER BY u.student_code, u.full_name`)
    .all(courseId);
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
    ON CONFLICT(course_id, user_id) DO UPDATE SET enrollment_status = 'active', section = COALESCE(excluded.section, section)`)
    .run(uuid(), courseId, userId, section || null);
}

/**
 * นำเข้ารายชื่อนักศึกษาจาก CSV/ข้อความที่คัดลอกจาก Excel
 * รูปแบบแต่ละบรรทัด: รหัสนักศึกษา, ชื่อ-นามสกุล, อีเมล(ไม่บังคับ), กลุ่มเรียน(ไม่บังคับ)
 * รหัสผ่านเริ่มต้น = รหัสนักศึกษา และบังคับเปลี่ยนเมื่อเข้าสู่ระบบครั้งแรก
 */
function importStudents(courseId, text, actorId) {
  const result = { created: 0, enrolled: 0, skipped: [], errors: [] };
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  tx(() => {
    lines.forEach((line, idx) => {
      const cols = line.split(/\t|,/).map((c) => c.trim().replace(/^"|"$/g, ''));
      const [code, name, email, section] = cols;
      if (idx === 0 && /รหัส|student|code/i.test(code)) return; // header
      if (!code || !/^[0-9A-Za-z-]{3,20}$/.test(code)) { result.errors.push(`บรรทัด ${idx + 1}: รหัสนักศึกษาไม่ถูกต้อง`); return; }
      if (!name) { result.errors.push(`บรรทัด ${idx + 1}: ไม่มีชื่อ-นามสกุล`); return; }
      let user = get().prepare('SELECT u.id, r.role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.student_code = ? OR u.username = ?').get(code, code);
      if (user && user.role_name !== 'student') { result.errors.push(`บรรทัด ${idx + 1}: ${code} เป็นบัญชีที่ไม่ใช่นักศึกษา`); return; }
      if (!user) {
        const id = auth.createUser({ username: code, studentCode: code, fullName: name, email, password: code, role: 'student', mustChangePassword: 1 });
        user = { id };
        result.created += 1;
      } else {
        result.skipped.push(code);
      }
      enroll(courseId, user.id, section);
      result.enrolled += 1;
    });
  });
  audit.log(actorId, 'students.import', 'course', courseId, { created: result.created, enrolled: result.enrolled, errors: result.errors.length });
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

function nextSession(courseId) {
  const today = now().slice(0, 10);
  return get().prepare(`SELECT * FROM course_sessions WHERE course_id = ? AND status != 'cancelled' AND (session_date >= ? OR attendance_state = 'open')
    ORDER BY CASE attendance_state WHEN 'open' THEN 0 ELSE 1 END, session_date, week_number LIMIT 1`).get(courseId, today);
}

module.exports = {
  getCourse, clos, categories, sessions, getSession, lessonDetail, students, isEnrolled, teacherIds,
  enroll, importStudents, announcements, documents, materials, nextSession,
};
