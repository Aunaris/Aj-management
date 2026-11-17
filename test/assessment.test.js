'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { login, q, one, PNG, db } = require('./helpers');
const courseSvc = require('../src/services/course');
const assignSvc = require('../src/services/assignments');
const grading = require('../src/services/grading');
const scores = require('../src/services/scores');
const scheduler = require('../src/services/scheduler');

const course = courseSvc.getCourse();
const cat = (code) => courseSvc.categories(course.id).find((c) => c.code === code);
const teacherId = one("SELECT id FROM users WHERE username = 'thaksin'").id;
const studentId = (code) => one('SELECT id FROM users WHERE student_code = ?', code).id;

function form(extra) {
  return {
    title: 'Character Design', assignment_code: 'A02', max_score: '7', category_id: cat('PRE_CLO2').id, submission_mode: 'online',
    allowed_types: 'png,jpg,pdf', allow_links: '1', allow_resubmit: '1', max_versions: '3', max_file_mb: '10',
    clo_CLO2: '1', clo_weight_CLO2: '1',
    criterion_name: ['โครงสร้าง', 'Model sheet', 'ตรงเวลา'], criterion_max: ['3', '3', '1'], criterion_weight: ['', '', ''], criterion_desc: ['', '', ''], criterion_levels: ['0|1|2|3', '', ''],
    ...extra,
  };
}

let A02;

test('TC-05/12 สร้าง Draft → Publish พร้อม CLO Mapping และแจ้งเตือนนักศึกษา (TC-27)', async () => {
  const teacher = await login('thaksin', 'teacher1234');
  const r = await teacher.post('/teacher/assignments').type('form').send({ _csrf: teacher.csrf, ...form() });
  assert.equal(r.status, 302);
  A02 = one("SELECT * FROM assignments WHERE assignment_code = 'A02'");
  assert.equal(A02.status, 'draft');
  const maps = assignSvc.cloMaps(A02.id);
  assert.deepEqual(maps.map((m) => [m.clo_code, m.contribution_weight]), [['CLO2', 1]]);
  assert.equal(assignSvc.rubric(A02.id).criteria.length, 3);
  // นักศึกษายังไม่เห็น Draft
  const st = await login('6501101001');
  assert.equal((await st.get(`/student/assignments/${A02.id}`)).status, 404);
  await teacher.post(`/teacher/assignments/${A02.id}/status`).type('form').send({ _csrf: teacher.csrf, status: 'published' });
  assert.equal(one('SELECT status FROM assignments WHERE id = ?', A02.id).status, 'published');
  assert.equal((await st.get(`/student/assignments/${A02.id}`)).status, 200);
  assert.ok(one("SELECT 1 x FROM notifications WHERE recipient_id = ? AND event_type = 'assignment_new' AND related_entity_id = ?", studentId('6501101001'), A02.id));
});

test('ห้ามคะแนนเต็มของงานรวมเกินหมวด OBE-3 และน้ำหนัก CLO ต้องรวม = 1', () => {
  assert.throws(() => assignSvc.save(course.id, form({ assignment_code: 'X1', max_score: '9' }), teacherId), /เกิน 15/); // 7 + 9 > 15
  assert.throws(() => assignSvc.save(course.id, form({ assignment_code: 'X2', max_score: '1', clo_CLO1: '1', clo_weight_CLO1: '0.5', clo_weight_CLO2: '0.7' }), teacherId), /รวมกันเท่ากับ 1/);
  assert.throws(() => assignSvc.save(course.id, form({ assignment_code: 'A02', max_score: '1' }), teacherId), /ถูกใช้แล้ว/);
  assert.throws(() => assignSvc.save(course.id, form({ assignment_code: 'X3', allowed_types: 'exe' }), teacherId), /ไม่รองรับ/);
});

test('TC-06/24/25/26/07 ส่งไฟล์ + URL, ตรวจชนิดไฟล์/เนื้อไฟล์, เก็บทุกเวอร์ชัน, แจ้งผู้สอน (TC-29)', async () => {
  const st = await login('6501101001');
  const bad = await st.post(`/student/assignments/${A02.id}/submit`).field('_csrf', st.csrf).attach('files', Buffer.from('MZ fake'), 'virus.exe');
  assert.equal(bad.status, 302);
  assert.equal(q('SELECT * FROM submissions WHERE assignment_id = ?', A02.id).length, 0);
  const fake = await st.post(`/student/assignments/${A02.id}/submit`).field('_csrf', st.csrf).attach('files', Buffer.from('not really a png'), 'fake.png');
  assert.equal(fake.status, 302);
  assert.equal(q('SELECT * FROM submissions WHERE assignment_id = ?', A02.id).length, 0);
  // ไม่มี CSRF → ปฏิเสธ
  const noCsrf = await st.post(`/student/assignments/${A02.id}/submit`).attach('files', PNG, 'a.png');
  assert.equal(noCsrf.status, 403);

  const ok = await st.post(`/student/assignments/${A02.id}/submit`).field('_csrf', st.csrf)
    .field('link_url', 'https://drive.google.com/file/d/abc/view').field('link_title', 'Model sheet').field('note', 'v1')
    .attach('files', PNG, 'ตัวละคร.png');
  assert.equal(ok.status, 302);
  const s1 = one('SELECT * FROM submissions WHERE assignment_id = ? AND version = 1', A02.id);
  assert.equal(s1.status, 'submitted');
  const f = one('SELECT * FROM submission_files WHERE submission_id = ?', s1.id);
  assert.equal(f.file_name, 'ตัวละคร.png');
  assert.equal(f.mime_type, 'image/png');
  assert.equal(one('SELECT COUNT(*) c FROM submission_links WHERE submission_id = ?', s1.id).c, 1);
  assert.ok(one("SELECT 1 x FROM notifications WHERE recipient_id = ? AND event_type = 'submission_new'", teacherId));
  assert.ok(one("SELECT 1 x FROM notifications WHERE recipient_id = ? AND event_type = 'link_check'", teacherId));

  const v2 = await st.post(`/student/assignments/${A02.id}/submit`).field('_csrf', st.csrf).attach('files', PNG, 'v2.png');
  assert.equal(v2.status, 302);
  const all = q('SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ? ORDER BY version', A02.id, studentId('6501101001'));
  assert.deepEqual(all.map((x) => [x.version, x.status]), [[1, 'submitted'], [2, 'resubmitted']]);
  assert.equal(q('SELECT * FROM submission_files f JOIN submissions s ON s.id = f.submission_id WHERE s.assignment_id = ?', A02.id).length, 2); // ไม่เขียนทับ

  // ไฟล์: เจ้าของ + ผู้สอนเปิดได้, นักศึกษาคนอื่นเปิดไม่ได้
  const teacher = await login('thaksin', 'teacher1234');
  assert.equal((await st.get(`/files/submission/${f.id}`)).status, 200);
  assert.equal((await teacher.get(`/files/submission/${f.id}`)).status, 200);
  const other = await login('6501101002');
  assert.equal((await other.get(`/files/submission/${f.id}`)).status, 404);
  // TC-08 หน้าตรวจงานแสดง preview รูปภาพ
  const page = await teacher.get(`/teacher/grading/${A02.id}?student=${studentId('6501101001')}`);
  assert.match(page.text, new RegExp(`<img src="/files/submission/`));
});

test('URL โดเมนที่ไม่อนุญาตถูกปฏิเสธ และผู้สอนบันทึกสถานะลิงก์ได้', async () => {
  db.get().prepare("UPDATE assignments SET allowed_domains = 'drive.google.com, youtube.com' WHERE id = ?").run(A02.id);
  const st = await login('6501101002');
  await st.post(`/student/assignments/${A02.id}/submit`).field('_csrf', st.csrf).field('link_url', 'https://evil.example.com/x');
  assert.equal(q('SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?', A02.id, studentId('6501101002')).length, 0);
  await st.post(`/student/assignments/${A02.id}/submit`).field('_csrf', st.csrf).field('link_url', 'https://www.youtube.com/watch?v=abc');
  const link = one('SELECT l.* FROM submission_links l JOIN submissions s ON s.id = l.submission_id WHERE s.student_id = ?', studentId('6501101002'));
  const teacher = await login('thaksin', 'teacher1234');
  await teacher.post(`/teacher/links/${link.id}/status`).type('form').send({ _csrf: teacher.csrf, status: 'permission_required' });
  assert.equal(one('SELECT validation_status v FROM submission_links WHERE id = ?', link.id).v, 'permission_required');
  assert.ok(one("SELECT 1 x FROM notifications WHERE recipient_id = ? AND title LIKE '%สิทธิ์การแชร์%'", studentId('6501101002')));
});

test('TC-09 Rubric รวมคะแนนถูกต้อง (รวมกรณีถ่วงน้ำหนัก)', () => {
  const a = { max_score: 10 };
  const rubric = { criteria: [{ id: 'a', max_score: 4, weight: 4 }, { id: 'b', max_score: 6, weight: 6 }] };
  assert.equal(grading.computeTotal(a, rubric, { a: 3, b: 6 }), 9);
  assert.equal(grading.computeTotal(a, rubric, { a: 3 }), null); // ยังให้คะแนนไม่ครบ
  const weighted = { criteria: [{ id: 'a', max_score: 5, weight: 1 }, { id: 'b', max_score: 5, weight: 3 }] };
  assert.equal(grading.computeTotal({ max_score: 20 }, weighted, { a: 5, b: 0 }), 5); // (1*1 + 0*3)/4 * 20
});

test('TC-10/30 Draft ไม่เห็น → Publish แล้วเห็นคะแนน+Feedback และได้รับแจ้งเตือน; TC-15 แก้คะแนนที่เผยแพร่ต้องมีเหตุผล', async () => {
  const teacher = await login('thaksin', 'teacher1234');
  const sid = studentId('6501101001');
  const rubric = assignSvc.rubric(A02.id);
  const body = { _csrf: teacher.csrf, action: 'draft', feedback: 'สัดส่วนดีมาก' };
  rubric.criteria.forEach((c, i) => { body[`score_${c.id}`] = [3, 2, 1][i]; });
  await teacher.post(`/teacher/grading/${A02.id}/${sid}`).type('form').send(body);
  assert.equal(one('SELECT total_score t, status s FROM grading_records WHERE assignment_id = ? AND student_id = ?', A02.id, sid).t, 6);

  const st = await login('6501101001');
  let page = await st.get(`/student/assignments/${A02.id}`);
  assert.doesNotMatch(page.text, /สัดส่วนดีมาก/);
  assert.equal(scores.gradebook(course.id, { studentId: sid }).rows[0].total, 0);

  // เกินคะแนนเต็มเกณฑ์ → ปฏิเสธ
  const over = await teacher.post(`/teacher/grading/${A02.id}/${sid}`).set('Accept', 'application/json').set('X-CSRF-Token', teacher.csrf)
    .send({ action: 'publish', scores: { [rubric.criteria[0].id]: 99, [rubric.criteria[1].id]: 1, [rubric.criteria[2].id]: 1 } });
  assert.equal(over.status, 400);

  await teacher.post(`/teacher/grading/${A02.id}/${sid}`).type('form').send({ ...body, action: 'publish' });
  page = await st.get(`/student/assignments/${A02.id}`);
  assert.match(page.text, /สัดส่วนดีมาก/);
  assert.match(page.text, /<strong>6<\/strong> \/ 7/);
  assert.ok(one("SELECT 1 x FROM notifications WHERE recipient_id = ? AND event_type = 'grade_published'", sid));
  assert.equal(one('SELECT status FROM submissions WHERE assignment_id = ? AND student_id = ? AND version = 2', A02.id, sid).status, 'reviewed');

  const changed = { scores: { [rubric.criteria[0].id]: 2, [rubric.criteria[1].id]: 2, [rubric.criteria[2].id]: 1 }, action: 'publish' };
  const noReason = await teacher.post(`/teacher/grading/${A02.id}/${sid}`).set('Accept', 'application/json').set('X-CSRF-Token', teacher.csrf).send(changed);
  assert.equal(noReason.status, 400);
  const withReason = await teacher.post(`/teacher/grading/${A02.id}/${sid}`).set('Accept', 'application/json').set('X-CSRF-Token', teacher.csrf).send({ ...changed, reason: 'ตรวจทานใหม่' });
  assert.equal(withReason.body.grade.total, 5);
  const adj = q('SELECT * FROM score_adjustments sa JOIN grading_records g ON g.id = sa.grading_record_id WHERE g.assignment_id = ? AND g.student_id = ? ORDER BY sa.changed_at', A02.id, sid);
  const last = adj[adj.length - 1];
  assert.equal(last.old_score, 6);
  assert.equal(last.new_score, 5);
  assert.equal(last.reason, 'ตรวจทานใหม่');
  assert.equal(last.changed_by, teacherId);
});

test('ขอให้แก้ไขงาน → นักศึกษาส่งเวอร์ชันใหม่ได้แม้เคยส่งแล้ว', async () => {
  const teacher = await login('thaksin', 'teacher1234');
  const sid = studentId('6501101002');
  const r = await teacher.post(`/teacher/grading/${A02.id}/${sid}`).type('form').send({ _csrf: teacher.csrf, action: 'revision', feedback: 'กรุณาเพิ่ม Expression sheet' });
  assert.equal(r.status, 302);
  assert.equal(one('SELECT status FROM grading_records WHERE assignment_id = ? AND student_id = ?', A02.id, sid).status, 'revision_requested');
  const st = await login('6501101002');
  const page = await st.get(`/student/assignments/${A02.id}`);
  assert.match(page.text, /กรุณาเพิ่ม Expression sheet/);
  assert.ok(one("SELECT 1 x FROM notifications WHERE recipient_id = ? AND event_type = 'revision_requested'", sid));
});

test('Quick Grid ให้คะแนนในคาบ (ไม่มีไฟล์ส่ง) + TC-11 คะแนนรวมไม่นับงานที่ยังไม่ตรวจเป็นศูนย์', async () => {
  const teacher = await login('thaksin', 'teacher1234');
  const id = assignSvc.save(course.id, {
    title: 'จิตพิสัย', assignment_code: 'AFF', max_score: '10', category_id: cat('AFFECTIVE').id, submission_mode: 'in_class', allowed_types: '',
    clo_CLO4: '1', clo_weight_CLO4: '1',
  }, teacherId);
  assignSvc.setStatus(id, 'published', teacherId);
  const sid = studentId('6501101003');
  const grid = await teacher.get(`/teacher/grading/${id}/grid`);
  assert.equal(grid.status, 200);
  assert.match(grid.text, /data-direct/);
  const r = await teacher.post(`/teacher/grading/${id}/${sid}`).set('Accept', 'application/json').set('X-CSRF-Token', teacher.csrf).send({ action: 'publish', direct_score: '8.5' });
  assert.equal(r.body.grade.total, 8.5);
  const over = await teacher.post(`/teacher/grading/${id}/${sid}`).set('Accept', 'application/json').set('X-CSRF-Token', teacher.csrf).send({ action: 'draft', direct_score: '11', reason: 'x' });
  assert.equal(over.status, 400);

  const gb = scores.gradebook(course.id);
  const row = gb.rows.find((x) => x.student.id === sid);
  assert.equal(row.total, 8.5);
  assert.ok(row.pending >= 1, 'งานที่ยังไม่ตรวจต้องนับเป็น pending ไม่ใช่ 0');
  const aff = row.byCat[cat('AFFECTIVE').id];
  assert.equal(aff.earned, 8.5);
  for (const r2 of gb.rows) assert.ok(r2.total <= 100);
  const st = scores.structureCheck(course.id);
  assert.equal(st.total, 100);
  assert.ok(st.totalOk);
});

test('TC-13 CLO Score ถ่วงน้ำหนัก และ Achievement Rate คำนวณเมื่อกำหนดเกณฑ์แล้ว', () => {
  const sid = studentId('6501101004');
  const id = assignSvc.save(course.id, {
    title: 'Final', assignment_code: 'FP', max_score: '20', category_id: cat('FP_WORK').id, submission_mode: 'in_class', allowed_types: '',
    clo_CLO3: '1', clo_weight_CLO3: '0.75', clo_CLO4: '1', clo_weight_CLO4: '0.25',
  }, teacherId);
  assignSvc.setStatus(id, 'published', teacherId);
  grading.saveGrade({ assignmentId: id, studentId: sid, directScore: 16, action: 'publish', actorId: teacherId });
  let data = scores.cloScores(course.id);
  const clo3 = data.clos.find((c) => c.clo_code === 'CLO3');
  const clo4 = data.clos.find((c) => c.clo_code === 'CLO4');
  const me = data.perStudent.find((p) => p.student.id === sid);
  assert.equal(me.clo[clo3.id].percent, 80);
  assert.equal(me.clo[clo3.id].earned, 12);
  assert.equal(me.clo[clo3.id].max, 15);
  assert.equal(me.clo[clo4.id].earned, 4);
  assert.equal(data.summary.find((s) => s.clo.id === clo3.id).achievementRate, null); // ยังไม่กำหนดเกณฑ์
  db.get().prepare("UPDATE clo_outcomes SET passing_criteria = 70 WHERE clo_code = 'CLO3'").run();
  data = scores.cloScores(course.id);
  const sum = data.summary.find((s) => s.clo.clo_code === 'CLO3');
  assert.equal(sum.assessed, 1);
  assert.equal(sum.passed, 1);
  assert.equal(sum.achievementRate, 100);
});

test('TC-28 เตือนกำหนดส่งตามเวลาที่ตั้งค่าและไม่ส่งซ้ำ', () => {
  const due = new Date(Date.now() + 30 * 60000).toISOString(); // อีก 30 นาที
  db.get().prepare('UPDATE assignments SET due_date = ? WHERE id = ?').run(due, A02.id);
  const first = scheduler.runReminders();
  assert.ok(first > 0);
  const second = scheduler.runReminders();
  assert.equal(second, 0);
  const sid = studentId('6501101005');
  const n = q("SELECT * FROM notifications WHERE recipient_id = ? AND event_type = 'due_reminder' AND related_entity_id = ?", sid, A02.id);
  assert.equal(n.length, 2); // 24 ชม. และ 1 ชม.
  // คนที่ส่งแล้วไม่ถูกเตือน
  assert.equal(q("SELECT * FROM notifications WHERE recipient_id = ? AND event_type = 'due_reminder' AND related_entity_id = ?", studentId('6501101001'), A02.id).length, 0);
});

test('ส่งงานล่าช้า: บันทึกว่า late; late_policy=reject ปฏิเสธ', async () => {
  db.get().prepare("UPDATE assignments SET due_date = '2020-01-01T00:00:00.000Z', late_policy = 'accept_mark' WHERE id = ?").run(A02.id);
  const st = await login('6501101006');
  await st.post(`/student/assignments/${A02.id}/submit`).field('_csrf', st.csrf).attach('files', PNG, 'late.png');
  const s = one('SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?', A02.id, studentId('6501101006'));
  assert.equal(s.status, 'late');
  assert.equal(s.is_late, 1);
  db.get().prepare("UPDATE assignments SET late_policy = 'reject' WHERE id = ?").run(A02.id);
  const st7 = await login('6501101007');
  await st7.post(`/student/assignments/${A02.id}/submit`).field('_csrf', st7.csrf).attach('files', PNG, 'late.png');
  assert.equal(q('SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?', A02.id, studentId('6501101007')).length, 0);
});

test('TC-14 ส่งออกรายงานตามสิทธิ์ (CSV มี BOM, ภาคเรียน, วันที่ออกรายงาน)', async () => {
  const teacher = await login('thaksin', 'teacher1234');
  for (const t of ['attendance', 'gradebook', 'submissions', 'grading', 'clo', 'progress']) {
    const r = await teacher.get(`/teacher/reports/${t}.csv`).buffer(true).parse((res, cb) => { let d = ''; res.setEncoding('utf8'); res.on('data', (c) => { d += c; }); res.on('end', () => cb(null, d)); });
    assert.equal(r.status, 200, t);
    assert.match(r.headers['content-type'], /text\/csv/);
    assert.ok(r.body.startsWith('﻿'), 'BOM');
    assert.ok(r.body.includes(`ภาคการศึกษา ${course.semester}/${course.academic_year}`));
    assert.match(r.body, /วันที่ออกรายงาน/);
    const p = await teacher.get(`/teacher/reports/${t}/print`);
    assert.equal(p.status, 200);
  }
  const filtered = await teacher.get(`/teacher/reports/grading.csv?assignment=${A02.id}`);
  assert.match(filtered.text, /เงื่อนไข:.*งาน: A02/);
  const st = await login('6501101001');
  assert.equal((await st.get('/teacher/reports/gradebook.csv')).status, 403);
  const admin = await login('admin', 'admin1234');
  assert.equal((await admin.get('/teacher/reports/gradebook.csv')).status, 200);
});

test('NFR-04 นักศึกษาเห็นเฉพาะข้อมูลตนเอง; Admin ให้คะแนนไม่ได้', async () => {
  const st = await login('6501101002');
  const grades = await st.get('/student/grades');
  assert.equal(grades.status, 200);
  assert.doesNotMatch(grades.text, /กมลชนก/); // ชื่อนักศึกษาคนอื่น
  const admin = await login('admin', 'admin1234');
  const r = await admin.post(`/teacher/grading/${A02.id}/${studentId('6501101001')}`).set('Accept', 'application/json').set('X-CSRF-Token', admin.csrf).send({ action: 'draft' });
  assert.equal(r.status, 403);
});

test('ล็อกคะแนน: ต้องไม่มี Draft ค้าง, หลังล็อกแก้คะแนนไม่ได้, ปลดล็อกต้องมีเหตุผล', async () => {
  const teacher = await login('thaksin', 'teacher1234');
  const draftId = one("SELECT g.id FROM grading_records g WHERE g.status = 'draft'");
  if (draftId) db.get().prepare("UPDATE grading_records SET status = 'published' WHERE status = 'draft'").run();
  const r = await teacher.post('/teacher/scores/lock').type('form').send({ _csrf: teacher.csrf });
  assert.equal(r.status, 302);
  assert.ok(courseSvc.getCourse().scores_locked_at);
  assert.equal(q("SELECT * FROM grading_records WHERE status = 'published'").length, 0);
  assert.throws(() => grading.saveGrade({ assignmentId: A02.id, studentId: studentId('6501101001'), directScore: 1, actorId: teacherId }), /ล็อก/);
  assert.throws(() => grading.unlockCourse(course.id, teacherId, ''), /เหตุผล/);
  grading.unlockCourse(course.id, teacherId, 'แก้ไขคะแนนตามคำร้อง');
  assert.equal(courseSvc.getCourse().scores_locked_at, null);
});

test('TC-22/23 Course Home และ Session Detail แสดงตามสิทธิ์', async () => {
  const st = await login('6501101001');
  const home = await st.get('/course');
  assert.equal(home.status, 200);
  for (const t of [course.course_code, 'CLO1', 'CLO4', 'Production Pipeline', 'ประกาศ']) assert.match(home.text, new RegExp(t));
  const s = courseSvc.sessions(course.id).find((x) => x.week_number === 2);
  const detail = await st.get(`/sessions/${s.id}`);
  assert.equal(detail.status, 200);
  assert.match(detail.text, /12 Principles/);
  assert.match(detail.text, /วัตถุประสงค์/);
  db.get().prepare("UPDATE course_sessions SET status = 'draft' WHERE id = ?").run(s.id);
  assert.equal((await st.get(`/sessions/${s.id}`)).status, 404);
  db.get().prepare("UPDATE course_sessions SET status = 'published' WHERE id = ?").run(s.id);
});

test('นำเข้ารายชื่อนักศึกษา (คัดลอกจาก Excel) และบังคับเปลี่ยนรหัสผ่านครั้งแรก', async () => {
  const teacher = await login('thaksin', 'teacher1234');
  await teacher.post('/teacher/students/import').type('form').send({ _csrf: teacher.csrf, data: 'รหัสนักศึกษา\tชื่อ\n6601100001\tทดสอบ นำเข้า\ttest@example.com\tS2\nbad!\tx' });
  const u = one("SELECT * FROM users WHERE student_code = '6601100001'");
  assert.ok(u);
  assert.equal(u.must_change_password, 1);
  const st = await login('6601100001');
  const r = await st.get('/student');
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/account/password');
});
