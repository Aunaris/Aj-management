'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { login, q, one, db } = require('./helpers');

const GIF = Buffer.from('474946383961010001008000000000ffffff21f90401000000002c00000000010001000002024401003b', 'hex');
const courseSvc = require('../src/services/course');
const assignSvc = require('../src/services/assignments');
const mailin = require('../src/services/mailin');

const course = courseSvc.getCourse();
const teacherId = one("SELECT id FROM users WHERE username = 'thaksin'").id;
const studentId = (code) => one('SELECT id FROM users WHERE student_code = ?', code).id;
const A01 = one("SELECT * FROM assignments WHERE assignment_code = 'A01'");

let n = 0;
function mime({ from, subject, text = 'ส่งงานครับ', attachments = [], date = new Date() }) {
  n += 1;
  const b = `b${n}`;
  const parts = [
    `From: ${from}`, 'To: teacher@example.com', `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    `Message-ID: <msg-${n}-${Date.now()}@example.com>`, `Date: ${date.toUTCString()}`, 'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${b}"`, '', `--${b}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(text).toString('base64'),
  ];
  for (const a of attachments) {
    parts.push(`--${b}`, `Content-Type: ${a.type}; name="${a.name}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${a.name}"`, '', a.data.toString('base64'));
  }
  parts.push(`--${b}--`, '');
  return parts.join('\r\n');
}

test('เข้ารหัส App Password และไม่คืนรหัสผ่านให้หน้าเว็บ', () => {
  const enc = mailin.encrypt('abcd efgh ijkl mnop');
  assert.notEqual(enc, 'abcd efgh ijkl mnop');
  assert.equal(mailin.decrypt(enc), 'abcd efgh ijkl mnop');
  mailin.saveAccount(course.id, { imap_host: '127.0.0.1', imap_port: 1, imap_secure: '', username: 'teacher@example.com', password: 'secret-pass', enabled: '' }, teacherId);
  const acc = mailin.publicAccount(course.id);
  assert.equal(acc.password_enc, undefined);
  assert.equal(acc.has_password, true);
  assert.notEqual(mailin.getAccount(course.id).password_enc, 'secret-pass');
});

test('อีเมลมี [รหัสงาน] + รหัสนักศึกษา → สร้าง Submission อัตโนมัติ (ไฟล์แนบ + ลิงก์)', async () => {
  const raw = mime({
    from: 'Kamol <kamol.private@gmail.com>', subject: '[A01] 6501101001 กมลชนก ส่งงาน Bouncing Ball',
    text: 'ลิงก์งาน https://drive.google.com/file/d/xyz/view ครับ',
    attachments: [{ name: 'ball.gif', type: 'image/gif', data: GIF }],
  });
  const r = await mailin.ingestRaw(course.id, raw, { uid: 1, receivedAt: new Date() });
  assert.equal(r.status, 'imported');
  const e = one('SELECT * FROM inbound_emails WHERE id = ?', r.id);
  const sub = one('SELECT * FROM submissions WHERE id = ?', e.submission_id);
  assert.equal(sub.student_id, studentId('6501101001'));
  assert.equal(sub.assignment_id, A01.id);
  assert.equal(sub.source, 'email');
  assert.equal(one('SELECT file_name FROM submission_files WHERE submission_id = ?', sub.id).file_name, 'ball.gif');
  assert.equal(one('SELECT url FROM submission_links WHERE submission_id = ?', sub.id).url, 'https://drive.google.com/file/d/xyz/view');
  assert.ok(one("SELECT 1 x FROM notifications WHERE recipient_id = ? AND title LIKE '%อีเมล%'", studentId('6501101001')));
  // อีเมลซ้ำ (Message-ID เดิม) ไม่นำเข้าซ้ำ
  assert.equal((await mailin.ingestRaw(course.id, raw)).status, 'duplicate');
});

test('จับคู่นักศึกษาจากอีเมลผู้ส่งที่ลงทะเบียน (ไม่มีรหัสนักศึกษาในหัวเรื่อง)', async () => {
  db.get().prepare("UPDATE users SET email = 'nattapon@mju.example' WHERE student_code = '6501101002'").run();
  const r = await mailin.ingestRaw(course.id, mime({ from: 'nattapon@mju.example', subject: 'ส่งงาน A01 ครับ', attachments: [{ name: 'a.gif', type: 'image/gif', data: GIF }] }));
  assert.equal(r.status, 'imported');
  assert.equal(one('SELECT student_id FROM inbound_emails WHERE id = ?', r.id).student_id, studentId('6501101002'));
});

test('อีเมลไม่เกี่ยวข้องไม่ถูกบันทึก; ไม่มีรหัสงาน → รอจัดการ แล้วอาจารย์นำเข้าเอง', async () => {
  const before = q('SELECT * FROM inbound_emails').length;
  assert.equal((await mailin.ingestRaw(course.id, mime({ from: 'news@shop.example', subject: 'โปรโมชั่นลดราคา' }))).status, 'skipped');
  assert.equal(q('SELECT * FROM inbound_emails').length, before);

  const r = await mailin.ingestRaw(course.id, mime({ from: 'x@gmail.com', subject: '6501101003 ส่งงานครับ', attachments: [{ name: 'w.gif', type: 'image/gif', data: GIF }] }));
  assert.equal(r.status, 'unmatched');
  const e = one('SELECT * FROM inbound_emails WHERE id = ?', r.id);
  assert.equal(e.student_id, studentId('6501101003'));
  assert.match(e.note, /รหัสงาน/);
  assert.ok(one("SELECT 1 x FROM notifications WHERE recipient_id = ? AND related_entity_id = ?", teacherId, r.id));

  const teacher = await login('thaksin', 'teacher1234');
  const page = await teacher.get('/teacher/mail');
  assert.equal(page.status, 200);
  assert.match(page.text, /6501101003 ส่งงานครับ/);
  await teacher.post(`/teacher/mail/${r.id}/import`).type('form').send({ _csrf: teacher.csrf, student_id: studentId('6501101003'), assignment_id: A01.id });
  const after = one('SELECT * FROM inbound_emails WHERE id = ?', r.id);
  assert.equal(after.status, 'imported');
  assert.equal(after.handled_by, teacherId);
});

test('อีเมลส่งงานใช้เงื่อนไขเดียวกับเว็บ: ชนิดไฟล์ไม่อนุญาต → ไม่ผ่านเงื่อนไข; ส่งหลังกำหนด → late ตามเวลาที่อีเมลถึง', async () => {
  const bad = await mailin.ingestRaw(course.id, mime({ from: 'y@gmail.com', subject: '[A01] 6501101004', attachments: [{ name: 'run.exe', type: 'application/octet-stream', data: Buffer.from('MZ') }] }));
  assert.equal(bad.status, 'error');
  assert.match(one('SELECT note FROM inbound_emails WHERE id = ?', bad.id).note, /exe/);

  db.get().prepare("UPDATE assignments SET due_date = ?, late_policy = 'accept_mark' WHERE id = ?").run(new Date(Date.now() - 3600000).toISOString(), A01.id);
  const late = await mailin.ingestRaw(course.id, mime({ from: 'z@gmail.com', subject: '[A01] 6501101005', attachments: [{ name: 'l.gif', type: 'image/gif', data: GIF }] }), { receivedAt: new Date() });
  assert.equal(late.status, 'imported');
  const s = one('SELECT s.* FROM submissions s JOIN inbound_emails e ON e.submission_id = s.id WHERE e.id = ?', late.id);
  assert.equal(s.is_late, 1);
  const ontime = await mailin.ingestRaw(course.id, mime({ from: 'z@gmail.com', subject: '[A01] 6501101006', attachments: [{ name: 'o.gif', type: 'image/gif', data: GIF }] }),
    { receivedAt: new Date(Date.now() - 2 * 3600000) });
  const s2 = one('SELECT s.* FROM submissions s JOIN inbound_emails e ON e.submission_id = s.id WHERE e.id = ?', ontime.id);
  assert.equal(s2.is_late, 0);
});

test('ข้ามอีเมลที่อาจารย์ส่งเอง และไม่จับคู่งานเมื่อหัวเรื่องมีรหัสงานหลายรายการ', async () => {
  assert.equal((await mailin.ingestRaw(course.id, mime({ from: 'teacher@example.com', subject: '[A01] 6501101001' }), { ownAddress: 'teacher@example.com' })).status, 'skipped');
  const cat = courseSvc.categories(course.id).find((c) => c.code === 'POST_CLO3');
  const id = assignSvc.save(course.id, { title: 'B', assignment_code: 'A11', max_score: '2', category_id: cat.id, allowed_types: 'png', allow_links: '1', clo_CLO3: '1', clo_weight_CLO3: '1' }, teacherId);
  assignSvc.setStatus(id, 'published', teacherId);
  const r = await mailin.ingestRaw(course.id, mime({ from: 'q@gmail.com', subject: 'A01 และ A11 6501101007' }));
  assert.equal(r.status, 'unmatched');
  assert.match(one('SELECT note FROM inbound_emails WHERE id = ?', r.id).note, /มากกว่า 1/);
  assert.deepEqual(mailin.extractUrls('ดูที่ https://youtu.be/abc, และ https://drive.google.com/x).'), ['https://youtu.be/abc', 'https://drive.google.com/x']);
});

test('เชื่อมต่อ IMAP ไม่ได้ → บันทึกข้อผิดพลาด ไม่ล่ม; นักศึกษาเข้าหน้าอีเมลไม่ได้', async () => {
  const r = await mailin.poll(course.id, { force: true });
  assert.ok(r.errorMessage);
  assert.ok(mailin.getAccount(course.id).last_error);
  const st = await login('6501101001');
  assert.equal((await st.get('/teacher/mail')).status, 403);
});
