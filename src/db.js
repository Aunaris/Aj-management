'use strict';
/**
 * Data layer. ใช้ SQLite (better-sqlite3) เพื่อให้ติดตั้งและใช้งานได้ทันทีในเครื่องเดียว
 * โครงสร้างตารางยึดตาม Blueprint หมวด 7 (Database Schema) โดยใช้ UUID เป็น Primary Key
 * จึงย้ายไป PostgreSQL ได้ภายหลังโดยไม่ต้องเปลี่ยนโครงสร้างข้อมูล
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
// ใช้ better-sqlite3 ถ้ามี (เซิร์ฟเวอร์) ไม่เช่นนั้นใช้ node:sqlite ที่มากับ Node.js (โปรแกรมสำหรับ PC)
// บังคับเลือกได้ด้วย DB_DRIVER=node หรือ DB_DRIVER=better
function loadDriver() {
  if (process.env.DB_DRIVER !== 'node') {
    try { return require('better-sqlite3'); } catch (e) { if (process.env.DB_DRIVER === 'better') throw e; }
  }
  return require('./sqlite-node');
}
const Database = loadDriver();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  role_name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  student_code TEXT UNIQUE,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT,
  password_hash TEXT NOT NULL,
  role_id TEXT NOT NULL REFERENCES roles(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  session_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  device_id_hash TEXT,
  user_agent TEXT,
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  course_code TEXT NOT NULL,
  course_name TEXT NOT NULL,
  course_name_en TEXT,
  semester TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  credit TEXT NOT NULL,
  program TEXT,
  faculty TEXT,
  description_th TEXT,
  description_en TEXT,
  instructors TEXT,
  contact TEXT,
  total_score REAL NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup','active','closed')),
  structure_confirmed_at TEXT,
  structure_confirmed_by TEXT,
  qr_ttl_seconds INTEGER NOT NULL DEFAULT 45,
  late_after_minutes INTEGER NOT NULL DEFAULT 15,
  device_binding INTEGER NOT NULL DEFAULT 0,
  clo_visible_to_students INTEGER NOT NULL DEFAULT 0,
  reminder_hours TEXT NOT NULL DEFAULT '24,1',
  scores_locked_at TEXT,
  scores_locked_by TEXT,
  risk_retention_days INTEGER NOT NULL DEFAULT 180
);

CREATE TABLE IF NOT EXISTS course_enrollments (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  enrollment_status TEXT NOT NULL DEFAULT 'active' CHECK (enrollment_status IN ('active','withdrawn')),
  section TEXT,
  UNIQUE (course_id, user_id)
);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  title TEXT NOT NULL,
  body TEXT,
  mandatory INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS course_documents (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  title TEXT NOT NULL,
  external_url TEXT,
  file_storage_key TEXT,
  file_name TEXT,
  mime_type TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS course_sessions (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  week_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  session_date TEXT,
  start_time TEXT,
  end_time TEXT,
  location TEXT,
  instructor TEXT,
  hours REAL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','completed','cancelled')),
  attendance_state TEXT NOT NULL DEFAULT 'not_started' CHECK (attendance_state IN ('not_started','open','closed')),
  attendance_opened_at TEXT,
  attendance_closed_at TEXT,
  verify_code_hash TEXT,
  verify_code_expires_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_lesson_details (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES course_sessions(id),
  objectives TEXT,
  topics TEXT,
  theory_activities TEXT,
  practical_activities TEXT,
  teaching_method TEXT,
  clo_codes TEXT,
  post_class_notes TEXT,
  issues TEXT,
  next_session_notes TEXT
);

CREATE TABLE IF NOT EXISTS session_materials (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES course_sessions(id),
  title TEXT NOT NULL,
  material_type TEXT NOT NULL DEFAULT 'link',
  file_storage_key TEXT,
  file_name TEXT,
  mime_type TEXT,
  external_url TEXT,
  visibility TEXT NOT NULL DEFAULT 'students' CHECK (visibility IN ('students','teachers')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES course_sessions(id),
  student_id TEXT NOT NULL REFERENCES users(id),
  attendance_status TEXT NOT NULL CHECK (attendance_status IN ('present','late','absent','leave')),
  checkin_method TEXT NOT NULL CHECK (checkin_method IN ('qr','code','manual')),
  checkin_time TEXT,
  device_id_hash TEXT,
  verified_at TEXT,
  note TEXT,
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL,
  UNIQUE (session_id, student_id)
);

CREATE TABLE IF NOT EXISTS attendance_challenges (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES course_sessions(id),
  token_hash TEXT NOT NULL UNIQUE,
  short_code_hash TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked'))
);

CREATE TABLE IF NOT EXISTS attendance_challenge_uses (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES attendance_challenges(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  used_at TEXT NOT NULL,
  UNIQUE (challenge_id, user_id)
);

CREATE TABLE IF NOT EXISTS attendance_attempts (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  user_id TEXT NOT NULL,
  device_id_hash TEXT,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trusted_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  device_fingerprint_hash TEXT NOT NULL,
  device_label TEXT,
  registered_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT,
  revoke_reason TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked'))
);

CREATE TABLE IF NOT EXISTS device_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL,
  session_hash TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS attendance_risk_events (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES course_sessions(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low','medium','high')),
  metadata TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','dismissed','confirmed')),
  review_note TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance_appeals (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES course_sessions(id),
  student_id TEXT NOT NULL REFERENCES users(id),
  appeal_type TEXT NOT NULL DEFAULT 'attendance' CHECK (appeal_type IN ('attendance','device_change','risk_event')),
  risk_event_id TEXT REFERENCES attendance_risk_events(id),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  response TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clo_outcomes (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  clo_code TEXT NOT NULL,
  description TEXT NOT NULL,
  plo_mapping TEXT,
  passing_criteria REAL,
  UNIQUE (course_id, clo_code)
);

CREATE TABLE IF NOT EXISTS assessment_categories (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  code TEXT NOT NULL,
  category_name TEXT NOT NULL,
  group_name TEXT,
  max_score REAL NOT NULL CHECK (max_score >= 0),
  clo_reference TEXT,
  rubric_hint TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (course_id, code)
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  category_id TEXT NOT NULL REFERENCES assessment_categories(id),
  session_id TEXT REFERENCES course_sessions(id),
  assignment_code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  instructions TEXT,
  template TEXT,
  week_number INTEGER,
  open_at TEXT,
  due_date TEXT,
  max_score REAL NOT NULL CHECK (max_score > 0),
  submission_mode TEXT NOT NULL DEFAULT 'online' CHECK (submission_mode IN ('online','in_class')),
  allowed_types TEXT NOT NULL DEFAULT 'jpg,jpeg,png,gif,mp4,mov,pdf,zip',
  max_file_mb INTEGER NOT NULL DEFAULT 200,
  allow_links INTEGER NOT NULL DEFAULT 1,
  allowed_domains TEXT,
  allow_resubmit INTEGER NOT NULL DEFAULT 1,
  max_versions INTEGER NOT NULL DEFAULT 5,
  late_policy TEXT NOT NULL DEFAULT 'accept_mark' CHECK (late_policy IN ('accept_mark','reject')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed')),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (course_id, assignment_code)
);

CREATE TABLE IF NOT EXISTS assignment_clo_maps (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id),
  clo_id TEXT NOT NULL REFERENCES clo_outcomes(id),
  contribution_weight REAL NOT NULL CHECK (contribution_weight > 0 AND contribution_weight <= 1),
  UNIQUE (assignment_id, clo_id)
);

CREATE TABLE IF NOT EXISTS rubrics (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL UNIQUE REFERENCES assignments(id),
  rubric_name TEXT NOT NULL,
  max_score REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS rubric_criteria (
  id TEXT PRIMARY KEY,
  rubric_id TEXT NOT NULL REFERENCES rubrics(id),
  criterion_name TEXT NOT NULL,
  description TEXT,
  max_score REAL NOT NULL CHECK (max_score > 0),
  weight REAL NOT NULL CHECK (weight > 0),
  levels TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id),
  student_id TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL,
  submitted_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','submitted','late','resubmitted','under_review','reviewed','revision_requested')),
  is_late INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  UNIQUE (assignment_id, student_id, version)
);

CREATE TABLE IF NOT EXISTS submission_files (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  file_name TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  sha256 TEXT
);

CREATE TABLE IF NOT EXISTS submission_links (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  validation_status TEXT NOT NULL DEFAULT 'unchecked' CHECK (validation_status IN ('unchecked','accessible','permission_required','invalid_url')),
  checked_at TEXT,
  checked_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS grading_records (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id),
  student_id TEXT NOT NULL REFERENCES users(id),
  submission_id TEXT REFERENCES submissions(id),
  grader_id TEXT REFERENCES users(id),
  total_score REAL,
  feedback TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','revision_requested','locked')),
  graded_at TEXT,
  published_at TEXT,
  UNIQUE (assignment_id, student_id)
);

CREATE TABLE IF NOT EXISTS rubric_scores (
  id TEXT PRIMARY KEY,
  grading_record_id TEXT NOT NULL REFERENCES grading_records(id),
  criterion_id TEXT NOT NULL REFERENCES rubric_criteria(id),
  score REAL NOT NULL,
  comment TEXT,
  UNIQUE (grading_record_id, criterion_id)
);

CREATE TABLE IF NOT EXISTS feedbacks (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id),
  student_id TEXT NOT NULL REFERENCES users(id),
  submission_id TEXT REFERENCES submissions(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS score_adjustments (
  id TEXT PRIMARY KEY,
  grading_record_id TEXT NOT NULL REFERENCES grading_records(id),
  old_score REAL,
  new_score REAL,
  old_status TEXT,
  new_status TEXT,
  reason TEXT,
  changed_by TEXT NOT NULL REFERENCES users(id),
  changed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  link TEXT,
  related_entity_type TEXT,
  related_entity_id TEXT,
  dedupe_key TEXT,
  mandatory INTEGER NOT NULL DEFAULT 0,
  read_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (recipient_id, dedupe_key)
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'in_app',
  enabled INTEGER NOT NULL DEFAULT 1,
  lead_time_minutes INTEGER,
  UNIQUE (user_id, event_type, channel)
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications(id),
  channel TEXT NOT NULL,
  delivery_status TEXT NOT NULL,
  sent_at TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS course_sections (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  section_code TEXT NOT NULL,
  name TEXT,
  meeting_day INTEGER,
  first_date TEXT,
  start_time TEXT,
  end_time TEXT,
  location TEXT,
  instructor TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (course_id, section_code)
);

CREATE TABLE IF NOT EXISTS mail_accounts (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL UNIQUE REFERENCES courses(id),
  imap_host TEXT NOT NULL,
  imap_port INTEGER NOT NULL DEFAULT 993,
  imap_secure INTEGER NOT NULL DEFAULT 1,
  username TEXT NOT NULL,
  password_enc TEXT,
  mailbox TEXT NOT NULL DEFAULT 'INBOX',
  days_back INTEGER NOT NULL DEFAULT 14,
  poll_minutes INTEGER NOT NULL DEFAULT 5,
  enabled INTEGER NOT NULL DEFAULT 0,
  uid_validity TEXT,
  last_uid INTEGER,
  last_checked_at TEXT,
  last_error TEXT,
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inbound_emails (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  message_id TEXT NOT NULL UNIQUE,
  imap_uid INTEGER,
  from_address TEXT,
  from_name TEXT,
  subject TEXT,
  body_text TEXT,
  received_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('imported','unmatched','error','ignored')),
  student_id TEXT REFERENCES users(id),
  assignment_id TEXT REFERENCES assignments(id),
  submission_id TEXT REFERENCES submissions(id),
  note TEXT,
  handled_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inbound_email_attachments (
  id TEXT PRIMARY KEY,
  email_id TEXT NOT NULL REFERENCES inbound_emails(id),
  file_name TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_att_session ON attendance_records(session_id);
CREATE INDEX IF NOT EXISTS idx_chal_session ON attendance_challenges(session_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attendance_attempts(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attempts_device ON attendance_attempts(device_id_hash, session_id);
CREATE INDEX IF NOT EXISTS idx_sub_assign ON submissions(assignment_id, student_id);
CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notifications(recipient_id, read_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
`;

// คอลัมน์ที่เพิ่มภายหลัง — เพิ่มให้ฐานข้อมูลเดิมอัตโนมัติ
const COLUMNS = {
  courses: {
    geo_enabled: 'INTEGER NOT NULL DEFAULT 0', geo_lat: 'REAL', geo_lng: 'REAL', geo_radius_m: 'INTEGER NOT NULL DEFAULT 150',
    geo_max_accuracy_m: 'INTEGER NOT NULL DEFAULT 150', device_lock: 'INTEGER NOT NULL DEFAULT 1', ip_allowlist: 'TEXT', term_start_date: 'TEXT', checkin_mode: "TEXT NOT NULL DEFAULT 'student_code'",
  },
  course_sessions: { geo_lat: 'REAL', geo_lng: 'REAL', section_id: 'TEXT REFERENCES course_sections(id)' },
  users: { program: 'TEXT', faculty: 'TEXT' },
  attendance_records: {
    ip_address: 'TEXT', fingerprint_hash: 'TEXT', local_device_hash: 'TEXT', geo_lat: 'REAL', geo_lng: 'REAL', geo_accuracy_m: 'REAL', geo_distance_m: 'REAL',
  },
  attendance_attempts: { ip_address: 'TEXT', fingerprint_hash: 'TEXT' },
  submissions: { source: "TEXT NOT NULL DEFAULT 'web'" },
};

function migrate(conn) {
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const have = new Set(conn.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [name, def] of Object.entries(cols)) {
      if (!have.has(name)) conn.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
    }
  }
}

let db = null;

function open(file) {
  const target = file || process.env.DB_FILE || path.join(__dirname, '..', 'data', 'classroom.db');
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true });
  const conn = new Database(target);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  conn.exec(SCHEMA);
  migrate(conn);
  db = conn;
  return conn;
}

function get() {
  if (!db) open();
  return db;
}

function close() {
  if (db) db.close();
  db = null;
}

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

/** Run fn inside a transaction (better-sqlite3 transactions are synchronous). */
function tx(fn) {
  return get().transaction(fn)();
}

module.exports = { open, get, close, uuid, now, tx };
