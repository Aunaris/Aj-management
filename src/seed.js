'use strict';
/**
 * ข้อมูลตั้งต้นจาก OBE-3 รายวิชา 10802103 (ภาคการศึกษา 1/2569)
 * - หมวด 1 ข้อมูลทั่วไป, หมวด 2 คำอธิบายรายวิชา/CLOs, หมวด 6 วิธีสอน, หมวด 7 แผนการสอน, หมวด 8 โครงสร้างคะแนน
 * ใช้: node src/seed.js [--reset] [--demo]
 */
const fs = require('fs');
const path = require('path');
const db = require('./db');
const auth = require('./services/auth');
const { uuid, now } = db;

const COURSE = {
  course_code: '10801327', // ตามไฟล์รายชื่อจากระบบทะเบียน (OBE-3/Blueprint ระบุ 10802103) — แก้ไขได้ที่ตั้งค่ารายวิชา
  course_name: 'การสร้างภาพเคลื่อนไหวด้วยเทคนิคภาพ 2 มิติ',
  course_name_en: '2D Animation Techniques',
  semester: '2',
  academic_year: '2569',
  credit: '3 (2-2-5)',
  program: 'ศิลปศาสตรบัณฑิต สาขาวิชาการสื่อสารดิจิทัล',
  faculty: 'คณะสารสนเทศและการสื่อสาร มหาวิทยาลัยแม่โจ้ — สาขาวิชาภาพยนตร์ดิจิทัลและการออกแบบสื่อสร้างสรรค์',
  description_th: 'หลักการ เทคนิค และกระบวนการสร้างภาพเคลื่อนไหวแบบ 2 มิติ การออกแบบตัวละคร การสร้างสตอรี่บอร์ด การเคลื่อนไหวพื้นฐาน การจัดองค์ประกอบภาพ การใช้ซอฟต์แวร์สำหรับงานแอนิเมชันสองมิติ ฝึกปฏิบัติการสร้างสรรค์ชิ้นงานแอนิเมชัน 2 มิติที่สามารถนำเสนอแนวคิด เรื่องราว และสื่อสารอย่างมีประสิทธิภาพ',
  description_en: 'Study the principles, techniques, and processes of creating 2D animation, including character design, storyboarding, basic motion, and composition. Learn to use software for 2D animation and practice producing creative works that effectively present ideas, stories, and communication.',
  instructors: 'ผู้ช่วยศาสตราจารย์พิริยะ กาญจนคงคา (ผู้ประสานงานรายวิชา); อาจารย์ทักษิณ อินตะพิงค์',
  contact: 'Microsoft Teams ของรายวิชา',
};

const CLOS = [
  ['CLO1', 'อธิบายหลักการ เทคนิค และกระบวนการสร้างภาพเคลื่อนไหวแบบ 2 มิติได้', 'Sub PLO 1.5, PLO2, PLO3'],
  ['CLO2', 'วิเคราะห์และออกแบบตัวละคร สตอรี่บอร์ด และการเล่าเรื่องอย่างสร้างสรรค์สำหรับงานแอนิเมชัน 2 มิติได้', 'Sub PLO 1.4, PLO3, PLO4'],
  ['CLO3', 'ใช้ซอฟต์แวร์สร้างสรรค์ชิ้นงานแอนิเมชัน 2 มิติที่นำเสนอแนวคิด เรื่องราว และสื่อสารได้อย่างมีประสิทธิภาพ', 'Sub PLO 1.3, PLO5, PLO6, PLO7'],
  ['CLO4', 'ทำงานร่วมกับผู้อื่น รับฟังและเคารพความคิดเห็นของผู้อื่น ยึดมั่นในคุณธรรม จริยธรรม และจรรยาบรรณในการผลิตงานแอนิเมชัน', 'Sub PLO 1.2, PLO9, PLO11'],
];

// โครงสร้างคะแนน OBE-3 หมวด 8 (รวม 100 คะแนน)
const CATEGORIES = [
  ['PRE_CLO1', 'งานรายบุคคลก่อนกลางภาค: หลักการ/เทคนิค', 'งานรายบุคคล (ก่อนกลางภาค) 30', 15, 'CLO1', 'เข้าใจหลักการ เทคนิค และกระบวนการสร้างภาพเคลื่อนไหว 2 มิติ; ส่งงานครบถ้วน ถูกต้อง และตรงเวลา'],
  ['PRE_CLO2', 'งานรายบุคคลก่อนกลางภาค: ตัวละคร/Storyboard/การเล่าเรื่อง', 'งานรายบุคคล (ก่อนกลางภาค) 30', 15, 'CLO2', 'ออกแบบตัวละคร สตอรี่บอร์ด และการเล่าเรื่องได้เหมาะสม; ส่งงานครบถ้วน ถูกต้อง และตรงเวลา'],
  ['POST_CLO2', 'งานรายบุคคลหลังกลางภาค: การเคลื่อนไหว/การเล่าเรื่อง', 'งานรายบุคคล (หลังกลางภาค) 30', 15, 'CLO2', 'สร้างสรรค์การเคลื่อนไหวและการเล่าเรื่องได้ดี; ส่งงานครบถ้วนและตรงเวลา'],
  ['POST_CLO3', 'งานรายบุคคลหลังกลางภาค: การใช้ซอฟต์แวร์', 'งานรายบุคคล (หลังกลางภาค) 30', 15, 'CLO3', 'ใช้ซอฟต์แวร์แอนิเมชัน 2 มิติผลิตชิ้นงานได้ถูกต้อง; ส่งงานครบถ้วนและตรงเวลา'],
  ['FP_WORK', 'Final Project: ผลงาน', 'Project', 20, 'CLO3', 'สื่อสารแนวคิดและเรื่องราวได้ชัดเจน; คุณภาพการเคลื่อนไหว การลงสี และการประกอบภาพ; ความสมบูรณ์และความคิดสร้างสรรค์'],
  ['FP_PRESENT', 'Final Project: การนำเสนอ', 'Project', 10, 'CLO4', 'นำเสนอแนวคิดและผลงานได้ชัดเจน ลำดับเนื้อหาดี; ทำงานร่วมกับผู้อื่นและรับฟังความคิดเห็น'],
  ['AFFECTIVE', 'จิตพิสัย', 'จิตพิสัย', 10, 'CLO4', 'กระตือรือร้น เข้าเรียนสม่ำเสมอ ส่งงานตรงเวลา; รับฟังและเคารพความคิดเห็นของผู้อื่น; ยึดมั่นในคุณธรรม จริยธรรม และจรรยาบรรณ'],
];

/** ชื่อผู้ใช้ของอาจารย์ผู้สอนหลัก (อาจารย์ทักษิณ อินตะพิงค์) */
const TEACHER_USERNAME = process.env.TEACHER_USERNAME || 'aunalyst';
const LEGACY_TEACHER_USERNAMES = ['thaksin'];

/** ฐานข้อมูลรุ่นก่อนใช้ชื่อผู้ใช้ "thaksin" — เปลี่ยนเป็นชื่อใหม่ (ข้อมูล/รหัสผ่านเดิมยังอยู่ครบ) */
function migrateAccounts() {
  const conn = db.get();
  if (conn.prepare('SELECT 1 FROM users WHERE username = ? OR student_code = ?').get(TEACHER_USERNAME, TEACHER_USERNAME)) return false;
  for (const old of LEGACY_TEACHER_USERNAMES) {
    const u = conn.prepare('SELECT id FROM users WHERE username = ?').get(old);
    if (!u) continue;
    conn.prepare('UPDATE users SET username = ? WHERE id = ?').run(TEACHER_USERNAME, u.id);
    require('./services/audit').log(null, 'user.rename', 'user', u.id, { old, new: TEACHER_USERNAME });
    return true;
  }
  return false;
}

function seedBase({ forceChange = true } = {}) {
  const conn = db.get();
  if (conn.prepare('SELECT COUNT(*) c FROM courses').get().c) return false;
  db.tx(() => {
    for (const r of ['admin', 'teacher', 'student']) conn.prepare('INSERT OR IGNORE INTO roles (id, role_name) VALUES (?,?)').run(uuid(), r);
    const courseId = uuid();
    conn.prepare(`INSERT INTO courses (id, course_code, course_name, course_name_en, semester, academic_year, credit, program, faculty, description_th, description_en, instructors, contact)
      VALUES (@id, @course_code, @course_name, @course_name_en, @semester, @academic_year, @credit, @program, @faculty, @description_th, @description_en, @instructors, @contact)`)
      .run({ id: courseId, ...COURSE });
    for (const [code, desc, plo] of CLOS) {
      conn.prepare('INSERT INTO clo_outcomes (id, course_id, clo_code, description, plo_mapping, passing_criteria) VALUES (?,?,?,?,?,NULL)').run(uuid(), courseId, code, desc, plo);
    }
    CATEGORIES.forEach(([code, name, group, max, clo, hint], i) => {
      conn.prepare('INSERT INTO assessment_categories (id, course_id, code, category_name, group_name, max_score, clo_reference, rubric_hint, sort_order) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(uuid(), courseId, code, name, group, max, clo, hint, i);
    });
    conn.prepare(`INSERT INTO course_documents (id, course_id, title, external_url, created_at) VALUES (?,?,?,?,?)`)
      .run(uuid(), courseId, `รายละเอียดรายวิชา (OBE-3) ${COURSE.semester}/${COURSE.academic_year} — ผู้สอนอัปโหลดไฟล์ได้ที่หน้าตั้งค่ารายวิชา`, null, now());

    const adminPass = process.env.ADMIN_PASSWORD || 'admin1234';
    auth.createUser({ username: 'admin', fullName: 'ผู้ดูแลระบบ', password: adminPass, role: 'admin', mustChangePassword: forceChange });
    const t1 = auth.createUser({ username: TEACHER_USERNAME, fullName: 'อาจารย์ทักษิณ อินตะพิงค์', password: process.env.TEACHER_PASSWORD || 'teacher1234', role: 'teacher', mustChangePassword: forceChange });
    const t2 = auth.createUser({ username: 'piriya', fullName: 'ผศ.พิริยะ กาญจนคงคา', password: process.env.TEACHER_PASSWORD || 'teacher1234', role: 'teacher', mustChangePassword: forceChange });
    for (const t of [t1, t2]) conn.prepare('INSERT INTO course_enrollments (id, course_id, user_id) VALUES (?,?,?)').run(uuid(), courseId, t);
    conn.prepare('INSERT INTO announcements (id, course_id, title, body, mandatory, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(uuid(), courseId, `ยินดีต้อนรับสู่รายวิชา ${COURSE.course_code}`, 'กรุณาเข้าสู่ระบบด้วยบัญชีของตนเองก่อนสแกน QR เช็คชื่อ และตรวจสอบกำหนดส่งงานในหน้าแรกของรายวิชา', 1, t1, now());
  });
  // กลุ่มเรียน 1–3 พร้อมคาบเรียนกลุ่มละ 17 สัปดาห์
  const courseSvc = require('./services/course');
  const c = courseSvc.getCourse();
  db.get().prepare('UPDATE courses SET term_start_date = ? WHERE id = ?').run(process.env.TERM_START_DATE || require('./plan').DEFAULT_TERM_START, c.id);
  for (const code of (process.env.SEED_SECTIONS || '1,2,3').split(',')) courseSvc.ensureSection(c.id, code.trim());
  return true;
}

const DEMO_STUDENTS = [
  ['6501101001', 'กมลชนก ใจดี'], ['6501101002', 'ณัฐพล แสงทอง'], ['6501101003', 'ธนพร ศรีสุข'], ['6501101004', 'ปวริศ วงศ์ไทย'],
  ['6501101005', 'พิมพ์ชนก คำมูล'], ['6501101006', 'ภานุวัฒน์ อินทร์แก้ว'], ['6501101007', 'วรรณิดา บุญมา'], ['6501101008', 'ศุภกร ปัญญาดี'],
  ['6501101009', 'สิริยากร ทองคำ'], ['6501101010', 'อนุชา มณีวงศ์'],
];

function seedDemo({ spread = false } = {}) {
  const courseSvc = require('./services/course');
  const course = courseSvc.getCourse();
  const teacher = db.get().prepare('SELECT id FROM users WHERE username = ?').get(TEACHER_USERNAME);
  const text = DEMO_STUDENTS.map(([c, n], i) => `${c},${n},,${spread ? (i % 3) + 1 : 1}`).join('\n');
  courseSvc.importStudents(course.id, text, teacher.id);
  db.get().prepare('UPDATE users SET must_change_password = 0').run();
  db.get().prepare("UPDATE courses SET structure_confirmed_at = ?, structure_confirmed_by = ?, status = 'active'").run(now(), teacher.id);
  // งานตัวอย่าง
  const assign = require('./services/assignments');
  const cats = courseSvc.categories(course.id);
  const clos = courseSvc.clos(course.id);
  const sessions = courseSvc.sessions(course.id);
  const tpl = assign.TEMPLATES.bouncing_ball;
  const cat = cats.find((c) => c.code === tpl.category);
  const input = {
    title: tpl.title, assignment_code: 'A01', max_score: tpl.max, category_id: cat.id, instructions: tpl.instructions, template: 'bouncing_ball',
    week_number: tpl.week, submission_mode: tpl.mode, allowed_types: tpl.types, allow_links: 1, allow_resubmit: 1, max_versions: 5,
    session_id: sessions.find((s) => s.week_number === 3).id, due_date: new Date(Date.now() + 7 * 86400000).toISOString(),
    criterion_name: tpl.criteria.map((c) => c[0]), criterion_max: tpl.criteria.map((c) => c[1]), criterion_desc: tpl.criteria.map((c) => c[2]),
    [`clo_${clos[0].clo_code}`]: 1, [`clo_weight_${clos[0].clo_code}`]: 1,
  };
  const id = assign.save(course.id, input, teacher.id);
  assign.setStatus(id, 'published', teacher.id);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'classroom.db');
  if (args.includes('--reset') && fs.existsSync(file)) {
    for (const f of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
    console.log('ลบฐานข้อมูลเดิมแล้ว');
  }
  db.open(file);
  const demo = args.includes('--demo');
  const created = seedBase({ forceChange: !demo });
  if (demo && created) seedDemo({ spread: true });
  console.log(created ? `สร้างข้อมูลตั้งต้นจาก OBE-3 เรียบร้อย${demo ? ' (พร้อมข้อมูลตัวอย่าง)' : ''}` : 'มีข้อมูลรายวิชาอยู่แล้ว ไม่ได้สร้างซ้ำ');
  db.close();
}

module.exports = { seedBase, seedDemo, migrateAccounts, TEACHER_USERNAME, DEMO_STUDENTS, CATEGORIES, CLOS };
