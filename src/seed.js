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
  course_code: '10802103',
  course_name: 'การสร้างภาพเคลื่อนไหวด้วยเทคนิคภาพ 2 มิติ',
  course_name_en: '2D Animation Techniques',
  semester: '1',
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

// แผนการสอน OBE-3 หมวด 7 — แยกเป็นคาบรายสัปดาห์ (สัปดาห์ละ 4 ชั่วโมง: ทฤษฎี 2 + ปฏิบัติ 2)
const PLAN = [
  [1, 'แนะนำรายวิชาและความรู้พื้นฐานเทคนิคพิเศษของภาพเคลื่อนไหว 2 มิติ และภาพรวมกระบวนการผลิต (Production Pipeline)', 'CLO1',
    'รู้จักรายวิชา CLOs ข้อตกลงร่วมกัน และภาพรวม Production Pipeline', 'การบรรยาย, กรณีศึกษา', 'บรรยายภาพรวมงานแอนิเมชัน 2 มิติ และ Pipeline', 'สำรวจซอฟต์แวร์ Adobe Animate / Toon Boom Harmony / OpenToonz / Krita'],
  [2, 'หลักการเคลื่อนไหว 12 ประการ (12 Principles of Animation) — ตอนที่ 1', 'CLO1',
    'อธิบายหลักการเคลื่อนไหว 12 ประการได้', 'การบรรยาย, มอบหมายงานรายบุคคล', 'บรรยาย Squash & Stretch, Timing, Spacing, Slow in–Slow out', 'ฝึกปฏิบัติ Bouncing Ball'],
  [3, 'หลักการเคลื่อนไหว 12 ประการ — ตอนที่ 2 และการฝึกปฏิบัติ Bouncing Ball', 'CLO1',
    'ประยุกต์หลักการเคลื่อนไหวกับงาน Bouncing Ball', 'การบรรยาย, การฝึกปฏิบัติ', 'วิเคราะห์ตัวอย่างงาน', 'Bouncing Ball (ส่งงาน)'],
  [4, 'การออกแบบตัวละคร (Character Design) โครงสร้าง สัดส่วน', 'CLO2',
    'วิเคราะห์โครงสร้างและสัดส่วนตัวละคร', 'การบรรยาย, Problem-Based Learning', 'บรรยายการออกแบบตัวละคร', 'ร่างแบบตัวละคร'],
  [5, 'การออกแบบตัวละคร — Model Sheet และการแสดงอารมณ์', 'CLO2',
    'สร้าง Model Sheet และ Expression Sheet', 'มอบหมายงานรายบุคคล', 'วิเคราะห์ Model Sheet ตัวอย่าง', 'Character Design & Model Sheet (ส่งงาน)'],
  [6, 'การเขียนบทและสตอรี่บอร์ด (Storyboarding) การวางช็อต', 'CLO2',
    'เขียนบทและวางช็อตเพื่อการเล่าเรื่อง', 'การบรรยาย, Problem-Based Learning', 'บรรยายภาษาภาพและประเภทช็อต', 'เขียนบทสั้นและ Thumbnail Storyboard'],
  [7, 'การจัดองค์ประกอบภาพ และ Animatic', 'CLO2',
    'จัดองค์ประกอบภาพและทำ Animatic', 'มอบหมายงานรายบุคคล', 'วิเคราะห์ Animatic ตัวอย่าง', 'Storyboard & Animatic (ส่งงาน)'],
  [8, 'การเคลื่อนไหวพื้นฐาน (Basic Motion) Walk Cycle, Keyframe และ In-between', 'CLO1',
    'สร้าง Walk Cycle ด้วย Keyframe และ In-between', 'การบรรยาย, การฝึกปฏิบัติ', 'บรรยายกลไกการเดิน', 'Walk Cycle (ส่งงาน)'],
  [9, 'สอบกลางภาค', '', 'สอบกลางภาค', '', '', ''],
  [10, 'เทคนิคการสร้างแอนิเมชัน 2 มิติด้วยซอฟต์แวร์ (Frame-by-Frame)', 'CLO3',
    'ใช้ซอฟต์แวร์สร้างงานแบบ Frame-by-Frame', 'การบรรยาย, มอบหมายงานรายบุคคล', 'สาธิตเครื่องมือซอฟต์แวร์', 'ฝึกปฏิบัติ Frame-by-Frame'],
  [11, 'เทคนิคการสร้างแอนิเมชัน 2 มิติด้วยซอฟต์แวร์ (Cut-out / Rigging)', 'CLO3',
    'สร้างตัวละคร Cut-out และ Rigging', 'การฝึกปฏิบัติ', 'สาธิต Rigging', 'Software Animation (ส่งงาน)'],
  [12, 'การลงสี ฉากหลัง เสียง และการประกอบภาพ (Compositing)', 'CLO2, CLO3',
    'ลงสี จัดฉากหลัง และประกอบภาพ', 'การบรรยาย, การฝึกปฏิบัติ', 'บรรยาย Color Script และ Compositing', 'ฝึกลงสีและประกอบภาพ'],
  [13, 'การทำ Lip Sync และการเรนเดอร์', 'CLO2, CLO3',
    'ทำ Lip Sync และเรนเดอร์งาน', 'มอบหมายงานรายบุคคล', 'สาธิต Lip Sync', 'Motion & Storytelling (ส่งงาน)'],
  [14, 'ปฏิบัติงาน Final Project — พัฒนาชิ้นงานแอนิเมชัน 2 มิติสั้น', 'CLO3, CLO4',
    'วางแผนและพัฒนา Final Project', 'Project-Based Learning', 'ให้คำปรึกษารายบุคคล/กลุ่ม', 'พัฒนาชิ้นงาน'],
  [15, 'ปฏิบัติงาน Final Project — ติดตามความก้าวหน้า', 'CLO3, CLO4',
    'ติดตามและปรับปรุงชิ้นงาน', 'Project-Based Learning', 'Critique ความก้าวหน้า', 'พัฒนาชิ้นงาน'],
  [16, 'นำเสนอ Final Project และการแลกเปลี่ยนความคิดเห็น สรุปบทเรียนร่วมกัน', 'CLO3, CLO4',
    'นำเสนอผลงานและแลกเปลี่ยนความคิดเห็น', 'การนำเสนอผลงาน, กรณีศึกษา', 'นำเสนอผลงาน', 'แลกเปลี่ยนความคิดเห็น'],
  [17, 'สอบปลายภาค', '', 'สอบปลายภาค (ตามแผนรายวิชา)', '', '', ''],
];

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function seedBase({ startDate = process.env.SEED_START_DATE || '2026-06-15', forceChange = true } = {}) {
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
    for (const [week, title, clo, objectives, method, theory, practical] of PLAN) {
      const sid = uuid();
      conn.prepare(`INSERT INTO course_sessions (id, course_id, week_number, title, session_date, start_time, end_time, location, instructor, hours, status, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(sid, courseId, week, title, addDays(startDate, (week - 1) * 7), '09:00', '13:00',
        'ห้องปฏิบัติการคอมพิวเตอร์', 'อาจารย์ทักษิณ อินตะพิงค์', week === 17 ? null : 4, 'published', now());
      conn.prepare(`INSERT INTO session_lesson_details (id, session_id, objectives, topics, theory_activities, practical_activities, teaching_method, clo_codes)
        VALUES (?,?,?,?,?,?,?,?)`).run(uuid(), sid, objectives, title, theory, practical, method, clo);
    }
    conn.prepare(`INSERT INTO course_documents (id, course_id, title, external_url, created_at) VALUES (?,?,?,?,?)`)
      .run(uuid(), courseId, 'รายละเอียดรายวิชา (OBE-3) 1/2569 — ผู้สอนอัปโหลดไฟล์ได้ที่หน้าตั้งค่ารายวิชา', null, now());

    const adminPass = process.env.ADMIN_PASSWORD || 'admin1234';
    auth.createUser({ username: 'admin', fullName: 'ผู้ดูแลระบบ', password: adminPass, role: 'admin', mustChangePassword: forceChange });
    const t1 = auth.createUser({ username: 'thaksin', fullName: 'อาจารย์ทักษิณ อินตะพิงค์', password: process.env.TEACHER_PASSWORD || 'teacher1234', role: 'teacher', mustChangePassword: forceChange });
    const t2 = auth.createUser({ username: 'piriya', fullName: 'ผศ.พิริยะ กาญจนคงคา', password: process.env.TEACHER_PASSWORD || 'teacher1234', role: 'teacher', mustChangePassword: forceChange });
    for (const t of [t1, t2]) conn.prepare('INSERT INTO course_enrollments (id, course_id, user_id) VALUES (?,?,?)').run(uuid(), courseId, t);
    conn.prepare('INSERT INTO announcements (id, course_id, title, body, mandatory, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(uuid(), courseId, 'ยินดีต้อนรับสู่รายวิชา 10802103', 'กรุณาเข้าสู่ระบบด้วยบัญชีของตนเองก่อนสแกน QR เช็คชื่อ และตรวจสอบกำหนดส่งงานในหน้าแรกของรายวิชา', 1, t1, now());
  });
  return true;
}

const DEMO_STUDENTS = [
  ['6501101001', 'กมลชนก ใจดี'], ['6501101002', 'ณัฐพล แสงทอง'], ['6501101003', 'ธนพร ศรีสุข'], ['6501101004', 'ปวริศ วงศ์ไทย'],
  ['6501101005', 'พิมพ์ชนก คำมูล'], ['6501101006', 'ภานุวัฒน์ อินทร์แก้ว'], ['6501101007', 'วรรณิดา บุญมา'], ['6501101008', 'ศุภกร ปัญญาดี'],
  ['6501101009', 'สิริยากร ทองคำ'], ['6501101010', 'อนุชา มณีวงศ์'],
];

function seedDemo() {
  const courseSvc = require('./services/course');
  const course = courseSvc.getCourse();
  const teacher = db.get().prepare("SELECT id FROM users WHERE username = 'thaksin'").get();
  const text = DEMO_STUDENTS.map(([c, n]) => `${c},${n},,S1`).join('\n');
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
  if (demo && created) seedDemo();
  console.log(created ? `สร้างข้อมูลตั้งต้นจาก OBE-3 เรียบร้อย${demo ? ' (พร้อมข้อมูลตัวอย่าง)' : ''}` : 'มีข้อมูลรายวิชาอยู่แล้ว ไม่ได้สร้างซ้ำ');
  db.close();
}

module.exports = { seedBase, seedDemo, DEMO_STUDENTS, CATEGORIES, CLOS, PLAN };
