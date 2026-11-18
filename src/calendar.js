'use strict';
/** ปฏิทินรายเดือน (เริ่มสัปดาห์วันจันทร์) สำหรับหน้าแรกรายวิชา */
const { localToday, toLocalInput } = require('./util');

const TH_MONTHS_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const DOW = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function parseMonth(m, fallbackDate) {
  const mm = /^(\d{4})-(\d{2})$/.exec(String(m || ''));
  if (mm && Number(mm[2]) >= 1 && Number(mm[2]) <= 12) return { y: Number(mm[1]), mo: Number(mm[2]) - 1 };
  const [y, mo] = (fallbackDate || localToday()).split('-').map(Number);
  return { y, mo: mo - 1 };
}

/**
 * @param {string} month 'YYYY-MM' (ไม่ระบุ = เดือนปัจจุบัน)
 * @param {{sessions: object[], assignments: object[], studentView?: boolean}} data
 */
function buildMonth(month, { sessions = [], assignments = [], studentView = false, role = 'teacher' } = {}) {
  const { y, mo } = parseMonth(month);
  const first = new Date(Date.UTC(y, mo, 1));
  const start = new Date(first);
  start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7)); // ย้อนไปวันจันทร์
  const today = localToday();
  const events = {};
  const add = (date, ev) => { (events[date] = events[date] || []).push(ev); };

  for (const s of sessions) {
    if (!s.session_date || s.status === 'draft') continue;
    add(s.session_date, {
      type: s.week_number === 9 || s.week_number === 17 ? 'exam' : 'session', time: s.start_time || '', sort: s.start_time || '',
      label: `${s.section_code ? `ก.${s.section_code} ` : ''}W${s.week_number}`, title: s.title, sec: s.section_code || '',
      href: `/sessions/${s.id}`, open: s.attendance_state === 'open', cancelled: s.status === 'cancelled', done: s.attendance_state === 'closed',
    });
  }
  for (const a of assignments) {
    if (a.status === 'draft') continue;
    // กำหนดส่งแยกกลุ่ม: แสดงทุกกลุ่ม (ฝั่งนักศึกษาได้วันที่ของกลุ่มตนเองแล้ว)
    const rows = !studentView && a.sections && a.sections.some((r) => r.due_date)
      ? a.sections.map((r) => ({ due: r.due_date || a.due_date, sec: r.section_code }))
      : [{ due: a.due_date, sec: '' }];
    for (const r of rows) {
      if (!r.due) continue;
      const local = toLocalInput(r.due);
      add(local.slice(0, 10), {
        type: 'due', time: local.slice(11, 16), sort: `z${local.slice(11, 16)}`, label: `ส่ง ${a.assignment_code}${r.sec ? ` ก.${r.sec}` : ''}`,
        title: a.title, sec: r.sec, href: studentView ? `/student/assignments/${a.id}` : role === 'teacher' ? `/teacher/grading/${a.id}` : '/teacher/assignments',
      });
    }
  }

  const weeks = [];
  const cur = new Date(start);
  do {
    const week = [];
    for (let i = 0; i < 7; i += 1) {
      const date = ymd(cur);
      week.push({
        date, day: cur.getUTCDate(), inMonth: cur.getUTCMonth() === mo, isToday: date === today, weekend: i >= 5,
        events: (events[date] || []).sort((p, q) => p.sort.localeCompare(q.sort)),
      });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    weeks.push(week);
  } while (cur.getUTCMonth() === mo);

  const prev = new Date(Date.UTC(y, mo - 1, 1));
  const next = new Date(Date.UTC(y, mo + 1, 1));
  const inMonthCount = weeks.flat().filter((d) => d.inMonth).reduce((t, d) => t + d.events.length, 0);
  return {
    label: `${TH_MONTHS_FULL[mo]} ${y + 543}`, month: `${y}-${pad(mo + 1)}`, dow: DOW, weeks, inMonthCount,
    prev: `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}`, next: `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}`,
    isCurrent: today.slice(0, 7) === `${y}-${pad(mo + 1)}`,
  };
}

module.exports = { buildMonth };
