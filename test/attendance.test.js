'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { login, q, one, db } = require('./helpers');
const att = require('../src/services/attendance');
const courseSvc = require('../src/services/course');

const course = courseSvc.getCourse();
const week = (n) => courseSvc.sessions(course.id).find((s) => s.week_number === n);
const teacherId = one("SELECT id FROM users WHERE username = 'thaksin'").id;
const studentId = (code) => one('SELECT id FROM users WHERE student_code = ?', code).id;

async function openSession(teacher, s) {
  const r = await teacher.post(`/teacher/sessions/${s.id}/attendance/open`).type('form').send({ _csrf: teacher.csrf });
  assert.equal(r.status, 302);
  const j = await teacher.get(`/teacher/sessions/${s.id}/qr.json`).set('Accept', 'application/json');
  assert.equal(j.body.open, true);
  return j.body;
}

function tokenOf(sessionId) {
  return att._live.get(sessionId).token;
}

test('TC-01 RBAC: นักศึกษาเข้าหน้าผู้สอนไม่ได้, ไม่ได้ login ถูกส่งไปหน้า login', async () => {
  const st = await login('6501101001');
  assert.equal((await st.get('/teacher')).status, 403);
  assert.equal((await st.get('/teacher/gradebook')).status, 403);
  assert.equal((await st.get('/admin')).status, 403);
  const teacher = await login('thaksin', 'teacher1234');
  assert.equal((await teacher.get('/admin')).status, 403);
  assert.equal((await teacher.get('/teacher')).status, 200);
  const anon = require('./helpers').request(require('./helpers').app);
  const r = await anon.get('/checkin?t=abc');
  assert.equal(r.status, 302);
  assert.match(r.headers.location, /^\/login\?next=/);
});

test('CSRF: POST ไม่มี token ถูกปฏิเสธ', async () => {
  const teacher = await login('thaksin', 'teacher1234');
  const r = await teacher.post(`/teacher/sessions/${week(1).id}/attendance/open`).type('form').send({});
  assert.equal(r.status, 403);
});

test('TC-02/04/16 QR check-in, duplicate, expired token, QR rotates', async () => {
  const teacher = await login('thaksin', 'teacher1234');
  const s = week(2);
  const qr = await openSession(teacher, s);
  assert.match(qr.qr, /^data:image\/png;base64,/);
  assert.match(qr.code, /^[A-Z0-9]{6}$/);
  // token เก็บเป็น hash เท่านั้น
  const ch = one('SELECT * FROM attendance_challenges WHERE session_id = ?', s.id);
  assert.notEqual(ch.token_hash, tokenOf(s.id));

  const st = await login('6501101002');
  const r1 = await st.post('/checkin').type('form').send({ _csrf: st.csrf, token: tokenOf(s.id) });
  assert.equal(r1.status, 200);
  assert.match(r1.text, /เช็คชื่อสำเร็จ/);
  const rec = one('SELECT * FROM attendance_records WHERE session_id = ? AND student_id = ?', s.id, studentId('6501101002'));
  assert.equal(rec.checkin_method, 'qr');
  assert.ok(['present', 'late'].includes(rec.attendance_status));

  const r2 = await st.post('/checkin').set('Accept', 'application/json').send({ token: tokenOf(s.id) }).set('X-CSRF-Token', st.csrf);
  assert.equal(r2.status, 409);
  assert.equal(r2.body.code, 'duplicate');
  assert.equal(q('SELECT * FROM attendance_records WHERE session_id = ? AND student_id = ?', s.id, studentId('6501101002')).length, 1);

  // expired token
  const old = tokenOf(s.id);
  db.get().prepare("UPDATE attendance_challenges SET expires_at = '2000-01-01T00:00:00.000Z' WHERE session_id = ?").run(s.id);
  const st3 = await login('6501101003');
  const r3 = await st3.post('/checkin').set('Accept', 'application/json').set('X-CSRF-Token', st3.csrf).send({ token: old });
  assert.equal(r3.status, 400);
  assert.equal(r3.body.code, 'expired_token');
  // invalid token
  const r4 = await st3.post('/checkin').set('Accept', 'application/json').set('X-CSRF-Token', st3.csrf).send({ token: 'not-a-real-token' });
  assert.equal(r4.body.code, 'invalid_token');
  // ใช้รหัสสั้น 6 ตัวได้
  att._live.delete(s.id);
  const fresh = (await teacher.get(`/teacher/sessions/${s.id}/qr.json`).set('Accept', 'application/json')).body;
  assert.notEqual(fresh.code, qr.code);
  const r5 = await st3.post('/checkin').set('Accept', 'application/json').set('X-CSRF-Token', st3.csrf).send({ code: fresh.code.toLowerCase() });
  assert.equal(r5.status, 200);
  assert.equal(one('SELECT checkin_method m FROM attendance_records WHERE session_id = ? AND student_id = ?', s.id, studentId('6501101003')).m, 'code');
});

test('TC-19 เช็คชื่อหลังปิด Session ถูกปฏิเสธ; Manual ย้อนหลังต้องมีเหตุผล', async () => {
  const teacher = await login('thaksin', 'teacher1234');
  const s = week(3);
  await openSession(teacher, s);
  const token = tokenOf(s.id);
  await teacher.post(`/teacher/sessions/${s.id}/attendance/close`).type('form').send({ _csrf: teacher.csrf, mark_absent: '1' });
  const st = await login('6501101004');
  const r = await st.post('/checkin').set('Accept', 'application/json').set('X-CSRF-Token', st.csrf).send({ token });
  assert.equal(r.body.code, 'session_closed');
  const sid = studentId('6501101004');
  assert.equal(one('SELECT attendance_status s FROM attendance_records WHERE session_id = ? AND student_id = ?', s.id, sid).s, 'absent');
  assert.ok(one("SELECT 1 x FROM attendance_risk_events WHERE session_id = ? AND user_id = ? AND event_type = 'after_close'", s.id, sid));

  const noReason = await teacher.post(`/teacher/sessions/${s.id}/attendance/manual`).set('Accept', 'application/json').set('X-CSRF-Token', teacher.csrf)
    .send({ student_id: sid, status: 'present' });
  assert.equal(noReason.status, 400);
  const ok = await teacher.post(`/teacher/sessions/${s.id}/attendance/manual`).set('Accept', 'application/json').set('X-CSRF-Token', teacher.csrf)
    .send({ student_id: sid, status: 'present', reason: 'โทรศัพท์แบตหมด ยืนยันว่าอยู่ในห้อง' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.record.attendance_status, 'present');
});

test('TC-03/15 Manual attendance บันทึกผู้แก้ไข ค่าเดิม/ใหม่ ใน Audit Log', async () => {
  const s = week(4);
  const sid = studentId('6501101005');
  att.manualSet({ sessionId: s.id, studentId: sid, status: 'leave', actorId: teacherId });
  assert.throws(() => att.manualSet({ sessionId: s.id, studentId: sid, status: 'late', actorId: teacherId }), /เหตุผล/);
  att.manualSet({ sessionId: s.id, studentId: sid, status: 'late', reason: 'มาถึงช้า 20 นาที', actorId: teacherId });
  const log = one("SELECT * FROM audit_logs WHERE action = 'attendance.update' AND entity_id = ? ORDER BY created_at DESC", `${s.id}:${sid}`);
  const meta = JSON.parse(log.metadata);
  assert.equal(meta.old, 'leave');
  assert.equal(meta.new, 'late');
  assert.equal(log.actor_id, teacherId);
});

test('TC-17 อุปกรณ์เดียว: 1 เครื่อง เช็คชื่อได้ 1 คนต่อคาบ (device lock) + Risk Event', async () => {
  const teacher = await login('thaksin', 'teacher1234');
  const s = week(5);
  await openSession(teacher, s);
  const device = 'shared-device-abcdefghijklmnop';
  const a = await login('6501101006', '6501101006', { deviceId: device });
  const b = await login('6501101007', '6501101007', { deviceId: device });
  assert.equal((await a.post('/checkin').set('Accept', 'application/json').set('X-CSRF-Token', a.csrf).send({ token: tokenOf(s.id) })).status, 200);
  const rb = await b.post('/checkin').set('Accept', 'application/json').set('X-CSRF-Token', b.csrf).send({ token: tokenOf(s.id) });
  assert.equal(rb.status, 403);
  assert.equal(rb.body.code, 'device_used');
  assert.equal(q('SELECT * FROM attendance_records WHERE session_id = ? AND student_id = ?', s.id, studentId('6501101007')).length, 0);
  const ev = one("SELECT * FROM attendance_risk_events WHERE session_id = ? AND event_type = 'multi_account_device'", s.id);
  assert.equal(ev.user_id, studentId('6501101007'));
  assert.equal(ev.risk_level, 'high');
  assert.ok(one("SELECT 1 x FROM notifications WHERE recipient_id = ? AND event_type = 'risk_event'", teacherId));

  // ล้าง cookie แต่ใช้เบราว์เซอร์เดิม (localStorage ID เดิม) ก็ยังถูกปฏิเสธ
  const lsid = 'local-storage-id-123';
  const c1 = await login('6501101008', '6501101008', { deviceId: 'cookie-one-zzzzzzzzzzzzzzzz' });
  assert.equal((await c1.post('/checkin').set('Accept', 'application/json').set('X-CSRF-Token', c1.csrf).send({ token: tokenOf(s.id), lsid })).status, 200);
  const c2 = await login('6501101009', '6501101009', { deviceId: 'cookie-two-zzzzzzzzzzzzzzzz' });
  const r2 = await c2.post('/checkin').set('Accept', 'application/json').set('X-CSRF-Token', c2.csrf).send({ token: tokenOf(s.id), lsid });
  assert.equal(r2.body.code, 'device_used');

  // ผู้สอนบันทึก Manual ให้ได้เสมอ (กรณีนักศึกษาไม่มีโทรศัพท์และยืมเครื่องเพื่อน)
  att.manualSet({ sessionId: s.id, studentId: studentId('6501101007'), status: 'present', reason: 'ไม่มีโทรศัพท์ ผู้สอนยืนยันตัวตน', actorId: teacherId });

  // ปิด device lock → ไม่ปฏิเสธ แต่ยังสร้าง Risk Event
  db.get().prepare('UPDATE courses SET device_lock = 0').run();
  const r3 = await c2.post('/checkin').set('Accept', 'application/json').set('X-CSRF-Token', c2.csrf).send({ token: tokenOf(s.id), lsid });
  assert.equal(r3.status, 200);
  db.get().prepare('UPDATE courses SET device_lock = 1').run();
});

test('IP: บันทึก IP และจำกัดเครือข่ายด้วย allowlist (CIDR)', async () => {
  assert.equal(att.ipAllowed('202.28.10.55', '202.28.10.0/24'), true);
  assert.equal(att.ipAllowed('::ffff:202.28.10.55', '202.28.10.0/24, 10.0.0.0/8'), true);
  assert.equal(att.ipAllowed('1.2.3.4', '202.28.10.0/24'), false);
  assert.equal(att.ipAllowed('1.2.3.4', ''), true);
  assert.deepEqual(att.parseAllowlist('202.28.0.0/16, nope, 10.0.0.0/99').errors, ['nope', '10.0.0.0/99']);

  const teacher = await login('thaksin', 'teacher1234');
  const s = week(10);
  await openSession(teacher, s);
  db.get().prepare("UPDATE courses SET ip_allowlist = '203.0.113.0/24'").run();
  const st = await login('6501101001');
  const bad = await st.post('/checkin').set('Accept', 'application/json').set('X-CSRF-Token', st.csrf).send({ token: tokenOf(s.id) });
  assert.equal(bad.body.code, 'ip_not_allowed');
  db.get().prepare("UPDATE courses SET ip_allowlist = '127.0.0.0/8, ::1/128'").run();
  const ok = await st.post('/checkin').set('Accept', 'application/json').set('X-CSRF-Token', st.csrf).send({ token: tokenOf(s.id) });
  assert.equal(ok.status, 200);
  const rec = one('SELECT ip_address FROM attendance_records WHERE session_id = ? AND student_id = ?', s.id, studentId('6501101001'));
  assert.match(rec.ip_address, /127\.0\.0\.1|::1/);
  db.get().prepare('UPDATE courses SET ip_allowlist = NULL').run();
});

test('GPS: ต้องส่งตำแหน่ง, ต้องแม่นยำพอ, ต้องอยู่ในรัศมีห้องเรียน', async () => {
  const teacher = await login('thaksin', 'teacher1234');
  const s = week(11);
  await openSession(teacher, s);
  // ผู้สอนตั้งจุดห้องเรียนจากเครื่องตนเอง (คณะสารสนเทศฯ แม่โจ้ — พิกัดตัวอย่าง)
  const center = { lat: 18.8960, lng: 99.0122 };
  const set = await teacher.post(`/teacher/sessions/${s.id}/geo`).set('Accept', 'application/json').set('X-CSRF-Token', teacher.csrf).send({ ...center, accuracy: 12 });
  assert.equal(set.status, 200);
  db.get().prepare('UPDATE courses SET geo_enabled = 1, geo_radius_m = 150, geo_max_accuracy_m = 100').run();
  const send = (ag, extra) => ag.post('/checkin').set('Accept', 'application/json').set('X-CSRF-Token', ag.csrf).send({ token: tokenOf(s.id), ...extra });

  const st = await login('6501101002');
  assert.equal((await send(st, {})).body.code, 'geo_required');
  assert.equal((await send(st, { lat: center.lat, lng: center.lng, acc: 500 })).body.code, 'geo_inaccurate');
  const far = await send(st, { lat: 18.80, lng: 98.95, acc: 20 }); // เมืองเชียงใหม่ ~12 กม.
  assert.equal(far.body.code, 'geo_out_of_range');
  assert.ok(one("SELECT 1 x FROM attendance_risk_events WHERE session_id = ? AND user_id = ? AND event_type = 'geo_out_of_range'", s.id, studentId('6501101002')));
  const near = await send(st, { lat: 18.8965, lng: 99.0125, acc: 25 }); // ~65 ม.
  assert.equal(near.status, 200);
  const rec = one('SELECT * FROM attendance_records WHERE session_id = ? AND student_id = ?', s.id, studentId('6501101002'));
  assert.ok(rec.geo_distance_m > 40 && rec.geo_distance_m < 90, String(rec.geo_distance_m));
  assert.equal(rec.geo_accuracy_m, 25);

  assert.ok(Math.abs(att.distanceM(18.8960, 99.0122, 18.8960, 99.0122)) < 1e-6);
  assert.ok(Math.abs(att.distanceM(0, 0, 0, 1) - 111195) < 50);
  db.get().prepare('UPDATE courses SET geo_enabled = 0').run();
});

test('Fingerprint ซ้ำ (เช่น มือถือรุ่นเดียวกัน) → แจ้งระดับต่ำ ไม่ปฏิเสธ', async () => {
  const teacher = await login('thaksin', 'teacher1234');
  const s = week(12);
  await openSession(teacher, s);
  const a = await login('6501101003');
  const b = await login('6501101004');
  assert.equal((await a.post('/checkin').set('Accept', 'application/json').set('X-CSRF-Token', a.csrf).send({ token: tokenOf(s.id), fp: 'iphone13-safari' })).status, 200);
  assert.equal((await b.post('/checkin').set('Accept', 'application/json').set('X-CSRF-Token', b.csrf).send({ token: tokenOf(s.id), fp: 'iphone13-safari' })).status, 200);
  const ev = one("SELECT * FROM attendance_risk_events WHERE session_id = ? AND event_type = 'same_fingerprint'", s.id);
  assert.equal(ev.risk_level, 'low');
});

test('TC-18 บัญชีเดียวใช้งานหลายอุปกรณ์พร้อมกัน → แจ้งเตือน', async () => {
  const teacher = await login('thaksin', 'teacher1234');
  const s = week(6);
  await openSession(teacher, s);
  await login('6501101008', '6501101008', { deviceId: 'device-one-aaaaaaaaaaaaaaaa' });
  const second = await login('6501101008', '6501101008', { deviceId: 'device-two-bbbbbbbbbbbbbbbb' });
  const r = await second.post('/checkin').set('Accept', 'application/json').set('X-CSRF-Token', second.csrf).send({ token: tokenOf(s.id) });
  assert.equal(r.status, 200);
  assert.ok(one("SELECT 1 x FROM attendance_risk_events WHERE session_id = ? AND user_id = ? AND event_type = 'multi_device_account'", s.id, studentId('6501101008')));
});

test('Rate limit: คำขอเช็คชื่อถี่ผิดปกติ → 429 + Risk Event', async () => {
  const st = await login('6501101009');
  let last;
  for (let i = 0; i < 8; i += 1) {
    last = await st.post('/checkin').set('Accept', 'application/json').set('X-CSRF-Token', st.csrf).send({ token: `bogus-${i}` });
  }
  assert.equal(last.status, 429);
  assert.ok(one("SELECT 1 x FROM attendance_risk_events WHERE user_id = ? AND event_type = 'rapid_requests'", studentId('6501101009')));
});

test('สถานะมาสายคำนวณจากเวลาเริ่มคาบ + late_after_minutes', () => {
  const c = { late_after_minutes: 15 };
  const s = { session_date: '2026-06-15', start_time: '09:00', attendance_opened_at: '2026-06-15T01:55:00.000Z' };
  assert.equal(att.computeStatus(s, c, new Date('2026-06-15T02:10:00.000Z')), 'present'); // 09:10 น.
  assert.equal(att.computeStatus(s, c, new Date('2026-06-15T02:16:00.000Z')), 'late'); // 09:16 น.
  // คาบไม่ตรงกับวันนี้ → อ้างอิงเวลาเปิดเช็คชื่อ
  const s2 = { session_date: '2026-01-01', start_time: '09:00', attendance_opened_at: '2026-06-15T02:00:00.000Z' };
  assert.equal(att.computeStatus(s2, c, new Date('2026-06-15T02:10:00.000Z')), 'present');
  assert.equal(att.computeStatus(s2, c, new Date('2026-06-15T02:20:00.000Z')), 'late');
});

test('Random in-class verification code', async () => {
  const s = week(2);
  const st = await login('6501101002');
  const { code } = att.issueVerifyCode(s.id, teacherId, 2);
  assert.throws(() => att.verifyPresence(s.id, studentId('6501101002'), code === '0000' ? '1111' : '0000'), /ไม่ถูกต้อง/);
  const r = await st.post('/checkin/verify').type('form').send({ _csrf: st.csrf, session_id: s.id, code });
  assert.equal(r.status, 302);
  assert.ok(one('SELECT verified_at FROM attendance_records WHERE session_id = ? AND student_id = ?', s.id, studentId('6501101002')).verified_at);
});

test('TC-20 Device binding: เปลี่ยนอุปกรณ์ → Risk Event; ยกเลิกอุปกรณ์เดิมแล้วลงทะเบียนใหม่', async () => {
  db.get().prepare('UPDATE courses SET device_binding = 1').run();
  const teacher = await login('thaksin', 'teacher1234');
  const s7 = week(7);
  await openSession(teacher, s7);
  const sid = studentId('6501101010');
  const phone1 = await login('6501101010', '6501101010', { deviceId: 'phone-1-xxxxxxxxxxxxxxxxxxx' });
  assert.equal((await phone1.post('/checkin').set('Accept', 'application/json').set('X-CSRF-Token', phone1.csrf).send({ token: tokenOf(s7.id) })).status, 200);
  assert.equal(q("SELECT * FROM trusted_devices WHERE user_id = ? AND status = 'active'", sid).length, 1);
  await phone1.post('/logout').type('form').send({ _csrf: phone1.csrf });

  const s8 = week(8);
  await openSession(teacher, s8);
  const phone2 = await login('6501101010', '6501101010', { deviceId: 'phone-2-yyyyyyyyyyyyyyyyyyy' });
  const r = await phone2.post('/checkin').set('Accept', 'application/json').set('X-CSRF-Token', phone2.csrf).send({ token: tokenOf(s8.id) });
  assert.equal(r.status, 200);
  assert.ok(one("SELECT 1 x FROM attendance_risk_events WHERE user_id = ? AND event_type = 'device_changed'", sid));

  // นักศึกษายื่นคำขอเปลี่ยนอุปกรณ์ → ผู้สอนอนุมัติ → อุปกรณ์เดิมถูกยกเลิก
  await phone2.post('/student/appeals').type('form').send({ _csrf: phone2.csrf, type: 'device_change', message: 'โทรศัพท์เครื่องเดิมหาย' });
  const ap = one("SELECT * FROM attendance_appeals WHERE student_id = ? AND appeal_type = 'device_change'", sid);
  await teacher.post(`/teacher/appeals/${ap.id}/review`).type('form').send({ _csrf: teacher.csrf, decision: 'approved', response: 'ตรวจสอบแล้ว' });
  assert.equal(q("SELECT * FROM trusted_devices WHERE user_id = ? AND status = 'active'", sid).length, 0);
  assert.equal(one('SELECT status FROM attendance_appeals WHERE id = ?', ap.id).status, 'approved');
  db.get().prepare('UPDATE courses SET device_binding = 0').run();
});

test('TC-21 ผู้สอนตรวจสอบเหตุการณ์เสี่ยง: ต้องมีเหตุผล บันทึกผู้ตรวจ เวลา ผล', async () => {
  const teacher = await login('thaksin', 'teacher1234');
  const ev = one("SELECT * FROM attendance_risk_events WHERE event_type = 'multi_account_device'");
  const bad = await teacher.post(`/teacher/risk/${ev.id}/review`).set('Accept', 'application/json').set('X-CSRF-Token', teacher.csrf).send({ decision: 'dismissed' });
  assert.equal(bad.status, 400);
  await teacher.post(`/teacher/risk/${ev.id}/review`).type('form').send({ _csrf: teacher.csrf, decision: 'dismissed', note: 'ยืมโทรศัพท์เพื่อนเพราะเครื่องเสีย ตรวจสอบแล้วอยู่ในห้อง' });
  const after = one('SELECT * FROM attendance_risk_events WHERE id = ?', ev.id);
  assert.equal(after.review_status, 'dismissed');
  assert.equal(after.reviewed_by, teacherId);
  assert.ok(after.reviewed_at);
  assert.match(after.review_note, /ยืมโทรศัพท์/);
});
