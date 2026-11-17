'use strict';
/** FR-04 Submission Management + FR-04.1 Document & Link Submission */
const { get, uuid, now, tx } = require('../db');
const audit = require('./audit');
const notify = require('./notify');
const storage = require('./storage');
const filesSvc = require('./files');
const courseSvc = require('./course');
const assignSvc = require('./assignments');
const { ValidationError } = assignSvc;

const MAX_FILES = 20;
const MAX_LINKS = 10;

function validateUrl(raw, allowedDomains) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return { error: `URL ไม่ถูกต้อง: ${raw}` }; }
  if (!['http:', 'https:'].includes(u.protocol)) return { error: `URL ต้องขึ้นต้นด้วย http:// หรือ https:// (${raw})` };
  if (u.username || u.password) return { error: 'ห้ามใส่ชื่อผู้ใช้/รหัสผ่านใน URL' };
  if (allowedDomains) {
    const list = allowedDomains.split(/[\s,]+/).map((d) => d.toLowerCase().replace(/^\*\./, '')).filter(Boolean);
    const host = u.hostname.toLowerCase();
    if (list.length && !list.some((d) => host === d || host.endsWith(`.${d}`))) {
      return { error: `โดเมน ${host} ไม่อยู่ในรายการที่อนุญาต (${list.join(', ')})` };
    }
  }
  return { url: u.toString() };
}

function latest(assignmentId, studentId) {
  return get().prepare('SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ? ORDER BY version DESC LIMIT 1').get(assignmentId, studentId);
}

function fixName(name) {
  // busboy อาจถอดรหัสชื่อไฟล์เป็น latin1 — แปลงกลับเป็น UTF-8 (รองรับชื่อไฟล์ภาษาไทย)
  const n = String(name || '');
  if (/[\u0080-ÿ]/.test(n) && !/[฀-๿]/.test(n)) {
    const converted = Buffer.from(n, 'latin1').toString('utf8');
    if (!converted.includes('�')) return converted;
  }
  return n;
}

/**
 * @param {{assignmentId, studentId, files: Array<{originalname, buffer, size}>, links: Array<{url,title,description}>, note, at}} p
 */
function submit({ assignmentId, studentId, files = [], links = [], note, at = new Date(), source = 'web' }) {
  const a = assignSvc.getAssignment(assignmentId);
  if (!a) throw new ValidationError('ไม่พบงาน');
  if (!courseSvc.isEnrolled(a.course_id, studentId)) throw new ValidationError('คุณไม่ได้ลงทะเบียนในรายวิชานี้');
  const errors = [];
  if (a.status !== 'published') errors.push(a.status === 'closed' ? 'งานนี้ปิดรับแล้ว' : 'งานนี้ยังไม่เปิดรับ');
  if (a.submission_mode !== 'online') errors.push('งานนี้ให้คะแนนในชั้นเรียน ไม่ต้องส่งผ่านระบบ');
  if (a.open_at && Date.parse(a.open_at) > at.getTime()) errors.push('ยังไม่ถึงเวลาเปิดรับงาน');
  const isLate = !!(a.due_date && Date.parse(a.due_date) < at.getTime());
  if (isLate && a.late_policy === 'reject') errors.push('เลยกำหนดส่งแล้ว งานนี้ไม่รับงานล่าช้า');

  const prev = latest(assignmentId, studentId);
  const grade = get().prepare('SELECT * FROM grading_records WHERE assignment_id = ? AND student_id = ?').get(assignmentId, studentId);
  if (prev) {
    const revision = (grade && grade.status === 'revision_requested') || prev.status === 'revision_requested';
    if (!a.allow_resubmit && !revision) errors.push('งานนี้ไม่อนุญาตให้ส่งซ้ำ');
    if (prev.version >= a.max_versions && !revision) errors.push(`ส่งได้สูงสุด ${a.max_versions} ครั้ง`);
    if (grade && ['published', 'locked'].includes(grade.status) && !revision) errors.push('งานนี้ได้รับการตรวจและเผยแพร่คะแนนแล้ว');
  }

  const allowed = a.allowed_types ? a.allowed_types.split(',') : [];
  if (files.length > MAX_FILES) errors.push(`แนบไฟล์ได้ไม่เกิน ${MAX_FILES} ไฟล์`);
  const cleanFiles = files.map((f) => ({ ...f, originalname: filesSvc.sanitizeName(fixName(f.originalname)) }));
  for (const f of cleanFiles) {
    const err = filesSvc.validate(f, allowed, a.max_file_mb);
    if (err) errors.push(err);
  }
  const cleanLinks = [];
  const rawLinks = links.filter((l) => l && String(l.url || '').trim());
  if (rawLinks.length && !a.allow_links) errors.push('งานนี้ไม่อนุญาตให้แนบ URL');
  if (rawLinks.length > MAX_LINKS) errors.push(`แนบ URL ได้ไม่เกิน ${MAX_LINKS} รายการ`);
  for (const l of rawLinks) {
    const v = validateUrl(l.url, a.allowed_domains);
    if (v.error) errors.push(v.error);
    else cleanLinks.push({ url: v.url, title: String(l.title || '').trim().slice(0, 200), description: String(l.description || '').trim().slice(0, 1000) });
  }
  if (!cleanFiles.length && !cleanLinks.length) errors.push('กรุณาแนบไฟล์หรือ URL อย่างน้อย 1 รายการ');
  if (errors.length) throw new ValidationError(errors);

  const version = prev ? prev.version + 1 : 1;
  const status = prev ? 'resubmitted' : isLate ? 'late' : 'submitted';
  const id = uuid();
  const stored = cleanFiles.map((f) => ({ f, s: storage.put(f.buffer, `submissions/${assignmentId}`), info: filesSvc.info(f.originalname) }));
  tx(() => {
    get().prepare('INSERT INTO submissions (id, assignment_id, student_id, version, submitted_at, status, is_late, note, source) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, assignmentId, studentId, version, at.toISOString(), status, isLate ? 1 : 0, String(note || '').trim().slice(0, 2000) || null, source === 'email' ? 'email' : 'web');
    for (const { f, s, info } of stored) {
      get().prepare('INSERT INTO submission_files (id, submission_id, file_name, storage_key, mime_type, file_size, sha256) VALUES (?,?,?,?,?,?,?)')
        .run(uuid(), id, f.originalname, s.key, info.mime, f.size, s.sha256);
    }
    for (const l of cleanLinks) {
      get().prepare('INSERT INTO submission_links (id, submission_id, url, title, description) VALUES (?,?,?,?,?)').run(uuid(), id, l.url, l.title || null, l.description || null);
    }
    if (grade) get().prepare('UPDATE grading_records SET submission_id = ? WHERE id = ?').run(id, grade.id);
  });
  audit.log(studentId, 'submission.create', 'submission', id, { assignmentId, version, files: cleanFiles.length, links: cleanLinks.length, isLate, source });

  const student = get().prepare('SELECT full_name, student_code FROM users WHERE id = ?').get(studentId);
  const teacherIds = courseSvc.teacherIds(a.course_id);
  notify.sendMany(teacherIds, {
    eventType: 'submission_new', title: `${status === 'resubmitted' ? 'ส่งงานใหม่' : isLate ? 'ส่งงานล่าช้า' : 'ส่งงาน'}${source === 'email' ? ' (ทางอีเมล)' : ''}: ${a.title}`,
    message: `${student.student_code || ''} ${student.full_name} (เวอร์ชัน ${version})`, link: `/teacher/grading/${assignmentId}?student=${studentId}`,
    entityType: 'submission', entityId: id, dedupeKey: `submission:${id}`,
  });
  if (cleanLinks.length) {
    notify.sendMany(teacherIds, {
      eventType: 'link_check', title: `มี URL ที่ต้องตรวจสอบ: ${a.title}`, message: `${student.full_name} แนบ ${cleanLinks.length} ลิงก์`,
      link: `/teacher/grading/${assignmentId}?student=${studentId}`, entityType: 'submission', entityId: id, dedupeKey: `links:${id}`,
    });
  }
  notify.send(studentId, {
    eventType: 'submission_status', title: `${source === 'email' ? 'ระบบรับงานจากอีเมลของคุณแล้ว' : 'ส่งงานสำเร็จ'}: ${a.title}`, message: `เวอร์ชัน ${version}${isLate ? ' (ล่าช้า)' : ''}`,
    link: `/student/assignments/${assignmentId}`, entityType: 'submission', entityId: id, dedupeKey: `submitted:${id}`,
  });
  return { id, version, status, isLate };
}

function withAttachments(sub) {
  if (!sub) return sub;
  sub.files = get().prepare('SELECT * FROM submission_files WHERE submission_id = ? ORDER BY rowid').all(sub.id).map((f) => ({ ...f, kind: filesSvc.info(f.file_name).kind }));
  sub.links = get().prepare('SELECT * FROM submission_links WHERE submission_id = ? ORDER BY rowid').all(sub.id);
  return sub;
}

function versions(assignmentId, studentId) {
  return get().prepare('SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ? ORDER BY version DESC').all(assignmentId, studentId).map(withAttachments);
}

function getSubmission(id) {
  return withAttachments(get().prepare('SELECT * FROM submissions WHERE id = ?').get(id));
}

/** รายชื่อนักศึกษาพร้อมสถานะการส่งและการตรวจของ Assignment */
function overview(assignmentId, { section } = {}) {
  const a = assignSvc.getAssignment(assignmentId);
  const subs = get().prepare(`SELECT s.* FROM submissions s JOIN (SELECT student_id, MAX(version) v FROM submissions WHERE assignment_id = ? GROUP BY student_id) m
    ON m.student_id = s.student_id AND m.v = s.version WHERE s.assignment_id = ?`).all(assignmentId, assignmentId);
  const subBy = Object.fromEntries(subs.map((s) => [s.student_id, s]));
  const grades = get().prepare('SELECT * FROM grading_records WHERE assignment_id = ?').all(assignmentId);
  const gradeBy = Object.fromEntries(grades.map((g) => [g.student_id, g]));
  const linkIssues = get().prepare(`SELECT s.student_id, COUNT(*) c FROM submission_links l JOIN submissions s ON s.id = l.submission_id
    WHERE s.assignment_id = ? AND l.validation_status IN ('unchecked','permission_required','invalid_url') GROUP BY s.student_id`).all(assignmentId);
  const linkBy = Object.fromEntries(linkIssues.map((r) => [r.student_id, r.c]));
  return courseSvc.students(a.course_id, { section }).map((st) => ({ student: st, submission: subBy[st.id] || null, grade: gradeBy[st.id] || null, linkIssues: linkBy[st.id] || 0 }));
}

function setLinkStatus(linkId, status, actorId) {
  if (!['unchecked', 'accessible', 'permission_required', 'invalid_url'].includes(status)) throw new ValidationError('สถานะลิงก์ไม่ถูกต้อง');
  const link = get().prepare('SELECT l.*, s.student_id, s.assignment_id FROM submission_links l JOIN submissions s ON s.id = l.submission_id WHERE l.id = ?').get(linkId);
  if (!link) throw new ValidationError('ไม่พบลิงก์');
  get().prepare('UPDATE submission_links SET validation_status = ?, checked_at = ?, checked_by = ? WHERE id = ?').run(status, now(), actorId, linkId);
  audit.log(actorId, 'submission_link.check', 'submission_link', linkId, { old: link.validation_status, new: status });
  if (status === 'permission_required' || status === 'invalid_url') {
    notify.send(link.student_id, {
      eventType: 'submission_status', title: status === 'permission_required' ? 'ผู้สอนเปิดลิงก์งานไม่ได้ — กรุณาเปิดสิทธิ์การแชร์' : 'ลิงก์งานไม่ถูกต้อง',
      message: link.url, link: `/student/assignments/${link.assignment_id}`, entityType: 'submission_link', entityId: linkId, dedupeKey: `link:${linkId}:${status}`,
    });
  }
  return link;
}

function markUnderReview(submissionId) {
  get().prepare("UPDATE submissions SET status = 'under_review' WHERE id = ? AND status IN ('submitted','late','resubmitted')").run(submissionId);
}

/** ไฟล์ที่ผู้ใช้มีสิทธิ์เข้าถึง (ตรวจสิทธิ์ทุกการเข้าถึงไฟล์) */
function fileForUser(fileId, user) {
  const f = get().prepare(`SELECT f.*, s.student_id, s.assignment_id FROM submission_files f JOIN submissions s ON s.id = f.submission_id WHERE f.id = ?`).get(fileId);
  if (!f) return null;
  if (user.role === 'teacher' || user.role === 'admin') return f;
  if (user.role === 'student' && f.student_id === user.user_id) return f;
  return null;
}

function portfolio(studentId) {
  return get().prepare(`SELECT f.*, a.title AS assignment_title, a.id AS assignment_id, s.version, s.submitted_at
    FROM submission_files f JOIN submissions s ON s.id = f.submission_id JOIN assignments a ON a.id = s.assignment_id
    WHERE s.student_id = ? AND a.deleted_at IS NULL AND s.version = (SELECT MAX(version) FROM submissions WHERE assignment_id = s.assignment_id AND student_id = s.student_id)
    ORDER BY s.submitted_at DESC`).all(studentId).map((f) => ({ ...f, kind: filesSvc.info(f.file_name).kind }));
}

module.exports = { submit, versions, getSubmission, overview, latest, setLinkStatus, markUnderReview, fileForUser, portfolio, validateUrl, fixName };
