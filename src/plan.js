'use strict';
/** แผนการสอนตาม OBE-3 หมวด 7 — ใช้สร้างคาบเรียนของแต่ละกลุ่มเรียน */

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

/**
 * ตารางเรียนภาคเรียน 2/2569 (Class Schedule — CMT Program, Elective Courses)
 * day: 0=อาทิตย์ 1=จันทร์ ... 6=เสาร์
 */
const SECTION_SCHEDULE = {
  1: { day: 2, start: '13:00', end: '17:00', location: 'InC 204' }, // อังคาร
  2: { day: 5, start: '13:00', end: '17:00', location: 'InC 204' }, // ศุกร์
  3: { day: 1, start: '13:00', end: '17:00', location: 'InC 204' }, // จันทร์
};

/** วันเปิดภาคเริ่มต้น (ยังไม่ยืนยันกับปฏิทินการศึกษา — แก้ได้ที่หน้า "กลุ่มเรียน") */
const DEFAULT_TERM_START = '2026-11-16';

/** วันแรกที่ตรงกับ weekday ตั้งแต่วันที่ start เป็นต้นไป */
function firstOnOrAfter(start, weekday) {
  const d = new Date(`${start}T00:00:00Z`);
  const diff = (Number(weekday) - d.getUTCDay() + 7) % 7;
  return addDays(start, diff);
}

module.exports = { PLAN, addDays, SECTION_SCHEDULE, DEFAULT_TERM_START, firstOnOrAfter };
