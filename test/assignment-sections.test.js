'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { login, one, q, db, PNG } = require('./helpers');
const courseSvc = require('../src/services/course');
const assignSvc = require('../src/services/assignments');
const scores = require('../src/services/scores');
const subSvc = require('../src/services/submissions');
const scheduler = require('../src/services/scheduler');
const mailin = require('../src/services/mailin');

const course = courseSvc.getCourse();
const teacherId = one("SELECT id FROM users WHERE username = 'aunalyst'").id;
const sid = (code) => one('SELECT id FROM users WHERE student_code = ?', code).id;
const sec = (code) => courseSvc.sectionByCode(course.id, code);
const cat = (code) => courseSvc.categories(course.id).find((c) => c.code === code);

// นักศึกษาตัวอย่าง: 6501101001-004 กลุ่ม 1, 005-007 กลุ่ม 2, 008-010 กลุ่ม 3
test.before(() => {
  for (const [code, s] of [['6501101005', '2'], ['6501101006', '2'], ['6501101007', '2'], ['6501101008', '3'], ['6501101009', '3'], ['6501101010', '3']]) {
    db.get().prepare('UPDATE course_enrollments SET section = ? WHERE user_id = ?').run(s, sid(code));
  }
});

function form(extra) {
  return {
    title: 'Bouncing Ball', max_score: '5', category_id: cat('PRE_CLO1').id, submission_mode: 'online', allowed_types: 'png', allow_links: '1', allow_resubmit: '1',
    max_versions: '3', clo_CLO1: '1', clo_weight_CLO1: '1', ...extra,
  };
}

let G1; let G2;
test('สร้างงานเฉพาะกลุ่ม พร้อมกำหนดส่งแยกกลุ่ม; คะแนนเต็มหมวดตรวจแยกทีละกลุ่ม', () => {
  const base = assignSvc.categoryUsageBySection(cat('PRE_CLO1').id, null).bySection; // งานของทุกกลุ่มที่มีอยู่แล้ว (เช่น A01 จากข้อมูลตัวอย่าง)
  const due1 = new Date(Date.now() + 3 * 86400000).toISOString();
  const due2 = new Date(Date.now() + 6 * 86400000).toISOString();
  G1 = assignSvc.save(course.id, form({ assignment_code: 'BB-S1', section_scope: 'selected', section_ids: [sec('1').id], [`sec_due_${sec('1').id}`]: due1 }), teacherId);
  // งานเดียวกันของกลุ่ม 2 คนละชิ้น 5 คะแนน — ไม่นับรวมกับกลุ่ม 1
  G2 = assignSvc.save(course.id, form({ assignment_code: 'BB-S2', section_scope: 'selected', section_ids: [sec('2').id], [`sec_due_${sec('2').id}`]: due2 }), teacherId);
  assignSvc.setStatus(G1, 'published', teacherId);
  assignSvc.setStatus(G2, 'published', teacherId);
  const u = assignSvc.categoryUsageBySection(cat('PRE_CLO1').id, null).bySection;
  assert.equal(u['1'], base['1'] + 5);
  assert.equal(u['2'], base['2'] + 5);
  assert.equal(u['3'], base['3']);
  // เติมกลุ่ม 1 จนเต็มไม่ได้เกิน แต่กลุ่ม 3 ยังเหลือที่ว่างมากกว่า
  const room1 = 15 - u['1'];
  const room3 = 15 - u['3'];
  assert.ok(room3 > room1);
  assert.throws(() => assignSvc.save(course.id, form({ assignment_code: 'X1', max_score: String(room3), section_scope: 'selected', section_ids: [sec('1').id] }), teacherId), /กลุ่ม 1/);
  assert.throws(() => assignSvc.save(course.id, form({ assignment_code: 'X2', max_score: String(room3), section_scope: 'all' }), teacherId), /เกิน 15/);
  const id3 = assignSvc.save(course.id, form({ assignment_code: 'X3', max_score: String(room3), section_scope: 'selected', section_ids: [sec('3').id] }), teacherId);
  assignSvc.softDelete(id3, teacherId);
  assert.throws(() => assignSvc.save(course.id, form({ assignment_code: 'X4', section_scope: 'selected', section_ids: [] }), teacherId), /อย่างน้อย 1 กลุ่ม/);
  const st = scores.structureCheck(course.id, { section: '1' }).categories.find((c) => c.code === 'PRE_CLO1');
  assert.equal(st.planned, base['1'] + 5);
});

test('แจ้งเตือนงานใหม่เฉพาะนักศึกษาในกลุ่มที่ได้รับมอบหมาย', () => {
  assert.ok(one("SELECT 1 x FROM notifications WHERE recipient_id = ? AND event_type = 'assignment_new' AND related_entity_id = ?", sid('6501101001'), G1));
  assert.equal(q("SELECT * FROM notifications WHERE recipient_id = ? AND event_type = 'assignment_new' AND related_entity_id = ?", sid('6501101005'), G1).length, 0);
});

test('นักศึกษาเห็น/ส่งได้เฉพาะงานของกลุ่มตนเอง และเห็นกำหนดส่งของกลุ่มตน', async () => {
  const s1 = await login('6501101002');
  const list = await s1.get('/student/assignments');
  assert.match(list.text, /BB-S1/);
  assert.doesNotMatch(list.text, /BB-S2/);
  assert.equal((await s1.get(`/student/assignments/${G2}`)).status, 404);
  assert.throws(() => subSvc.submit({ assignmentId: G2, studentId: sid('6501101002'), files: [{ originalname: 'a.png', buffer: PNG, size: PNG.length }] }), /ไม่ได้มอบหมายให้กลุ่มเรียนของคุณ/);
  const r = subSvc.submit({ assignmentId: G1, studentId: sid('6501101002'), files: [{ originalname: 'a.png', buffer: PNG, size: PNG.length }] });
  assert.equal(r.version, 1);
  const s2 = await login('6501101006');
  const page = await s2.get(`/student/assignments/${G2}`);
  assert.equal(page.status, 200);
  const due2 = assignSvc.getAssignment(G2).sections[0].due_date;
  assert.ok(page.text.includes(require('../src/util').thaiDate(due2, { time: true })));
});

test('ส่งล่าช้าตัดสินจากกำหนดส่งของกลุ่ม', () => {
  const a = assignSvc.getAssignment(G2);
  db.get().prepare('UPDATE assignment_sections SET due_date = ? WHERE assignment_id = ?').run(new Date(Date.now() - 3600000).toISOString(), G2);
  db.get().prepare('UPDATE assignments SET due_date = ? WHERE id = ?').run(new Date(Date.now() + 86400000).toISOString(), G2);
  const r = subSvc.submit({ assignmentId: G2, studentId: sid('6501101007'), files: [{ originalname: 'b.png', buffer: PNG, size: PNG.length }] });
  assert.equal(r.isLate, true);
  assert.ok(a);
});

test('สมุดคะแนน/รายชื่อตรวจงาน นับเฉพาะงานของกลุ่มนักศึกษา (งานกลุ่มอื่นไม่เป็น "รอผล")', () => {
  const gb = scores.gradebook(course.id);
  const g1 = gb.rows.find((r) => r.student.student_code === '6501101003');
  const g3 = gb.rows.find((r) => r.student.student_code === '6501101009');
  const items = (row) => Object.values(row.byCat).flatMap((b) => b.items.map((i) => i.assignment.assignment_code));
  assert.ok(items(g1).includes('BB-S1'));
  assert.ok(!items(g1).includes('BB-S2'));
  assert.ok(!items(g3).includes('BB-S1') && !items(g3).includes('BB-S2'));
  const ov = subSvc.overview(G1);
  assert.ok(ov.length >= 1 && ov.every((o) => o.student.section === '1'));
});

test('หน้ารายการงานของผู้สอน: แยกตามกลุ่มที่เลือก และแสดงคอลัมน์กลุ่ม', async () => {
  const teacher = await login('aunalyst', 'teacher1234');
  await teacher.get(`/teacher/section?id=${sec('2').id}&back=/teacher/assignments`);
  const page = await teacher.get('/teacher/assignments');
  assert.match(page.text, /BB-S2/);
  assert.doesNotMatch(page.text, /BB-S1/);
  await teacher.get('/teacher/section?id=&back=/teacher/assignments');
  const all = await teacher.get('/teacher/assignments');
  assert.match(all.text, /BB-S1/);
  assert.match(all.text, /BB-S2/);
  const edit = await teacher.get(`/teacher/assignments/${G1}/edit`);
  assert.match(edit.text, /name="section_scope" value="selected" checked/);
  // นำกลุ่มที่มีการส่งงานแล้วออกไม่ได้
  const r = await teacher.post(`/teacher/assignments/${G1}`).set('Accept', 'application/json').set('X-CSRF-Token', teacher.csrf)
    .send(form({ assignment_code: 'BB-S1', section_scope: 'selected', section_ids: [sec('3').id] }));
  assert.equal(r.status, 400);
  assert.match(r.body.errors.join(), /กลุ่ม 1 มีการส่งงาน/);
});

test('เตือนกำหนดส่งตามวันของกลุ่ม และรับงานทางอีเมลจับคู่งานของกลุ่มตนเอง', async () => {
  db.get().prepare('UPDATE assignment_sections SET due_date = ? WHERE assignment_id = ?').run(new Date(Date.now() + 30 * 60000).toISOString(), G1);
  scheduler.runReminders();
  assert.ok(one("SELECT 1 x FROM notifications WHERE recipient_id = ? AND event_type = 'due_reminder' AND related_entity_id = ?", sid('6501101004'), G1));
  assert.equal(q("SELECT * FROM notifications WHERE recipient_id = ? AND event_type = 'due_reminder' AND related_entity_id = ?", sid('6501101009'), G1).length, 0);
  const m = mailin.match(course.id, { fromAddress: 'x@y.z', subject: 'BB-S2 6501101005' });
  assert.equal(m.assignment.id, G2);
  const wrong = mailin.match(course.id, { fromAddress: 'x@y.z', subject: 'BB-S2 6501101001' });
  assert.equal(wrong.assignment, null);
});
