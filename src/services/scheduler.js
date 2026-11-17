'use strict';
/** งานตามเวลา: เตือนกำหนดส่ง (24 ชม. / 1 ชม. ตั้งค่าได้), แจ้งงานเลยกำหนด, ล้างข้อมูลที่หมดอายุ */
const { get } = require('../db');
const notify = require('./notify');
const courseSvc = require('./course');
const att = require('./attendance');

function runReminders(at = new Date()) {
  const course = courseSvc.getCourse();
  if (!course) return 0;
  const hours = String(course.reminder_hours || '24,1').split(',').map(Number).filter((n) => n > 0);
  const assignments = get().prepare(`SELECT * FROM assignments WHERE course_id = ? AND status = 'published' AND submission_mode = 'online' AND deleted_at IS NULL AND due_date IS NOT NULL`).all(course.id);
  const students = courseSvc.students(course.id);
  let sent = 0;
  for (const a of assignments) {
    const due = Date.parse(a.due_date);
    const submitted = new Set(get().prepare('SELECT DISTINCT student_id FROM submissions WHERE assignment_id = ?').all(a.id).map((r) => r.student_id));
    for (const h of hours) {
      if (at.getTime() >= due - h * 3600000 && at.getTime() < due) {
        for (const s of students) {
          if (submitted.has(s.id)) continue;
          if (notify.send(s.id, {
            eventType: 'due_reminder', title: `ใกล้ครบกำหนดส่ง: ${a.title}`, message: `เหลือเวลาไม่เกิน ${h} ชั่วโมง`,
            link: `/student/assignments/${a.id}`, entityType: 'assignment', entityId: a.id, dedupeKey: `due:${a.id}:${a.due_date}:${h}`,
          })) sent += 1;
        }
      }
    }
    if (at.getTime() >= due && at.getTime() - due < 7 * 86400000) {
      for (const s of students) {
        if (submitted.has(s.id)) continue;
        if (notify.send(s.id, {
          eventType: 'overdue', title: `งานเลยกำหนดส่ง: ${a.title}`, message: a.late_policy === 'reject' ? 'งานนี้ไม่รับงานล่าช้า' : 'ยังส่งได้แต่จะถูกบันทึกว่าส่งล่าช้า',
          link: `/student/assignments/${a.id}`, entityType: 'assignment', entityId: a.id, dedupeKey: `overdue:${a.id}:${a.due_date}`,
        })) sent += 1;
      }
    }
  }
  return sent;
}

function start() {
  const tick = () => {
    try {
      runReminders();
      const c = courseSvc.getCourse();
      att.purgeOld(c ? c.risk_retention_days : 180);
    } catch (e) { console.error('scheduler error', e); }
  };
  setTimeout(tick, 5000).unref();
  return setInterval(tick, 60000).unref();
}

module.exports = { runReminders, start };
