'use strict';
/**
 * FR-07 CLO Assessment & Analytics + FR-08 Final Score Management (หมวด 10)
 * - คะแนนรายวิชา = ผลรวมคะแนนที่เผยแพร่แล้วในแต่ละหมวดตาม OBE-3 (ไม่ปรับสัดส่วนอัตโนมัติ)
 * - งานที่ยังไม่ตรวจ/ยังไม่เผยแพร่ ไม่ถูกตีความเป็นศูนย์ (แสดงแยก)
 * - CLO Score (%) = Σ(คะแนนที่ได้ × น้ำหนัก CLO) ÷ Σ(คะแนนเต็ม × น้ำหนัก CLO) × 100
 * - Achievement Rate (%) = ผู้ผ่านเกณฑ์ ÷ ผู้ได้รับการประเมิน × 100 (คำนวณเมื่อกำหนดเกณฑ์ผ่านแล้วเท่านั้น)
 */
const { get } = require('../db');
const courseSvc = require('./course');
const assignSvc = require('./assignments');
const { round2 } = require('../util');

const COUNTED = ['published', 'locked'];

function load(courseId) {
  const assignments = assignSvc.attachSections(get().prepare(`SELECT a.* FROM assignments a WHERE a.course_id = ? AND a.deleted_at IS NULL AND a.status != 'draft'`).all(courseId));
  const grades = get().prepare(`SELECT g.* FROM grading_records g JOIN assignments a ON a.id = g.assignment_id WHERE a.course_id = ? AND a.deleted_at IS NULL`).all(courseId);
  const maps = get().prepare(`SELECT m.*, c.clo_code FROM assignment_clo_maps m JOIN clo_outcomes c ON c.id = m.clo_id JOIN assignments a ON a.id = m.assignment_id
    WHERE a.course_id = ? AND a.deleted_at IS NULL`).all(courseId);
  return { assignments, grades, maps };
}

/** ตรวจสอบโครงสร้างคะแนน: คะแนนเต็มของงานในแต่ละหมวดเทียบกับหมวด (คะแนนเกิน/ขาด) */
/**
 * ตรวจสอบโครงสร้างคะแนน: คะแนนเต็มของงานในแต่ละหมวดเทียบกับหมวด (คะแนนเกิน/ขาด) — ตรวจแยกทีละกลุ่มเรียน
 * @param {{section?: string}} opts ระบุกลุ่ม = ดูเฉพาะกลุ่มนั้น, ไม่ระบุ = ทุกกลุ่ม (planned = กลุ่มที่ใช้มากสุด)
 */
function structureCheck(courseId, { section = null } = {}) {
  const cats = courseSvc.categories(courseId);
  const all = assignSvc.attachSections(get().prepare('SELECT id, category_id, status, max_score FROM assignments WHERE course_id = ? AND deleted_at IS NULL').all(courseId));
  const codes = section ? [String(section)] : courseSvc.sections(courseId).map((x) => x.section_code);
  const total = cats.reduce((s, c) => s + c.max_score, 0);
  const sum = (rows) => round2(rows.reduce((t, r) => t + r.max_score, 0));
  return {
    total: round2(total),
    totalOk: Math.abs(total - 100) < 1e-9,
    categories: cats.map((c) => {
      const mine = all.filter((r) => r.category_id === c.id);
      const bySection = {};
      for (const code of codes.length ? codes : ['*']) {
        const rows = code === '*' ? mine : mine.filter((r) => assignSvc.appliesTo(r, code));
        bySection[code] = { planned: sum(rows), published: sum(rows.filter((r) => r.status !== 'draft')) };
      }
      const vals = Object.values(bySection);
      const planned = Math.max(0, ...vals.map((v) => v.planned));
      const published = Math.max(0, ...vals.map((v) => v.published));
      const over = vals.some((v) => v.planned > c.max_score + 1e-9);
      const allOk = vals.every((v) => Math.abs(v.planned - c.max_score) < 1e-9);
      return { ...c, planned, published, count: mine.length, bySection, state: over ? 'over' : allOk ? 'ok' : 'under' };
    }),
  };
}

/**
 * @param {string} courseId
 * @param {{includeDraft?: boolean, studentId?: string}} opts includeDraft = แสดงคะแนน Draft ให้ผู้สอนดูประกอบ (แยกจากคะแนนจริง)
 */
function gradebook(courseId, { studentId, section } = {}) {
  const cats = courseSvc.categories(courseId);
  const { assignments, grades } = load(courseId);
  const students = courseSvc.students(courseId, { section }).filter((s) => !studentId || s.id === studentId);
  const gradeKey = Object.fromEntries(grades.map((g) => [`${g.assignment_id}:${g.student_id}`, g]));
  return {
    categories: cats,
    assignments,
    rows: students.map((st) => {
      const byCat = {};
      let total = 0;
      let draftTotal = 0;
      let pending = 0;
      for (const c of cats) byCat[c.id] = { earned: 0, gradedMax: 0, pending: 0, draft: 0, items: [] };
      for (const a of assignments) {
        if (!assignSvc.appliesTo(a, st.section)) continue; // งานของกลุ่มอื่น ไม่นับ
        const g = gradeKey[`${a.id}:${st.id}`];
        const bucket = byCat[a.category_id];
        if (!bucket) continue;
        const counted = g && COUNTED.includes(g.status) && g.total_score !== null;
        const state = !g || g.total_score === null ? (g && g.status === 'revision_requested' ? 'revision_requested' : 'not_graded') : g.status;
        bucket.items.push({ assignment: a, grade: g || null, counted, state });
        if (counted) { bucket.earned += g.total_score; bucket.gradedMax += a.max_score; total += g.total_score; }
        else { bucket.pending += 1; pending += 1; }
        if (g && g.status === 'draft' && g.total_score !== null) { bucket.draft += g.total_score; draftTotal += g.total_score; }
      }
      for (const c of cats) { byCat[c.id].earned = round2(byCat[c.id].earned); byCat[c.id].draft = round2(byCat[c.id].draft); }
      return { student: st, byCat, total: round2(total), draftTotal: round2(draftTotal), pending };
    }),
  };
}

function cloScores(courseId, { studentId, section } = {}) {
  const clos = courseSvc.clos(courseId);
  const { assignments, grades, maps } = load(courseId);
  const aBy = Object.fromEntries(assignments.map((a) => [a.id, a]));
  const students = courseSvc.students(courseId, { section }).filter((s) => !studentId || s.id === studentId);
  const perStudent = students.map((st) => {
    const res = {};
    for (const clo of clos) res[clo.id] = { earned: 0, max: 0 };
    for (const g of grades) {
      if (g.student_id !== st.id || !COUNTED.includes(g.status) || g.total_score === null) continue;
      const a = aBy[g.assignment_id];
      if (!a) continue;
      for (const m of maps.filter((x) => x.assignment_id === a.id)) {
        res[m.clo_id].earned += g.total_score * m.contribution_weight;
        res[m.clo_id].max += a.max_score * m.contribution_weight;
      }
    }
    const out = {};
    for (const clo of clos) {
      const r = res[clo.id];
      out[clo.id] = r.max > 0 ? { percent: round2((r.earned / r.max) * 100), earned: round2(r.earned), max: round2(r.max) } : null;
    }
    return { student: st, clo: out };
  });
  const summary = clos.map((clo) => {
    const assessed = perStudent.filter((p) => p.clo[clo.id]);
    const avg = assessed.length ? round2(assessed.reduce((s, p) => s + p.clo[clo.id].percent, 0) / assessed.length) : null;
    const hasCriteria = clo.passing_criteria !== null && clo.passing_criteria !== undefined;
    const passed = hasCriteria ? assessed.filter((p) => p.clo[clo.id].percent >= clo.passing_criteria).length : null;
    const plannedMax = round2(maps.filter((m) => m.clo_id === clo.id).reduce((s, m) => s + (aBy[m.assignment_id] ? aBy[m.assignment_id].max_score * m.contribution_weight : 0), 0));
    return {
      clo, assessed: assessed.length, average: avg, passed, plannedMax,
      achievementRate: hasCriteria && assessed.length ? round2((passed / assessed.length) * 100) : null,
    };
  });
  return { clos, perStudent, summary };
}

/**
 * ตารางการเข้าเรียนรายสัปดาห์ — แต่ละกลุ่มมีคาบของตนเอง จึงจับคู่นักศึกษากับคาบของกลุ่มตนในสัปดาห์นั้น
 * @param {{section?: string}} opts section_code (ไม่ระบุ = ทุกกลุ่ม)
 */
function attendanceMatrix(courseId, { section } = {}) {
  const all = courseSvc.sessions(courseId).filter((s) => s.status !== 'cancelled');
  const inScope = all.filter((s) => !section || !s.section_code || s.section_code === String(section));
  const started = inScope.filter((s) => s.attendance_state !== 'not_started');
  const weeks = [...new Set(started.map((s) => s.week_number))].sort((x, y) => x - y);
  const recs = get().prepare('SELECT a.* FROM attendance_records a JOIN course_sessions s ON s.id = a.session_id WHERE s.course_id = ?').all(courseId);
  const key = Object.fromEntries(recs.map((r) => [`${r.session_id}:${r.student_id}`, r]));
  const sessionFor = (week, code) => started.find((s) => s.week_number === week && (s.section_code === code || !s.section_code));
  const rows = courseSvc.students(courseId, { section }).map((st) => {
    const cells = weeks.map((w) => {
      const s = sessionFor(w, st.section);
      return s ? (key[`${s.id}:${st.id}`] || null) : undefined;
    });
    const held = cells.filter((c) => c !== undefined);
    const count = (k) => held.filter((c) => c && c.attendance_status === k).length;
    const attended = count('present') + count('late');
    return {
      student: st, cells, present: count('present'), late: count('late'), absent: count('absent'), leave: count('leave'),
      none: held.filter((c) => !c).length, held: held.length, rate: held.length ? round2((attended / held.length) * 100) : null,
    };
  });
  return { weeks, sessions: weeks.map((w) => ({ week_number: w })), rows };
}

module.exports = { structureCheck, gradebook, cloScores, attendanceMatrix };
