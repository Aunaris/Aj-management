'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, login, one, q, db, request } = require('./helpers');
const att = require('../src/services/attendance');
const courseSvc = require('../src/services/course');
const { maskName } = require('../src/routes/checkin');

const course = courseSvc.getCourse();
const sid = (code) => one('SELECT id FROM users WHERE student_code = ?', code).id;
const week = (n, sec = '1') => courseSvc.sessions(course.id).find((s) => s.week_number === n && s.section_code === sec);
const tokenOf = (id) => att._live.get(id).token;

/** อุปกรณ์ของนักศึกษาที่ไม่ได้เข้าสู่ระบบ: เปิดหน้า /checkin เพื่อรับ cookie และ token ของฟอร์ม */
async function phone(deviceId) {
  const agent = request.agent(app);
  agent.jar.setCookie(`did=${deviceId}; Path=/`, '127.0.0.1');
  const page = await agent.get('/checkin');
  assert.equal(page.status, 200);
  agent.ck = /name="_ck" value="([^"]+)"/.exec(page.text)[1];
  agent.page = page.text;
  return agent;
}
const send = (ag, body) => ag.post('/checkin').set('Accept', 'application/json').send({ _ck: ag.ck, ...body });

async function openWeek(n, sec = '1') {
  const teacher = await login('aunalyst', 'teacher1234');
  const s = week(n, sec);
  await teacher.post(`/teacher/sessions/${s.id}/attendance/open`).type('form').send({ _csrf: teacher.csrf });
  await teacher.get(`/teacher/sessions/${s.id}/qr.json`).set('Accept', 'application/json');
  return { s, teacher };
}

test('ค่าเริ่มต้น: เช็คชื่อด้วยรหัสนักศึกษา ไม่ต้องมีบัญชี/ไม่ต้องเข้าสู่ระบบ', async () => {
  assert.equal(courseSvc.getCourse().checkin_mode, 'student_code');
  const { s } = await openWeek(13);
  const p = await phone('phone-public-aaaaaaaaaaaaaaaa');
  assert.match(p.page, /รหัสนักศึกษา/);
  const r = await send(p, { token: tokenOf(s.id), student_code: '6501101001' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.name, maskName('กมลชนก ใจดี'));
  const rec = one('SELECT * FROM attendance_records WHERE session_id = ? AND student_id = ?', s.id, sid('6501101001'));
  assert.equal(rec.checkin_method, 'qr');
  // หน้าผลลัพธ์ (HTML) แสดงรหัสและชื่อแบบปิดบางส่วน
  const p2 = await phone('phone-public-bbbbbbbbbbbbbbbb');
  const html = await p2.post('/checkin').type('form').send({ _ck: p2.ck, token: tokenOf(s.id), student_code: '6501101002' });
  assert.equal(html.status, 200);
  assert.match(html.text, /เช็คชื่อสำเร็จ/);
  assert.match(html.text, /6501101002/);
  assert.doesNotMatch(html.text, /แสงทอง/); // นามสกุลเต็มไม่แสดง
});

test('กรอกรหัสเช็คชื่อ 6 ตัวแทนการสแกนได้; รหัสนักศึกษาผิด/ไม่อยู่ในรายวิชาถูกปฏิเสธ', async () => {
  const { s, teacher } = await openWeek(13);
  const code = (await teacher.get(`/teacher/sessions/${s.id}/qr.json`).set('Accept', 'application/json')).body.code;
  const p = await phone('phone-public-cccccccccccccccc');
  assert.equal((await send(p, { code, student_code: '9999999999' })).body.code, 'invalid_student');
  assert.equal((await send(p, { code, student_code: '' })).body.code, 'invalid_student');
  const ok = await send(p, { code, student_code: ' 6501101003 ' });
  assert.equal(ok.status, 200);
  assert.equal(one('SELECT checkin_method m FROM attendance_records WHERE session_id = ? AND student_id = ?', s.id, sid('6501101003')).m, 'code');
});

test('1 เครื่อง เช็คชื่อได้ 1 รหัสต่อคาบ (กันกรอกรหัสเพื่อนแทน) และเช็คซ้ำไม่ได้', async () => {
  const { s } = await openWeek(13);
  const p = await phone('phone-public-dddddddddddddddd');
  assert.equal((await send(p, { token: tokenOf(s.id), student_code: '6501101004' })).status, 200);
  const friend = await send(p, { token: tokenOf(s.id), student_code: '6501101005' });
  assert.equal(friend.status, 403);
  assert.equal(friend.body.code, 'device_used');
  assert.equal(q('SELECT * FROM attendance_records WHERE session_id = ? AND student_id = ?', s.id, sid('6501101005')).length, 0);
  const again = await send(p, { token: tokenOf(s.id), student_code: '6501101004' });
  assert.equal(again.body.code, 'duplicate');
});

test('ต้องมี token ของฟอร์ม (กันการส่งจากเว็บอื่น) และ QR หมดอายุถูกปฏิเสธ', async () => {
  const { s } = await openWeek(13);
  const raw = request(app);
  const r = await raw.post('/checkin').set('Accept', 'application/json').send({ token: tokenOf(s.id), student_code: '6501101006' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'bad_request');
  const p = await phone('phone-public-eeeeeeeeeeeeeeee');
  const old = tokenOf(s.id);
  db.get().prepare("UPDATE attendance_challenges SET expires_at = '2000-01-01T00:00:00.000Z' WHERE session_id = ?").run(s.id);
  assert.equal((await send(p, { token: old, student_code: '6501101006' })).body.code, 'expired_token');
  att._live.delete(s.id);
});

test('จำกัดความถี่ต่อเครื่อง (กันสุ่มรหัสนักศึกษา)', async () => {
  const p = await phone('phone-public-ffffffffffffffff');
  let last;
  for (let i = 0; i < 12; i += 1) last = await send(p, { code: 'ZZZZZZ', student_code: `65011019${String(i).padStart(2, '0')}` });
  assert.equal(last.status, 429);
});

test('QR ของกลุ่มอื่นใช้ไม่ได้ แม้ไม่ได้เข้าสู่ระบบ', async () => {
  const { s } = await openWeek(14, '2');
  const p = await phone('phone-public-gggggggggggggggg');
  const r = await send(p, { token: tokenOf(s.id), student_code: '6501101007' }); // นักศึกษากลุ่ม 1
  assert.equal(r.body.code, 'wrong_section');
});

test('ยืนยันในห้องได้เฉพาะจากเครื่องที่ใช้เช็คชื่อ', async () => {
  const { s } = await openWeek(15);
  const p = await phone('phone-public-hhhhhhhhhhhhhhhh');
  assert.equal((await send(p, { token: tokenOf(s.id), student_code: '6501101008' })).status, 200);
  const { code } = att.issueVerifyCode(s.id, one("SELECT id FROM users WHERE username = 'aunalyst'").id, 2);
  const other = await phone('phone-public-iiiiiiiiiiiiiiii');
  const bad = await other.post('/checkin/verify').set('Accept', 'application/json').send({ _ck: other.ck, student_code: '6501101008', session_id: s.id, code });
  assert.equal(bad.body.code, 'device_mismatch');
  const ok = await p.post('/checkin/verify').set('Accept', 'application/json').send({ _ck: p.ck, student_code: '6501101008', session_id: s.id, code });
  assert.equal(ok.status, 200);
  assert.ok(one('SELECT verified_at FROM attendance_records WHERE session_id = ? AND student_id = ?', s.id, sid('6501101008')).verified_at);
});

test('นักศึกษาที่เข้าสู่ระบบอยู่แล้ว ยังเช็คชื่อแบบเดิมได้; ผู้สอนเปลี่ยนเป็นโหมด "ต้องเข้าสู่ระบบ" ได้', async () => {
  const { s, teacher } = await openWeek(16);
  const st = await login('6501101009');
  const r = await st.post('/checkin').set('Accept', 'application/json').set('X-CSRF-Token', st.csrf).send({ token: tokenOf(s.id) });
  assert.equal(r.status, 200);
  await teacher.post('/teacher/settings').type('form').send({ _csrf: teacher.csrf, checkin_mode: 'login', device_lock: '1', qr_ttl_seconds: '45', late_after_minutes: '15', geo_radius_m: '150', geo_max_accuracy_m: '150' });
  assert.equal(courseSvc.getCourse().checkin_mode, 'login');
  const anon = request(app);
  assert.equal((await anon.get('/checkin')).status, 302);
  await teacher.post('/teacher/settings').type('form').send({ _csrf: teacher.csrf, checkin_mode: 'student_code', device_lock: '1', qr_ttl_seconds: '45', late_after_minutes: '15', geo_radius_m: '150', geo_max_accuracy_m: '150' });
  assert.equal(courseSvc.getCourse().checkin_mode, 'student_code');
});

test('ชื่อแบบปิดบางส่วน', () => {
  assert.equal(maskName('นางสาวกนกวรรณ เอี่ยมมาตร'), 'นางสาวกนกวรรณ เ••••••');
  assert.equal(maskName('Somchai'), 'Somchai');
});
