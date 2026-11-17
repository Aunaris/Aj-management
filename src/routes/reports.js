'use strict';
/** FR-09 Report & Export — CSV (เปิดด้วย Excel ได้) และหน้าพิมพ์/บันทึกเป็น PDF */
const express = require('express');
const { get } = require('../db');
const courseSvc = require('../services/course');
const assignSvc = require('../services/assignments');
const subSvc = require('../services/submissions');
const scores = require('../services/scores');
const audit = require('../services/audit');
const util = require('../util');
const { allow } = require('./guard');

const router = express.Router();
const TA = allow('teacher', 'admin');

const TYPES = {
  attendance: 'รายงานการเข้าเรียน',
  gradebook: 'รายงานคะแนนรวม (Final Score)',
  submissions: 'รายงานการส่งงาน',
  grading: 'รายงานผลการตรวจรายงาน',
  clo: 'รายงานผลลัพธ์การเรียนรู้ CLO',
  progress: 'รายงานความก้าวหน้านักศึกษา',
};

function build(type, query, section = null) {
  const c = courseSvc.getCourse();
  const filters = [];
  const sec = section ? courseSvc.sectionByCode(c.id, section) : null;
  filters.push(sec ? `กลุ่มเรียน: ${courseSvc.sectionLabel(sec)}` : 'กลุ่มเรียน: ทุกกลุ่ม');
  if (type === 'attendance') {
    const m = scores.attendanceMatrix(c.id, { section });
    const headers = ['กลุ่ม', 'รหัสนักศึกษา', 'ชื่อ-นามสกุล', ...m.weeks.map((w) => `สัปดาห์ ${w}`), 'มา', 'สาย', 'ขาด', 'ลา', 'ไม่มีข้อมูล', 'อัตราเข้าเรียน (%)'];
    const rows = m.rows.map((r) => [r.student.section || '', r.student.student_code, r.student.full_name,
      ...r.cells.map((x) => (x === undefined ? 'ไม่มีคาบ' : x ? util.label('attendance', x.attendance_status) : '-')), r.present, r.late, r.absent, r.leave, r.none, r.rate ?? '']);
    return { headers, rows, filters };
  }
  if (type === 'gradebook') {
    const gb = scores.gradebook(c.id, { section });
    const headers = ['กลุ่ม', 'รหัสนักศึกษา', 'ชื่อ-นามสกุล', ...gb.categories.map((x) => `${x.category_name} (${x.max_score})`), 'รวม (100)', 'รายการที่ยังไม่มีผลประเมิน'];
    const rows = gb.rows.map((r) => [r.student.section || '', r.student.student_code, r.student.full_name, ...gb.categories.map((x) => r.byCat[x.id].earned), r.total, r.pending]);
    filters.push('นับเฉพาะคะแนนที่เผยแพร่แล้ว (งานที่ยังไม่ตรวจไม่นับเป็นศูนย์)');
    return { headers, rows, filters };
  }
  if (type === 'submissions' || type === 'grading') {
    const list = assignSvc.list(c.id).filter((a) => a.status !== 'draft' && (!query.assignment || a.id === query.assignment));
    if (query.assignment && list[0]) filters.push(`งาน: ${list[0].assignment_code} ${list[0].title}`);
    const headers = type === 'submissions'
      ? ['รหัสงาน', 'ชื่องาน', 'กลุ่ม', 'รหัสนักศึกษา', 'ชื่อ-นามสกุล', 'สถานะการส่ง', 'เวอร์ชัน', 'เวลาส่งล่าสุด', 'ส่งล่าช้า', 'จำนวนไฟล์', 'จำนวนลิงก์']
      : ['รหัสงาน', 'ชื่องาน', 'หมวดคะแนน', 'คะแนนเต็ม', 'กลุ่ม', 'รหัสนักศึกษา', 'ชื่อ-นามสกุล', 'คะแนน', 'สถานะคะแนน', 'Feedback'];
    const rows = [];
    for (const a of list) {
      for (const o of subSvc.overview(a.id, { section })) {
        if (type === 'submissions') {
          const files = o.submission ? get().prepare('SELECT COUNT(*) c FROM submission_files WHERE submission_id = ?').get(o.submission.id).c : 0;
          const links = o.submission ? get().prepare('SELECT COUNT(*) c FROM submission_links WHERE submission_id = ?').get(o.submission.id).c : 0;
          rows.push([a.assignment_code, a.title, o.student.section || '', o.student.student_code, o.student.full_name, util.label('submission', o.submission ? o.submission.status : 'none'),
            o.submission ? o.submission.version : '', o.submission ? util.thaiDate(o.submission.submitted_at, { time: true }) : '', o.submission && o.submission.is_late ? 'ใช่' : '', files, links]);
        } else {
          const g = o.grade;
          rows.push([a.assignment_code, a.title, a.category_name, a.max_score, o.student.section || '', o.student.student_code, o.student.full_name,
            g && g.total_score !== null ? g.total_score : '', util.label('grade', g ? g.status : 'not_graded'), g && g.feedback ? g.feedback : '']);
        }
      }
    }
    return { headers, rows, filters };
  }
  if (type === 'clo') {
    const d = scores.cloScores(c.id, { section });
    const headers = ['กลุ่ม', 'รหัสนักศึกษา', 'ชื่อ-นามสกุล', ...d.clos.map((x) => `${x.clo_code} (%)`)];
    const rows = d.perStudent.map((p) => [p.student.section || '', p.student.student_code, p.student.full_name, ...d.clos.map((x) => (p.clo[x.id] ? p.clo[x.id].percent : 'ยังไม่ประเมิน'))]);
    rows.push([]);
    rows.push(['สรุป CLO', 'คะแนนเฉลี่ย (%)', 'ผู้ได้รับการประเมิน', 'เกณฑ์ผ่าน (%)', 'ผู้ผ่าน', 'Achievement Rate (%)']);
    for (const s of d.summary) rows.push([s.clo.clo_code, s.average ?? '', s.assessed, s.clo.passing_criteria ?? 'ยังไม่กำหนด', s.passed ?? '', s.achievementRate ?? '']);
    return { headers, rows, filters };
  }
  if (type === 'progress') {
    const gb = scores.gradebook(c.id, { section });
    const m = scores.attendanceMatrix(c.id, { section });
    const attBy = Object.fromEntries(m.rows.map((r) => [r.student.id, r]));
    const online = assignSvc.list(c.id).filter((a) => a.status !== 'draft' && a.submission_mode === 'online');
    const headers = ['กลุ่ม', 'รหัสนักศึกษา', 'ชื่อ-นามสกุล', 'อัตราเข้าเรียน (%)', 'ส่งงานแล้ว', 'งานทั้งหมด (ออนไลน์)', 'ส่งล่าช้า', 'คะแนนสะสม', 'รอผลประเมิน'];
    const rows = gb.rows.map((r) => {
      const subs = online.map((a) => subSvc.latest(a.id, r.student.id)).filter(Boolean);
      return [r.student.section || '', r.student.student_code, r.student.full_name, attBy[r.student.id]?.rate ?? '', subs.length, online.length, subs.filter((s) => s.is_late).length, r.total, r.pending];
    });
    return { headers, rows, filters };
  }
  return null;
}

/** กลุ่มของรายงาน: ?section=... (all = ทุกกลุ่ม) ไม่ระบุ = กลุ่มที่เลือกอยู่ */
function reportSection(req) {
  if (req.query.section === 'all') return null;
  if (req.query.section) return String(req.query.section);
  return req.section ? req.section.section_code : null;
}

router.get('/reports', TA, (req, res) => {
  res.page('teacher/reports', { title: 'รายงานและส่งออกข้อมูล', types: TYPES, assignments: assignSvc.list(courseSvc.getCourse().id) });
});

router.get('/reports/:type.csv', TA, (req, res, next) => {
  const type = req.params.type;
  if (!TYPES[type]) return next();
  const c = courseSvc.getCourse();
  const data = build(type, req.query, reportSection(req));
  const meta = [
    [`${TYPES[type]}`], [`รายวิชา ${c.course_code} ${c.course_name}`], [`ภาคการศึกษา ${c.semester}/${c.academic_year}`],
    [`วันที่ออกรายงาน ${util.thaiDate(new Date().toISOString(), { time: true })}`], ...(data.filters.length ? [[`เงื่อนไข: ${data.filters.join('; ')}`]] : []), [],
  ];
  const csv = util.toCsv(meta[0], [...meta.slice(1), data.headers, ...data.rows]);
  audit.log(req.user.user_id, 'report.export', 'report', type, { format: 'csv', filters: req.query });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  const sec = reportSection(req);
  res.setHeader('Content-Disposition', `attachment; filename="${c.course_code}_${sec ? 'sec' + sec + '_' : ''}${type}_${util.localToday()}.csv"`);
  return res.send(csv);
});

router.get('/reports/:type/print', TA, (req, res, next) => {
  const type = req.params.type;
  if (!TYPES[type]) return next();
  const data = build(type, req.query, reportSection(req));
  audit.log(req.user.user_id, 'report.export', 'report', type, { format: 'print', filters: req.query });
  return res.page('teacher/print', { title: TYPES[type], data, generatedAt: new Date().toISOString() }, { bare: true });
});

module.exports = router;
module.exports.build = build;
