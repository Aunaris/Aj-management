'use strict';
/**
 * รีเซ็ตรหัสผ่านจากบรรทัดคำสั่ง (ใช้เมื่อเข้าสู่ระบบไม่ได้)
 * ใช้: node scripts/reset-password.js <ชื่อผู้ใช้> <รหัสผ่านใหม่>
 * Docker: docker compose exec classroom node scripts/reset-password.js aunalyst teacher1234
 * ผู้ใช้จะถูกบังคับให้เปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งถัดไป และออกจากระบบทุกอุปกรณ์
 */
const db = require('../src/db');
const auth = require('../src/services/auth');
const { now } = db;

const [login, password] = process.argv.slice(2);
if (!login || !password) {
  console.error('ใช้: node scripts/reset-password.js <ชื่อผู้ใช้> <รหัสผ่านใหม่>');
  process.exit(2);
}
db.open();
const user = auth.findUserByLogin(login);
if (!user) {
  const names = db.get().prepare(`SELECT u.username, r.role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE r.role_name != 'student' ORDER BY u.username`).all();
  console.error(`ไม่พบผู้ใช้ "${login}" — บัญชีอาจารย์/ผู้ดูแลที่มี: ${names.map((n) => `${n.username} (${n.role_name})`).join(', ')}`);
  process.exit(1);
}
auth.changePassword(user.id, password);
db.get().prepare("UPDATE users SET must_change_password = 1, status = 'active' WHERE id = ?").run(user.id);
db.get().prepare('UPDATE auth_sessions SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL').run(now(), user.id);
require('../src/services/audit').log(null, 'user.reset_password_cli', 'user', user.id);
db.close();
console.log(`รีเซ็ตรหัสผ่านของ ${user.username} แล้ว — เข้าสู่ระบบด้วยรหัสใหม่ แล้วระบบจะให้ตั้งรหัสผ่านใหม่`);
