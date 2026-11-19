'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { login, q, one, db } = require('./helpers');
const courseSvc = require('../src/services/course');
const att = require('../src/services/attendance');
const scores = require('../src/services/scores');

const course = courseSvc.getCourse();
const teacherId = one("SELECT id FROM users WHERE username = 'aunalyst'").id;
const sid = (code) => one('SELECT id FROM users WHERE student_code = ?', code).id;

// ข้อมูลทดสอบรูปแบบเดียวกับไฟล์ ClassRoster ของระบบทะเบียน (ชื่อสมมติ)
function roster(section, students) {
  return [
    'รหัสวิชา,ชื่อวิชา,ปีการศึกษา,ภาคเรียน,กลุ่มเรียน',
    `"${course.course_code}","การสร้างภาพเคลื่อนไหวด้วยเทคนิคภาพ 2 มิติ","${course.academic_year}","${course.semester}","${section}"`,
    '',
    'ลำดับ,รหัสนักศึกษา,ชื่อ-สกุล,สาขาวิชา,คณะ',
    ...students.map(([code, name], i) => `${i + 1},"${code}","${name}","การสื่อสารดิจิทัล วิชาเอกเทคโนโลยีสื่อ","สารสนเทศและการสื่อสาร"`),
    '',
  ].join('\r\n');
}
const weekOf = (code, w) => courseSvc.sessions(course.id).find((s) => s.section_code === String(code) && s.week_number === w);
const tokenOf = (sessionId) => att._live.get(sessionId).token;

test('ค่าเริ่มต้น: 3 กลุ่มเรียน กลุ่มละ 17 คาบ', () => {
  const secs = courseSvc.sections(course.id);
  assert.deepEqual(secs.map((s) => s.section_code), ['1', '2', '3']);
  for (const s of secs) assert.equal(q('SELECT id FROM course_sessions WHERE section_id = ?', s.id).length, 17);
  assert.equal(q('SELECT id FROM course_sessions WHERE section_id IS NULL').length, 0);
});

test('นำเข้าไฟล์ ClassRoster: อ่านกลุ่มจากหัวไฟล์, เก็บสาขา/คณะ, หลายไฟล์พร้อมกัน, สร้างกลุ่มใหม่อัตโนมัติ', async () => {
  const teacher = await login('aunalyst', 'teacher1234');
  const r = await teacher.post('/teacher/students/import-file').field('_csrf', teacher.csrf)
    .attach('files', Buffer.from('﻿' + roster(2, [['6900000001', 'นางสาวทดสอบ หนึ่ง'], ['6900000002', 'นายทดสอบ สอง']])), 'ClassRoster_A.csv')
    .attach('files', Buffer.from(roster(3, [['6900000003', 'นางสาวทดสอบ สาม']])), 'ClassRoster_B.csv')
    .attach('files', Buffer.from(roster(4, [['6900000004', 'นายทดสอบ สี่']])), 'ClassRoster_C.csv');
  assert.equal(r.status, 302);
  const u = one("SELECT u.*, e.section FROM users u JOIN course_enrollments e ON e.user_id = u.id WHERE u.student_code = '6900000001'");
  assert.equal(u.section, '2');
  assert.equal(u.full_name, 'นางสาวทดสอบ หนึ่ง');
  assert.equal(u.program, 'การสื่อสารดิจิทัล วิชาเอกเทคโนโลยีสื่อ');
  assert.equal(u.faculty, 'สารสนเทศและการสื่อสาร');
  assert.equal(u.must_change_password, 1);
  assert.equal(courseSvc.studentSectionCode(course.id, sid('6900000003')), '3');
  // กลุ่ม 4 ยังไม่มี → สร้างพร้อมคาบเรียน (คัดลอกจากกลุ่มที่มีอยู่)
  const s4 = courseSvc.sectionByCode(course.id, '4');
  assert.ok(s4);
  assert.equal(q('SELECT * FROM course_sessions WHERE section_id = ?', s4.id).length, 17);
  assert.ok(one('SELECT 1 x FROM session_lesson_details d JOIN course_sessions s ON s.id = d.session_id WHERE s.section_id = ? AND d.objectives IS NOT NULL', s4.id));

  // นำเข้าซ้ำ: ไม่สร้างบัญชีซ้ำ, ย้ายกลุ่มได้, แจ้งเตือนรหัสวิชาไม่ตรง
  const again = courseSvc.importStudents(course.id, roster(3, [['6900000001', 'นางสาวทดสอบ หนึ่ง']]).replace(course.course_code, '99999999'), teacherId);
  assert.equal(again.created, 0);
  assert.equal(again.moved.length, 1);
  assert.match(again.warnings.join(), /99999999/);
  assert.equal(courseSvc.studentSectionCode(course.id, sid('6900000001')), '3');
  courseSvc.importStudents(course.id, roster(2, [['6900000001', 'นางสาวทดสอบ หนึ่ง']]), teacherId);
});

test('ไฟล์ภาษาไทยแบบ Windows-874 (TIS-620) อ่านได้', async () => {
  const teacher = await login('aunalyst', 'teacher1234');
  // "นายทดสอบ ห้า" ในรหัส TIS-620: อักษรไทย U+0E01–U+0E5B = 0xA1–0xFB
  const thai = 'นายทดสอบ ห้า';
  const bytes = Buffer.from([...roster(1, [['6900000005', 'X']]).replace('การสร้างภาพเคลื่อนไหวด้วยเทคนิคภาพ 2 มิติ', 'v')
    .replace('ลำดับ,รหัสนักศึกษา,ชื่อ-สกุล,สาขาวิชา,คณะ', 'ลำดับ,รหัสนักศึกษา,ชื่อ-สกุล,สาขาวิชา,คณะ').replace('"X"', `"${thai}"`)]
    .map((ch) => { const c = ch.codePointAt(0); return c >= 0x0e01 && c <= 0x0e5b ? c - 0x0e01 + 0xa1 : c; }));
  await teacher.post('/teacher/students/import-file').field('_csrf', teacher.csrf).attach('files', bytes, 'tis.csv');
  assert.equal(one("SELECT full_name FROM users WHERE student_code = '6900000005'").full_name, thai);
});

test('เช็คชื่อ: ต้องเป็นคาบของกลุ่มตนเอง; รายชื่อในคาบแสดงเฉพาะกลุ่มนั้น', async () => {
  const teacher = await login('aunalyst', 'teacher1234');
  const s2 = weekOf(2, 1);
  await teacher.post(`/teacher/sessions/${s2.id}/attendance/open`).type('form').send({ _csrf: teacher.csrf });
  await teacher.get(`/teacher/sessions/${s2.id}/qr.json`).set('Accept', 'application/json');
  const roster2 = att.roster(s2.id);
  assert.ok(roster2.length >= 1);
  assert.ok(roster2.every((r) => r.section === '2'));

  const other = await login('6501101001'); // กลุ่ม 1
  const bad = await other.post('/checkin').set('Accept', 'application/json').set('X-CSRF-Token', other.csrf).send({ token: tokenOf(s2.id) });
  assert.equal(bad.status, 403);
  assert.equal(bad.body.code, 'wrong_section');
  assert.throws(() => att.manualSet({ sessionId: s2.id, studentId: sid('6501101001'), status: 'present', actorId: teacherId }), /กลุ่มเรียน/);

  db.get().prepare("UPDATE users SET must_change_password = 0 WHERE student_code = '6900000002'").run();
  const mine = await login('6900000002', '123456');
  const ok = await mine.post('/checkin').set('Accept', 'application/json').set('X-CSRF-Token', mine.csrf).send({ token: tokenOf(s2.id) });
  assert.equal(ok.status, 200);

  // ปิดคาบ: บันทึกขาดเฉพาะนักศึกษากลุ่ม 2
  await teacher.post(`/teacher/sessions/${s2.id}/attendance/close`).type('form').send({ _csrf: teacher.csrf, mark_absent: '1' });
  const recs = q('SELECT a.*, e.section FROM attendance_records a JOIN course_enrollments e ON e.user_id = a.student_id WHERE a.session_id = ?', s2.id);
  assert.ok(recs.length >= 2);
  assert.ok(recs.every((r) => r.section === '2'));
});

test('นักศึกษาเห็นเฉพาะคาบของกลุ่มตนเอง', async () => {
  const st = await login('6900000002'); // กลุ่ม 2
  const home = await st.get('/course');
  assert.equal(home.status, 200);
  assert.equal((await st.get(`/sessions/${weekOf(2, 3).id}`)).status, 200);
  assert.equal((await st.get(`/sessions/${weekOf(1, 3).id}`)).status, 404);
  const hist = att.studentHistory(course.id, sid('6900000002'));
  assert.equal(hist.length, 17);
  const dash = await st.get('/student');
  assert.match(dash.text, /กลุ่ม 2/);
});

test('ผู้สอนเลือกกลุ่ม → รายชื่อ/คาบ/สมุดคะแนน/รายงาน กรองตามกลุ่ม', async () => {
  const teacher = await login('aunalyst', 'teacher1234');
  const s3 = courseSvc.sectionByCode(course.id, '3');
  const set = await teacher.get(`/teacher/section?id=${s3.id}&back=/teacher/students`);
  assert.equal(set.status, 302);
  assert.equal(set.headers.location, '/teacher/students');
  const page = await teacher.get('/teacher/students');
  assert.match(page.text, /6900000003/);
  assert.doesNotMatch(page.text, /6900000002/);
  const sessions = await teacher.get('/teacher/sessions');
  assert.equal((sessions.text.match(/href="\/teacher\/sessions\/[^"]+\/live"/g) || []).length, 17);
  const csv = await teacher.get('/teacher/reports/gradebook.csv');
  assert.match(csv.text, /กลุ่มเรียน: กลุ่ม 3/);
  assert.match(csv.text, /6900000003/);
  assert.doesNotMatch(csv.text, /6900000002/);
  const all = await teacher.get('/teacher/reports/gradebook.csv?section=all');
  assert.match(all.text, /6900000002/);
  assert.match(all.text, /6900000003/);
  await teacher.get('/teacher/section?id=&back=/teacher');
  assert.match((await teacher.get('/teacher/students')).text, /6900000002/);
  assert.equal((await teacher.get('/teacher/sections')).status, 200);
  assert.equal((await teacher.get('/teacher')).status, 200);
});

test('ตารางการเข้าเรียนรายสัปดาห์จับคู่คาบของแต่ละกลุ่ม', () => {
  const m = scores.attendanceMatrix(course.id);
  assert.ok(m.weeks.includes(1));
  const row2 = m.rows.find((r) => r.student.student_code === '6900000002');
  const i = m.weeks.indexOf(1);
  assert.ok(['present', 'late'].includes(row2.cells[i].attendance_status));
  const only1 = scores.attendanceMatrix(course.id, { section: '1' });
  assert.ok(only1.rows.every((r) => r.student.section === '1'));
});

test('ตั้งตารางเรียนของกลุ่ม: เลื่อนวันที่คาบที่ยังไม่เริ่ม (ไม่แตะคาบที่เช็คชื่อแล้ว) และย้ายกลุ่มนักศึกษา', async () => {
  const teacher = await login('aunalyst', 'teacher1234');
  const s2 = courseSvc.sectionByCode(course.id, '2');
  const started = weekOf(2, 1);
  await teacher.post(`/teacher/sections/${s2.id}`).type('form')
    .send({ _csrf: teacher.csrf, name: 'กลุ่ม 2 (วันพุธ)', first_date: '2026-11-04', start_time: '13:00', end_time: '17:00', location: 'ห้อง 301', apply_sessions: '1' });
  const sec = courseSvc.getSection(s2.id);
  assert.equal(sec.meeting_day, 3); // พุธ
  assert.equal(weekOf(2, 3).session_date, '2026-11-18');
  assert.equal(weekOf(2, 3).start_time, '13:00');
  assert.equal(weekOf(2, 3).location, 'ห้อง 301');
  assert.equal(weekOf(2, 1).session_date, started.session_date);

  const s1 = courseSvc.sectionByCode(course.id, '1');
  await teacher.post(`/teacher/students/${sid('6900000002')}/section`).type('form').send({ _csrf: teacher.csrf, section_id: s1.id });
  assert.equal(courseSvc.studentSectionCode(course.id, sid('6900000002')), '1');
  // ประวัติคาบเดิมของกลุ่ม 2 ยังอยู่
  assert.ok(att.studentHistory(course.id, sid('6900000002')).some((h) => h.session_id === started.id && h.attendance_status));
});

test('ย้ายฐานข้อมูลรุ่นเก่า (คาบไม่มีกลุ่ม) เป็นแบบกลุ่มเรียน', () => {
  const Database = require('better-sqlite3');
  assert.ok(Database);
  // จำลอง: ลบกลุ่มทั้งหมดในรายวิชาใหม่ แล้วให้ migrate สร้างกลุ่ม 1 + กลุ่มตามข้อมูลลงทะเบียน
  const cid = require('../src/db').uuid();
  db.get().prepare("INSERT INTO courses (id, course_code, course_name, semester, academic_year, credit) VALUES (?, 'X1', 'x', '1', '2569', '3')").run(cid);
  db.get().prepare("INSERT INTO course_sessions (id, course_id, week_number, title, status, created_at) VALUES (?, ?, 1, 'legacy', 'published', ?)").run(require('../src/db').uuid(), cid, new Date().toISOString());
  courseSvc.migrateSections(cid);
  const secs = courseSvc.sections(cid);
  assert.deepEqual(secs.map((s) => s.section_code), ['1']);
  assert.equal(one('SELECT section_id FROM course_sessions WHERE course_id = ?', cid).section_id, secs[0].id);
});

test('ตารางเรียน 2/2569: Sec 1 อังคาร, Sec 2 ศุกร์, Sec 3 จันทร์ 13:00–17:00 ห้อง InC 204 และเปลี่ยนวันเปิดภาคได้', async () => {
  const { firstOnOrAfter } = require('../src/plan');
  assert.equal(firstOnOrAfter('2026-11-16', 2), '2026-11-17');
  assert.equal(firstOnOrAfter('2026-11-16', 1), '2026-11-16');
  assert.equal(firstOnOrAfter('2026-11-18', 1), '2026-11-23');

  // สร้างกลุ่มตามตารางใหม่ในรายวิชาทดสอบแยก (ข้อมูลหลักถูกแก้ไขในเทสก่อนหน้า)
  const { uuid } = require('../src/db');
  const cid = uuid();
  db.get().prepare("INSERT INTO courses (id, course_code, course_name, semester, academic_year, credit, term_start_date) VALUES (?, 'T1', 't', '2', '2569', '3', '2026-11-16')").run(cid);
  for (const code of ['1', '2', '3']) courseSvc.ensureSection(cid, code);
  const day = (code) => courseSvc.sectionByCode(cid, code);
  const s = (code, w) => courseSvc.sessions(cid, { sectionId: day(code).id }).find((x) => x.week_number === w);
  assert.equal(day('1').meeting_day, 2);
  assert.equal(day('2').meeting_day, 5);
  assert.equal(day('3').meeting_day, 1);
  assert.equal(s('1', 1).session_date, '2026-11-17');
  assert.equal(s('2', 1).session_date, '2026-11-20');
  assert.equal(s('3', 1).session_date, '2026-11-16');
  assert.equal(s('3', 2).session_date, '2026-11-23');
  assert.equal(s('1', 17).session_date, '2027-03-09');
  for (const code of ['1', '2', '3']) {
    assert.equal(s(code, 5).start_time, '13:00');
    assert.equal(s(code, 5).end_time, '17:00');
    assert.equal(s(code, 5).location, 'InC 204');
  }
  // เปลี่ยนวันเปิดภาค → เลื่อนทุกกลุ่ม ยกเว้นคาบที่เช็คชื่อแล้ว
  db.get().prepare("UPDATE course_sessions SET attendance_state = 'closed' WHERE id = ?").run(s('3', 1).id);
  courseSvc.setTermStart(cid, '2026-11-23', teacherId);
  assert.equal(s('1', 1).session_date, '2026-11-24');
  assert.equal(s('2', 1).session_date, '2026-11-27');
  assert.equal(s('3', 2).session_date, '2026-11-30');
  assert.equal(s('3', 1).session_date, '2026-11-16'); // เช็คชื่อแล้ว ไม่เปลี่ยน
});
