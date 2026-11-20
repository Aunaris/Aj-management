/**
 * ============================================================================
 *  2D animation — ระบบเช็คชื่อ ส่งงาน และให้คะแนนระหว่างคาบ
 *  รายวิชา 10801327 การสร้างภาพเคลื่อนไหวด้วยเทคนิคภาพ 2 มิติ
 *  Google Apps Script Web App | ฐานข้อมูล: Google Sheets | ไฟล์งาน: Google Drive
 *
 *  วิธีติดตั้ง
 *   1) แก้ค่า SHEET_ID, WEB_APP_URL, FOLDER_ID, ADMIN_PASSWORD ในส่วน CONFIGURATION
 *   2) Deploy > New deployment > Web app
 *        Execute as: Me | Who has access: Anyone (นักศึกษาเช็คชื่อได้โดยไม่ต้องมีบัญชี Google)
 *   3) นำ URL ของ Web App มาใส่ WEB_APP_URL แล้ว Deploy ใหม่ (Manage deployments > Edit > New version)
 *   4) เข้าสู่ระบบด้วยชื่อผู้ใช้ aunalyst และรหัสผ่าน ADMIN_PASSWORD
 *      ระบบจะสร้างชีต กลุ่มเรียน 3 กลุ่ม และคาบเรียน 17 สัปดาห์ให้อัตโนมัติ
 *      จากนั้นนำเข้ารายชื่อนักศึกษาจากไฟล์ ClassRoster ที่เมนู "นักศึกษา"
 * ============================================================================
 */

/* ============================================================================
 * CONFIGURATION
 * ========================================================================== */
const CONFIG = {
  SHEET_ID: 'ใส่_SPREADSHEET_ID',
  WEB_APP_URL: '',
  FOLDER_ID: 'ใส่_FOLDER_ID',
  ADMIN_PASSWORD: 'ใส่_ADMIN_PASSWORD',

  APP_NAME: '2D animation',
  TEACHER_USERNAME: 'aunalyst',
  TEACHER_NAME: 'อาจารย์ทักษิณ อินตะพิงค์',
  STUDENT_DEFAULT_PASSWORD: '123456',
  MIN_PASSWORD_LENGTH: 8,
  TIMEZONE: 'Asia/Bangkok',
  UTC_OFFSET_HOURS: 7,
  SESSION_TTL_SECONDS: 21600,
  MAX_LOGIN_ATTEMPTS: 10,
  LOGIN_LOCK_SECONDS: 900,
  QR_ROTATE_SECONDS: 30,
  CHECKIN_RATE_PER_MINUTE: 10,
  LOG_VIEW_LIMIT: 500,
  LOCK_WAIT_MS: 25000,

  COURSE: {
    courseCode: '10801327',
    courseName: 'การสร้างภาพเคลื่อนไหวด้วยเทคนิคภาพ 2 มิติ',
    courseNameEn: '2D Animation Techniques',
    semester: '2',
    academicYear: '2569',
    instructors: 'ผู้ช่วยศาสตราจารย์พิริยะ กาญจนคงคา (ผู้ประสานงานรายวิชา); อาจารย์ทักษิณ อินตะพิงค์'
  },
  CLOS: {
    CLO1: 'อธิบายหลักการ เทคนิค และกระบวนการสร้างภาพเคลื่อนไหวแบบ 2 มิติได้',
    CLO2: 'วิเคราะห์และออกแบบตัวละคร สตอรี่บอร์ด และการเล่าเรื่องอย่างสร้างสรรค์สำหรับงานแอนิเมชัน 2 มิติได้',
    CLO3: 'ใช้ซอฟต์แวร์สร้างสรรค์ชิ้นงานแอนิเมชัน 2 มิติที่นำเสนอแนวคิด เรื่องราว และสื่อสารได้อย่างมีประสิทธิภาพ',
    CLO4: 'ทำงานร่วมกับผู้อื่น รับฟังและเคารพความคิดเห็นของผู้อื่น ยึดมั่นในคุณธรรม จริยธรรม และจรรยาบรรณในการผลิตงานแอนิเมชัน'
  },
  // โครงสร้างคะแนน OBE-3 หมวด 8 (รวม 100 คะแนน)
  CATEGORIES: [
    { code: 'PRE_CLO1', name: 'งานรายบุคคลก่อนกลางภาค: หลักการ/เทคนิค', max: 15, clo: 'CLO1' },
    { code: 'PRE_CLO2', name: 'งานรายบุคคลก่อนกลางภาค: ตัวละคร/Storyboard/การเล่าเรื่อง', max: 15, clo: 'CLO2' },
    { code: 'POST_CLO2', name: 'งานรายบุคคลหลังกลางภาค: การเคลื่อนไหว/การเล่าเรื่อง', max: 15, clo: 'CLO2' },
    { code: 'POST_CLO3', name: 'งานรายบุคคลหลังกลางภาค: การใช้ซอฟต์แวร์', max: 15, clo: 'CLO3' },
    { code: 'FP_WORK', name: 'Final Project: ผลงาน', max: 20, clo: 'CLO3' },
    { code: 'FP_PRESENT', name: 'Final Project: การนำเสนอ', max: 10, clo: 'CLO4' },
    { code: 'AFFECTIVE', name: 'จิตพิสัย', max: 10, clo: 'CLO4' }
  ],
  // แผนการสอน 17 สัปดาห์ (สัปดาห์ 9 และ 17 สอบ)
  PLAN: [
    [1, 'แนะนำรายวิชาและภาพรวมกระบวนการผลิต (Production Pipeline)', 'CLO1'],
    [2, 'หลักการเคลื่อนไหว 12 ประการ ตอนที่ 1', 'CLO1'],
    [3, 'หลักการเคลื่อนไหว 12 ประการ ตอนที่ 2 และ Bouncing Ball', 'CLO1'],
    [4, 'การออกแบบตัวละคร โครงสร้าง สัดส่วน', 'CLO2'],
    [5, 'การออกแบบตัวละคร Model Sheet และการแสดงอารมณ์', 'CLO2'],
    [6, 'การเขียนบทและสตอรี่บอร์ด การวางช็อต', 'CLO2'],
    [7, 'การจัดองค์ประกอบภาพ และ Animatic', 'CLO2'],
    [8, 'การเคลื่อนไหวพื้นฐาน Walk Cycle, Keyframe และ In-between', 'CLO1'],
    [9, 'สอบกลางภาค', ''],
    [10, 'เทคนิคการสร้างแอนิเมชันด้วยซอฟต์แวร์ (Frame-by-Frame)', 'CLO3'],
    [11, 'เทคนิคการสร้างแอนิเมชันด้วยซอฟต์แวร์ (Cut-out / Rigging)', 'CLO3'],
    [12, 'การลงสี ฉากหลัง เสียง และการประกอบภาพ (Compositing)', 'CLO2, CLO3'],
    [13, 'การทำ Lip Sync และการเรนเดอร์', 'CLO2, CLO3'],
    [14, 'Final Project พัฒนาชิ้นงานแอนิเมชัน 2 มิติสั้น', 'CLO3, CLO4'],
    [15, 'Final Project ติดตามความก้าวหน้า', 'CLO3, CLO4'],
    [16, 'นำเสนอ Final Project และสรุปบทเรียน', 'CLO3, CLO4'],
    [17, 'สอบปลายภาค', '']
  ],
  EXAM_WEEKS: [9, 17],
  // ตารางเรียนภาคเรียน 2/2569 (meetingDay: 0=อาทิตย์, 1=จันทร์, 2=อังคาร, 3=พุธ, 4=พฤหัสบดี, 5=ศุกร์, 6=เสาร์)
  DEFAULT_SECTIONS: [
    { code: '1', meetingDay: 2, startTime: '13:00', endTime: '17:00', room: 'InC 204' },
    { code: '2', meetingDay: 5, startTime: '13:00', endTime: '17:00', room: 'InC 204' },
    { code: '3', meetingDay: 1, startTime: '13:00', endTime: '17:00', room: 'InC 204' }
  ],
  DEFAULT_TERM_START: '2026-11-16',

  ROLES: { admin: 'อาจารย์ผู้สอนหลัก', teacher: 'อาจารย์ผู้สอน', student: 'นักศึกษา' },
  DAYS: ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'],
  SESSION_STATUS: { scheduled: 'ยังไม่เปิด', open: 'กำลังเช็คชื่อ', closed: 'ปิดเช็คชื่อแล้ว', cancelled: 'งดสอน' },
  ATTENDANCE_STATUS: { present: 'มาเรียน', late: 'สาย', absent: 'ขาด', excused: 'ลา' },
  ASSIGNMENT_STATUS: { draft: 'ฉบับร่าง', published: 'เผยแพร่', closed: 'ปิดรับงาน' },
  SUBMISSION_MODE: { online: 'ส่งออนไลน์ (ไฟล์/ลิงก์)', offline: 'ส่งในห้องเรียน/ให้คะแนนโดยตรง' },
  GRADE_STATUS: { draft: 'ยังไม่เผยแพร่', published: 'เผยแพร่แล้ว' },
  USER_STATUS: { active: 'ใช้งาน', inactive: 'ปิดใช้งาน' },
  FOLDERS: { submissions: 'Submissions', exports: 'Exports', backups: 'Backups' },

  NUMERIC_FIELDS: ['meetingDay', 'week', 'maxScore', 'score', 'version', 'size'],

  SHEETS: {
    Settings: ['key', 'value', 'updatedAt'],
    Teachers: ['id', 'username', 'password', 'fullName', 'status', 'lastLoginAt', 'createdAt', 'updatedAt'],
    Sections: ['id', 'code', 'name', 'meetingDay', 'startTime', 'endTime', 'room', 'firstDate', 'createdAt', 'updatedAt'],
    Students: ['id', 'studentCode', 'fullName', 'sectionCode', 'program', 'faculty', 'email', 'password', 'mustChange', 'status', 'lastLoginAt', 'createdAt', 'updatedAt'],
    Sessions: ['id', 'sectionCode', 'week', 'sessionDate', 'startTime', 'endTime', 'room', 'title', 'clo', 'status', 'openedAt', 'closedAt', 'createdAt', 'updatedAt'],
    Attendance: ['id', 'sessionId', 'studentCode', 'status', 'checkinAt', 'method', 'deviceHash', 'note', 'updatedBy', 'updatedAt'],
    Assignments: ['id', 'code', 'title', 'description', 'categoryCode', 'maxScore', 'sectionScope', 'dueAt', 'sectionDue', 'submissionMode', 'allowLate', 'status', 'createdBy', 'createdAt', 'updatedAt'],
    Submissions: ['id', 'assignmentId', 'studentCode', 'version', 'submittedAt', 'isLate', 'fileIds', 'links', 'note', 'createdAt'],
    Grades: ['id', 'assignmentId', 'studentCode', 'score', 'feedback', 'status', 'gradedBy', 'gradedAt', 'publishedAt'],
    Files: ['id', 'name', 'mimeType', 'size', 'driveId', 'url', 'submissionId', 'assignmentId', 'studentCode', 'createdAt'],
    AuditLog: ['timestamp', 'username', 'action', 'entity', 'entityId', 'detail']
  },

  DEFAULT_SETTINGS: {
    courseCode: '10801327',
    courseName: 'การสร้างภาพเคลื่อนไหวด้วยเทคนิคภาพ 2 มิติ',
    semester: '2',
    academicYear: '2569',
    termStart: '2026-11-16',
    lateMinutes: '15',
    deviceLock: 'on',
    maxUploadMB: '20',
    backupRetention: '30',
    dailyBackup: 'off'
  }
};

/* ============================================================================
 * doGet()
 * ========================================================================== */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(CONFIG.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/* ============================================================================
 * Initial Setup
 * ========================================================================== */
/** เรียกจาก Editor ได้ (Run > setupSystem) หรือระบบเรียกให้อัตโนมัติเมื่อเข้าสู่ระบบ */
function setupSystem() {
  const res = handle_(function () {
    runSetup_();
    const ss = ss_();
    const folder = rootFolder_();
    return ok_({
      spreadsheet: ss.getName(), sheets: ss.getSheets().map(function (s) { return s.getName(); }),
      folder: folder.getName(), sections: readTable_('Sections').rows.length, sessions: readTable_('Sessions').rows.length,
      webAppUrl: appUrl_() || '(ยังไม่ได้ Deploy)'
    }, 'เชื่อมต่อ Google Sheets และ Google Drive สำเร็จ');
  });
  console.log(JSON.stringify(res, null, 2));
  return res;
}

function ensureSetup_() {
  if (CacheService.getScriptCache().get('setup:ok')) return;
  runSetup_();
}

function runSetup_() {
  assertConfigured_();
  withLock_(function () {
    initSheets_();
    ensureDefaultSettings_();
    ensureDefaultSections_();
    Object.keys(CONFIG.FOLDERS).forEach(function (key) { subFolder_(key); });
  });
  CacheService.getScriptCache().put('setup:ok', '1', 21600);
}

function assertConfigured_() {
  if (!CONFIG.SHEET_ID || CONFIG.SHEET_ID.indexOf('ใส่_') === 0) throw appError_('ระบบยังไม่ได้ตั้งค่า SHEET_ID กรุณาติดต่ออาจารย์ผู้ดูแลระบบ');
  if (!CONFIG.FOLDER_ID || CONFIG.FOLDER_ID.indexOf('ใส่_') === 0) throw appError_('ระบบยังไม่ได้ตั้งค่า FOLDER_ID กรุณาติดต่ออาจารย์ผู้ดูแลระบบ');
}

function ensureDefaultSettings_() {
  const map = settingsMap_();
  const add = [];
  const stamp = now_();
  Object.keys(CONFIG.DEFAULT_SETTINGS).forEach(function (key) {
    if (map[key] === undefined) add.push({ key: key, value: CONFIG.DEFAULT_SETTINGS[key], updatedAt: stamp });
  });
  if (add.length) insertRows_('Settings', add);
}

/** สร้างกลุ่มเรียนตามตารางเรียนจริงของรายวิชา (เฉพาะครั้งแรกที่ยังไม่มีกลุ่มเรียน) */
function ensureDefaultSections_() {
  if (readTable_('Sections').rows.length) return;
  const termStart = publicSettings_().termStart || CONFIG.DEFAULT_TERM_START;
  const stamp = now_();
  const rows = CONFIG.DEFAULT_SECTIONS.map(function (s) {
    return {
      id: newId_('SEC'), code: s.code, name: 'กลุ่ม ' + s.code, meetingDay: s.meetingDay, startTime: s.startTime, endTime: s.endTime,
      room: s.room, firstDate: firstOnOrAfter_(termStart, s.meetingDay), createdAt: stamp, updatedAt: stamp
    };
  });
  insertRows_('Sections', rows);
  rows.forEach(function (s) { syncSessions_(s); });
}

/* ============================================================================
 * Sheet Initialization
 * ========================================================================== */
function initSheets_() {
  const ss = ss_();
  Object.keys(CONFIG.SHEETS).forEach(function (name) {
    const headers = CONFIG.SHEETS[name];
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const lastCol = sh.getLastColumn();
    const current = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v).trim(); }) : [];
    const used = current.filter(function (v) { return v !== ''; });
    if (!used.length) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else {
      for (let i = 0; i < used.length && i < headers.length; i++) {
        if (current[i] !== headers[i]) throw appError_('โครงสร้างชีต "' + name + '" ไม่ตรงกับระบบ (คอลัมน์ที่ ' + (i + 1) + ')');
      }
      if (used.length < headers.length) sh.getRange(1, used.length + 1, 1, headers.length - used.length).setValues([headers.slice(used.length)]);
    }
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e6f4f1');
    const textCols = [];
    headers.forEach(function (h, i) {
      if (CONFIG.NUMERIC_FIELDS.indexOf(h) < 0) { const col = columnLetter_(i + 1); textCols.push(col + ':' + col); }
    });
    if (textCols.length) sh.getRangeList(textCols).setNumberFormat('@');
  });
  ['Sheet1', 'ชีต1', 'แผ่น1', 'แผ่นงาน1'].forEach(function (n) {
    const s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
}

/* ============================================================================
 * Authentication
 * ========================================================================== */
const SESSION_EXPIRED_MSG = 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';

function createSession_(kind, id) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('sess:' + token, JSON.stringify({ kind: kind, id: id }), CONFIG.SESSION_TTL_SECONDS);
  return token;
}

/** ตรวจสิทธิ์ทุกคำขอ: allowMustChange = ยอมให้นักศึกษาที่ยังไม่เปลี่ยนรหัสผ่านเรียกได้ */
function auth_(token, roles, allowMustChange) {
  if (!token || typeof token !== 'string' || token.length > 80) throw appError_(SESSION_EXPIRED_MSG, 'SESSION_EXPIRED');
  const cache = CacheService.getScriptCache();
  const raw = cache.get('sess:' + token);
  if (!raw) throw appError_(SESSION_EXPIRED_MSG, 'SESSION_EXPIRED');
  const s = JSON.parse(raw);
  let user;
  if (s.kind === 'admin') {
    user = mainTeacher_();
  } else if (s.kind === 'teacher') {
    const row = findById_('Teachers', s.id);
    if (!row || row.status !== 'active') { cache.remove('sess:' + token); throw appError_('บัญชีนี้ถูกปิดการใช้งาน', 'SESSION_EXPIRED'); }
    user = { id: row.id, username: row.username, fullName: row.fullName, role: 'teacher', builtin: false };
  } else {
    const st = findById_('Students', s.id);
    if (!st || st.status !== 'active') { cache.remove('sess:' + token); throw appError_('บัญชีนักศึกษานี้ถูกปิดการใช้งาน', 'SESSION_EXPIRED'); }
    user = studentUser_(st);
  }
  if (roles && roles.indexOf(user.role) < 0) throw appError_('คุณไม่มีสิทธิ์ใช้งานส่วนนี้');
  if (user.role === 'student' && user.mustChange && !allowMustChange) throw appError_('กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน', 'MUST_CHANGE_PASSWORD');
  cache.put('sess:' + token, raw, CONFIG.SESSION_TTL_SECONDS);
  return user;
}

function mainTeacher_() {
  return { id: 'admin', username: CONFIG.TEACHER_USERNAME, fullName: CONFIG.TEACHER_NAME, role: 'admin', builtin: true };
}

function studentUser_(st) {
  return { id: st.id, username: st.studentCode, studentCode: st.studentCode, fullName: st.fullName, sectionCode: st.sectionCode, role: 'student', mustChange: st.mustChange === '1', builtin: false };
}

const TEACHERS_ = ['admin', 'teacher'];

/* ============================================================================
 * Login / Logout
 * ========================================================================== */
function login(username, password) {
  return handle_(function () {
    ensureSetup_();
    const name = String(username || '').trim();
    const pass = String(password || '');
    if (!name || !pass) throw appError_('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
    if (name.length > 50 || pass.length > 100) throw appError_('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    const cache = CacheService.getScriptCache();
    const failKey = 'fail:' + name.toLowerCase();
    const fails = Number(cache.get(failKey) || 0);
    if (fails >= CONFIG.MAX_LOGIN_ATTEMPTS) throw appError_('เข้าสู่ระบบผิดเกินกำหนด กรุณาลองใหม่ใน ' + Math.round(CONFIG.LOGIN_LOCK_SECONDS / 60) + ' นาที');

    let kind = '';
    let id = '';
    let user = null;
    if (name.toLowerCase() === CONFIG.TEACHER_USERNAME.toLowerCase()) {
      const ready = CONFIG.ADMIN_PASSWORD && CONFIG.ADMIN_PASSWORD.indexOf('ใส่_') !== 0;
      if (ready && pass === CONFIG.ADMIN_PASSWORD) { kind = 'admin'; id = 'admin'; user = mainTeacher_(); }
    } else {
      const teacher = readTable_('Teachers').rows.filter(function (t) { return t.username.toLowerCase() === name.toLowerCase(); })[0];
      if (teacher) {
        if (teacher.status === 'active' && teacher.password === pass) {
          kind = 'teacher'; id = teacher.id;
          user = { id: teacher.id, username: teacher.username, fullName: teacher.fullName, role: 'teacher' };
          withLock_(function () { updateRow_('Teachers', findById_('Teachers', teacher.id), { lastLoginAt: now_() }); });
        }
      } else {
        const st = readTable_('Students').rows.filter(function (s) { return s.studentCode === name; })[0];
        if (st && st.status === 'active' && st.password === pass) {
          kind = 'student'; id = st.id;
          user = studentUser_(st);
          withLock_(function () { updateRow_('Students', findById_('Students', st.id), { lastLoginAt: now_() }); });
        }
      }
    }
    if (!user) {
      cache.put(failKey, String(fails + 1), CONFIG.LOGIN_LOCK_SECONDS);
      audit_({ username: name }, 'login_failed', 'Auth', '', 'เข้าสู่ระบบไม่สำเร็จ');
      throw appError_('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }
    cache.remove(failKey);
    const token = createSession_(kind, id);
    audit_(user, 'login', 'Auth', id, 'เข้าสู่ระบบ');
    return ok_({ token: token, bootstrap: buildBootstrap_(user) }, 'เข้าสู่ระบบสำเร็จ');
  });
}

function logout(token) {
  return handle_(function () {
    const cache = CacheService.getScriptCache();
    if (token && typeof token === 'string' && token.length <= 80) {
      if (cache.get('sess:' + token)) audit_({ username: 'session' }, 'logout', 'Auth', '', 'ออกจากระบบ');
      cache.remove('sess:' + token);
    }
    return ok_({}, 'ออกจากระบบแล้ว');
  });
}

function getBootstrap(token) {
  return handle_(function () {
    const user = auth_(token, null, true);
    return ok_(buildBootstrap_(user));
  });
}

function buildBootstrap_(user) {
  const settings = publicSettings_();
  const out = {
    appName: CONFIG.APP_NAME,
    appUrl: appUrl_(),
    user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role, roleLabel: CONFIG.ROLES[user.role], builtin: !!user.builtin, mustChange: !!user.mustChange, sectionCode: user.sectionCode || '', studentCode: user.studentCode || '' },
    settings: settings,
    course: courseInfo_(settings),
    sections: sectionList_(),
    meta: {
      days: CONFIG.DAYS, categories: CONFIG.CATEGORIES, clos: CONFIG.CLOS, sessionStatus: CONFIG.SESSION_STATUS,
      attendanceStatus: CONFIG.ATTENDANCE_STATUS, assignmentStatus: CONFIG.ASSIGNMENT_STATUS, submissionMode: CONFIG.SUBMISSION_MODE,
      gradeStatus: CONFIG.GRADE_STATUS, roles: CONFIG.ROLES, userStatus: CONFIG.USER_STATUS, minPasswordLength: CONFIG.MIN_PASSWORD_LENGTH,
      qrRotateSeconds: CONFIG.QR_ROTATE_SECONDS, examWeeks: CONFIG.EXAM_WEEKS
    }
  };
  if (user.role === 'student') {
    if (!user.mustChange) out.student = studentData_(user);
  } else {
    out.dashboard = dashboard_();
  }
  return out;
}

function courseInfo_(settings) {
  return {
    courseCode: settings.courseCode, courseName: settings.courseName, courseNameEn: CONFIG.COURSE.courseNameEn,
    semester: settings.semester, academicYear: settings.academicYear, instructors: CONFIG.COURSE.instructors
  };
}

/** ข้อมูลสาธารณะสำหรับหน้าเข้าสู่ระบบ (ไม่มีข้อมูลส่วนบุคคล) */
function getPublicInfo() {
  return handle_(function () {
    ensureSetup_();
    const settings = publicSettings_();
    return ok_({ course: courseInfo_(settings), sections: sectionList_().map(function (s) { return { code: s.code, name: s.name, dayLabel: s.dayLabel, startTime: s.startTime, endTime: s.endTime, room: s.room }; }) });
  });
}

function changeMyPassword(token, data) {
  return handle_(function () {
    const user = auth_(token, null, true);
    if (user.builtin) throw appError_('รหัสผ่านของอาจารย์ผู้สอนหลักเปลี่ยนได้ที่ส่วน CONFIGURATION ใน Code.gs เท่านั้น');
    const d = data || {};
    const current = String(d.currentPassword || '');
    const next = String(d.newPassword || '');
    const confirm = String(d.confirmPassword || '');
    if (!current || !next || !confirm) throw appError_('กรุณากรอกข้อมูลให้ครบ');
    if (next.length < CONFIG.MIN_PASSWORD_LENGTH) throw appError_('รหัสผ่านใหม่ต้องมีอย่างน้อย ' + CONFIG.MIN_PASSWORD_LENGTH + ' ตัวอักษร');
    if (next.length > 100) throw appError_('รหัสผ่านยาวเกินไป');
    if (next !== confirm) throw appError_('ยืนยันรหัสผ่านไม่ตรงกัน');
    if (next === CONFIG.STUDENT_DEFAULT_PASSWORD) throw appError_('ห้ามใช้รหัสผ่านเริ่มต้นเป็นรหัสผ่านใหม่');
    return withLock_(function () {
      const sheet = user.role === 'student' ? 'Students' : 'Teachers';
      const row = findById_(sheet, user.id);
      if (!row || row.password !== current) throw appError_('รหัสผ่านปัจจุบันไม่ถูกต้อง');
      if (current === next) throw appError_('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
      const patch = { password: next, updatedAt: now_() };
      if (sheet === 'Students') patch.mustChange = '0';
      updateRow_(sheet, row, patch);
      audit_(user, 'change_password', sheet === 'Students' ? 'Student' : 'Teacher', user.id, 'เปลี่ยนรหัสผ่านตนเอง');
      const fresh = sheet === 'Students' ? studentUser_(findById_('Students', user.id)) : user;
      return ok_({ bootstrap: buildBootstrap_(fresh) }, 'เปลี่ยนรหัสผ่านเรียบร้อย');
    });
  });
}

/* ============================================================================
 * Section & Schedule Management
 * ========================================================================== */
function sectionList_() {
  const students = readTable_('Students').rows.filter(function (s) { return s.status === 'active'; });
  const sessions = readTable_('Sessions').rows;
  const today = today_();
  return readTable_('Sections').rows.map(function (s) {
    const mine = sessions.filter(function (x) { return x.sectionCode === s.code && x.status !== 'cancelled'; })
      .sort(function (a, b) { return a.sessionDate.localeCompare(b.sessionDate); });
    const next = mine.filter(function (x) { return x.status === 'open' || (x.sessionDate >= today && x.status === 'scheduled'); })[0] || null;
    return {
      id: s.id, code: s.code, name: s.name || ('กลุ่ม ' + s.code), meetingDay: s.meetingDay, dayLabel: CONFIG.DAYS[s.meetingDay] || '',
      startTime: s.startTime, endTime: s.endTime, room: s.room, firstDate: s.firstDate,
      studentCount: students.filter(function (x) { return x.sectionCode === s.code; }).length,
      next: next ? { id: next.id, week: next.week, sessionDate: next.sessionDate, status: next.status } : null
    };
  }).sort(function (a, b) { return ((a.meetingDay + 6) % 7) - ((b.meetingDay + 6) % 7) || a.code.localeCompare(b.code); });
}

function listSections(token) {
  return handle_(function () {
    auth_(token, TEACHERS_);
    return ok_({ items: sectionList_() });
  });
}

function saveSection(token, data) {
  return handle_(function () {
    const user = auth_(token, ['admin']);
    const d = data || {};
    const input = {
      code: req_(str_(d.code, 10), 'รหัสกลุ่มเรียน'),
      name: str_(d.name, 60),
      meetingDay: intRange_(d.meetingDay, 0, 6, 'วันเรียน'),
      startTime: time_(d.startTime, 'เวลาเริ่ม'),
      endTime: time_(d.endTime, 'เวลาสิ้นสุด'),
      room: str_(d.room, 60),
      firstDate: date_(d.firstDate, 'วันที่เรียนสัปดาห์ที่ 1', true)
    };
    if (!/^[A-Za-z0-9]{1,10}$/.test(input.code)) throw appError_('รหัสกลุ่มเรียนต้องเป็นตัวอักษรหรือตัวเลข');
    if (input.endTime <= input.startTime) throw appError_('เวลาสิ้นสุดต้องหลังเวลาเริ่ม');
    if (weekdayOf_(input.firstDate) !== input.meetingDay) throw appError_('วันที่เรียนสัปดาห์ที่ 1 ต้องตรงกับวัน' + CONFIG.DAYS[input.meetingDay]);
    if (!input.name) input.name = 'กลุ่ม ' + input.code;
    return withLock_(function () {
      const rows = readTable_('Sections').rows;
      if (rows.some(function (r) { return r.code === input.code && r.id !== d.id; })) throw appError_('รหัสกลุ่มเรียนซ้ำ');
      let saved;
      if (d.id) {
        const cur = findById_('Sections', d.id);
        if (!cur) throw appError_('ไม่พบกลุ่มเรียน');
        if (cur.code !== input.code) throw appError_('ไม่สามารถเปลี่ยนรหัสกลุ่มเรียนที่สร้างแล้วได้');
        saved = updateRow_('Sections', cur, Object.assign({}, input, { updatedAt: now_() }));
      } else {
        saved = Object.assign({ id: newId_('SEC'), createdAt: now_(), updatedAt: now_() }, input);
        insertRows_('Sections', [saved]);
      }
      const result = syncSessions_(saved);
      audit_(user, d.id ? 'update' : 'create', 'Section', saved.id, saved.name + ' (สร้างคาบ ' + result.created + ', เลื่อนวัน ' + result.moved + ')');
      return ok_({ items: sectionList_() }, 'บันทึกกลุ่มเรียนแล้ว · สร้างคาบใหม่ ' + result.created + ' คาบ · ปรับวันที่ ' + result.moved + ' คาบ');
    });
  });
}

function deleteSection(token, id) {
  return handle_(function () {
    const user = auth_(token, ['admin']);
    return withLock_(function () {
      const cur = findById_('Sections', id);
      if (!cur) throw appError_('ไม่พบกลุ่มเรียน');
      if (readTable_('Students').rows.some(function (s) { return s.sectionCode === cur.code; })) throw appError_('ไม่สามารถลบได้ เนื่องจากยังมีนักศึกษาในกลุ่มนี้');
      const sessionIds = {};
      readTable_('Sessions').rows.forEach(function (s) { if (s.sectionCode === cur.code) sessionIds[s.id] = true; });
      if (readTable_('Attendance').rows.some(function (a) { return sessionIds[a.sessionId]; })) throw appError_('ไม่สามารถลบได้ เนื่องจากมีข้อมูลการเข้าเรียนแล้ว');
      deleteWhere_('Sessions', function (s) { return s.sectionCode === cur.code; });
      deleteWhere_('Sections', function (s) { return s.id === cur.id; });
      audit_(user, 'delete', 'Section', cur.id, cur.name);
      return ok_({ items: sectionList_() }, 'ลบกลุ่มเรียนแล้ว');
    });
  });
}

/** ตั้งวันเปิดภาค แล้วคำนวณวันที่เรียนสัปดาห์ที่ 1 ของทุกกลุ่มใหม่ (ไม่แตะคาบที่เปิด/ปิดเช็คชื่อแล้ว) */
function setTermStart(token, dateStr) {
  return handle_(function () {
    const user = auth_(token, ['admin']);
    const termStart = date_(dateStr, 'วันเปิดภาคเรียน', true);
    return withLock_(function () {
      setSettingValues_([['termStart', termStart]]);
      let created = 0;
      let moved = 0;
      readTable_('Sections').rows.forEach(function (s) {
        const updated = updateRow_('Sections', findById_('Sections', s.id), { firstDate: firstOnOrAfter_(termStart, s.meetingDay), updatedAt: now_() });
        const r = syncSessions_(updated);
        created += r.created;
        moved += r.moved;
      });
      audit_(user, 'update', 'Settings', 'termStart', termStart);
      return ok_({ items: sectionList_(), settings: publicSettings_() }, 'ตั้งวันเปิดภาคแล้ว · สร้างคาบ ' + created + ' · ปรับวันที่ ' + moved + ' คาบ');
    });
  });
}

/** สร้างคาบ 17 สัปดาห์ให้กลุ่มเรียน และเลื่อนวันที่/เวลาของคาบที่ยังไม่เปิดเช็คชื่อให้ตรงตาราง */
function syncSessions_(section) {
  const all = readTable_('Sessions').rows;
  const mine = all.filter(function (s) { return s.sectionCode === section.code; });
  const touched = {};
  readTable_('Attendance').rows.forEach(function (a) { touched[a.sessionId] = true; });
  const stamp = now_();
  const add = [];
  let moved = 0;
  const updates = {};
  CONFIG.PLAN.forEach(function (p) {
    const week = p[0];
    const date = addDays_(section.firstDate, (week - 1) * 7);
    const existing = mine.filter(function (s) { return s.week === week; })[0];
    if (!existing) {
      add.push({
        id: newId_('SES'), sectionCode: section.code, week: week, sessionDate: date, startTime: section.startTime, endTime: section.endTime,
        room: section.room, title: p[1], clo: p[2], status: 'scheduled', openedAt: '', closedAt: '', createdAt: stamp, updatedAt: stamp
      });
    } else if (existing.status === 'scheduled' && !touched[existing.id]) {
      if (existing.sessionDate !== date || existing.startTime !== section.startTime || existing.endTime !== section.endTime || existing.room !== section.room) {
        updates[existing.id] = { sessionDate: date, startTime: section.startTime, endTime: section.endTime, room: section.room, updatedAt: stamp };
        moved += 1;
      }
    }
  });
  if (moved) {
    rewriteTable_('Sessions', all.map(function (s) { return updates[s.id] ? Object.assign({}, s, updates[s.id]) : s; }));
  }
  if (add.length) insertRows_('Sessions', add);
  return { created: add.length, moved: moved };
}

/* ============================================================================
 * Student Management
 * ========================================================================== */
function listStudents(token) {
  return handle_(function () {
    auth_(token, TEACHERS_);
    const items = readTable_('Students').rows.map(studentView_)
      .sort(function (a, b) { return a.sectionCode.localeCompare(b.sectionCode) || a.studentCode.localeCompare(b.studentCode); });
    return ok_({ items: items });
  });
}

function studentView_(s) {
  return {
    id: s.id, studentCode: s.studentCode, fullName: s.fullName, sectionCode: s.sectionCode, program: s.program, faculty: s.faculty,
    email: s.email, mustChange: s.mustChange === '1', status: s.status, lastLoginAt: s.lastLoginAt, createdAt: s.createdAt
  };
}

/**
 * นำเข้ารายชื่อเป็นชุด (setValues ครั้งเดียว) — rows: [{studentCode, fullName, sectionCode, program, faculty, email}]
 * รหัสที่มีอยู่แล้วจะอัปเดตชื่อ/กลุ่ม ไม่สร้างซ้ำ และไม่เปลี่ยนรหัสผ่าน
 */
function importStudents(token, payload) {
  return handle_(function () {
    const user = auth_(token, ['admin']);
    const list = payload && payload.rows;
    if (!list || !list.length) throw appError_('ไม่พบรายชื่อนักศึกษาในไฟล์');
    if (list.length > 2000) throw appError_('นำเข้าได้ครั้งละไม่เกิน 2000 รายการ');
    return withLock_(function () {
      const sectionCodes = {};
      readTable_('Sections').rows.forEach(function (s) { sectionCodes[s.code] = true; });
      const t = readTable_('Students');
      const byCode = indexBy_(t.rows, 'studentCode');
      const rows = t.rows.map(function (r) { return Object.assign({}, r); });
      const rowByCode = indexBy_(rows, 'studentCode');
      const stamp = now_();
      const errors = [];
      let created = 0;
      let updated = 0;
      const seen = {};
      list.forEach(function (r, i) {
        const code = str_(r.studentCode, 20).replace(/\s/g, '');
        const name = str_(r.fullName, 150);
        const sec = str_(r.sectionCode, 10);
        const line = 'แถวที่ ' + (i + 1);
        if (!/^\d{5,15}$/.test(code)) { errors.push(line + ': รหัสนักศึกษาไม่ถูกต้อง'); return; }
        if (!name) { errors.push(line + ': ไม่มีชื่อ-สกุล'); return; }
        if (!sectionCodes[sec]) { errors.push(line + ': ไม่พบกลุ่มเรียน "' + sec + '"'); return; }
        if (seen[code]) { errors.push(line + ': รหัส ' + code + ' ซ้ำในไฟล์'); return; }
        seen[code] = true;
        if (byCode[code]) {
          const row = rowByCode[code];
          row.fullName = name;
          row.sectionCode = sec;
          if (r.program) row.program = str_(r.program, 200);
          if (r.faculty) row.faculty = str_(r.faculty, 200);
          if (r.email) row.email = str_(r.email, 120);
          row.status = 'active';
          row.updatedAt = stamp;
          updated += 1;
        } else {
          rows.push({
            id: newId_('STD'), studentCode: code, fullName: name, sectionCode: sec, program: str_(r.program, 200), faculty: str_(r.faculty, 200),
            email: str_(r.email, 120), password: CONFIG.STUDENT_DEFAULT_PASSWORD, mustChange: '1', status: 'active', lastLoginAt: '', createdAt: stamp, updatedAt: stamp
          });
          created += 1;
        }
      });
      if (created || updated) rewriteTable_('Students', rows);
      audit_(user, 'import', 'Student', '', 'เพิ่ม ' + created + ' · อัปเดต ' + updated + ' · ข้อผิดพลาด ' + errors.length);
      return ok_({ created: created, updated: updated, errors: errors.slice(0, 50), errorCount: errors.length }, 'นำเข้าแล้ว: เพิ่มใหม่ ' + created + ' คน · อัปเดต ' + updated + ' คน' + (errors.length ? ' · ข้าม ' + errors.length + ' แถว' : ''));
    });
  });
}

function saveStudent(token, data) {
  return handle_(function () {
    const user = auth_(token, ['admin']);
    const d = data || {};
    const input = {
      studentCode: req_(str_(d.studentCode, 20), 'รหัสนักศึกษา'),
      fullName: req_(str_(d.fullName, 150), 'ชื่อ-สกุล'),
      sectionCode: req_(str_(d.sectionCode, 10), 'กลุ่มเรียน'),
      program: str_(d.program, 200),
      faculty: str_(d.faculty, 200),
      email: str_(d.email, 120),
      status: oneOf_(d.status || 'active', CONFIG.USER_STATUS, 'สถานะ')
    };
    if (!/^\d{5,15}$/.test(input.studentCode)) throw appError_('รหัสนักศึกษาต้องเป็นตัวเลข 5–15 หลัก');
    if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw appError_('รูปแบบอีเมลไม่ถูกต้อง');
    return withLock_(function () {
      if (!readTable_('Sections').rows.some(function (s) { return s.code === input.sectionCode; })) throw appError_('ไม่พบกลุ่มเรียน');
      const rows = readTable_('Students').rows;
      if (rows.some(function (s) { return s.studentCode === input.studentCode && s.id !== d.id; })) throw appError_('รหัสนักศึกษา ' + input.studentCode + ' มีอยู่แล้ว');
      let saved;
      if (d.id) {
        const cur = findById_('Students', d.id);
        if (!cur) throw appError_('ไม่พบนักศึกษา');
        if (cur.studentCode !== input.studentCode && hasStudentRecords_(cur.studentCode)) throw appError_('ไม่สามารถเปลี่ยนรหัสนักศึกษาที่มีประวัติเข้าเรียน/ส่งงานแล้วได้');
        saved = updateRow_('Students', cur, Object.assign({}, input, { updatedAt: now_() }));
        audit_(user, 'update', 'Student', cur.id, input.studentCode + ' ' + input.fullName + ' กลุ่ม ' + input.sectionCode);
      } else {
        saved = Object.assign({ id: newId_('STD'), password: CONFIG.STUDENT_DEFAULT_PASSWORD, mustChange: '1', lastLoginAt: '', createdAt: now_(), updatedAt: now_() }, input);
        insertRows_('Students', [saved]);
        audit_(user, 'create', 'Student', saved.id, input.studentCode + ' ' + input.fullName);
      }
      return ok_(studentView_(saved), 'บันทึกข้อมูลนักศึกษาแล้ว');
    });
  });
}

function resetStudentPassword(token, id) {
  return handle_(function () {
    const user = auth_(token, TEACHERS_);
    return withLock_(function () {
      const cur = findById_('Students', id);
      if (!cur) throw appError_('ไม่พบนักศึกษา');
      updateRow_('Students', cur, { password: CONFIG.STUDENT_DEFAULT_PASSWORD, mustChange: '1', updatedAt: now_() });
      audit_(user, 'reset_password', 'Student', cur.id, cur.studentCode);
      return ok_({ id: cur.id }, 'รีเซ็ตรหัสผ่านของ ' + cur.studentCode + ' เป็น ' + CONFIG.STUDENT_DEFAULT_PASSWORD + ' แล้ว (บังคับเปลี่ยนเมื่อเข้าสู่ระบบ)');
    });
  });
}

function deleteStudent(token, id) {
  return handle_(function () {
    const user = auth_(token, ['admin']);
    return withLock_(function () {
      const cur = findById_('Students', id);
      if (!cur) throw appError_('ไม่พบนักศึกษา');
      if (hasStudentRecords_(cur.studentCode)) throw appError_('นักศึกษามีประวัติเข้าเรียนหรือส่งงานแล้ว ให้เปลี่ยนสถานะเป็น "ปิดใช้งาน" แทนการลบ');
      deleteWhere_('Students', function (s) { return s.id === cur.id; });
      audit_(user, 'delete', 'Student', cur.id, cur.studentCode + ' ' + cur.fullName);
      return ok_({ id: cur.id }, 'ลบนักศึกษาแล้ว');
    });
  });
}

function hasStudentRecords_(code) {
  return readTable_('Attendance').rows.some(function (a) { return a.studentCode === code; }) ||
    readTable_('Submissions').rows.some(function (s) { return s.studentCode === code; }) ||
    readTable_('Grades').rows.some(function (g) { return g.studentCode === code; });
}

/* ============================================================================
 * Class Sessions & Attendance (เช็คชื่อ)
 * ========================================================================== */
function listSessions(token) {
  return handle_(function () {
    auth_(token, TEACHERS_);
    const att = readTable_('Attendance').rows;
    const counts = {};
    att.forEach(function (a) {
      const c = counts[a.sessionId] || (counts[a.sessionId] = { present: 0, late: 0, absent: 0, excused: 0 });
      if (c[a.status] !== undefined) c[a.status] += 1;
    });
    const sectionSize = {};
    readTable_('Students').rows.forEach(function (s) { if (s.status === 'active') sectionSize[s.sectionCode] = (sectionSize[s.sectionCode] || 0) + 1; });
    const items = readTable_('Sessions').rows.map(function (s) {
      return Object.assign(sessionView_(s), { counts: counts[s.id] || { present: 0, late: 0, absent: 0, excused: 0 }, studentCount: sectionSize[s.sectionCode] || 0 });
    }).sort(function (a, b) { return a.sessionDate.localeCompare(b.sessionDate) || a.sectionCode.localeCompare(b.sectionCode); });
    return ok_({ items: items });
  });
}

function sessionView_(s) {
  return {
    id: s.id, sectionCode: s.sectionCode, week: s.week, sessionDate: s.sessionDate, startTime: s.startTime, endTime: s.endTime, room: s.room,
    title: s.title, clo: s.clo, status: s.status, statusLabel: CONFIG.SESSION_STATUS[s.status] || s.status,
    isExam: CONFIG.EXAM_WEEKS.indexOf(s.week) >= 0, openedAt: s.openedAt, closedAt: s.closedAt
  };
}

function updateSession(token, data) {
  return handle_(function () {
    const user = auth_(token, ['admin']);
    const d = data || {};
    return withLock_(function () {
      const cur = findById_('Sessions', d.id);
      if (!cur) throw appError_('ไม่พบคาบเรียน');
      const input = {
        sessionDate: date_(d.sessionDate, 'วันที่', true),
        startTime: time_(d.startTime, 'เวลาเริ่ม'),
        endTime: time_(d.endTime, 'เวลาสิ้นสุด'),
        room: str_(d.room, 60),
        title: req_(str_(d.title, 300), 'หัวข้อ'),
        status: cur.status
      };
      if (input.endTime <= input.startTime) throw appError_('เวลาสิ้นสุดต้องหลังเวลาเริ่ม');
      if (d.cancelled === true && cur.status === 'scheduled') input.status = 'cancelled';
      if (d.cancelled === false && cur.status === 'cancelled') input.status = 'scheduled';
      if (d.cancelled === true && cur.status !== 'scheduled' && cur.status !== 'cancelled') throw appError_('งดสอนได้เฉพาะคาบที่ยังไม่เปิดเช็คชื่อ');
      const saved = updateRow_('Sessions', cur, Object.assign({}, input, { updatedAt: now_() }));
      audit_(user, 'update', 'Session', cur.id, 'กลุ่ม ' + cur.sectionCode + ' สัปดาห์ ' + cur.week);
      return ok_(sessionView_(saved), 'บันทึกคาบเรียนแล้ว');
    });
  });
}

function openSession(token, id) {
  return handle_(function () {
    const user = auth_(token, TEACHERS_);
    return withLock_(function () {
      const cur = findById_('Sessions', id);
      if (!cur) throw appError_('ไม่พบคาบเรียน');
      if (cur.status === 'cancelled') throw appError_('คาบนี้ถูกตั้งเป็นงดสอน');
      const patch = { status: 'open', updatedAt: now_() };
      if (!cur.openedAt) patch.openedAt = now_();
      patch.closedAt = '';
      updateRow_('Sessions', cur, patch);
      rotateCode_(cur.id, true);
      audit_(user, 'open', 'Session', cur.id, 'เปิดเช็คชื่อ กลุ่ม ' + cur.sectionCode + ' สัปดาห์ ' + cur.week);
      return ok_({ id: cur.id }, 'เปิดเช็คชื่อแล้ว');
    });
  });
}

function closeSession(token, id, markAbsent) {
  return handle_(function () {
    const user = auth_(token, TEACHERS_);
    return withLock_(function () {
      const cur = findById_('Sessions', id);
      if (!cur) throw appError_('ไม่พบคาบเรียน');
      if (cur.status !== 'open') throw appError_('คาบนี้ไม่ได้เปิดเช็คชื่ออยู่');
      updateRow_('Sessions', cur, { status: 'closed', closedAt: now_(), updatedAt: now_() });
      const cache = CacheService.getScriptCache();
      const state = cache.get('qrs:' + cur.id);
      if (state) {
        const st = JSON.parse(state);
        [st.code, st.prev].forEach(function (c) { if (c) cache.remove('qrc:' + c); });
        cache.remove('qrs:' + cur.id);
      }
      let absent = 0;
      if (markAbsent) {
        const done = {};
        readTable_('Attendance').rows.forEach(function (a) { if (a.sessionId === cur.id) done[a.studentCode] = true; });
        const stamp = now_();
        const add = readTable_('Students').rows.filter(function (s) { return s.status === 'active' && s.sectionCode === cur.sectionCode && !done[s.studentCode]; })
          .map(function (s) { return { id: newId_('ATT'), sessionId: cur.id, studentCode: s.studentCode, status: 'absent', checkinAt: '', method: 'auto_close', deviceHash: '', note: 'ไม่ได้เช็คชื่อ', updatedBy: user.username, updatedAt: stamp }; });
        insertRows_('Attendance', add);
        absent = add.length;
      }
      audit_(user, 'close', 'Session', cur.id, 'ปิดเช็คชื่อ กลุ่ม ' + cur.sectionCode + ' สัปดาห์ ' + cur.week + (markAbsent ? ' (บันทึกขาด ' + absent + ')' : ''));
      return ok_({ id: cur.id, absent: absent }, 'ปิดเช็คชื่อแล้ว' + (markAbsent ? ' · บันทึกขาด ' + absent + ' คน' : ''));
    });
  });
}

/** รหัสเช็คชื่อ 6 ตัว หมุนทุก QR_ROTATE_SECONDS วินาที (รหัสก่อนหน้ายังใช้ได้อีก 1 รอบ) */
function rotateCode_(sessionId, force) {
  const cache = CacheService.getScriptCache();
  const raw = cache.get('qrs:' + sessionId);
  const nowMs = Date.now();
  let st = raw ? JSON.parse(raw) : null;
  if (!st || force || nowMs - st.issuedAt >= CONFIG.QR_ROTATE_SECONDS * 1000) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + nowMs);
    for (let i = 0; i < 6; i++) code += alphabet.charAt((bytes[i] + 256) % alphabet.length);
    const prev = st ? st.code : '';
    st = { code: code, prev: prev, issuedAt: nowMs };
    const ttl = CONFIG.QR_ROTATE_SECONDS * 2 + 15;
    cache.put('qrc:' + code, sessionId, ttl);
    if (prev) cache.put('qrc:' + prev, sessionId, CONFIG.QR_ROTATE_SECONDS + 15);
    cache.put('qrs:' + sessionId, JSON.stringify(st), 21600);
  }
  return { code: st.code, expiresIn: Math.max(1, Math.round((st.issuedAt + CONFIG.QR_ROTATE_SECONDS * 1000 - nowMs) / 1000)) };
}

/** ข้อมูลหน้าระหว่างคาบ (เรียกซ้ำทุกไม่กี่วินาทีจากจอโปรเจกเตอร์) */
function getLiveSession(token, id) {
  return handle_(function () {
    auth_(token, TEACHERS_);
    const s = findById_('Sessions', id);
    if (!s) throw appError_('ไม่พบคาบเรียน');
    const qr = s.status === 'open' ? rotateCode_(s.id, false) : null;
    const att = indexBy_(readTable_('Attendance').rows.filter(function (a) { return a.sessionId === s.id; }), 'studentCode');
    const roster = readTable_('Students').rows.filter(function (st) { return st.sectionCode === s.sectionCode && st.status === 'active'; })
      .sort(function (a, b) { return a.studentCode.localeCompare(b.studentCode); })
      .map(function (st) {
        const a = att[st.studentCode];
        return { studentCode: st.studentCode, fullName: st.fullName, status: a ? a.status : '', checkinAt: a ? a.checkinAt : '', method: a ? a.method : '', note: a ? a.note : '' };
      });
    const counts = { present: 0, late: 0, absent: 0, excused: 0, none: 0 };
    roster.forEach(function (r) { if (r.status) counts[r.status] += 1; else counts.none += 1; });
    const base = appUrl_();
    return ok_({
      session: sessionView_(s), code: qr ? qr.code : '', expiresIn: qr ? qr.expiresIn : 0,
      checkinUrl: qr && base ? base + '?checkin=' + qr.code : '', roster: roster, counts: counts, serverTime: now_()
    });
  });
}

/** เช็คชื่อโดยนักศึกษา (ไม่ต้องเข้าสู่ระบบ) — กรอกรหัสนักศึกษา + รหัส 6 ตัวจาก QR */
function checkIn(payload) {
  return handle_(function () {
    const d = payload || {};
    const code = String(d.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const studentCode = String(d.studentCode || '').trim().replace(/\s/g, '').slice(0, 20);
    const deviceHash = String(d.deviceHash || '').replace(/[^a-f0-9]/gi, '').slice(0, 64);
    if (code.length !== 6) throw appError_('กรุณากรอกรหัสเช็คชื่อ 6 ตัวที่แสดงบนจอ');
    if (!/^\d{5,15}$/.test(studentCode)) throw appError_('กรุณากรอกรหัสนักศึกษาให้ถูกต้อง');
    const cache = CacheService.getScriptCache();
    rateLimit_(cache, 'rl:s:' + studentCode);
    if (deviceHash) rateLimit_(cache, 'rl:d:' + deviceHash);
    const sessionId = cache.get('qrc:' + code);
    if (!sessionId) throw appError_('รหัสเช็คชื่อหมดอายุหรือไม่ถูกต้อง กรุณาสแกน QR ล่าสุดบนจออีกครั้ง');
    return withLock_(function () {
      const s = findById_('Sessions', sessionId);
      if (!s || s.status !== 'open') throw appError_('คาบนี้ปิดเช็คชื่อแล้ว');
      const st = readTable_('Students').rows.filter(function (x) { return x.studentCode === studentCode; })[0];
      if (!st || st.status !== 'active') throw appError_('ไม่พบรหัสนักศึกษานี้ในรายวิชา');
      if (st.sectionCode !== s.sectionCode) throw appError_('คาบนี้เป็นของกลุ่ม ' + s.sectionCode + ' แต่คุณอยู่กลุ่ม ' + st.sectionCode);
      const sessionAtt = readTable_('Attendance').rows.filter(function (a) { return a.sessionId === s.id; });
      const mine = sessionAtt.filter(function (a) { return a.studentCode === studentCode; })[0];
      if (mine) {
        return ok_({ fullName: maskName_(st.fullName), status: mine.status, statusLabel: CONFIG.ATTENDANCE_STATUS[mine.status], checkinAt: mine.checkinAt, week: s.week, sectionCode: s.sectionCode, already: true }, 'คุณเช็คชื่อคาบนี้ไว้แล้ว');
      }
      if (publicSettings_().deviceLock === 'on' && deviceHash) {
        const used = sessionAtt.filter(function (a) { return a.deviceHash === deviceHash && a.studentCode !== studentCode; })[0];
        if (used) {
          audit_({ username: studentCode }, 'checkin_blocked', 'Attendance', s.id, 'อุปกรณ์ซ้ำกับ ' + used.studentCode);
          throw appError_('อุปกรณ์นี้ถูกใช้เช็คชื่อให้นักศึกษาคนอื่นในคาบนี้แล้ว (1 เครื่อง : 1 คน) หากเป็นความผิดพลาด กรุณาแจ้งอาจารย์');
        }
      }
      const nowStr = now_();
      const status = isLate_(s) ? 'late' : 'present';
      const rec = { id: newId_('ATT'), sessionId: s.id, studentCode: studentCode, status: status, checkinAt: nowStr, method: 'qr', deviceHash: deviceHash, note: '', updatedBy: studentCode, updatedAt: nowStr };
      insertRows_('Attendance', [rec]);
      audit_({ username: studentCode }, 'checkin', 'Attendance', rec.id, 'กลุ่ม ' + s.sectionCode + ' สัปดาห์ ' + s.week + ' ' + status);
      return ok_({ fullName: maskName_(st.fullName), status: status, statusLabel: CONFIG.ATTENDANCE_STATUS[status], checkinAt: nowStr, week: s.week, sectionCode: s.sectionCode, already: false }, status === 'late' ? 'เช็คชื่อแล้ว (สาย)' : 'เช็คชื่อสำเร็จ');
    });
  });
}

/** ข้อมูลคาบจากรหัส QR (ไม่มีข้อมูลส่วนบุคคล) — ใช้แสดงก่อนกดยืนยันเช็คชื่อ */
function getCheckinInfo(code) {
  return handle_(function () {
    const c = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (c.length !== 6) throw appError_('รหัสเช็คชื่อไม่ถูกต้อง');
    const sessionId = CacheService.getScriptCache().get('qrc:' + c);
    if (!sessionId) throw appError_('รหัสเช็คชื่อหมดอายุ กรุณาสแกน QR ล่าสุดบนจออีกครั้ง');
    const s = findById_('Sessions', sessionId);
    if (!s || s.status !== 'open') throw appError_('คาบนี้ปิดเช็คชื่อแล้ว');
    return ok_({ week: s.week, sectionCode: s.sectionCode, title: s.title, sessionDate: s.sessionDate, startTime: s.startTime, room: s.room, courseName: publicSettings_().courseName });
  });
}

function rateLimit_(cache, key) {
  const n = Number(cache.get(key) || 0);
  if (n >= CONFIG.CHECKIN_RATE_PER_MINUTE) throw appError_('ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่');
  cache.put(key, String(n + 1), 60);
}

function isLate_(s) {
  const lateMinutes = Number(publicSettings_().lateMinutes) || 15;
  const p = s.sessionDate.split('-').map(Number);
  const t = s.startTime.split(':').map(Number);
  const startMs = Date.UTC(p[0], p[1] - 1, p[2], t[0] - CONFIG.UTC_OFFSET_HOURS, t[1]);
  return Date.now() > startMs + lateMinutes * 60000;
}

function maskName_(name) {
  const parts = String(name || '').split(/\s+/).filter(String);
  if (!parts.length) return '';
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  return first + (last ? ' ' + last.charAt(0) + '.' : '');
}

/** ผู้สอนแก้สถานะการเข้าเรียนด้วยตนเอง (หลายคนพร้อมกันได้) */
function setAttendance(token, data) {
  return handle_(function () {
    const user = auth_(token, TEACHERS_);
    const d = data || {};
    const codes = (d.studentCodes || []).map(function (c) { return str_(c, 20); }).filter(String);
    if (!codes.length) throw appError_('กรุณาเลือกนักศึกษา');
    if (codes.length > 500) throw appError_('เลือกนักศึกษาได้ครั้งละไม่เกิน 500 คน');
    const clear = d.status === '';
    const status = clear ? '' : oneOf_(d.status, CONFIG.ATTENDANCE_STATUS, 'สถานะการเข้าเรียน');
    const note = str_(d.note, 300);
    return withLock_(function () {
      const s = findById_('Sessions', d.sessionId);
      if (!s) throw appError_('ไม่พบคาบเรียน');
      if (s.status === 'scheduled' || s.status === 'cancelled') throw appError_('บันทึกการเข้าเรียนได้เมื่อเปิดเช็คชื่อแล้ว');
      const valid = {};
      readTable_('Students').rows.forEach(function (st) { if (st.sectionCode === s.sectionCode) valid[st.studentCode] = true; });
      codes.forEach(function (c) { if (!valid[c]) throw appError_('รหัส ' + c + ' ไม่อยู่ในกลุ่ม ' + s.sectionCode); });
      const t = readTable_('Attendance');
      const want = {};
      codes.forEach(function (c) { want[c] = true; });
      const stamp = now_();
      const rows = [];
      const done = {};
      t.rows.forEach(function (a) {
        if (a.sessionId === s.id && want[a.studentCode]) {
          done[a.studentCode] = true;
          if (clear) return;
          rows.push(Object.assign({}, a, { status: status, method: a.method === 'qr' ? 'qr' : 'manual', note: note || a.note, updatedBy: user.username, updatedAt: stamp }));
        } else {
          rows.push(a);
        }
      });
      if (!clear) {
        codes.forEach(function (c) {
          if (!done[c]) rows.push({ id: newId_('ATT'), sessionId: s.id, studentCode: c, status: status, checkinAt: '', method: 'manual', deviceHash: '', note: note, updatedBy: user.username, updatedAt: stamp });
        });
      }
      rewriteTable_('Attendance', rows);
      audit_(user, 'attendance', 'Session', s.id, 'สัปดาห์ ' + s.week + ' กลุ่ม ' + s.sectionCode + ': ' + (clear ? 'ล้างสถานะ' : status) + ' ' + codes.length + ' คน');
      return ok_({ count: codes.length }, 'บันทึกการเข้าเรียน ' + codes.length + ' คนแล้ว');
    });
  });
}

/** ตารางการเข้าเรียน นักศึกษา × สัปดาห์ */
function getAttendanceMatrix(token, sectionCode) {
  return handle_(function () {
    auth_(token, TEACHERS_);
    const sec = req_(str_(sectionCode, 10), 'กลุ่มเรียน');
    const sessions = readTable_('Sessions').rows.filter(function (s) { return s.sectionCode === sec; }).sort(function (a, b) { return a.week - b.week; });
    const ids = {};
    sessions.forEach(function (s) { ids[s.id] = s.week; });
    const byStudent = {};
    readTable_('Attendance').rows.forEach(function (a) {
      if (ids[a.sessionId] === undefined) return;
      (byStudent[a.studentCode] = byStudent[a.studentCode] || {})[ids[a.sessionId]] = a.status;
    });
    const held = sessions.filter(function (s) { return (s.status === 'open' || s.status === 'closed') && countable_(s); });
    const closedWeeks = sessions.filter(function (s) { return s.status === 'closed' && countable_(s); }).map(function (s) { return s.week; });
    const openWeeks = sessions.filter(function (s) { return s.status === 'open' && countable_(s); }).map(function (s) { return s.week; });
    const students = readTable_('Students').rows.filter(function (s) { return s.sectionCode === sec && s.status === 'active'; })
      .sort(function (a, b) { return a.studentCode.localeCompare(b.studentCode); })
      .map(function (s) {
        const marks = byStudent[s.studentCode] || {};
        const sum = attendanceSummary_(marks, closedWeeks, openWeeks);
        return { studentCode: s.studentCode, fullName: s.fullName, marks: marks, summary: sum };
      });
    return ok_({ sectionCode: sec, sessions: sessions.map(sessionView_), students: students, heldCount: held.length });
  });
}

/** นับเฉพาะคาบที่ปิดเช็คชื่อแล้ว (ไม่มีข้อมูล = ขาด) และคาบที่เปิดอยู่ซึ่งนักศึกษามีสถานะแล้ว */
function attendanceSummary_(marks, closedWeeks, openWeeks) {
  const weeks = closedWeeks.concat((openWeeks || []).filter(function (w) { return !!marks[w]; }));
  const out = { present: 0, late: 0, absent: 0, excused: 0, held: weeks.length, rate: 0 };
  weeks.forEach(function (w) { const m = marks[w]; if (m && out[m] !== undefined) out[m] += 1; else out.absent += 1; });
  out.rate = weeks.length ? round2_((out.present + out.late + out.excused) / weeks.length * 100) : 0;
  return out;
}

function countable_(s) {
  return CONFIG.EXAM_WEEKS.indexOf(s.week) < 0;
}

/* ============================================================================
 * Assignments (งานที่มอบหมาย)
 * ========================================================================== */
function listAssignments(token) {
  return handle_(function () {
    auth_(token, TEACHERS_);
    const subs = readTable_('Submissions').rows;
    const grades = readTable_('Grades').rows;
    const items = readTable_('Assignments').rows.map(function (a) {
      const v = assignmentView_(a);
      const subStudents = {};
      subs.forEach(function (s) { if (s.assignmentId === a.id) subStudents[s.studentCode] = true; });
      v.submittedCount = Object.keys(subStudents).length;
      v.gradedCount = grades.filter(function (g) { return g.assignmentId === a.id && g.score !== ''; }).length;
      v.publishedCount = grades.filter(function (g) { return g.assignmentId === a.id && g.status === 'published'; }).length;
      return v;
    }).sort(function (a, b) { return a.code.localeCompare(b.code); });
    return ok_({ items: items, capacity: categoryCapacity_() });
  });
}

function assignmentView_(a) {
  const cat = categoryOf_(a.categoryCode);
  return {
    id: a.id, code: a.code, title: a.title, description: a.description, categoryCode: a.categoryCode, categoryName: cat ? cat.name : '', clo: cat ? cat.clo : '',
    maxScore: a.maxScore, sectionScope: a.sectionScope, sections: scopeList_(a.sectionScope), dueAt: a.dueAt, sectionDue: parseJson_(a.sectionDue, {}),
    submissionMode: a.submissionMode, submissionModeLabel: CONFIG.SUBMISSION_MODE[a.submissionMode] || a.submissionMode, allowLate: a.allowLate === '1',
    status: a.status, statusLabel: CONFIG.ASSIGNMENT_STATUS[a.status] || a.status, createdBy: a.createdBy, createdAt: a.createdAt, updatedAt: a.updatedAt
  };
}

function scopeList_(scope) {
  if (!scope || scope === 'all') return [];
  return String(scope).split(',').map(function (x) { return x.trim(); }).filter(String);
}

function appliesTo_(a, sectionCode) {
  const list = scopeList_(a.sectionScope);
  return !list.length || list.indexOf(sectionCode) >= 0;
}

function dueFor_(a, sectionCode) {
  const map = parseJson_(a.sectionDue, {});
  return map[sectionCode] || a.dueAt || '';
}

/** คะแนนเต็มที่ใช้ไปในแต่ละหมวด แยกตามกลุ่มเรียน (ต้องไม่เกินโครงสร้าง OBE-3) */
function categoryCapacity_(excludeId) {
  const sections = readTable_('Sections').rows.map(function (s) { return s.code; });
  const assigns = readTable_('Assignments').rows.filter(function (a) { return a.id !== excludeId; });
  return CONFIG.CATEGORIES.map(function (c) {
    const bySection = {};
    sections.forEach(function (code) {
      bySection[code] = round2_(assigns.filter(function (a) { return a.categoryCode === c.code && appliesTo_(a, code); }).reduce(function (t, a) { return t + a.maxScore; }, 0));
    });
    return { code: c.code, name: c.name, max: c.max, clo: c.clo, bySection: bySection };
  });
}

function saveAssignment(token, data) {
  return handle_(function () {
    const user = auth_(token, TEACHERS_);
    const d = data || {};
    const input = {
      code: req_(str_(d.code, 20), 'รหัสงาน').toUpperCase(),
      title: req_(str_(d.title, 200), 'ชื่องาน'),
      description: str_(d.description, 5000),
      categoryCode: req_(str_(d.categoryCode, 20), 'หมวดคะแนน'),
      maxScore: score_(d.maxScore, 'คะแนนเต็ม', 100, true),
      dueAt: dateTime_(d.dueAt, 'กำหนดส่ง', false),
      submissionMode: oneOf_(d.submissionMode || 'online', CONFIG.SUBMISSION_MODE, 'วิธีส่งงาน'),
      allowLate: d.allowLate ? '1' : '0',
      status: oneOf_(d.status || 'draft', CONFIG.ASSIGNMENT_STATUS, 'สถานะ')
    };
    if (!/^[A-Z0-9_-]{1,20}$/.test(input.code)) throw appError_('รหัสงานใช้ได้เฉพาะ A–Z 0–9 _ -');
    const cat = categoryOf_(input.categoryCode);
    if (!cat) throw appError_('หมวดคะแนนไม่ถูกต้อง');
    const sectionCodes = readTable_('Sections').rows.map(function (s) { return s.code; });
    const scope = (d.sections || []).map(function (x) { return str_(x, 10); }).filter(String);
    scope.forEach(function (c) { if (sectionCodes.indexOf(c) < 0) throw appError_('ไม่พบกลุ่มเรียน ' + c); });
    input.sectionScope = scope.length && scope.length < sectionCodes.length ? scope.join(',') : 'all';
    const due = {};
    const src = d.sectionDue || {};
    Object.keys(src).forEach(function (k) {
      if (sectionCodes.indexOf(k) < 0) return;
      const v = dateTime_(src[k], 'กำหนดส่งของกลุ่ม ' + k, false);
      if (v) due[k] = v;
    });
    input.sectionDue = JSON.stringify(due);
    if (input.submissionMode === 'online' && input.status !== 'draft' && !input.dueAt && !Object.keys(due).length) throw appError_('งานที่ส่งออนไลน์ต้องมีกำหนดส่งก่อนเผยแพร่');
    return withLock_(function () {
      const rows = readTable_('Assignments').rows;
      if (rows.some(function (a) { return a.code === input.code && a.id !== d.id; })) throw appError_('รหัสงาน ' + input.code + ' ซ้ำ');
      const cap = categoryCapacity_(d.id || '').filter(function (c) { return c.code === cat.code; })[0];
      const probe = { sectionScope: input.sectionScope };
      Object.keys(cap.bySection).forEach(function (sec) {
        if (!appliesTo_(probe, sec)) return;
        if (cap.bySection[sec] + input.maxScore > cat.max + 0.001) {
          throw appError_('คะแนนเต็มรวมของหมวด "' + cat.name + '" ในกลุ่ม ' + sec + ' จะเกิน ' + cat.max + ' คะแนน (ใช้ไปแล้ว ' + cap.bySection[sec] + ' · เหลือ ' + round2_(cat.max - cap.bySection[sec]) + ')');
        }
      });
      let saved;
      if (d.id) {
        const cur = findById_('Assignments', d.id);
        if (!cur) throw appError_('ไม่พบงาน');
        const maxGrade = readTable_('Grades').rows.filter(function (g) { return g.assignmentId === cur.id && g.score !== ''; }).reduce(function (m, g) { return Math.max(m, Number(g.score)); }, 0);
        if (input.maxScore < maxGrade) throw appError_('คะแนนเต็มต้องไม่น้อยกว่าคะแนนที่ให้ไปแล้ว (' + maxGrade + ')');
        saved = updateRow_('Assignments', cur, Object.assign({}, input, { updatedAt: now_() }));
        audit_(user, 'update', 'Assignment', cur.id, input.code + ' ' + input.title);
      } else {
        saved = Object.assign({ id: newId_('ASG'), createdBy: user.username, createdAt: now_(), updatedAt: now_() }, input);
        insertRows_('Assignments', [saved]);
        audit_(user, 'create', 'Assignment', saved.id, input.code + ' ' + input.title);
      }
      return ok_(assignmentView_(saved), 'บันทึกงานแล้ว');
    });
  });
}

function deleteAssignment(token, id) {
  return handle_(function () {
    const user = auth_(token, TEACHERS_);
    return withLock_(function () {
      const cur = findById_('Assignments', id);
      if (!cur) throw appError_('ไม่พบงาน');
      if (readTable_('Submissions').rows.some(function (s) { return s.assignmentId === cur.id; }) || readTable_('Grades').rows.some(function (g) { return g.assignmentId === cur.id && g.score !== ''; })) {
        throw appError_('งานนี้มีการส่งงานหรือให้คะแนนแล้ว ให้เปลี่ยนสถานะเป็น "ปิดรับงาน" แทนการลบ');
      }
      deleteWhere_('Grades', function (g) { return g.assignmentId === cur.id; });
      deleteWhere_('Assignments', function (a) { return a.id === cur.id; });
      audit_(user, 'delete', 'Assignment', cur.id, cur.code + ' ' + cur.title);
      return ok_({ id: cur.id }, 'ลบงานแล้ว');
    });
  });
}

/* ============================================================================
 * Submissions (ส่งงาน)
 * ========================================================================== */
function submitAssignment(token, data) {
  return handle_(function () {
    const user = auth_(token, ['student']);
    const d = data || {};
    const links = String(d.links || '').split(/\s+/).map(function (x) { return x.trim(); }).filter(String);
    if (links.length > 10) throw appError_('แนบลิงก์ได้ไม่เกิน 10 ลิงก์');
    links.forEach(function (l) { if (!/^https:\/\/[^\s<>"']{4,500}$/.test(l)) throw appError_('ลิงก์ต้องขึ้นต้นด้วย https:// : ' + l.slice(0, 60)); });
    const files = (d.files || []).slice(0, 11);
    if (files.length > 10) throw appError_('แนบไฟล์ได้ไม่เกิน 10 ไฟล์');
    const uploads = files.map(validateUpload_);
    const total = uploads.reduce(function (t, f) { return t + f.size; }, 0);
    if (total > maxUploadBytes_()) throw appError_('ไฟล์รวมกันเกิน ' + publicSettings_().maxUploadMB + ' MB');
    if (!links.length && !uploads.length) throw appError_('กรุณาแนบไฟล์หรือลิงก์อย่างน้อย 1 รายการ');
    const note = str_(d.note, 1000);
    return withLock_(function () {
      const a = findById_('Assignments', d.assignmentId);
      if (!a || a.status === 'draft' || !appliesTo_(a, user.sectionCode)) throw appError_('ไม่พบงานนี้');
      if (a.status === 'closed') throw appError_('งานนี้ปิดรับแล้ว');
      if (a.submissionMode !== 'online') throw appError_('งานนี้ไม่ได้ส่งออนไลน์');
      const due = dueFor_(a, user.sectionCode);
      const late = !!due && nowLocal_() > due;
      if (late && a.allowLate !== '1') throw appError_('เลยกำหนดส่งแล้ว (' + due.replace('T', ' ') + ') และงานนี้ไม่รับงานล่าช้า');
      const grade = readTable_('Grades').rows.filter(function (g) { return g.assignmentId === a.id && g.studentCode === user.studentCode; })[0];
      if (grade && grade.status === 'published') throw appError_('งานนี้ได้รับคะแนนแล้ว หากต้องการส่งใหม่กรุณาติดต่ออาจารย์');
      const prior = readTable_('Submissions').rows.filter(function (s) { return s.assignmentId === a.id && s.studentCode === user.studentCode; });
      const version = prior.reduce(function (m, s) { return Math.max(m, s.version); }, 0) + 1;
      const subId = newId_('SUB');
      const folder = submissionFolder_(a);
      const stamp = now_();
      const fileRows = uploads.map(function (u) {
        const blob = Utilities.newBlob(Utilities.base64Decode(u.data), u.mimeType, user.studentCode + '_v' + version + '_' + u.name);
        const file = folder.createFile(blob);
        return { id: newId_('FIL'), name: u.name, mimeType: u.mimeType, size: u.size, driveId: file.getId(), url: file.getUrl(), submissionId: subId, assignmentId: a.id, studentCode: user.studentCode, createdAt: stamp };
      });
      if (fileRows.length) insertRows_('Files', fileRows);
      insertRows_('Submissions', [{
        id: subId, assignmentId: a.id, studentCode: user.studentCode, version: version, submittedAt: stamp, isLate: late ? '1' : '0',
        fileIds: fileRows.map(function (f) { return f.id; }).join(','), links: links.join('\n'), note: note, createdAt: stamp
      }]);
      audit_(user, 'submit', 'Submission', subId, a.code + ' v' + version + (late ? ' (ล่าช้า)' : ''));
      return ok_({ student: studentData_(user) }, 'ส่งงาน ' + a.code + ' (ครั้งที่ ' + version + ') เรียบร้อย' + (late ? ' · ส่งล่าช้า' : ''));
    });
  });
}

function submissionFolder_(a) {
  const root = subFolder_('submissions');
  const name = a.code + ' ' + a.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function downloadFile(token, fileId) {
  return handle_(function () {
    const user = auth_(token, null, false);
    const f = findById_('Files', fileId);
    if (!f || (user.role === 'student' && f.studentCode !== user.studentCode)) throw appError_('ไม่พบไฟล์');
    let blob;
    try { blob = DriveApp.getFileById(f.driveId).getBlob(); } catch (err) { throw appError_('ไม่พบไฟล์ใน Google Drive (อาจถูกลบไปแล้ว)'); }
    const bytes = blob.getBytes();
    if (bytes.length > 40 * 1024 * 1024) throw appError_('ไฟล์ใหญ่เกินกว่าจะดาวน์โหลดผ่านระบบ กรุณาเปิดจาก Google Drive');
    audit_(user, 'download', 'File', f.id, f.name);
    return ok_({ name: f.name, mimeType: f.mimeType || blob.getContentType(), data: Utilities.base64Encode(bytes) });
  });
}

function validateUpload_(file) {
  if (!file || !file.data || !file.name) throw appError_('ไฟล์ไม่ถูกต้อง');
  const name = String(file.name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 150);
  const mimeType = String(file.mimeType || 'application/octet-stream').slice(0, 120);
  const b64 = String(file.data);
  if (!/^[A-Za-z0-9+/=]+$/.test(b64)) throw appError_('ข้อมูลไฟล์ไม่ถูกต้อง');
  const size = Math.floor(b64.length * 3 / 4) - (b64.slice(-2) === '==' ? 2 : b64.slice(-1) === '=' ? 1 : 0);
  if (size <= 0) throw appError_('ไฟล์ว่างเปล่า: ' + name);
  if (/\.(exe|bat|cmd|com|js|vbs|ps1|sh|msi|scr)$/i.test(name)) throw appError_('ไม่อนุญาตไฟล์ประเภทนี้: ' + name);
  return { name: name, mimeType: mimeType, data: b64, size: size };
}

function maxUploadBytes_() {
  const mb = Number(publicSettings_().maxUploadMB) || 20;
  return Math.min(Math.max(mb, 1), 40) * 1024 * 1024;
}

/* ============================================================================
 * Grading (ให้คะแนน)
 * ========================================================================== */
function getGrading(token, assignmentId) {
  return handle_(function () {
    auth_(token, TEACHERS_);
    const a = findById_('Assignments', assignmentId);
    if (!a) throw appError_('ไม่พบงาน');
    const fileMap = indexBy_(readTable_('Files').rows, 'id');
    const subs = readTable_('Submissions').rows.filter(function (s) { return s.assignmentId === a.id; });
    const grades = indexBy_(readTable_('Grades').rows.filter(function (g) { return g.assignmentId === a.id; }), 'studentCode');
    const rows = readTable_('Students').rows.filter(function (s) { return s.status === 'active' && appliesTo_(a, s.sectionCode); })
      .sort(function (x, y) { return x.sectionCode.localeCompare(y.sectionCode) || x.studentCode.localeCompare(y.studentCode); })
      .map(function (s) {
        const mine = subs.filter(function (x) { return x.studentCode === s.studentCode; }).sort(function (x, y) { return y.version - x.version; });
        const latest = mine[0] || null;
        const g = grades[s.studentCode];
        return {
          studentCode: s.studentCode, fullName: s.fullName, sectionCode: s.sectionCode, due: dueFor_(a, s.sectionCode),
          submission: latest ? {
            id: latest.id, version: latest.version, submittedAt: latest.submittedAt, isLate: latest.isLate === '1', note: latest.note,
            links: latest.links ? latest.links.split('\n') : [],
            files: latest.fileIds ? latest.fileIds.split(',').map(function (id) { const f = fileMap[id]; return f ? { id: f.id, name: f.name, size: f.size, url: f.url } : null; }).filter(Boolean) : []
          } : null,
          versions: mine.length,
          grade: g ? { score: g.score === '' ? '' : Number(g.score), feedback: g.feedback, status: g.status, gradedAt: g.gradedAt, gradedBy: g.gradedBy } : null
        };
      });
    return ok_({ assignment: assignmentView_(a), rows: rows });
  });
}

/** บันทึกคะแนนเป็นชุด (เขียนชีต Grades ครั้งเดียว) — publish=true จะเผยแพร่ให้นักศึกษาเห็นทันที */
function saveGrades(token, data) {
  return handle_(function () {
    const user = auth_(token, TEACHERS_);
    const d = data || {};
    const list = d.grades || [];
    if (!list.length) throw appError_('ไม่มีคะแนนที่จะบันทึก');
    if (list.length > 1000) throw appError_('บันทึกได้ครั้งละไม่เกิน 1000 รายการ');
    return withLock_(function () {
      const a = findById_('Assignments', d.assignmentId);
      if (!a) throw appError_('ไม่พบงาน');
      if (a.status === 'draft') throw appError_('กรุณาเผยแพร่งานก่อนให้คะแนน');
      const students = indexBy_(readTable_('Students').rows, 'studentCode');
      const clean = list.map(function (g) {
        const code = str_(g.studentCode, 20);
        const st = students[code];
        if (!st || !appliesTo_(a, st.sectionCode)) throw appError_('นักศึกษา ' + code + ' ไม่อยู่ในกลุ่มที่ได้รับงานนี้');
        const raw = String(g.score === undefined || g.score === null ? '' : g.score).trim();
        return { studentCode: code, score: raw === '' ? '' : score_(raw, 'คะแนนของ ' + code, a.maxScore, false), feedback: str_(g.feedback, 3000) };
      });
      const t = readTable_('Grades');
      const rows = t.rows.map(function (r) { return Object.assign({}, r); });
      const idx = {};
      rows.forEach(function (r, i) { if (r.assignmentId === a.id) idx[r.studentCode] = i; });
      const stamp = now_();
      let published = 0;
      clean.forEach(function (g) {
        const i = idx[g.studentCode];
        const publish = !!d.publish && g.score !== '';
        if (i === undefined) {
          if (g.score === '' && !g.feedback) return;
          rows.push({ id: newId_('GRD'), assignmentId: a.id, studentCode: g.studentCode, score: g.score, feedback: g.feedback, status: publish ? 'published' : 'draft', gradedBy: user.username, gradedAt: stamp, publishedAt: publish ? stamp : '' });
        } else {
          const r = rows[i];
          r.score = g.score;
          r.feedback = g.feedback;
          r.gradedBy = user.username;
          r.gradedAt = stamp;
          if (publish) { r.status = 'published'; r.publishedAt = stamp; } else if (g.score === '') { r.status = 'draft'; r.publishedAt = ''; }
        }
        if (publish) published += 1;
      });
      rewriteTable_('Grades', rows);
      audit_(user, d.publish ? 'grade_publish' : 'grade_save', 'Assignment', a.id, a.code + ' ' + clean.length + ' รายการ');
      return ok_({ count: clean.length, published: published }, 'บันทึกคะแนน ' + clean.length + ' รายการแล้ว' + (d.publish ? ' · เผยแพร่ ' + published + ' รายการ' : ''));
    });
  });
}

function publishGrades(token, assignmentId) {
  return handle_(function () {
    const user = auth_(token, TEACHERS_);
    return withLock_(function () {
      const a = findById_('Assignments', assignmentId);
      if (!a) throw appError_('ไม่พบงาน');
      const t = readTable_('Grades');
      const stamp = now_();
      let n = 0;
      const rows = t.rows.map(function (r) {
        if (r.assignmentId === a.id && r.status === 'draft' && r.score !== '') { n += 1; return Object.assign({}, r, { status: 'published', publishedAt: stamp }); }
        return r;
      });
      if (n) rewriteTable_('Grades', rows);
      audit_(user, 'grade_publish', 'Assignment', a.id, a.code + ' เผยแพร่ ' + n + ' รายการ');
      return ok_({ published: n }, n ? 'เผยแพร่คะแนน ' + n + ' รายการแล้ว' : 'ไม่มีคะแนนที่รอเผยแพร่');
    });
  });
}

/* ============================================================================
 * Gradebook (สมุดคะแนน)
 * ========================================================================== */
function getGradebook(token, sectionCode) {
  return handle_(function () {
    auth_(token, TEACHERS_);
    return ok_(gradebook_(str_(sectionCode, 10)));
  });
}

function gradebook_(sectionCode) {
  const assigns = readTable_('Assignments').rows.filter(function (a) { return a.status !== 'draft'; });
  const grades = readTable_('Grades').rows;
  const gmap = {};
  grades.forEach(function (g) { gmap[g.assignmentId + '|' + g.studentCode] = g; });
  const sessions = readTable_('Sessions').rows;
  const attendance = readTable_('Attendance').rows;
  const sessionWeek = {};
  sessions.forEach(function (s) { sessionWeek[s.id] = s; });
  const marksBy = {};
  attendance.forEach(function (a) {
    const s = sessionWeek[a.sessionId];
    if (!s) return;
    (marksBy[a.studentCode] = marksBy[a.studentCode] || {})[s.week] = a.status;
  });
  const closedBySection = {};
  const openBySection = {};
  sessions.forEach(function (s) {
    if (!countable_(s)) return;
    if (s.status === 'closed') (closedBySection[s.sectionCode] = closedBySection[s.sectionCode] || []).push(s.week);
    if (s.status === 'open') (openBySection[s.sectionCode] = openBySection[s.sectionCode] || []).push(s.week);
  });
  const students = readTable_('Students').rows.filter(function (s) { return s.status === 'active' && (!sectionCode || s.sectionCode === sectionCode); })
    .sort(function (a, b) { return a.sectionCode.localeCompare(b.sectionCode) || a.studentCode.localeCompare(b.studentCode); });
  const rows = students.map(function (s) {
    const byCat = {};
    CONFIG.CATEGORIES.forEach(function (c) { byCat[c.code] = { earned: 0, pending: 0, items: 0 }; });
    let total = 0;
    let pending = 0;
    assigns.forEach(function (a) {
      if (!appliesTo_(a, s.sectionCode) || !byCat[a.categoryCode]) return;
      const g = gmap[a.id + '|' + s.studentCode];
      byCat[a.categoryCode].items += 1;
      if (g && g.status === 'published' && g.score !== '') { byCat[a.categoryCode].earned += Number(g.score); total += Number(g.score); }
      else { byCat[a.categoryCode].pending += 1; pending += 1; }
    });
    Object.keys(byCat).forEach(function (k) { byCat[k].earned = round2_(byCat[k].earned); });
    return {
      studentCode: s.studentCode, fullName: s.fullName, sectionCode: s.sectionCode, byCat: byCat, total: round2_(total), pending: pending,
      attendance: attendanceSummary_(marksBy[s.studentCode] || {}, closedBySection[s.sectionCode] || [], openBySection[s.sectionCode] || [])
    };
  });
  return { sectionCode: sectionCode, categories: CONFIG.CATEGORIES, rows: rows, generatedAt: now_() };
}

/** ส่งออกสมุดคะแนนเป็น Google Sheets ในโฟลเดอร์ Exports */
function exportGradebook(token, sectionCode) {
  return handle_(function () {
    const user = auth_(token, TEACHERS_);
    const gb = gradebook_(str_(sectionCode, 10));
    const settings = publicSettings_();
    const title = 'สมุดคะแนน ' + settings.courseCode + ' ' + settings.semester + '-' + settings.academicYear + (gb.sectionCode ? ' กลุ่ม ' + gb.sectionCode : ' ทุกกลุ่ม') + ' (' + today_() + ')';
    const header = ['กลุ่ม', 'รหัสนักศึกษา', 'ชื่อ-สกุล'].concat(CONFIG.CATEGORIES.map(function (c) { return c.code + ' (' + c.max + ')'; }))
      .concat(['รวม (100)', 'รอผล', 'มา', 'สาย', 'ขาด', 'ลา', 'เข้าเรียน (%)']);
    const data = gb.rows.map(function (r) {
      return [r.sectionCode, r.studentCode, r.fullName].concat(CONFIG.CATEGORIES.map(function (c) { return r.byCat[c.code].earned; }))
        .concat([r.total, r.pending, r.attendance.present, r.attendance.late, r.attendance.absent, r.attendance.excused, r.attendance.rate]);
    });
    const book = SpreadsheetApp.create(title);
    const sh = book.getSheets()[0];
    sh.setName('สมุดคะแนน');
    const grid = [[title], ['ออกรายงานโดย ' + user.fullName + ' ' + now_() + ' · รวมเฉพาะคะแนนที่เผยแพร่แล้ว'], header].concat(data);
    const width = header.length;
    sh.getRange(1, 1, grid.length, width).setValues(grid.map(function (row) { const c = row.slice(); while (c.length < width) c.push(''); return c; }));
    sh.getRange(3, 1, 1, width).setFontWeight('bold');
    sh.getRange(1, 1).setFontWeight('bold').setFontSize(13);
    sh.setFrozenRows(3);
    SpreadsheetApp.flush();
    const file = DriveApp.getFileById(book.getId());
    file.moveTo(subFolder_('exports'));
    audit_(user, 'export', 'Gradebook', gb.sectionCode || 'all', title);
    return ok_({ url: file.getUrl(), name: title }, 'ส่งออกสมุดคะแนนเป็น Google Sheets แล้ว');
  });
}

/* ============================================================================
 * Student Portal (ข้อมูลของนักศึกษา)
 * ========================================================================== */
function getStudentData(token) {
  return handle_(function () {
    const user = auth_(token, ['student']);
    return ok_(studentData_(user));
  });
}

function studentData_(user) {
  const st = findById_('Students', user.id);
  const sec = readTable_('Sections').rows.filter(function (s) { return s.code === st.sectionCode; })[0] || null;
  const sessions = readTable_('Sessions').rows.filter(function (s) { return s.sectionCode === st.sectionCode; }).sort(function (a, b) { return a.week - b.week; });
  const myAtt = {};
  readTable_('Attendance').rows.forEach(function (a) { if (a.studentCode === st.studentCode) myAtt[a.sessionId] = a; });
  const fileMap = indexBy_(readTable_('Files').rows.filter(function (f) { return f.studentCode === st.studentCode; }), 'id');
  const subs = readTable_('Submissions').rows.filter(function (s) { return s.studentCode === st.studentCode; });
  const grades = indexBy_(readTable_('Grades').rows.filter(function (g) { return g.studentCode === st.studentCode && g.status === 'published'; }), 'assignmentId');
  const assignments = readTable_('Assignments').rows.filter(function (a) { return a.status !== 'draft' && appliesTo_(a, st.sectionCode); })
    .map(function (a) {
      const mine = subs.filter(function (s) { return s.assignmentId === a.id; }).sort(function (x, y) { return y.version - x.version; });
      const g = grades[a.id];
      const cat = categoryOf_(a.categoryCode);
      return {
        id: a.id, code: a.code, title: a.title, description: a.description, categoryName: cat ? cat.name : '', clo: cat ? cat.clo : '', maxScore: a.maxScore,
        due: dueFor_(a, st.sectionCode), submissionMode: a.submissionMode, allowLate: a.allowLate === '1', status: a.status,
        submissions: mine.map(function (s) {
          return {
            version: s.version, submittedAt: s.submittedAt, isLate: s.isLate === '1', note: s.note, links: s.links ? s.links.split('\n') : [],
            files: s.fileIds ? s.fileIds.split(',').map(function (id) { const f = fileMap[id]; return f ? { id: f.id, name: f.name, size: f.size } : null; }).filter(Boolean) : []
          };
        }),
        grade: g ? { score: Number(g.score), feedback: g.feedback, publishedAt: g.publishedAt } : null
      };
    }).sort(function (a, b) { return String(a.due || '9').localeCompare(String(b.due || '9')) || a.code.localeCompare(b.code); });
  const closedWeeks = sessions.filter(function (s) { return s.status === 'closed' && countable_(s); }).map(function (s) { return s.week; });
  const openWeeks = sessions.filter(function (s) { return s.status === 'open' && countable_(s); }).map(function (s) { return s.week; });
  const marks = {};
  sessions.forEach(function (s) { if (myAtt[s.id]) marks[s.week] = myAtt[s.id].status; });
  const gb = gradebook_(st.sectionCode).rows.filter(function (r) { return r.studentCode === st.studentCode; })[0];
  return {
    profile: { studentCode: st.studentCode, fullName: st.fullName, sectionCode: st.sectionCode, program: st.program, faculty: st.faculty },
    section: sec ? { code: sec.code, name: sec.name, dayLabel: CONFIG.DAYS[sec.meetingDay], startTime: sec.startTime, endTime: sec.endTime, room: sec.room } : null,
    sessions: sessions.map(function (s) {
      const a = myAtt[s.id];
      return Object.assign(sessionView_(s), { myStatus: a ? a.status : '', myCheckinAt: a ? a.checkinAt : '', myNote: a ? a.note : '' });
    }),
    attendance: attendanceSummary_(marks, closedWeeks, openWeeks),
    assignments: assignments,
    grades: gb ? { byCat: gb.byCat, total: gb.total, pending: gb.pending } : null,
    now: nowLocal_()
  };
}

/* ============================================================================
 * Dashboard
 * ========================================================================== */
function getDashboard(token) {
  return handle_(function () {
    auth_(token, TEACHERS_);
    return ok_(dashboard_());
  });
}

function dashboard_() {
  const today = today_();
  const sessions = readTable_('Sessions').rows;
  const att = readTable_('Attendance').rows;
  const students = readTable_('Students').rows.filter(function (s) { return s.status === 'active'; });
  const sectionSize = {};
  students.forEach(function (s) { sectionSize[s.sectionCode] = (sectionSize[s.sectionCode] || 0) + 1; });
  const countFor = function (id) {
    const c = { present: 0, late: 0, absent: 0, excused: 0 };
    att.forEach(function (a) { if (a.sessionId === id && c[a.status] !== undefined) c[a.status] += 1; });
    return c;
  };
  const todaySessions = sessions.filter(function (s) { return s.sessionDate === today || s.status === 'open'; })
    .map(function (s) { return Object.assign(sessionView_(s), { counts: countFor(s.id), studentCount: sectionSize[s.sectionCode] || 0 }); })
    .sort(function (a, b) { return a.startTime.localeCompare(b.startTime); });
  const upcoming = sessions.filter(function (s) { return s.sessionDate > today && s.status === 'scheduled'; })
    .sort(function (a, b) { return a.sessionDate.localeCompare(b.sessionDate); }).slice(0, 5).map(sessionView_);
  const subs = readTable_('Submissions').rows;
  const grades = readTable_('Grades').rows;
  const gradedAt = {};
  grades.forEach(function (g) { if (g.score !== '') gradedAt[g.assignmentId + '|' + g.studentCode] = g.gradedAt; });
  const latestSub = {};
  subs.forEach(function (s) { const k = s.assignmentId + '|' + s.studentCode; if (!latestSub[k] || latestSub[k] < s.submittedAt) latestSub[k] = s.submittedAt; });
  const toGrade = {};
  Object.keys(latestSub).forEach(function (k) { if (!gradedAt[k] || gradedAt[k] < latestSub[k]) { const id = k.split('|')[0]; toGrade[id] = (toGrade[id] || 0) + 1; } });
  const assigns = readTable_('Assignments').rows;
  const pendingGrading = assigns.filter(function (a) { return toGrade[a.id]; }).map(function (a) { return { id: a.id, code: a.code, title: a.title, count: toGrade[a.id] }; });
  const nowStr = nowLocal_();
  const in7 = Utilities.formatDate(new Date(Date.now() + 7 * 86400000), CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm");
  const dueSoon = [];
  assigns.filter(function (a) { return a.status === 'published'; }).forEach(function (a) {
    readTable_('Sections').rows.forEach(function (sec) {
      if (!appliesTo_(a, sec.code)) return;
      const due = dueFor_(a, sec.code);
      if (due && due >= nowStr && due <= in7) dueSoon.push({ id: a.id, code: a.code, title: a.title, sectionCode: sec.code, due: due });
    });
  });
  dueSoon.sort(function (a, b) { return a.due.localeCompare(b.due); });
  const sectionRates = readTable_('Sections').rows.map(function (sec) {
    const held = sessions.filter(function (s) { return s.sectionCode === sec.code && (s.status === 'open' || s.status === 'closed') && CONFIG.EXAM_WEEKS.indexOf(s.week) < 0; });
    const heldIds = {};
    held.forEach(function (s) { heldIds[s.id] = true; });
    const attended = att.filter(function (a) { return heldIds[a.sessionId] && a.status !== 'absent'; }).length;
    const possible = held.length * (sectionSize[sec.code] || 0);
    return { code: sec.code, name: sec.name, held: held.length, students: sectionSize[sec.code] || 0, rate: possible ? round2_(attended / possible * 100) : 0 };
  }).sort(function (a, b) { return a.code.localeCompare(b.code); });
  return {
    totals: { students: students.length, sections: Object.keys(sectionSize).length, assignments: assigns.filter(function (a) { return a.status !== 'draft'; }).length, toGrade: Object.keys(toGrade).reduce(function (t, k) { return t + toGrade[k]; }, 0) },
    today: todaySessions, upcoming: upcoming, pendingGrading: pendingGrading, dueSoon: dueSoon.slice(0, 8), sectionRates: sectionRates, generatedAt: now_()
  };
}

/* ============================================================================
 * Settings
 * ========================================================================== */
function getSettings(token) {
  return handle_(function () {
    const user = auth_(token, TEACHERS_);
    const out = { settings: publicSettings_(), sections: sectionList_() };
    if (user.role === 'admin') {
      out.teachers = readTable_('Teachers').rows.map(function (t) { return { id: t.id, username: t.username, fullName: t.fullName, status: t.status, lastLoginAt: t.lastLoginAt }; });
      out.backups = { items: backupFiles_(), dailyBackupActive: dailyBackupTrigger_() !== null, lastBackupAt: PropertiesService.getScriptProperties().getProperty('lastBackupAt') || '' };
    }
    return ok_(out);
  });
}

function saveSettings(token, data) {
  return handle_(function () {
    const user = auth_(token, ['admin']);
    const d = data || {};
    const lateMinutes = intRange_(d.lateMinutes, 0, 240, 'นาทีที่ถือว่าสาย');
    const maxMb = intRange_(d.maxUploadMB, 1, 40, 'ขนาดไฟล์งานสูงสุด (MB)');
    const retention = intRange_(d.backupRetention, 1, 365, 'จำนวนไฟล์สำรองที่เก็บ');
    const values = [
      ['courseCode', req_(str_(d.courseCode, 20), 'รหัสวิชา')],
      ['courseName', req_(str_(d.courseName, 200), 'ชื่อวิชา')],
      ['semester', req_(str_(d.semester, 5), 'ภาคเรียน')],
      ['academicYear', req_(str_(d.academicYear, 5), 'ปีการศึกษา')],
      ['lateMinutes', String(lateMinutes)],
      ['deviceLock', d.deviceLock === 'on' ? 'on' : 'off'],
      ['maxUploadMB', String(maxMb)],
      ['backupRetention', String(retention)]
    ];
    return withLock_(function () {
      setSettingValues_(values);
      audit_(user, 'update', 'Settings', '', values.map(function (v) { return v[0] + '=' + v[1]; }).join(', '));
      return ok_({ settings: publicSettings_() }, 'บันทึกการตั้งค่าแล้ว');
    });
  });
}

function saveTeacher(token, data) {
  return handle_(function () {
    const user = auth_(token, ['admin']);
    const d = data || {};
    const input = {
      username: req_(str_(d.username, 30), 'ชื่อผู้ใช้'),
      fullName: req_(str_(d.fullName, 120), 'ชื่อ-สกุล'),
      status: oneOf_(d.status || 'active', CONFIG.USER_STATUS, 'สถานะ')
    };
    if (!/^[A-Za-z][A-Za-z0-9._-]{2,29}$/.test(input.username)) throw appError_('ชื่อผู้ใช้ต้องขึ้นต้นด้วยตัวอักษรภาษาอังกฤษ ใช้ได้ A–Z 0–9 . _ - ความยาว 3–30 ตัว');
    if (input.username.toLowerCase() === CONFIG.TEACHER_USERNAME.toLowerCase()) throw appError_('ชื่อผู้ใช้นี้เป็นของอาจารย์ผู้สอนหลัก');
    const password = String(d.password || '');
    if (password && password.length < CONFIG.MIN_PASSWORD_LENGTH) throw appError_('รหัสผ่านต้องมีอย่างน้อย ' + CONFIG.MIN_PASSWORD_LENGTH + ' ตัวอักษร');
    return withLock_(function () {
      const rows = readTable_('Teachers').rows;
      if (rows.some(function (t) { return t.username.toLowerCase() === input.username.toLowerCase() && t.id !== d.id; })) throw appError_('ชื่อผู้ใช้ "' + input.username + '" มีอยู่แล้ว');
      let saved;
      if (d.id) {
        const cur = findById_('Teachers', d.id);
        if (!cur) throw appError_('ไม่พบบัญชีอาจารย์');
        const patch = Object.assign({}, input, { updatedAt: now_() });
        if (password) patch.password = password;
        saved = updateRow_('Teachers', cur, patch);
      } else {
        if (!password) throw appError_('กรุณากำหนดรหัสผ่าน');
        saved = Object.assign({ id: newId_('TCH'), password: password, lastLoginAt: '', createdAt: now_(), updatedAt: now_() }, input);
        insertRows_('Teachers', [saved]);
      }
      audit_(user, d.id ? 'update' : 'create', 'Teacher', saved.id, input.username);
      return ok_({ id: saved.id }, 'บันทึกบัญชีอาจารย์แล้ว');
    });
  });
}

function deleteTeacher(token, id) {
  return handle_(function () {
    const user = auth_(token, ['admin']);
    return withLock_(function () {
      const cur = findById_('Teachers', id);
      if (!cur) throw appError_('ไม่พบบัญชีอาจารย์');
      deleteWhere_('Teachers', function (t) { return t.id === cur.id; });
      audit_(user, 'delete', 'Teacher', cur.id, cur.username);
      return ok_({ id: cur.id }, 'ลบบัญชีอาจารย์แล้ว');
    });
  });
}

function settingsMap_() {
  const map = {};
  readTable_('Settings').rows.forEach(function (r) { map[r.key] = r.value; });
  return map;
}

function publicSettings_() {
  const map = settingsMap_();
  const out = {};
  Object.keys(CONFIG.DEFAULT_SETTINGS).forEach(function (k) { out[k] = map[k] !== undefined ? map[k] : CONFIG.DEFAULT_SETTINGS[k]; });
  return out;
}

function setSettingValues_(pairs) {
  const rows = readTable_('Settings').rows.map(function (r) { return Object.assign({}, r); });
  const stamp = now_();
  pairs.forEach(function (pair) {
    const existing = rows.filter(function (r) { return r.key === pair[0]; })[0];
    if (existing) { existing.value = pair[1]; existing.updatedAt = stamp; } else rows.push({ key: pair[0], value: pair[1], updatedAt: stamp });
  });
  rewriteTable_('Settings', rows);
}

/* ============================================================================
 * File Management (Google Drive)
 * ========================================================================== */
function rootFolder_() {
  try { return DriveApp.getFolderById(CONFIG.FOLDER_ID); } catch (err) { throw appError_('ไม่สามารถเข้าถึงโฟลเดอร์หลักของระบบใน Google Drive ได้'); }
}

function subFolder_(key) {
  const settingKey = 'sys:folder:' + key;
  const map = settingsMap_();
  if (map[settingKey]) {
    try { const f = DriveApp.getFolderById(map[settingKey]); if (!f.isTrashed()) return f; } catch (err) { /* สร้างใหม่ด้านล่าง */ }
  }
  const root = rootFolder_();
  const it = root.getFoldersByName(CONFIG.FOLDERS[key]);
  const folder = it.hasNext() ? it.next() : root.createFolder(CONFIG.FOLDERS[key]);
  setSettingValues_([[settingKey, folder.getId()]]);
  return folder;
}

function trashDriveFile_(driveId) {
  if (!driveId) return;
  try { DriveApp.getFileById(driveId).setTrashed(true); } catch (err) { console.warn('ลบไฟล์ใน Drive ไม่สำเร็จ: ' + driveId); }
}

/* ============================================================================
 * Backup
 * ========================================================================== */
function createBackup(token) {
  return handle_(function () {
    const user = auth_(token, ['admin']);
    const item = withLock_(function () { return runBackup_('manual'); });
    audit_(user, 'backup', 'Backup', item.id, item.name);
    return ok_({ items: backupFiles_(), lastBackupAt: item.createdAt }, 'สำรองข้อมูลแล้ว');
  });
}

function deleteBackup(token, fileId) {
  return handle_(function () {
    const user = auth_(token, ['admin']);
    const item = backupFiles_().filter(function (b) { return b.id === fileId; })[0];
    if (!item) throw appError_('ไม่พบไฟล์สำรองข้อมูล');
    trashDriveFile_(item.id);
    audit_(user, 'delete', 'Backup', item.id, item.name);
    return ok_({ items: backupFiles_() }, 'ลบไฟล์สำรองข้อมูลแล้ว');
  });
}

function setDailyBackup(token, enabled) {
  return handle_(function () {
    const user = auth_(token, ['admin']);
    ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'dailyBackupJob'; }).forEach(function (t) { ScriptApp.deleteTrigger(t); });
    if (enabled) ScriptApp.newTrigger('dailyBackupJob').timeBased().everyDays(1).atHour(2).inTimezone(CONFIG.TIMEZONE).create();
    withLock_(function () { setSettingValues_([['dailyBackup', enabled ? 'on' : 'off']]); });
    audit_(user, 'update', 'Backup', '', enabled ? 'เปิดสำรองข้อมูลอัตโนมัติ 02:00' : 'ปิดสำรองข้อมูลอัตโนมัติ');
    return ok_({ dailyBackupActive: !!enabled }, enabled ? 'เปิดสำรองข้อมูลอัตโนมัติทุกวันเวลา 02:00 แล้ว' : 'ปิดสำรองข้อมูลอัตโนมัติแล้ว');
  });
}

/** เรียกโดย Time-driven Trigger — ไม่ทำซ้ำหากเพิ่งสำรองภายใน 20 ชั่วโมง */
function dailyBackupJob() {
  const last = Number(PropertiesService.getScriptProperties().getProperty('lastBackupTs') || 0);
  if (Date.now() - last < 20 * 3600 * 1000) return;
  try {
    withLock_(function () { runBackup_('auto'); });
    audit_({ username: 'system' }, 'backup', 'Backup', '', 'สำรองข้อมูลอัตโนมัติ');
  } catch (err) {
    console.error('dailyBackupJob: ' + err);
  }
}

function runBackup_(kind) {
  assertConfigured_();
  const folder = subFolder_('backups');
  const stamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd_HHmmss');
  const copy = DriveApp.getFileById(CONFIG.SHEET_ID).makeCopy(CONFIG.APP_NAME + ' backup ' + stamp + (kind === 'auto' ? ' (auto)' : ''), folder);
  const props = PropertiesService.getScriptProperties();
  props.setProperty('lastBackupTs', String(Date.now()));
  props.setProperty('lastBackupAt', now_());
  const keep = Number(publicSettings_().backupRetention) || 30;
  backupFiles_().slice(keep).forEach(function (b) { trashDriveFile_(b.id); });
  return { id: copy.getId(), name: copy.getName(), url: copy.getUrl(), createdAt: now_() };
}

function backupFiles_() {
  const it = subFolder_('backups').getFiles();
  const items = [];
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed()) continue;
    items.push({ id: f.getId(), name: f.getName(), url: f.getUrl(), size: f.getSize(), createdAt: Utilities.formatDate(f.getDateCreated(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss') });
  }
  return items.sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
}

function dailyBackupTrigger_() {
  return ScriptApp.getProjectTriggers().filter(function (x) { return x.getHandlerFunction() === 'dailyBackupJob'; })[0] || null;
}

/* ============================================================================
 * Audit Log
 * ========================================================================== */
function audit_(user, action, entity, entityId, detail) {
  try {
    insertRows_('AuditLog', [{
      timestamp: now_(), username: user && user.username ? user.username : 'system', action: action, entity: entity,
      entityId: entityId || '', detail: String(typeof detail === 'string' ? detail : JSON.stringify(detail || '')).slice(0, 500)
    }]);
  } catch (err) {
    console.error('audit_: ' + err);
  }
}

function listLogs(token) {
  return handle_(function () {
    auth_(token, ['admin']);
    const rows = readTable_('AuditLog').rows;
    const items = rows.slice(Math.max(0, rows.length - CONFIG.LOG_VIEW_LIMIT)).reverse().map(clean_);
    return ok_({ items: items, total: rows.length, limit: CONFIG.LOG_VIEW_LIMIT });
  });
}

/* ============================================================================
 * Utility Functions
 * ========================================================================== */
const TABLE_CACHE_ = {};
let SS_CACHE_ = null;

function handle_(fn) {
  try {
    return fn();
  } catch (err) {
    if (err && err.isAppError) {
      const res = { success: false, message: err.message };
      if (err.code) res.code = err.code;
      return res;
    }
    console.error(err && err.stack ? err.stack : String(err));
    return { success: false, message: 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง' };
  }
}

function ok_(data, message) {
  return { success: true, message: message || 'สำเร็จ', data: data === undefined ? {} : data };
}

function appError_(message, code) {
  const e = new Error(message);
  e.isAppError = true;
  e.code = code || '';
  return e;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) throw appError_('มีผู้ใช้งานพร้อมกันจำนวนมาก กรุณาลองใหม่อีกครั้ง');
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function ss_() {
  if (!SS_CACHE_) {
    assertConfigured_();
    try { SS_CACHE_ = SpreadsheetApp.openById(CONFIG.SHEET_ID); } catch (err) { throw appError_('ไม่สามารถเปิดฐานข้อมูล Google Sheets ได้ กรุณาติดต่ออาจารย์ผู้ดูแลระบบ'); }
  }
  return SS_CACHE_;
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) {
    CacheService.getScriptCache().remove('setup:ok');
    throw appError_('ไม่พบชีต "' + name + '" กรุณาให้อาจารย์เข้าสู่ระบบใหม่เพื่อสร้างชีตอัตโนมัติ');
  }
  return sh;
}

function normalizeCell_(header, v) {
  if (CONFIG.NUMERIC_FIELDS.indexOf(header) >= 0) {
    if (v === '' || v === null || v === undefined) return header === 'score' ? '' : 0;
    const n = Number(v);
    return isFinite(n) ? n : 0;
  }
  if (v instanceof Date) return Utilities.formatDate(v, CONFIG.TIMEZONE, /Date$/.test(header) ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss');
  return v === null || v === undefined ? '' : String(v);
}

/** อ่านทั้งชีตครั้งเดียวด้วย getValues() แล้วเก็บในหน่วยความจำของการเรียกครั้งนั้น */
function readTable_(name) {
  if (TABLE_CACHE_[name]) return TABLE_CACHE_[name];
  const headers = CONFIG.SHEETS[name];
  const sh = sheet_(name);
  const last = sh.getLastRow();
  const rows = [];
  if (last > 1) {
    const values = sh.getRange(2, 1, last - 1, headers.length).getValues();
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      let empty = true;
      for (let c = 0; c < row.length; c++) { if (row[c] !== '' && row[c] !== null) { empty = false; break; } }
      if (empty) continue;
      const obj = {};
      for (let c = 0; c < headers.length; c++) obj[headers[c]] = normalizeCell_(headers[c], row[c]);
      obj._row = i + 2;
      rows.push(obj);
    }
  }
  TABLE_CACHE_[name] = { headers: headers, rows: rows };
  return TABLE_CACHE_[name];
}

function invalidate_(name) {
  delete TABLE_CACHE_[name];
}

function toRow_(name, obj) {
  return CONFIG.SHEETS[name].map(function (h) {
    const v = obj[h];
    if (CONFIG.NUMERIC_FIELDS.indexOf(h) >= 0) {
      if (h === 'score' && (v === '' || v === null || v === undefined)) return '';
      const n = Number(v);
      return isFinite(n) ? n : 0;
    }
    if (v === undefined || v === null) return '';
    const s = String(v);
    return /^[=+\-@]/.test(s) ? "'" + s : s;
  });
}

/** เพิ่มหลายแถวพร้อมกันด้วย setValues() ครั้งเดียว */
function insertRows_(name, objs) {
  if (!objs.length) return;
  const sh = sheet_(name);
  const width = CONFIG.SHEETS[name].length;
  const start = sh.getLastRow() + 1;
  const needed = start + objs.length - 1 - sh.getMaxRows();
  if (needed > 0) sh.insertRowsAfter(sh.getMaxRows(), needed + 200);
  sh.getRange(start, 1, objs.length, width).setValues(objs.map(function (o) { return toRow_(name, o); }));
  invalidate_(name);
}

function updateRow_(name, rowObj, patch) {
  const merged = Object.assign({}, rowObj, patch);
  sheet_(name).getRange(rowObj._row, 1, 1, CONFIG.SHEETS[name].length).setValues([toRow_(name, merged)]);
  invalidate_(name);
  return merged;
}

/** เขียนทั้งตารางใหม่ในครั้งเดียว (ใช้กับการแก้/ลบหลายแถว) */
function rewriteTable_(name, rows) {
  const sh = sheet_(name);
  const width = CONFIG.SHEETS[name].length;
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, width).clearContent();
  if (rows.length) {
    const needed = rows.length + 1 - sh.getMaxRows();
    if (needed > 0) sh.insertRowsAfter(sh.getMaxRows(), needed + 200);
    sh.getRange(2, 1, rows.length, width).setValues(rows.map(function (o) { return toRow_(name, o); }));
  }
  invalidate_(name);
}

function deleteWhere_(name, predicate) {
  const t = readTable_(name);
  const removed = [];
  const keep = [];
  t.rows.forEach(function (r) { (predicate(r) ? removed : keep).push(r); });
  if (removed.length) rewriteTable_(name, keep);
  return removed;
}

function findById_(name, id) {
  if (!id) return null;
  const key = String(id);
  const rows = readTable_(name).rows;
  for (let i = 0; i < rows.length; i++) if (rows[i].id === key) return rows[i];
  return null;
}

function indexBy_(rows, key) {
  const map = {};
  rows.forEach(function (r) { map[r[key]] = r; });
  return map;
}

function categoryOf_(code) {
  return CONFIG.CATEGORIES.filter(function (c) { return c.code === code; })[0] || null;
}

function parseJson_(s, fallback) {
  try { return s ? JSON.parse(s) : fallback; } catch (err) { return fallback; }
}

function clean_(obj) {
  const out = {};
  Object.keys(obj).forEach(function (k) { if (k.charAt(0) !== '_') out[k] = obj[k]; });
  return out;
}

function appUrl_() {
  if (CONFIG.WEB_APP_URL) return CONFIG.WEB_APP_URL;
  try { return ScriptApp.getService().getUrl() || ''; } catch (err) { return ''; }
}

function newId_(prefix) {
  return prefix + '-' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyMMdd') + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
}

function now_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

function nowLocal_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm");
}

function today_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function addDays_(dateStr, days) {
  const p = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}

function weekdayOf_(dateStr) {
  const p = dateStr.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
}

function firstOnOrAfter_(dateStr, weekday) {
  return addDays_(dateStr, (weekday - weekdayOf_(dateStr) + 7) % 7);
}

function str_(v, max) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max || 500);
}

function req_(v, label) {
  if (v === undefined || v === null || String(v).trim() === '') throw appError_('กรุณากรอก ' + label);
  return v;
}

function score_(v, label, max, mustBePositive) {
  const s = String(v === undefined || v === null ? '' : v).replace(/,/g, '').trim();
  if (s === '') throw appError_('กรุณากรอก ' + label);
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw appError_(label + ' ต้องเป็นตัวเลข');
  const n = Number(s);
  if (n < 0) throw appError_(label + ' ต้องไม่ติดลบ');
  if (mustBePositive && n <= 0) throw appError_(label + ' ต้องมากกว่า 0');
  if (n > max) throw appError_(label + ' ต้องไม่เกิน ' + max);
  return round2_(n);
}

function intRange_(v, min, max, label) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (!/^\d+$/.test(s)) throw appError_(label + ' ต้องเป็นจำนวนเต็ม');
  const n = Number(s);
  if (n < min || n > max) throw appError_(label + ' ต้องอยู่ระหว่าง ' + min + '–' + max);
  return n;
}

function date_(v, label, required) {
  const s = str_(v, 10);
  if (!s) { if (required) throw appError_('กรุณาเลือก ' + label); return ''; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw appError_(label + ' ไม่ถูกต้อง');
  const p = s.split('-').map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  if (dt.getUTCFullYear() !== p[0] || dt.getUTCMonth() !== p[1] - 1 || dt.getUTCDate() !== p[2]) throw appError_(label + ' ไม่ถูกต้อง');
  return s;
}

function dateTime_(v, label, required) {
  const s = str_(v, 16);
  if (!s) { if (required) throw appError_('กรุณาเลือก ' + label); return ''; }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) throw appError_(label + ' ไม่ถูกต้อง');
  date_(s.slice(0, 10), label, true);
  time_(s.slice(11), label);
  return s;
}

function time_(v, label) {
  const s = str_(v, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw appError_(label + ' ไม่ถูกต้อง (รูปแบบ HH:mm)');
  return s;
}

function oneOf_(v, map, label) {
  const s = str_(v, 50);
  if (!Object.prototype.hasOwnProperty.call(map, s)) throw appError_(label + ' ไม่ถูกต้อง');
  return s;
}

function round2_(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function columnLetter_(n) {
  let s = '';
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}
