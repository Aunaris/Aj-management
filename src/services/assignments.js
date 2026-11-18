'use strict';
/** FR-03 Assignment Management + Rubric (FR-05) + CLO Mapping (FR-07) */
const { get, uuid, now, tx } = require('../db');
const audit = require('./audit');
const notify = require('./notify');
const courseSvc = require('./course');
const filesSvc = require('./files');
const { round2 } = require('../util');

class ValidationError extends Error {
  constructor(errors) {
    super(Array.isArray(errors) ? errors.join('\n') : errors);
    this.errors = Array.isArray(errors) ? errors : [errors];
    this.status = 400;
  }
}

const ANIMATION_TYPES = 'jpg,jpeg,png,gif,mp4,mov,pdf,zip';
/** Template ตามแผนการสอน OBE-3 (ผู้สอนแก้ไขได้ทุกค่า) */
const TEMPLATES = {
  bouncing_ball: {
    label: 'Bouncing Ball (สัปดาห์ 2–3)', category: 'PRE_CLO1', week: 3, max: 5, mode: 'online', types: 'gif,mp4,mov,zip,fla',
    title: 'Bouncing Ball — 12 Principles of Animation',
    instructions: 'สร้างแอนิเมชันลูกบอลเด้งอย่างน้อย 3 ครั้ง แสดง Squash & Stretch, Timing/Spacing และ Slow in–Slow out ส่งไฟล์ GIF หรือ MP4 พร้อมไฟล์ต้นฉบับ',
    criteria: [
      ['เข้าใจหลักการเคลื่อนไหว (Squash & Stretch, Timing, Spacing)', 2, 'แสดงหลักการได้ถูกต้องครบถ้วน'],
      ['ความถูกต้องทางเทคนิคและความลื่นไหล', 2, 'จังหวะการเคลื่อนไหวสมจริง ไม่กระตุก'],
      ['ส่งงานครบถ้วน ถูกต้อง และตรงเวลา', 1, 'ส่งไฟล์ครบตามที่กำหนดภายในเวลา'],
    ],
  },
  character_design: {
    label: 'Character Design / Model Sheet (สัปดาห์ 4–5)', category: 'PRE_CLO2', week: 5, max: 7, mode: 'online', types: 'jpg,jpeg,png,pdf,psd,zip',
    title: 'Character Design & Model Sheet',
    instructions: 'ออกแบบตัวละครหลัก 1 ตัว พร้อม Model Sheet (Turnaround หน้า/ข้าง/หลัง/3/4) และ Expression Sheet อย่างน้อย 6 อารมณ์',
    criteria: [
      ['โครงสร้างและสัดส่วนตัวละคร', 2, ''],
      ['Model Sheet และการแสดงอารมณ์', 2, ''],
      ['ความคิดสร้างสรรค์และการสื่อบุคลิก', 2, ''],
      ['ส่งงานครบถ้วน ถูกต้อง และตรงเวลา', 1, ''],
    ],
  },
  storyboard: {
    label: 'Storyboard / Animatic (สัปดาห์ 6–7)', category: 'PRE_CLO2', week: 7, max: 8, mode: 'online', types: 'pdf,jpg,jpeg,png,mp4,mov,zip',
    title: 'Storyboard & Animatic',
    instructions: 'เขียนบทสั้นและสร้าง Storyboard อย่างน้อย 12 ช่อง ระบุ Shot/มุมกล้อง/การเคลื่อนไหว และทำ Animatic พร้อมเสียงประกอบเบื้องต้น',
    criteria: [
      ['การเล่าเรื่องและลำดับเหตุการณ์', 3, ''],
      ['การวางช็อตและการจัดองค์ประกอบภาพ', 2, ''],
      ['Animatic สื่อจังหวะและอารมณ์', 2, ''],
      ['ส่งงานครบถ้วน ถูกต้อง และตรงเวลา', 1, ''],
    ],
  },
  walk_cycle: {
    label: 'Walk Cycle (สัปดาห์ 8)', category: 'PRE_CLO1', week: 8, max: 5, mode: 'online', types: 'gif,mp4,mov,zip,fla,tbh,kra',
    title: 'Walk Cycle — Keyframe & In-between',
    instructions: 'สร้าง Walk Cycle ของตัวละคร (Contact, Down, Passing, Up) แบบวนลูป แสดง Keyframe และ In-between ที่ถูกต้อง',
    criteria: [
      ['Keyframe และท่าทางหลักถูกต้อง', 2, ''],
      ['In-between และความลื่นไหลของลูป', 2, ''],
      ['ส่งงานครบถ้วน ถูกต้อง และตรงเวลา', 1, ''],
    ],
  },
  software_animation: {
    label: 'Frame-by-Frame / Cut-out / Rigging (สัปดาห์ 10–11)', category: 'POST_CLO3', week: 11, max: 7.5, mode: 'online', types: 'gif,mp4,mov,zip,fla,tbh,kra',
    title: 'Software Animation — Cut-out & Rigging',
    instructions: 'สร้างแอนิเมชันสั้นด้วยซอฟต์แวร์ (Adobe Animate / Toon Boom Harmony / OpenToonz / Krita) โดยใช้เทคนิค Frame-by-Frame หรือ Cut-out/Rigging',
    criteria: [
      ['ใช้ซอฟต์แวร์และเทคนิคได้ถูกต้อง', 3, ''],
      ['คุณภาพการเคลื่อนไหว', 3, ''],
      ['ส่งงานครบถ้วนและตรงเวลา', 1.5, ''],
    ],
  },
  motion_story: {
    label: 'Coloring / Compositing / Lip Sync (สัปดาห์ 12–13)', category: 'POST_CLO2', week: 13, max: 7.5, mode: 'online', types: 'mp4,mov,gif,zip',
    title: 'Motion & Storytelling — Lip Sync และ Compositing',
    instructions: 'สร้างฉากสั้นที่มีการลงสี ฉากหลัง เสียง และ Lip Sync ประกอบภาพและเรนเดอร์เป็นวิดีโอ',
    criteria: [
      ['สร้างสรรค์การเคลื่อนไหวและการเล่าเรื่อง', 3, ''],
      ['Lip Sync / เสียง / Compositing', 3, ''],
      ['ส่งงานครบถ้วนและตรงเวลา', 1.5, ''],
    ],
  },
  final_project: {
    label: 'Final Project — ผลงาน (สัปดาห์ 14–16)', category: 'FP_WORK', week: 16, max: 20, mode: 'online', types: 'mp4,mov,pdf,zip',
    title: 'Final Project: แอนิเมชัน 2 มิติสั้น', allowLinks: true,
    instructions: 'พัฒนาชิ้นงานแอนิเมชัน 2 มิติสั้นที่นำเสนอแนวคิดและเรื่องราว ส่งไฟล์วิดีโอหรือแนบลิงก์ (YouTube/Google Drive) พร้อมเอกสารประกอบ',
    criteria: [
      ['ชิ้นงานสื่อสารแนวคิดและเรื่องราวได้ชัดเจน', 8, ''],
      ['คุณภาพการเคลื่อนไหว การลงสี และการประกอบภาพ', 7, ''],
      ['ความสมบูรณ์และความคิดสร้างสรรค์ของผลงาน', 5, ''],
    ],
  },
  final_presentation: {
    label: 'Final Project — การนำเสนอ (ให้คะแนนในคาบ)', category: 'FP_PRESENT', week: 16, max: 10, mode: 'in_class', types: 'pdf,pptx',
    title: 'Final Project: การนำเสนอผลงาน',
    instructions: 'นำเสนอแนวคิด กระบวนการ และผลงาน Final Project พร้อมรับฟังและแลกเปลี่ยนความคิดเห็น',
    criteria: [
      ['นำเสนอแนวคิดและผลงานได้ชัดเจน ลำดับเนื้อหาดี', 6, ''],
      ['ทำงานร่วมกับผู้อื่นและรับฟังความคิดเห็น', 4, ''],
    ],
  },
  affective: {
    label: 'จิตพิสัย (บันทึกคะแนนโดยผู้สอน)', category: 'AFFECTIVE', week: 16, max: 10, mode: 'in_class', types: 'pdf',
    title: 'จิตพิสัย',
    instructions: 'ประเมินความกระตือรือร้น การเข้าเรียนสม่ำเสมอ การส่งงานตรงเวลา การรับฟังและเคารพความคิดเห็นผู้อื่น และจรรยาบรรณในการผลิตงาน',
    criteria: [
      ['ความกระตือรือร้น เข้าเรียนสม่ำเสมอ และส่งงานตรงเวลา', 4, ''],
      ['รับฟังและเคารพความคิดเห็นของผู้อื่น', 3, ''],
      ['ยึดมั่นในคุณธรรม จริยธรรม และจรรยาบรรณในการผลิตงาน', 3, ''],
    ],
  },
  in_class_activity: {
    label: 'กิจกรรมในคาบ (ให้คะแนนระหว่างคาบ)', category: null, week: null, max: 2, mode: 'in_class', types: 'jpg,jpeg,png,gif,mp4',
    title: 'กิจกรรมฝึกปฏิบัติในคาบ', instructions: 'ฝึกปฏิบัติตามที่ผู้สอนกำหนดในคาบ ผู้สอนให้คะแนนทันทีระหว่างคาบ', criteria: [],
  },
};

/* ---------- กลุ่มเรียนของงาน ---------- */
/** แถวกลุ่มเรียนของงาน (ไม่มีแถว = มอบหมายทุกกลุ่ม) */
function sectionRows(assignmentId) {
  return get().prepare(`SELECT x.*, cs.section_code, cs.name AS section_name FROM assignment_sections x JOIN course_sections cs ON cs.id = x.section_id
    WHERE x.assignment_id = ? ORDER BY CAST(cs.section_code AS INTEGER), cs.section_code`).all(assignmentId);
}

function attachSections(list) {
  if (!list.length) return list;
  const rows = get().prepare(`SELECT x.*, cs.section_code, cs.name AS section_name FROM assignment_sections x JOIN course_sections cs ON cs.id = x.section_id
    ORDER BY CAST(cs.section_code AS INTEGER), cs.section_code`).all();
  const by = {};
  for (const r of rows) (by[r.assignment_id] = by[r.assignment_id] || []).push(r);
  for (const a of list) a.sections = by[a.id] || [];
  return list;
}

/** งานนี้มอบหมายให้กลุ่ม (section_code) นี้หรือไม่ */
function appliesTo(a, sectionCode) {
  if (!a.sections || !a.sections.length) return true;
  return sectionCode !== null && sectionCode !== undefined && a.sections.some((r) => r.section_code === String(sectionCode));
}

/** วันเปิดรับ/กำหนดส่งที่ใช้กับกลุ่มนี้ (ค่าของกลุ่ม ถ้าไม่ตั้งใช้ค่ากลางของงาน) */
function forSection(a, sectionCode) {
  const row = (a.sections || []).find((r) => r.section_code === String(sectionCode));
  return { ...a, open_at: (row && row.open_at) || a.open_at, due_date: (row && row.due_date) || a.due_date };
}

function sectionLabelOf(a) {
  return !a.sections || !a.sections.length ? 'ทุกกลุ่ม' : a.sections.map((r) => r.section_name || `กลุ่ม ${r.section_code}`).join(', ');
}

function getAssignment(id) {
  const a = get().prepare(`SELECT a.*, c.category_name, c.code AS category_code, c.max_score AS category_max
    FROM assignments a JOIN assessment_categories c ON c.id = a.category_id WHERE a.id = ? AND a.deleted_at IS NULL`).get(id);
  if (!a) return a;
  a.sections = sectionRows(id);
  return a;
}

/** @param {{section?: string}} opts section = section_code — แสดงเฉพาะงานที่มอบหมายให้กลุ่มนั้น (รวมงานของทุกกลุ่ม) */
function list(courseId, { status, studentView = false, sessionId, section = null } = {}) {
  const where = ['a.course_id = ?', 'a.deleted_at IS NULL'];
  const args = [courseId];
  if (studentView) where.push("a.status IN ('published','closed')");
  if (status) { where.push('a.status = ?'); args.push(status); }
  if (sessionId) { where.push('a.session_id = ?'); args.push(sessionId); }
  const rows = attachSections(get().prepare(`SELECT a.*, c.category_name, c.code AS category_code FROM assignments a JOIN assessment_categories c ON c.id = a.category_id
    WHERE ${where.join(' AND ')} ORDER BY COALESCE(a.week_number, 99), a.due_date, a.created_at`).all(...args));
  return section ? rows.filter((a) => appliesTo(a, section)) : rows;
}

function cloMaps(assignmentId) {
  return get().prepare(`SELECT m.*, c.clo_code FROM assignment_clo_maps m JOIN clo_outcomes c ON c.id = m.clo_id WHERE m.assignment_id = ? ORDER BY c.clo_code`).all(assignmentId);
}

function rubric(assignmentId) {
  const r = get().prepare('SELECT * FROM rubrics WHERE assignment_id = ?').get(assignmentId);
  if (!r) return null;
  r.criteria = get().prepare('SELECT * FROM rubric_criteria WHERE rubric_id = ? ORDER BY sort_order').all(r.id)
    .map((c) => ({ ...c, levels: c.levels ? JSON.parse(c.levels) : [] }));
  return r.criteria.length ? r : null;
}

/**
 * คะแนนเต็มที่ใช้ไปในหมวด แยกตามกลุ่มเรียน (นักศึกษาแต่ละกลุ่มต้องได้คะแนนเต็มรวมไม่เกินหมวดตาม OBE-3)
 * @returns {{bySection: Object<string, number>, max: number}}
 */
function categoryUsageBySection(categoryId, excludeId) {
  const cat = get().prepare('SELECT course_id FROM assessment_categories WHERE id = ?').get(categoryId);
  const rows = attachSections(get().prepare('SELECT id, max_score FROM assignments WHERE category_id = ? AND deleted_at IS NULL AND id IS NOT ?').all(categoryId, excludeId || null));
  const codes = cat ? courseSvc.sections(cat.course_id).map((x) => x.section_code) : [];
  const bySection = {};
  if (!codes.length) {
    bySection['*'] = round2(rows.reduce((t, a) => t + a.max_score, 0));
  } else {
    for (const c of codes) bySection[c] = round2(rows.filter((a) => appliesTo(a, c)).reduce((t, a) => t + a.max_score, 0));
  }
  return { bySection, max: Math.max(0, ...Object.values(bySection)) };
}

function categoryUsage(categoryId, excludeId, sectionCode = null) {
  const u = categoryUsageBySection(categoryId, excludeId);
  return sectionCode && u.bySection[sectionCode] !== undefined ? u.bySection[sectionCode] : u.max;
}

function parseCriteria(input) {
  const names = [].concat(input.criterion_name || []);
  const maxes = [].concat(input.criterion_max || []);
  const weights = [].concat(input.criterion_weight || []);
  const descs = [].concat(input.criterion_desc || []);
  const levels = [].concat(input.criterion_levels || []);
  const out = [];
  names.forEach((n, i) => {
    const name = String(n || '').trim();
    if (!name) return;
    const max = Number(maxes[i]);
    const weightRaw = weights[i] === undefined || weights[i] === '' ? max : Number(weights[i]);
    out.push({
      name, max, weight: weightRaw, description: String(descs[i] || '').trim(),
      levels: String(levels[i] || '').split('|').map((s) => s.trim()).filter(Boolean),
    });
  });
  return out;
}

function parseCloMaps(input, clos) {
  const out = [];
  for (const clo of clos) {
    const on = input[`clo_${clo.clo_code}`];
    if (!on) continue;
    const w = input[`clo_weight_${clo.clo_code}`];
    out.push({ cloId: clo.id, code: clo.clo_code, weight: w === undefined || w === '' ? null : Number(w) });
  }
  if (out.length && out.every((m) => m.weight === null)) out.forEach((m) => { m.weight = round2(1 / out.length); });
  if (out.length === 1 && out[0].weight === null) out[0].weight = 1;
  return out;
}

/** สร้าง/แก้ไข Assignment พร้อมตรวจสอบกฎทั้งหมดฝั่ง Server */
function save(courseId, input, actorId, existingId = null) {
  const course = get().prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
  const clos = courseSvc.clos(courseId);
  const cats = courseSvc.categories(courseId);
  const errors = [];
  const existing = existingId ? getAssignment(existingId) : null;
  if (existingId && !existing) throw new ValidationError('ไม่พบงาน');
  if (course.scores_locked_at) errors.push('คะแนนรายวิชาถูกล็อกแล้ว ไม่สามารถแก้ไขงานได้');

  const title = String(input.title || '').trim();
  const code = String(input.assignment_code || '').trim();
  const maxScore = Number(input.max_score);
  const category = cats.find((c) => c.id === input.category_id);
  if (!title) errors.push('กรุณาระบุชื่องาน');
  if (!code || !/^[A-Za-z0-9_.-]{1,30}$/.test(code)) errors.push('รหัสงานต้องเป็นตัวอักษรอังกฤษ/ตัวเลข/ขีด ไม่เกิน 30 ตัว');
  if (!(maxScore > 0)) errors.push('คะแนนเต็มต้องมากกว่า 0');
  if (!category) errors.push('กรุณาเลือกหมวดคะแนนตาม OBE-3');
  // กลุ่มเรียนที่ได้รับมอบหมาย
  const allSections = courseSvc.sections(courseId);
  const scope = input.section_scope === 'selected' ? 'selected' : 'all';
  const pickedIds = scope === 'selected' ? [].concat(input.section_ids || []).map(String) : [];
  const picked = allSections.filter((x) => pickedIds.includes(x.id));
  if (scope === 'selected' && !picked.length) errors.push('กรุณาเลือกกลุ่มเรียนอย่างน้อย 1 กลุ่ม');
  const secDates = picked.map((x) => ({
    sec: x, open_at: input[`sec_open_${x.id}`] || null, due_date: input[`sec_due_${x.id}`] || null,
  }));
  for (const d of secDates) {
    if (d.open_at && d.due_date && d.open_at > d.due_date) errors.push(`${d.sec.name || 'กลุ่ม ' + d.sec.section_code}: วันเปิดรับต้องก่อนกำหนดส่ง`);
  }
  if (existing && existing.sections) {
    const before = existing.sections.length ? existing.sections.map((r) => r.section_code) : allSections.map((x) => x.section_code);
    const after = scope === 'all' ? allSections.map((x) => x.section_code) : picked.map((x) => x.section_code);
    for (const code of before.filter((c) => !after.includes(c))) {
      const used = get().prepare(`SELECT COUNT(*) c FROM (SELECT student_id FROM submissions WHERE assignment_id = ? UNION SELECT student_id FROM grading_records WHERE assignment_id = ?) x
        WHERE x.student_id IN (SELECT user_id FROM course_enrollments WHERE course_id = ? AND section = ?)`).get(existingId, existingId, courseId, code).c;
      if (used) errors.push(`กลุ่ม ${code} มีการส่งงาน/ให้คะแนนงานนี้แล้ว จึงนำกลุ่มนี้ออกไม่ได้`);
    }
  }
  if (category && maxScore > 0) {
    const usage = categoryUsageBySection(category.id, existingId);
    const targets = scope === 'all' ? Object.keys(usage.bySection) : picked.map((x) => x.section_code);
    for (const code of targets) {
      const used = usage.bySection[code] || 0;
      if (round2(used + maxScore) > category.max_score + 1e-9) {
        const who = code === '*' ? '' : ` สำหรับกลุ่ม ${code}`;
        errors.push(`คะแนนเต็มรวมของหมวด "${category.category_name}"${who} จะเกิน ${category.max_score} คะแนน (ใช้ไปแล้ว ${round2(used)} เหลือ ${round2(category.max_score - used)})`);
      }
    }
  }
  const dup = get().prepare('SELECT id FROM assignments WHERE course_id = ? AND assignment_code = ? AND id IS NOT ?').get(courseId, code, existingId || null);
  if (dup) errors.push(`รหัสงาน ${code} ถูกใช้แล้ว`);

  const mode = input.submission_mode === 'in_class' ? 'in_class' : 'online';
  const allowed = String(input.allowed_types || '').split(/[\s,]+/).map((t) => t.replace(/^\./, '').toLowerCase()).filter(Boolean);
  if (mode === 'online') {
    const bad = allowed.filter((t) => !filesSvc.TYPES[t]);
    if (bad.length) errors.push(`ชนิดไฟล์ไม่รองรับ: ${bad.join(', ')}`);
    if (!allowed.length && !input.allow_links) errors.push('ต้องอนุญาตอย่างน้อยชนิดไฟล์หรือ URL');
  }
  const openAt = input.open_at || null;
  const dueDate = input.due_date || null;
  if (openAt && dueDate && openAt > dueDate) errors.push('วันเปิดรับต้องก่อนวันกำหนดส่ง');
  const maxFileMb = Math.max(1, Math.min(2048, Number(input.max_file_mb) || 200));
  const maxVersions = Math.max(1, Math.min(50, Number(input.max_versions) || 5));

  const maps = parseCloMaps(input, clos);
  if (!maps.length) errors.push('กรุณาเชื่อมโยงอย่างน้อย 1 CLO');
  const wsum = maps.reduce((s, m) => s + (m.weight || 0), 0);
  if (maps.length && Math.abs(wsum - 1) > 0.011) errors.push(`น้ำหนัก CLO ต้องรวมกันเท่ากับ 1 (ปัจจุบัน ${round2(wsum)}) เพื่อไม่ให้นับคะแนนซ้ำหลาย CLO`);
  if (maps.some((m) => !(m.weight > 0 && m.weight <= 1))) errors.push('น้ำหนัก CLO ต้องอยู่ระหว่าง 0–1');

  const criteria = parseCriteria(input);
  criteria.forEach((c, i) => {
    if (!(c.max > 0)) errors.push(`เกณฑ์ข้อ ${i + 1}: คะแนนเต็มต้องมากกว่า 0`);
    if (!(c.weight > 0)) errors.push(`เกณฑ์ข้อ ${i + 1}: น้ำหนักต้องมากกว่า 0`);
  });

  if (existing) {
    const graded = get().prepare("SELECT COUNT(*) c FROM grading_records WHERE assignment_id = ? AND total_score IS NOT NULL").get(existingId).c;
    if (graded && Number(existing.max_score) !== maxScore) errors.push('มีการให้คะแนนแล้ว ไม่สามารถเปลี่ยนคะแนนเต็มได้');
    if (graded && rubricChanged(existingId, criteria)) errors.push('มีการให้คะแนนแล้ว ไม่สามารถแก้ไขเกณฑ์ Rubric ได้ (แก้ไขได้เฉพาะคำอธิบาย)');
  }
  if (errors.length) throw new ValidationError(errors);

  const ts = now();
  const id = existingId || uuid();
  const row = {
    category_id: category.id, session_id: input.session_id || null, assignment_code: code, title,
    description: String(input.description || '').trim(), instructions: String(input.instructions || '').trim(), template: input.template || null,
    week_number: input.week_number ? Number(input.week_number) : null, open_at: openAt, due_date: dueDate, max_score: maxScore,
    submission_mode: mode, allowed_types: allowed.join(','), max_file_mb: maxFileMb, allow_links: input.allow_links ? 1 : 0,
    allowed_domains: String(input.allowed_domains || '').trim() || null, allow_resubmit: input.allow_resubmit ? 1 : 0, max_versions: maxVersions,
    late_policy: input.late_policy === 'reject' ? 'reject' : 'accept_mark',
  };
  tx(() => {
    if (existing) {
      const cols = Object.keys(row);
      get().prepare(`UPDATE assignments SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...cols.map((c) => row[c]), ts, id);
    } else {
      const cols = Object.keys(row);
      get().prepare(`INSERT INTO assignments (id, course_id, ${cols.join(', ')}, status, created_by, created_at, updated_at)
        VALUES (?, ?, ${cols.map(() => '?').join(', ')}, 'draft', ?, ?, ?)`).run(id, courseId, ...cols.map((c) => row[c]), actorId, ts, ts);
    }
    get().prepare('DELETE FROM assignment_clo_maps WHERE assignment_id = ?').run(id);
    for (const m of maps) {
      get().prepare('INSERT INTO assignment_clo_maps (id, assignment_id, clo_id, contribution_weight) VALUES (?,?,?,?)').run(uuid(), id, m.cloId, m.weight);
    }
    saveRubric(id, title, maxScore, criteria);
    get().prepare('DELETE FROM assignment_sections WHERE assignment_id = ?').run(id);
    for (const d of secDates) {
      get().prepare('INSERT INTO assignment_sections (id, assignment_id, section_id, open_at, due_date) VALUES (?,?,?,?,?)').run(uuid(), id, d.sec.id, d.open_at, d.due_date);
    }
  });
  audit.log(actorId, existing ? 'assignment.update' : 'assignment.create', 'assignment', id, {
    title, maxScore, category: category.code, dueDate, old: existing ? { due_date: existing.due_date, max_score: existing.max_score, instructions: existing.instructions } : null,
  });
  const dueSig = (rows) => JSON.stringify((rows || []).map((r) => [r.section_id || (r.sec && r.sec.id), r.due_date || null]));
  const dueChanged = existing && (existing.due_date !== dueDate || dueSig(existing.sections) !== dueSig(secDates));
  if (existing && existing.status === 'published' && (dueChanged || existing.instructions !== row.instructions || existing.title !== title)) {
    notifyStudents(courseId, {
      eventType: 'assignment_changed', title: `มีการแก้ไขงาน: ${title}`, message: dueChanged ? 'กำหนดส่งมีการเปลี่ยนแปลง' : 'โจทย์/คำสั่งมีการเปลี่ยนแปลง',
      link: `/student/assignments/${id}`, entityType: 'assignment', entityId: id, dedupeKey: `assignment-changed:${id}:${ts}`,
    }, id);
  }
  return id;
}

function rubricChanged(assignmentId, criteria) {
  const r = rubric(assignmentId);
  const old = r ? r.criteria : [];
  if (old.length !== criteria.length) return true;
  return old.some((o, i) => o.criterion_name !== criteria[i].name || Number(o.max_score) !== criteria[i].max || Number(o.weight) !== criteria[i].weight);
}

function saveRubric(assignmentId, title, maxScore, criteria) {
  const db = get();
  let r = db.prepare('SELECT * FROM rubrics WHERE assignment_id = ?').get(assignmentId);
  if (!criteria.length) {
    if (r) {
      const used = db.prepare('SELECT COUNT(*) c FROM rubric_scores rs JOIN rubric_criteria rc ON rc.id = rs.criterion_id WHERE rc.rubric_id = ?').get(r.id).c;
      if (!used) { db.prepare('DELETE FROM rubric_criteria WHERE rubric_id = ?').run(r.id); db.prepare('DELETE FROM rubrics WHERE id = ?').run(r.id); }
    }
    return;
  }
  if (!r) {
    r = { id: uuid() };
    db.prepare('INSERT INTO rubrics (id, assignment_id, rubric_name, max_score) VALUES (?,?,?,?)').run(r.id, assignmentId, `Rubric: ${title}`, maxScore);
  } else {
    db.prepare('UPDATE rubrics SET rubric_name = ?, max_score = ? WHERE id = ?').run(`Rubric: ${title}`, maxScore, r.id);
  }
  const existing = db.prepare('SELECT * FROM rubric_criteria WHERE rubric_id = ? ORDER BY sort_order').all(r.id);
  criteria.forEach((c, i) => {
    if (existing[i]) {
      db.prepare('UPDATE rubric_criteria SET criterion_name = ?, description = ?, max_score = ?, weight = ?, levels = ?, sort_order = ? WHERE id = ?')
        .run(c.name, c.description, c.max, c.weight, JSON.stringify(c.levels), i, existing[i].id);
    } else {
      db.prepare('INSERT INTO rubric_criteria (id, rubric_id, criterion_name, description, max_score, weight, levels, sort_order) VALUES (?,?,?,?,?,?,?,?)')
        .run(uuid(), r.id, c.name, c.description, c.max, c.weight, JSON.stringify(c.levels), i);
    }
  });
  for (const extra of existing.slice(criteria.length)) {
    db.prepare('DELETE FROM rubric_criteria WHERE id = ?').run(extra.id);
  }
}

/** แจ้งเตือนเฉพาะนักศึกษาในกลุ่มที่ได้รับมอบหมายงาน */
function notifyStudents(courseId, payload, assignmentId = null) {
  const a = assignmentId ? getAssignment(assignmentId) : null;
  for (const s of courseSvc.students(courseId)) {
    if (a && !appliesTo(a, s.section)) continue;
    notify.send(s.id, payload);
  }
}

function setStatus(id, status, actorId) {
  const a = getAssignment(id);
  if (!a) throw new ValidationError('ไม่พบงาน');
  if (!['draft', 'published', 'closed'].includes(status)) throw new ValidationError('สถานะไม่ถูกต้อง');
  if (status === 'draft') {
    const subs = get().prepare('SELECT COUNT(*) c FROM submissions WHERE assignment_id = ?').get(id).c;
    if (subs) throw new ValidationError('มีการส่งงานแล้ว ไม่สามารถกลับเป็น Draft ได้');
  }
  get().prepare('UPDATE assignments SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
  audit.log(actorId, `assignment.${status}`, 'assignment', id, { old: a.status });
  if (status === 'published' && a.status === 'draft') {
    notifyStudents(a.course_id, {
      eventType: 'assignment_new', title: `งานใหม่: ${a.title}`, message: a.due_date ? 'มีกำหนดส่ง' : null,
      link: `/student/assignments/${id}`, entityType: 'assignment', entityId: id, dedupeKey: `assignment-new:${id}`,
    }, id);
  }
}

function softDelete(id, actorId) {
  const a = getAssignment(id);
  if (!a) throw new ValidationError('ไม่พบงาน');
  const subs = get().prepare('SELECT COUNT(*) c FROM submissions WHERE assignment_id = ?').get(id).c;
  const grades = get().prepare('SELECT COUNT(*) c FROM grading_records WHERE assignment_id = ?').get(id).c;
  if (subs || grades) throw new ValidationError('มีการส่งงานหรือให้คะแนนแล้ว ไม่สามารถลบได้ (ใช้ "ปิดรับงาน" แทน)');
  get().prepare('UPDATE assignments SET deleted_at = ?, assignment_code = assignment_code || ? WHERE id = ?').run(now(), `~del-${Date.now()}`, id);
  audit.log(actorId, 'assignment.delete', 'assignment', id, { title: a.title });
}

function isOpenForSubmission(a, at = new Date()) {
  if (a.status !== 'published' || a.submission_mode !== 'online') return false;
  if (a.open_at && Date.parse(a.open_at) > at.getTime()) return false;
  if (a.due_date && a.late_policy === 'reject' && Date.parse(a.due_date) < at.getTime()) return false;
  return true;
}

module.exports = {
  ValidationError, TEMPLATES, ANIMATION_TYPES, getAssignment, list, cloMaps, rubric, categoryUsage, categoryUsageBySection, save, setStatus, softDelete, isOpenForSubmission,
  sectionRows, attachSections, appliesTo, forSection, sectionLabelOf,
};
