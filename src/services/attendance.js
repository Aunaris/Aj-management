'use strict';
/**
 * FR-02 Attendance Management + 10.4 Anti Proxy Attendance
 * - Dynamic QR: token สุ่มผูกกับ Course Session อายุสั้น (qr_ttl_seconds) แล้วหมุนเวียนอัตโนมัติ
 * - เก็บเฉพาะ hash ของ token ในฐานข้อมูล
 * - token ใช้ได้หนึ่งครั้งต่อบัญชี, ปฏิเสธ token หมดอายุ/ไม่ตรง session/หลังปิด session
 * - ตรวจจับความผิดปกติแล้วสร้าง Risk Event ให้ผู้สอนพิจารณา (ไม่ลงโทษอัตโนมัติ)
 */
const crypto = require('crypto');
const net = require('net');
const { get, uuid, now, tx } = require('../db');
const { sha256 } = require('./auth');
const audit = require('./audit');
const notify = require('./notify');
const courseSvc = require('./course');
const { localDateTime, localToday } = require('../util');

const TOKEN_GRACE_MS = 20 * 1000; // เผื่อเวลาสแกนช่วงรอยต่อ QR และเวลาขอตำแหน่ง GPS
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 6;
const SHORT_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

class AttendanceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// token ดิบของรอบปัจจุบันเก็บในหน่วยความจำเท่านั้น (สำหรับแสดงบนจอผู้สอน)
const liveChallenges = new Map();

function shortCode() {
  let s = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i += 1) s += SHORT_ALPHABET[bytes[i] % SHORT_ALPHABET.length];
  return s;
}

/** ระยะทางระหว่างพิกัด (เมตร) — Haversine */
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function normalizeIp(ip) {
  const s = String(ip || '').trim();
  return s.startsWith('::ffff:') && net.isIPv4(s.slice(7)) ? s.slice(7) : s;
}

/** รายการเครือข่ายที่อนุญาต เช่น "202.28.0.0/16, 10.0.0.0/8" (ว่าง = ไม่จำกัด) */
function parseAllowlist(text) {
  const list = new net.BlockList();
  const errors = [];
  let count = 0;
  for (const raw of String(text || '').split(/[\s,]+/).filter(Boolean)) {
    const [addr, prefixRaw] = raw.split('/');
    const type = net.isIPv4(addr) ? 'ipv4' : net.isIPv6(addr) ? 'ipv6' : null;
    if (!type) { errors.push(raw); continue; }
    const prefix = prefixRaw === undefined ? (type === 'ipv4' ? 32 : 128) : Number(prefixRaw);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > (type === 'ipv4' ? 32 : 128)) { errors.push(raw); continue; }
    list.addSubnet(addr, prefix, type);
    count += 1;
  }
  return { list, count, errors };
}

function ipAllowed(ip, allowlistText) {
  const { list, count } = parseAllowlist(allowlistText);
  if (!count) return true;
  const n = normalizeIp(ip);
  const type = net.isIPv4(n) ? 'ipv4' : net.isIPv6(n) ? 'ipv6' : null;
  return !!type && list.check(n, type);
}

function geoCenter(session, course) {
  if (session.geo_lat !== null && session.geo_lat !== undefined && session.geo_lng !== null && session.geo_lng !== undefined) return { lat: session.geo_lat, lng: session.geo_lng, from: 'session' };
  if (course.geo_lat !== null && course.geo_lat !== undefined && course.geo_lng !== null && course.geo_lng !== undefined) return { lat: course.geo_lat, lng: course.geo_lng, from: 'course' };
  return null;
}

function cleanGeo(geo) {
  if (!geo) return null;
  const lat = Number(geo.lat);
  const lng = Number(geo.lng);
  const acc = Number(geo.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { lat, lng, accuracy: Number.isFinite(acc) && acc >= 0 ? acc : null };
}

function sessionWithCourse(sessionId) {
  const s = courseSvc.getSession(sessionId);
  if (!s) throw new AttendanceError('not_found', 'ไม่พบคาบเรียน', 404);
  const course = get().prepare('SELECT * FROM courses WHERE id = ?').get(s.course_id);
  return { session: s, course };
}

function openAttendance(sessionId, actorId) {
  const { session } = sessionWithCourse(sessionId);
  if (session.status === 'cancelled') throw new AttendanceError('cancelled', 'คาบนี้ถูกยกเลิกแล้ว');
  const ts = now();
  get().prepare(`UPDATE course_sessions SET attendance_state = 'open', attendance_opened_at = COALESCE(attendance_opened_at, ?), attendance_closed_at = NULL,
    status = CASE WHEN status = 'draft' THEN 'published' ELSE status END WHERE id = ?`).run(ts, sessionId);
  audit.log(actorId, 'attendance.open', 'course_session', sessionId);
  return courseSvc.getSession(sessionId);
}

function closeAttendance(sessionId, actorId, { markAbsent = false } = {}) {
  const { session } = sessionWithCourse(sessionId);
  tx(() => {
    get().prepare("UPDATE course_sessions SET attendance_state = 'closed', attendance_closed_at = ? WHERE id = ?").run(now(), sessionId);
    get().prepare("UPDATE attendance_challenges SET status = 'revoked' WHERE session_id = ? AND status = 'active'").run(sessionId);
    if (markAbsent) {
      const missing = get().prepare(`SELECT u.id FROM course_enrollments e JOIN users u ON u.id = e.user_id JOIN roles r ON r.id = u.role_id
        WHERE e.course_id = ? AND r.role_name = 'student' AND e.enrollment_status = 'active' AND (? IS NULL OR e.section = ?)
        AND u.id NOT IN (SELECT student_id FROM attendance_records WHERE session_id = ?)`).all(session.course_id, courseSvc.sessionSectionCode(session), courseSvc.sessionSectionCode(session), sessionId);
      const ins = get().prepare(`INSERT INTO attendance_records (id, session_id, student_id, attendance_status, checkin_method, note, updated_by, updated_at)
        VALUES (?,?,?,'absent','manual','ไม่ได้เช็คชื่อเมื่อปิด Session',?,?)`);
      for (const m of missing) ins.run(uuid(), sessionId, m.id, actorId, now());
    }
  });
  liveChallenges.delete(sessionId);
  audit.log(actorId, 'attendance.close', 'course_session', sessionId, { markAbsent });
}

/** คืนค่า challenge ปัจจุบัน (หมุนเวียนใหม่เมื่อหมดอายุ) — เรียกจากจอแสดง QR ของผู้สอน */
function currentChallenge(sessionId) {
  const { session, course } = sessionWithCourse(sessionId);
  if (session.attendance_state !== 'open') throw new AttendanceError('closed', 'ยังไม่ได้เปิดเช็คชื่อ');
  const live = liveChallenges.get(sessionId);
  const ttl = Math.max(15, Math.min(600, course.qr_ttl_seconds || 45));
  if (live && Date.parse(live.expiresAt) - Date.now() > 1500) return live;
  const token = crypto.randomBytes(24).toString('base64url');
  const code = shortCode();
  const issued = new Date();
  const expires = new Date(issued.getTime() + ttl * 1000);
  const id = uuid();
  tx(() => {
    get().prepare("UPDATE attendance_challenges SET status = 'expired' WHERE session_id = ? AND status = 'active' AND expires_at < ?").run(sessionId, issued.toISOString());
    get().prepare(`INSERT INTO attendance_challenges (id, session_id, token_hash, short_code_hash, issued_at, expires_at) VALUES (?,?,?,?,?,?)`)
      .run(id, sessionId, sha256(token), sha256(`code:${code}`), issued.toISOString(), expires.toISOString());
  });
  const challenge = { id, token, code, issuedAt: issued.toISOString(), expiresAt: expires.toISOString(), ttl };
  liveChallenges.set(sessionId, challenge);
  return challenge;
}

function riskEvent(sessionId, userId, eventType, riskLevel, metadata, { notifyTeachers = true } = {}) {
  const id = uuid();
  get().prepare(`INSERT INTO attendance_risk_events (id, session_id, user_id, event_type, risk_level, metadata, created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(id, sessionId || null, userId, eventType, riskLevel, metadata ? JSON.stringify(metadata) : null, now());
  if (notifyTeachers && sessionId) {
    const s = courseSvc.getSession(sessionId);
    if (s && riskLevel !== 'low') {
      notify.sendMany(courseSvc.teacherIds(s.course_id), {
        eventType: 'risk_event', title: 'พบเหตุการณ์เสี่ยงการเช็คชื่อ', message: `สัปดาห์ ${s.week_number}: ${eventType}`,
        link: `/teacher/risk?session=${sessionId}`, entityType: 'attendance_risk_event', entityId: id, dedupeKey: `risk:${id}`,
      });
    }
  }
  return id;
}

function hasRecentRisk(sessionId, userId, eventType) {
  return !!get().prepare('SELECT 1 FROM attendance_risk_events WHERE session_id IS ? AND user_id = ? AND event_type = ?').get(sessionId, userId, eventType);
}

function recordAttempt(sessionId, userId, deviceHash, result, extra = {}) {
  get().prepare('INSERT INTO attendance_attempts (id, session_id, user_id, device_id_hash, result, created_at, ip_address, fingerprint_hash) VALUES (?,?,?,?,?,?,?,?)')
    .run(uuid(), sessionId || null, userId, deviceHash || null, result, now(), extra.ip || null, extra.fp || null);
}

function computeStatus(session, course, at = new Date()) {
  const lateMin = course.late_after_minutes ?? 15;
  let base = null;
  if (session.session_date && session.start_time && session.session_date === localToday(at)) {
    base = localDateTime(session.session_date, session.start_time);
  }
  if (!base && session.attendance_opened_at) base = new Date(session.attendance_opened_at);
  if (!base) return 'present';
  return at.getTime() > base.getTime() + lateMin * 60000 ? 'late' : 'present';
}

/**
 * นักศึกษาเช็คชื่อ (ต้อง Login แล้ว) ด้วย token จาก QR หรือรหัสสั้น 6 ตัวที่แสดงคู่กับ QR
 * @returns {{status:string, record:object, warnings:string[]}}
 */
function checkIn({ userId, token, code, deviceId, localDeviceId, fingerprint, ip, geo, at = new Date() }) {
  const db = get();
  const deviceHash = deviceId ? sha256(deviceId) : null;
  const localHash = localDeviceId ? sha256(`local:${String(localDeviceId).slice(0, 100)}`) : null;
  const fpHash = fingerprint ? sha256(`fp:${String(fingerprint).slice(0, 200)}`) : null;
  const ipAddr = ip ? normalizeIp(ip) : null;
  const extra = { ip: ipAddr, fp: fpHash };
  const position = cleanGeo(geo);

  // Rate limit + ตรวจจับคำขอถี่ผิดปกติ
  const since = new Date(at.getTime() - RATE_WINDOW_MS).toISOString();
  const recent = db.prepare('SELECT COUNT(*) c FROM attendance_attempts WHERE user_id = ? AND created_at >= ?').get(userId, since).c;
  if (recent >= RATE_MAX) {
    const last = db.prepare('SELECT session_id FROM attendance_attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(userId);
    const sid = last ? last.session_id : null;
    if (!db.prepare('SELECT 1 FROM attendance_risk_events WHERE user_id = ? AND event_type = ? AND created_at >= ?').get(userId, 'rapid_requests', since)) {
      riskEvent(sid, userId, 'rapid_requests', 'medium', { attemptsInLastMinute: recent + 1 });
    }
    recordAttempt(sid, userId, deviceHash, 'rate_limited', extra);
    throw new AttendanceError('rate_limited', 'ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่', 429);
  }

  let challenge = null;
  if (token) challenge = db.prepare('SELECT * FROM attendance_challenges WHERE token_hash = ?').get(sha256(token));
  else if (code) {
    const normalized = String(code).trim().toUpperCase();
    challenge = db.prepare('SELECT * FROM attendance_challenges WHERE short_code_hash = ? ORDER BY issued_at DESC LIMIT 1').get(sha256(`code:${normalized}`));
  }
  if (!challenge) {
    recordAttempt(null, userId, deviceHash, 'invalid_token', extra);
    throw new AttendanceError('invalid_token', 'QR/รหัสไม่ถูกต้อง กรุณาสแกน QR ล่าสุดบนจอ');
  }
  const { session, course } = sessionWithCourse(challenge.session_id);

  if (session.attendance_state !== 'open' || challenge.status === 'revoked') {
    recordAttempt(session.id, userId, deviceHash, 'session_closed', extra);
    if (!hasRecentRisk(session.id, userId, 'after_close') && courseSvc.isEnrolled(session.course_id, userId)) {
      riskEvent(session.id, userId, 'after_close', 'low', { method: token ? 'qr' : 'code' }, { notifyTeachers: false });
    }
    throw new AttendanceError('session_closed', 'คาบนี้ปิดการเช็คชื่อแล้ว หากมีเหตุจำเป็นกรุณาแจ้งผู้สอนเพื่อบันทึกแบบ Manual');
  }
  if (at.getTime() > Date.parse(challenge.expires_at) + TOKEN_GRACE_MS) {
    recordAttempt(session.id, userId, deviceHash, 'expired_token', extra);
    throw new AttendanceError('expired_token', 'QR หมดอายุแล้ว กรุณาสแกน QR ใหม่บนจอ');
  }
  if (!courseSvc.isEnrolled(session.course_id, userId)) {
    recordAttempt(session.id, userId, deviceHash, 'not_enrolled', extra);
    throw new AttendanceError('not_enrolled', 'บัญชีนี้ไม่ได้ลงทะเบียนในรายวิชานี้', 403);
  }
  if (!courseSvc.sessionVisibleTo(session, session.course_id, userId)) {
    recordAttempt(session.id, userId, deviceHash, 'wrong_section', extra);
    const mine = courseSvc.studentSectionCode(session.course_id, userId);
    throw new AttendanceError('wrong_section', `QR นี้เป็นของ${session.section_name || 'กลุ่มเรียนอื่น'} คุณอยู่กลุ่ม ${mine || '-'} — กรุณาเช็คชื่อในคาบของกลุ่มตนเอง`, 403);
  }

  const existing = db.prepare('SELECT * FROM attendance_records WHERE session_id = ? AND student_id = ?').get(session.id, userId);
  if (existing) {
    recordAttempt(session.id, userId, deviceHash, 'duplicate', extra);
    if (db.prepare('SELECT 1 FROM attendance_challenge_uses WHERE challenge_id = ? AND user_id = ?').get(challenge.id, userId)) {
      if (!hasRecentRisk(session.id, userId, 'token_reuse')) riskEvent(session.id, userId, 'token_reuse', 'low', { challengeId: challenge.id }, { notifyTeachers: false });
    }
    const err = new AttendanceError('duplicate', 'คุณเช็คชื่อคาบนี้แล้ว', 409);
    err.record = existing;
    throw err;
  }

  // เครือข่ายที่อนุญาต (เช่น Wi-Fi มหาวิทยาลัย)
  if (course.ip_allowlist && !ipAllowed(ipAddr, course.ip_allowlist)) {
    recordAttempt(session.id, userId, deviceHash, 'ip_not_allowed', extra);
    throw new AttendanceError('ip_not_allowed', `ต้องเชื่อมต่อเครือข่ายของมหาวิทยาลัย/ห้องเรียนก่อนเช็คชื่อ (IP ของคุณ: ${ipAddr || 'ไม่ทราบ'})`, 403);
  }

  // GPS: ต้องอยู่ในรัศมีห้องเรียน
  let distance = null;
  if (course.geo_enabled) {
    const center = geoCenter(session, course);
    if (center) {
      if (!position) {
        recordAttempt(session.id, userId, deviceHash, 'geo_missing', extra);
        throw new AttendanceError('geo_required', 'ต้องอนุญาตการเข้าถึงตำแหน่ง (Location) ของเบราว์เซอร์เพื่อเช็คชื่อ แล้วสแกนใหม่ หากใช้ไม่ได้ให้แจ้งผู้สอน');
      }
      const maxAcc = course.geo_max_accuracy_m || 150;
      if (position.accuracy !== null && position.accuracy > maxAcc) {
        recordAttempt(session.id, userId, deviceHash, 'geo_inaccurate', extra);
        throw new AttendanceError('geo_inaccurate', `ตำแหน่งไม่แม่นยำพอ (±${Math.round(position.accuracy)} ม.) กรุณาเปิด "ตำแหน่งที่แม่นยำ" แล้วลองใหม่`);
      }
      distance = Math.round(distanceM(center.lat, center.lng, position.lat, position.lng));
      const slack = Math.min(position.accuracy || 0, course.geo_radius_m || 150);
      if (distance - slack > (course.geo_radius_m || 150)) {
        recordAttempt(session.id, userId, deviceHash, 'geo_out_of_range', extra);
        if (!hasRecentRisk(session.id, userId, 'geo_out_of_range')) {
          riskEvent(session.id, userId, 'geo_out_of_range', 'medium', { distanceM: distance, accuracyM: position.accuracy, ip: ipAddr });
        }
        throw new AttendanceError('geo_out_of_range', `คุณอยู่นอกพื้นที่ห้องเรียน (ห่างประมาณ ${distance} ม.) หากอยู่ในห้องจริงให้แจ้งผู้สอน`, 403);
      }
    }
  }

  // 1 เครื่อง เช็คชื่อได้ 1 บัญชีต่อคาบ
  if (course.device_lock && (deviceHash || localHash)) {
    const used = db.prepare(`SELECT student_id FROM attendance_records WHERE session_id = ? AND student_id != ? AND checkin_method != 'manual'
      AND ((device_id_hash IS NOT NULL AND device_id_hash = ?) OR (local_device_hash IS NOT NULL AND local_device_hash = ?)) LIMIT 1`)
      .get(session.id, userId, deviceHash, localHash);
    if (used) {
      recordAttempt(session.id, userId, deviceHash, 'device_used', extra);
      riskEvent(session.id, userId, 'multi_account_device', 'high', { otherAccounts: [used.student_id], blocked: true, ip: ipAddr });
      throw new AttendanceError('device_used', 'อุปกรณ์นี้ถูกใช้เช็คชื่อในคาบนี้แล้ว (1 เครื่อง เช็คชื่อได้ 1 คนต่อคาบ) กรุณาใช้อุปกรณ์ของตนเอง หรือแจ้งผู้สอน', 403);
    }
  }

  const warnings = [];
  const status = computeStatus(session, course, at);
  const recordId = uuid();
  tx(() => {
    db.prepare(`INSERT INTO attendance_records (id, session_id, student_id, attendance_status, checkin_method, checkin_time, device_id_hash, updated_by, updated_at,
        ip_address, fingerprint_hash, local_device_hash, geo_lat, geo_lng, geo_accuracy_m, geo_distance_m)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(recordId, session.id, userId, status, token ? 'qr' : 'code', at.toISOString(), deviceHash, userId, at.toISOString(),
      ipAddr, fpHash, localHash, position ? position.lat : null, position ? position.lng : null, position ? position.accuracy : null, distance);
    db.prepare('INSERT INTO attendance_challenge_uses (id, challenge_id, user_id, used_at) VALUES (?,?,?,?)').run(uuid(), challenge.id, userId, at.toISOString());
    db.prepare('UPDATE attendance_challenges SET use_count = use_count + 1, used_at = COALESCE(used_at, ?) WHERE id = ?').run(at.toISOString(), challenge.id);
    recordAttempt(session.id, userId, deviceHash, 'success', extra);
  });

  // Device Anomaly Detection (สร้าง Risk Event เท่านั้น ไม่ปฏิเสธ/ไม่หักคะแนน)
  if (deviceHash) {
    const others = db.prepare(`SELECT DISTINCT student_id FROM attendance_records WHERE session_id = ? AND device_id_hash = ? AND student_id != ?`)
      .all(session.id, deviceHash, userId).map((r) => r.student_id);
    if (others.length) {
      riskEvent(session.id, userId, 'multi_account_device', 'high', { otherAccounts: others, ip: ipAddr });
      warnings.push('ระบบพบว่าอุปกรณ์นี้ถูกใช้เช็คชื่อหลายบัญชี ผู้สอนจะตรวจสอบเพิ่มเติม');
    }
    const activeDevices = db.prepare(`SELECT COUNT(DISTINCT device_id) c FROM device_sessions WHERE user_id = ? AND ended_at IS NULL AND started_at >= ?`)
      .get(userId, new Date(at.getTime() - 12 * 3600 * 1000).toISOString()).c;
    if (activeDevices > 1) {
      riskEvent(session.id, userId, 'multi_device_account', 'medium', { activeDevices });
      warnings.push('บัญชีนี้เข้าสู่ระบบอยู่หลายอุปกรณ์ กรุณายืนยันตัวตนกับผู้สอนหากได้รับการร้องขอ');
    }
    if (course.device_binding) {
      const bound = db.prepare("SELECT * FROM trusted_devices WHERE user_id = ? AND status = 'active'").all(userId);
      if (!bound.length) {
        db.prepare('INSERT INTO trusted_devices (id, user_id, device_fingerprint_hash, device_label, registered_at) VALUES (?,?,?,?,?)')
          .run(uuid(), userId, deviceHash, 'ลงทะเบียนอัตโนมัติจากการเช็คชื่อครั้งแรก', at.toISOString());
      } else if (!bound.some((b) => b.device_fingerprint_hash === deviceHash)) {
        riskEvent(session.id, userId, 'device_changed', 'medium', {});
        warnings.push('อุปกรณ์นี้ไม่ใช่อุปกรณ์หลักที่ลงทะเบียนไว้ หากเปลี่ยนเครื่องให้ยื่นคำขอเปลี่ยนอุปกรณ์');
      }
    }
  }

  // ลายนิ้วมือเบราว์เซอร์ซ้ำกับคนอื่น (อาจเป็นมือถือรุ่นเดียวกัน จึงแจ้งเตือนเท่านั้น ไม่ปฏิเสธ)
  if (fpHash) {
    const same = db.prepare(`SELECT student_id FROM attendance_records WHERE session_id = ? AND student_id != ? AND fingerprint_hash = ?
      AND (device_id_hash IS NOT ? OR device_id_hash IS NULL)`).all(session.id, userId, fpHash, deviceHash).map((r) => r.student_id);
    if (same.length && !hasRecentRisk(session.id, userId, 'same_fingerprint')) {
      riskEvent(session.id, userId, 'same_fingerprint', 'low', { otherAccounts: same, ip: ipAddr }, { notifyTeachers: false });
    }
  }

  const record = db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(recordId);
  return { status, record, session, warnings };
}

/** สุ่มรหัสยืนยันในห้องเรียน (Random In-class Verification) */
function issueVerifyCode(sessionId, actorId, minutes = 2) {
  const code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  const expires = new Date(Date.now() + minutes * 60000).toISOString();
  get().prepare('UPDATE course_sessions SET verify_code_hash = ?, verify_code_expires_at = ? WHERE id = ?').run(sha256(`verify:${sessionId}:${code}`), expires, sessionId);
  audit.log(actorId, 'attendance.verify_code', 'course_session', sessionId, { expires });
  return { code, expiresAt: expires };
}

function verifyPresence(sessionId, userId, code) {
  const s = courseSvc.getSession(sessionId);
  if (!s || !s.verify_code_hash || !s.verify_code_expires_at || s.verify_code_expires_at < now()) {
    throw new AttendanceError('no_code', 'ขณะนี้ไม่มีรหัสยืนยันที่เปิดใช้งาน');
  }
  const rec = get().prepare('SELECT * FROM attendance_records WHERE session_id = ? AND student_id = ?').get(sessionId, userId);
  if (!rec) throw new AttendanceError('no_record', 'กรุณาเช็คชื่อด้วย QR ก่อนยืนยันรหัส');
  if (sha256(`verify:${sessionId}:${String(code).trim()}`) !== s.verify_code_hash) {
    recordAttempt(sessionId, userId, null, 'verify_failed');
    throw new AttendanceError('wrong_code', 'รหัสยืนยันไม่ถูกต้อง');
  }
  get().prepare('UPDATE attendance_records SET verified_at = ? WHERE id = ?').run(now(), rec.id);
  return true;
}

const VALID = ['present', 'late', 'absent', 'leave'];

/** Manual Attendance / Manual Exception — ผู้สอนบันทึกหรือแก้ไขพร้อมเหตุผล */
function manualSet({ sessionId, studentId, status, reason, actorId }) {
  if (!VALID.includes(status)) throw new AttendanceError('invalid_status', 'สถานะไม่ถูกต้อง');
  const { session } = sessionWithCourse(sessionId);
  if (!courseSvc.isEnrolled(session.course_id, studentId)) throw new AttendanceError('not_enrolled', 'นักศึกษาไม่ได้อยู่ในรายวิชา');
  if (!courseSvc.sessionVisibleTo(session, session.course_id, studentId)) throw new AttendanceError('wrong_section', 'นักศึกษาไม่ได้อยู่ในกลุ่มเรียนของคาบนี้');
  const db = get();
  const existing = db.prepare('SELECT * FROM attendance_records WHERE session_id = ? AND student_id = ?').get(sessionId, studentId);
  const cleanReason = (reason || '').trim();
  if (existing && existing.attendance_status === status) return existing;
  if (existing && !cleanReason) throw new AttendanceError('reason_required', 'กรุณาระบุเหตุผลในการแก้ไขสถานะการเข้าเรียน');
  if (!existing && session.attendance_state === 'closed' && !cleanReason) {
    throw new AttendanceError('reason_required', 'Session ปิดแล้ว การบันทึกย้อนหลังต้องระบุเหตุผล');
  }
  const ts = now();
  if (existing) {
    db.prepare('UPDATE attendance_records SET attendance_status = ?, note = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(status, cleanReason || existing.note, actorId, ts, existing.id);
  } else {
    db.prepare(`INSERT INTO attendance_records (id, session_id, student_id, attendance_status, checkin_method, checkin_time, note, updated_by, updated_at)
      VALUES (?,?,?,?, 'manual', ?, ?, ?, ?)`).run(uuid(), sessionId, studentId, status, ['present', 'late'].includes(status) ? ts : null, cleanReason || null, actorId, ts);
  }
  audit.log(actorId, existing ? 'attendance.update' : 'attendance.manual', 'attendance_record', `${sessionId}:${studentId}`, {
    sessionId, studentId, old: existing ? existing.attendance_status : null, new: status, reason: cleanReason || null,
  });
  return db.prepare('SELECT * FROM attendance_records WHERE session_id = ? AND student_id = ?').get(sessionId, studentId);
}

function roster(sessionId) {
  const { session } = sessionWithCourse(sessionId);
  const recs = get().prepare('SELECT * FROM attendance_records WHERE session_id = ?').all(sessionId);
  const byStudent = Object.fromEntries(recs.map((r) => [r.student_id, r]));
  const risks = get().prepare("SELECT user_id, COUNT(*) c FROM attendance_risk_events WHERE session_id = ? AND review_status = 'pending' GROUP BY user_id").all(sessionId);
  const riskBy = Object.fromEntries(risks.map((r) => [r.user_id, r.c]));
  return courseSvc.students(session.course_id, { section: courseSvc.sessionSectionCode(session) }).map((s) => ({ ...s, record: byStudent[s.id] || null, pendingRisks: riskBy[s.id] || 0 }));
}

function summary(sessionId) {
  const rows = roster(sessionId);
  const out = { total: rows.length, present: 0, late: 0, absent: 0, leave: 0, none: 0, verified: 0 };
  for (const r of rows) {
    out[r.record ? r.record.attendance_status : 'none'] += 1;
    if (r.record && r.record.verified_at) out.verified += 1;
  }
  return out;
}

function studentHistory(courseId, studentId) {
  const sec = courseSvc.sectionByCode(courseId, courseSvc.studentSectionCode(courseId, studentId) || '');
  return get().prepare(`SELECT s.id AS session_id, s.week_number, s.title, s.session_date, s.status AS session_status, s.attendance_state,
      a.attendance_status, a.checkin_method, a.checkin_time, a.verified_at, a.note, a.ip_address, a.geo_distance_m
    FROM course_sessions s LEFT JOIN attendance_records a ON a.session_id = s.id AND a.student_id = ?
    WHERE s.course_id = ? AND s.status != 'cancelled' AND (s.section_id IS NULL OR s.section_id IS ? OR a.id IS NOT NULL)
    ORDER BY s.week_number, s.session_date`).all(studentId, courseId, sec ? sec.id : null);
}

function riskEvents({ sessionId, status } = {}) {
  const where = [];
  const args = [];
  if (sessionId) { where.push('e.session_id = ?'); args.push(sessionId); }
  if (status) { where.push('e.review_status = ?'); args.push(status); }
  return get().prepare(`SELECT e.*, u.full_name, u.student_code, s.week_number, s.title AS session_title, rv.full_name AS reviewer_name
    FROM attendance_risk_events e JOIN users u ON u.id = e.user_id LEFT JOIN course_sessions s ON s.id = e.session_id
    LEFT JOIN users rv ON rv.id = e.reviewed_by
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.created_at DESC LIMIT 500`).all(...args)
    .map((r) => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : {} }));
}

function reviewRisk(eventId, { decision, note, actorId }) {
  if (!['dismissed', 'confirmed'].includes(decision)) throw new AttendanceError('invalid', 'ผลการตรวจสอบไม่ถูกต้อง');
  if (!note || !note.trim()) throw new AttendanceError('reason_required', 'กรุณาระบุเหตุผลประกอบผลการตรวจสอบ');
  const ev = get().prepare('SELECT * FROM attendance_risk_events WHERE id = ?').get(eventId);
  if (!ev) throw new AttendanceError('not_found', 'ไม่พบเหตุการณ์', 404);
  get().prepare('UPDATE attendance_risk_events SET review_status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?')
    .run(decision, note.trim(), actorId, now(), eventId);
  audit.log(actorId, 'risk.review', 'attendance_risk_event', eventId, { decision, note: note.trim(), old: ev.review_status });
}

function createAppeal({ studentId, sessionId, type = 'attendance', riskEventId, message }) {
  if (!message || !message.trim()) throw new AttendanceError('message_required', 'กรุณาระบุรายละเอียดคำร้อง');
  const id = uuid();
  get().prepare(`INSERT INTO attendance_appeals (id, session_id, student_id, appeal_type, risk_event_id, message, created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(id, sessionId || null, studentId, type, riskEventId || null, message.trim().slice(0, 2000), now());
  const course = courseSvc.getCourse();
  notify.sendMany(courseSvc.teacherIds(course.id), {
    eventType: 'appeal', title: 'มีคำร้องเรื่องการเช็คชื่อ/อุปกรณ์', link: '/teacher/risk#appeals', entityType: 'attendance_appeal', entityId: id, dedupeKey: `appeal:${id}`,
  });
  return id;
}

function appeals({ studentId, status } = {}) {
  const where = [];
  const args = [];
  if (studentId) { where.push('a.student_id = ?'); args.push(studentId); }
  if (status) { where.push('a.status = ?'); args.push(status); }
  return get().prepare(`SELECT a.*, u.full_name, u.student_code, s.week_number, s.title AS session_title
    FROM attendance_appeals a JOIN users u ON u.id = a.student_id LEFT JOIN course_sessions s ON s.id = a.session_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.created_at DESC`).all(...args);
}

function reviewAppeal(appealId, { decision, response, actorId, attendanceStatus }) {
  const ap = get().prepare('SELECT * FROM attendance_appeals WHERE id = ?').get(appealId);
  if (!ap) throw new AttendanceError('not_found', 'ไม่พบคำร้อง', 404);
  if (!['approved', 'rejected'].includes(decision)) throw new AttendanceError('invalid', 'ผลการพิจารณาไม่ถูกต้อง');
  if (!response || !response.trim()) throw new AttendanceError('reason_required', 'กรุณาระบุเหตุผลการพิจารณา');
  tx(() => {
    get().prepare('UPDATE attendance_appeals SET status = ?, response = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?')
      .run(decision, response.trim(), actorId, now(), appealId);
    if (decision === 'approved') {
      if (ap.appeal_type === 'device_change') revokeDevices(ap.student_id, actorId, `อนุมัติคำร้องเปลี่ยนอุปกรณ์: ${response.trim()}`);
      if (ap.appeal_type === 'attendance' && ap.session_id && attendanceStatus) {
        manualSet({ sessionId: ap.session_id, studentId: ap.student_id, status: attendanceStatus, reason: `อนุมัติคำร้อง: ${response.trim()}`, actorId });
      }
      if (ap.risk_event_id) {
        get().prepare("UPDATE attendance_risk_events SET review_status = 'dismissed', review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?")
          .run(`อุทธรณ์สำเร็จ: ${response.trim()}`, actorId, now(), ap.risk_event_id);
      }
    }
  });
  audit.log(actorId, 'appeal.review', 'attendance_appeal', appealId, { decision, response: response.trim() });
  notify.send(ap.student_id, {
    eventType: 'appeal', title: decision === 'approved' ? 'คำร้องของคุณได้รับการอนุมัติ' : 'คำร้องของคุณไม่ได้รับการอนุมัติ',
    message: response.trim(), link: '/student/attendance', entityType: 'attendance_appeal', entityId: appealId, dedupeKey: `appeal-result:${appealId}`,
  });
}

/** ยกเลิกอุปกรณ์เดิม (TC-20) — นักศึกษาจะลงทะเบียนอุปกรณ์ใหม่อัตโนมัติเมื่อเช็คชื่อครั้งถัดไป */
function revokeDevices(userId, actorId, reason) {
  get().prepare("UPDATE trusted_devices SET status = 'revoked', revoked_at = ?, revoked_by = ?, revoke_reason = ? WHERE user_id = ? AND status = 'active'")
    .run(now(), actorId, reason || null, userId);
  audit.log(actorId, 'device.revoke', 'user', userId, { reason });
}

function devices(userId) {
  return get().prepare('SELECT * FROM trusted_devices WHERE user_id = ? ORDER BY registered_at DESC').all(userId);
}

/** ลบข้อมูลที่หมดความจำเป็นตามระยะเวลาเก็บรักษา (Privacy by Design) */
/** ตั้งจุดศูนย์กลางห้องเรียน (จากตำแหน่งเครื่องผู้สอน) */
function setSessionGeo(sessionId, geo, actorId, { asDefault = false } = {}) {
  const p = cleanGeo(geo);
  if (!p) throw new AttendanceError('invalid_geo', 'พิกัดไม่ถูกต้อง');
  get().prepare('UPDATE course_sessions SET geo_lat = ?, geo_lng = ? WHERE id = ?').run(p.lat, p.lng, sessionId);
  if (asDefault) {
    const s = courseSvc.getSession(sessionId);
    get().prepare('UPDATE courses SET geo_lat = ?, geo_lng = ? WHERE id = ?').run(p.lat, p.lng, s.course_id);
  }
  audit.log(actorId, 'attendance.geo_center', 'course_session', sessionId, { lat: p.lat, lng: p.lng, accuracy: p.accuracy, asDefault });
  return p;
}

function purgeOld(retentionDays = 180) {
  // ลบพิกัด GPS ดิบหลัง 30 วัน (เก็บไว้เฉพาะระยะห่างจากห้องเรียน)
  get().prepare('UPDATE attendance_records SET geo_lat = NULL, geo_lng = NULL WHERE geo_lat IS NOT NULL AND checkin_time < ?').run(new Date(Date.now() - 30 * 86400000).toISOString());
  const attemptsCut = new Date(Date.now() - 30 * 86400000).toISOString();
  const riskCut = new Date(Date.now() - retentionDays * 86400000).toISOString();
  get().prepare('DELETE FROM attendance_attempts WHERE created_at < ?').run(attemptsCut);
  get().prepare("DELETE FROM attendance_risk_events WHERE created_at < ? AND review_status != 'pending' AND id NOT IN (SELECT risk_event_id FROM attendance_appeals WHERE risk_event_id IS NOT NULL)").run(riskCut);
  get().prepare("DELETE FROM attendance_challenge_uses WHERE used_at < ?").run(attemptsCut);
}

module.exports = {
  AttendanceError, openAttendance, closeAttendance, currentChallenge, checkIn, issueVerifyCode, verifyPresence,
  manualSet, roster, summary, studentHistory, riskEvents, reviewRisk, createAppeal, appeals, reviewAppeal,
  revokeDevices, devices, purgeOld, computeStatus, setSessionGeo, distanceM, ipAllowed, parseAllowlist, normalizeIp, geoCenter, _live: liveChallenges,
};
