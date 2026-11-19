'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, login, one, db, request } = require('./helpers');
const courseSvc = require('../src/services/course');
const auth = require('../src/services/auth');

const course = courseSvc.getCourse();
const teacherId = one("SELECT id FROM users WHERE username = 'aunalyst'").id;
const roster = (rows) => ['รหัสนักศึกษา\tชื่อ', ...rows.map((r) => r.join('\t'))].join('\n');

test('หน้าแรกสาธารณะ: มีฟอร์มเข้าสู่ระบบนักศึกษา ปุ่มเช็คชื่อ และตารางเรียน', async () => {
  const r = await request(app).get('/');
  assert.equal(r.status, 200);
  assert.match(r.text, /เข้าสู่ระบบนักศึกษา/);
  assert.match(r.text, /action="\/login"/);
  assert.match(r.text, /href="\/checkin"/);
  assert.match(r.text, /123456/);
  assert.match(r.text, /ตารางสอน/);
  assert.doesNotMatch(r.text, /แก้ไขตาราง/);
  // เข้าสู่ระบบแล้วถูกพาไปหน้าตามบทบาท
  const t = await login('aunalyst', 'teacher1234');
  assert.equal((await t.get('/')).headers.location, '/teacher');
});

test('บัญชีนักศึกษา: ชื่อผู้ใช้ = รหัสนักศึกษา, รหัสผ่านครั้งแรก 123456, บังคับเปลี่ยนรหัสผ่าน', async () => {
  courseSvc.importStudents(course.id, roster([['6900000101', 'นายทดสอบ บัญชี']]), teacherId);
  const u = one("SELECT * FROM users WHERE student_code = '6900000101'");
  assert.equal(u.username, '6900000101');
  assert.equal(u.must_change_password, 1);
  assert.ok(auth.verifyPassword('123456', u.password_hash));
  assert.ok(!auth.verifyPassword('6900000101', u.password_hash));

  const bad = await request(app).post('/login').type('form').send({ login: '6900000101', password: '6900000101' });
  assert.equal(bad.status, 401);

  const st = await login('6900000101', '123456');
  const r = await st.get('/student');
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/account/password');
  const pw = await st.get('/account/password');
  st.csrf = /name="csrf-token" content="([^"]+)"/.exec(pw.text)[1];
  // ตั้งรหัสใหม่สั้นเกิน / ซ้ำรหัสเดิม ไม่ได้
  await st.post('/account/password').type('form').send({ _csrf: st.csrf, current: '123456', password: '123456', confirm: '123456' });
  assert.equal(one("SELECT must_change_password m FROM users WHERE id = ?", u.id).m, 1);
  await st.post('/account/password').type('form').send({ _csrf: st.csrf, current: '123456', password: 'NewPass#2569', confirm: 'NewPass#2569' });
  assert.equal(one("SELECT must_change_password m FROM users WHERE id = ?", u.id).m, 0);
  assert.equal((await st.get('/student')).status, 200);

  // อาจารย์รีเซ็ต → กลับเป็น 123456 และบังคับเปลี่ยนอีกครั้ง
  const t = await login('aunalyst', 'teacher1234');
  await t.post(`/teacher/students/${u.id}/reset-password`).type('form').send({ _csrf: t.csrf });
  const after = one('SELECT * FROM users WHERE id = ?', u.id);
  assert.equal(after.must_change_password, 1);
  assert.ok(auth.verifyPassword('123456', after.password_hash));
});

test('ย้ายข้อมูลครั้งเดียว: นักศึกษาที่ยังไม่เคยเปลี่ยนรหัสผ่าน → 123456; ที่เปลี่ยนแล้วไม่ถูกแตะ', () => {
  const seed = require('../src/seed');
  const conn = db.get();
  conn.prepare("DELETE FROM audit_logs WHERE action = 'migrate.student_default_password'").run();
  courseSvc.importStudents(course.id, roster([['6900000201', 'ก ทดสอบ'], ['6900000202', 'ข ทดสอบ']]), teacherId);
  const a = one("SELECT id FROM users WHERE student_code = '6900000201'").id;
  const b = one("SELECT id FROM users WHERE student_code = '6900000202'").id;
  conn.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword('6900000201'), a); // แบบเดิม
  auth.changePassword(b, 'Changed#2569');
  assert.ok(seed.migrateStudentPasswords() >= 1);
  assert.ok(auth.verifyPassword('123456', one('SELECT password_hash h FROM users WHERE id = ?', a).h));
  assert.ok(auth.verifyPassword('Changed#2569', one('SELECT password_hash h FROM users WHERE id = ?', b).h));
  assert.equal(seed.migrateStudentPasswords(), 0); // ไม่ทำซ้ำ
});
