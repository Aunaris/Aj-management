'use strict';
const crypto = require('crypto');
const { get, uuid, now } = require('../db');

const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** Password hashing ด้วย scrypt + salt (ห้ามเก็บรหัสผ่านแบบ Plain Text) */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltHex, hashHex] = stored.split('$');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

function roleId(name) {
  return get().prepare('SELECT id FROM roles WHERE role_name = ?').get(name).id;
}

function createUser({ username, fullName, email, password, role, studentCode, mustChangePassword = 0 }) {
  const id = uuid();
  get()
    .prepare(`INSERT INTO users (id, student_code, username, full_name, email, password_hash, role_id, must_change_password, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, studentCode || null, username, fullName, email || null, hashPassword(password), roleId(role), mustChangePassword ? 1 : 0, now());
  return id;
}

function findUserByLogin(login) {
  return get()
    .prepare(`SELECT u.*, r.role_name AS role FROM users u JOIN roles r ON r.id = u.role_id
      WHERE (u.username = ? OR u.student_code = ? OR lower(u.email) = lower(?))`)
    .get(login, login, login);
}

function getUser(id) {
  return get().prepare('SELECT u.*, r.role_name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?').get(id);
}

/** สร้าง Session ฝั่ง Server เก็บเฉพาะ hash ของ token ในฐานข้อมูล */
function createSession(userId, { deviceId, userAgent } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const ts = now();
  const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
  const sessionHash = sha256(token);
  const db = get();
  db.prepare(`INSERT INTO auth_sessions (id, user_id, session_hash, csrf_token, device_id_hash, user_agent, started_at, last_seen_at, expires_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(uuid(), userId, sessionHash, csrf, deviceId ? sha256(deviceId) : null, (userAgent || '').slice(0, 300), ts, ts, expires);
  if (deviceId) {
    db.prepare('INSERT INTO device_sessions (id, user_id, device_id, session_hash, started_at) VALUES (?,?,?,?,?)')
      .run(uuid(), userId, sha256(deviceId), sessionHash, ts);
  }
  return token;
}

function resolveSession(token) {
  if (!token) return null;
  const row = get()
    .prepare(`SELECT s.*, u.full_name, u.username, u.student_code, u.status AS user_status, u.must_change_password, r.role_name AS role
      FROM auth_sessions s JOIN users u ON u.id = s.user_id JOIN roles r ON r.id = u.role_id
      WHERE s.session_hash = ? AND s.ended_at IS NULL`)
    .get(sha256(token));
  if (!row) return null;
  if (row.expires_at < now() || row.user_status !== 'active') return null;
  // touch at most once per minute
  if (Date.now() - Date.parse(row.last_seen_at) > 60000) {
    get().prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?').run(now(), row.id);
  }
  return row;
}

function endSession(token) {
  if (!token) return;
  const h = sha256(token);
  const ts = now();
  get().prepare('UPDATE auth_sessions SET ended_at = ? WHERE session_hash = ?').run(ts, h);
  get().prepare('UPDATE device_sessions SET ended_at = ? WHERE session_hash = ? AND ended_at IS NULL').run(ts, h);
}

function changePassword(userId, newPassword) {
  get().prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(newPassword), userId);
}

module.exports = {
  sha256, hashPassword, verifyPassword, createUser, findUserByLogin, getUser,
  createSession, resolveSession, endSession, changePassword, roleId,
};
