/**
 * ============================================================================
 *  2D animation — ระบบบริหารโครงการ กิจกรรม งบประมาณ และเอกสาร
 *  Google Apps Script Web App | ฐานข้อมูล: Google Sheets | ไฟล์: Google Drive
 *
 *  วิธีติดตั้ง
 *   1) แก้ค่า SHEET_ID, WEB_APP_URL, FOLDER_ID, ADMIN_PASSWORD ในส่วน CONFIGURATION
 *   2) Deploy > New deployment > Web app
 *        Execute as: Me  |  Who has access: ตามนโยบายสถานศึกษา
 *   3) เปิด Web App แล้วเข้าสู่ระบบด้วยชื่อผู้ใช้ admin และ ADMIN_PASSWORD
 *      ระบบจะสร้างชีตและโฟลเดอร์ที่จำเป็นให้อัตโนมัติเมื่อเข้าสู่ระบบครั้งแรก
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
  ADMIN_USERNAME: 'admin',
  TIMEZONE: 'Asia/Bangkok',
  SESSION_TTL_SECONDS: 21600,
  MAX_LOGIN_ATTEMPTS: 5,
  LOGIN_LOCK_SECONDS: 900,
  LOG_VIEW_LIMIT: 500,
  LOCK_WAIT_MS: 20000,
  MIN_PASSWORD_LENGTH: 6,

  ROLES: { admin: 'ผู้ดูแลระบบ', manager: 'หัวหน้างาน', staff: 'เจ้าหน้าที่' },
  USER_STATUS: { active: 'ใช้งาน', inactive: 'ปิดใช้งาน' },
  PROJECT_STATUS: { planning: 'วางแผน', active: 'ดำเนินการ', on_hold: 'ระงับชั่วคราว', completed: 'เสร็จสิ้น', cancelled: 'ยกเลิก' },
  ACTIVITY_STATUS: { not_started: 'ยังไม่เริ่ม', in_progress: 'กำลังดำเนินการ', completed: 'เสร็จสิ้น', cancelled: 'ยกเลิก' },
  EXPENSE_STATUS: { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ' },
  REPORT_TYPES: { project: 'รายงานสรุปโครงการ', budget: 'รายงานสรุปงบประมาณ', expense: 'รายงานการเบิกจ่าย' },
  FILE_SHARING: { private: 'เฉพาะเจ้าของไฟล์', domain: 'ทุกคนในองค์กรที่มีลิงก์', anyone: 'ทุกคนที่มีลิงก์' },
  FOLDERS: { projects: 'Projects', reports: 'Reports', backups: 'Backups', general: 'General' },

  NUMERIC_FIELDS: ['budget', 'amount', 'percent', 'size', 'progress'],

  SHEETS: {
    Users: ['id', 'username', 'password', 'fullName', 'email', 'role', 'departmentId', 'status', 'lastLoginAt', 'createdAt', 'updatedAt'],
    Departments: ['id', 'code', 'name', 'description', 'createdAt', 'updatedAt'],
    Projects: ['id', 'code', 'name', 'departmentId', 'ownerName', 'description', 'budget', 'startDate', 'endDate', 'status', 'progress', 'folderId', 'createdBy', 'createdAt', 'updatedAt'],
    Activities: ['id', 'projectId', 'name', 'description', 'responsible', 'budget', 'startDate', 'endDate', 'status', 'createdBy', 'createdAt', 'updatedAt'],
    Expenses: ['id', 'projectId', 'activityId', 'expenseDate', 'description', 'payee', 'receiptNo', 'amount', 'fileId', 'status', 'note', 'createdBy', 'createdAt', 'updatedAt', 'approvedBy', 'approvedAt'],
    Progress: ['id', 'projectId', 'activityId', 'reportDate', 'percent', 'detail', 'problems', 'nextSteps', 'createdBy', 'createdAt', 'updatedAt'],
    Reports: ['id', 'title', 'reportType', 'projectId', 'departmentId', 'startDate', 'endDate', 'note', 'fileId', 'fileUrl', 'generatedAt', 'createdBy', 'createdAt', 'updatedAt'],
    Files: ['id', 'name', 'mimeType', 'size', 'driveId', 'url', 'refType', 'refId', 'projectId', 'description', 'uploadedBy', 'createdAt'],
    Settings: ['key', 'value', 'updatedAt'],
    AuditLog: ['timestamp', 'username', 'action', 'entity', 'entityId', 'detail']
  },

  DEFAULT_SETTINGS: {
    orgName: '',
    fiscalYear: '',
    currency: 'บาท',
    maxUploadMB: '10',
    fileSharing: 'private',
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
  return handle_(function () {
    runSetup_();
    return ok_({ sheets: Object.keys(CONFIG.SHEETS) }, 'ตั้งค่าระบบเรียบร้อย');
  });
}

function ensureSetup_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('setup:ok')) return;
  runSetup_();
}

function runSetup_() {
  assertConfigured_();
  withLock_(function () {
    initSheets_();
    ensureDefaultSettings_();
    Object.keys(CONFIG.FOLDERS).forEach(function (key) { subFolder_(key); });
  });
  CacheService.getScriptCache().put('setup:ok', '1', 21600);
}

function assertConfigured_() {
  if (!CONFIG.SHEET_ID || CONFIG.SHEET_ID.indexOf('ใส่_') === 0) throw appError_('ระบบยังไม่ได้ตั้งค่า SHEET_ID กรุณาติดต่อผู้ดูแลระบบ');
  if (!CONFIG.FOLDER_ID || CONFIG.FOLDER_ID.indexOf('ใส่_') === 0) throw appError_('ระบบยังไม่ได้ตั้งค่า FOLDER_ID กรุณาติดต่อผู้ดูแลระบบ');
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
      if (used.length < headers.length) {
        sh.getRange(1, used.length + 1, 1, headers.length - used.length).setValues([headers.slice(used.length)]);
      }
    }
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e8eefc');
    const textCols = [];
    headers.forEach(function (h, i) {
      if (CONFIG.NUMERIC_FIELDS.indexOf(h) < 0) {
        const col = columnLetter_(i + 1);
        textCols.push(col + ':' + col);
      }
    });
    if (textCols.length) sh.getRangeList(textCols).setNumberFormat('@');
  });
  ['Sheet1', 'แผ่น1', 'แผ่นงาน1'].forEach(function (n) {
    const s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
}

function ensureDefaultSettings_() {
  const map = settingsMap_();
  const add = [];
  const stamp = now_();
  Object.keys(CONFIG.DEFAULT_SETTINGS).forEach(function (key) {
    if (map[key] === undefined) {
      let value = CONFIG.DEFAULT_SETTINGS[key];
      if (key === 'fiscalYear') {
        // ปีงบประมาณไทยเริ่ม 1 ตุลาคม
        const y = Number(Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy'));
        const m = Number(Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'MM'));
        value = String(y + 543 + (m >= 10 ? 1 : 0));
      }
      add.push({ key: key, value: value, updatedAt: stamp });
    }
  });
  if (add.length) insertRows_('Settings', add);
}

/* ============================================================================
 * Authentication
 * ========================================================================== */
const SESSION_EXPIRED_MSG = 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';

function createSession_(user) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('sess:' + token, JSON.stringify({ id: user.id }), CONFIG.SESSION_TTL_SECONDS);
  return token;
}

function auth_(token) {
  if (!token || typeof token !== 'string' || token.length > 80) throw appError_(SESSION_EXPIRED_MSG, 'SESSION_EXPIRED');
  const cache = CacheService.getScriptCache();
  const raw = cache.get('sess:' + token);
  if (!raw) throw appError_(SESSION_EXPIRED_MSG, 'SESSION_EXPIRED');
  const s = JSON.parse(raw);
  let user;
  if (s.id === 'admin') {
    user = builtinAdmin_();
  } else {
    const row = findById_('Users', s.id);
    if (!row || row.status !== 'active') {
      cache.remove('sess:' + token);
      throw appError_('บัญชีนี้ถูกปิดการใช้งานหรือถูกลบแล้ว', 'SESSION_EXPIRED');
    }
    user = sessionUser_(row);
  }
  cache.put('sess:' + token, raw, CONFIG.SESSION_TTL_SECONDS);
  return user;
}

function builtinAdmin_() {
  return { id: 'admin', username: CONFIG.ADMIN_USERNAME, fullName: 'ผู้ดูแลระบบ', email: '', role: 'admin', departmentId: '', builtin: true };
}

function sessionUser_(row) {
  return { id: row.id, username: row.username, fullName: row.fullName, email: row.email, role: row.role, departmentId: row.departmentId, builtin: false };
}

function requireRole_(user, roles) {
  if (roles.indexOf(user.role) < 0) throw appError_('คุณไม่มีสิทธิ์ใช้งานส่วนนี้');
}

function canSeeProject_(user, p) {
  return user.role === 'admin' || (!!p.departmentId && p.departmentId === user.departmentId);
}

function canManageProject_(user, p) {
  return user.role === 'admin' || (user.role === 'manager' && p.departmentId === user.departmentId);
}

function projectFor_(user, projectId, manage) {
  const p = findById_('Projects', projectId);
  if (!p || !canSeeProject_(user, p)) throw appError_('ไม่พบโครงการ หรือคุณไม่มีสิทธิ์เข้าถึง');
  if (manage && !canManageProject_(user, p)) throw appError_('คุณไม่มีสิทธิ์แก้ไขข้อมูลของโครงการนี้');
  return p;
}

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

    let user = null;
    if (name.toLowerCase() === CONFIG.ADMIN_USERNAME.toLowerCase()) {
      const adminReady = CONFIG.ADMIN_PASSWORD && CONFIG.ADMIN_PASSWORD.indexOf('ใส่_') !== 0;
      if (adminReady && pass === CONFIG.ADMIN_PASSWORD) user = builtinAdmin_();
    } else {
      const row = readTable_('Users').rows.filter(function (u) { return u.username.toLowerCase() === name.toLowerCase(); })[0];
      if (row && row.status === 'active' && row.password === pass) {
        user = sessionUser_(row);
        withLock_(function () { updateRow_('Users', findById_('Users', row.id), { lastLoginAt: now_() }); });
      }
    }
    if (!user) {
      cache.put(failKey, String(fails + 1), CONFIG.LOGIN_LOCK_SECONDS);
      audit_({ username: name }, 'login_failed', 'Auth', '', 'เข้าสู่ระบบไม่สำเร็จ');
      throw appError_('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }
    cache.remove(failKey);
    const token = createSession_(user);
    audit_(user, 'login', 'Auth', user.id, 'เข้าสู่ระบบ');
    return ok_({ token: token, bootstrap: buildBootstrap_(user) }, 'เข้าสู่ระบบสำเร็จ');
  });
}

function logout(token) {
  return handle_(function () {
    const cache = CacheService.getScriptCache();
    if (token && typeof token === 'string') {
      const raw = cache.get('sess:' + token);
      if (raw) {
        const s = JSON.parse(raw);
        const user = s.id === 'admin' ? builtinAdmin_() : (findById_('Users', s.id) || { username: 'unknown' });
        audit_(user, 'logout', 'Auth', s.id, 'ออกจากระบบ');
      }
      cache.remove('sess:' + token);
    }
    return ok_({}, 'ออกจากระบบแล้ว');
  });
}

function getBootstrap(token) {
  return handle_(function () {
    const user = auth_(token);
    return ok_(buildBootstrap_(user));
  });
}

function buildBootstrap_(user) {
  const ctx = context_();
  return {
    appName: CONFIG.APP_NAME,
    appUrl: appUrl_(),
    user: publicUser_(user, ctx),
    settings: publicSettings_(),
    departments: departmentList_(ctx),
    lookups: lookups_(user, ctx),
    dashboard: dashboard_(user, ctx),
    meta: {
      roles: CONFIG.ROLES,
      userStatus: CONFIG.USER_STATUS,
      projectStatus: CONFIG.PROJECT_STATUS,
      activityStatus: CONFIG.ACTIVITY_STATUS,
      expenseStatus: CONFIG.EXPENSE_STATUS,
      reportTypes: CONFIG.REPORT_TYPES,
      fileSharing: CONFIG.FILE_SHARING,
      minPasswordLength: CONFIG.MIN_PASSWORD_LENGTH
    }
  };
}

function publicUser_(user, ctx) {
  const dept = user.departmentId ? ctx.deptMap[user.departmentId] : null;
  return {
    id: user.id, username: user.username, fullName: user.fullName, email: user.email || '',
    role: user.role, roleLabel: CONFIG.ROLES[user.role] || user.role,
    departmentId: user.departmentId || '', departmentName: dept ? dept.name : '', builtin: !!user.builtin
  };
}

function changeMyPassword(token, data) {
  return handle_(function () {
    const user = auth_(token);
    if (user.builtin) throw appError_('รหัสผ่านของผู้ดูแลระบบหลักเปลี่ยนได้ที่ ADMIN_PASSWORD ใน Code.gs เท่านั้น');
    const d = data || {};
    const current = String(d.currentPassword || '');
    const next = String(d.newPassword || '');
    const confirm = String(d.confirmPassword || '');
    if (!current || !next || !confirm) throw appError_('กรุณากรอกข้อมูลให้ครบ');
    if (next.length < CONFIG.MIN_PASSWORD_LENGTH) throw appError_('รหัสผ่านใหม่ต้องมีอย่างน้อย ' + CONFIG.MIN_PASSWORD_LENGTH + ' ตัวอักษร');
    if (next.length > 100) throw appError_('รหัสผ่านยาวเกินไป');
    if (next !== confirm) throw appError_('ยืนยันรหัสผ่านไม่ตรงกัน');
    return withLock_(function () {
      const row = findById_('Users', user.id);
      if (!row || row.password !== current) throw appError_('รหัสผ่านปัจจุบันไม่ถูกต้อง');
      if (current === next) throw appError_('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
      updateRow_('Users', row, { password: next, updatedAt: now_() });
      audit_(user, 'change_password', 'User', user.id, 'เปลี่ยนรหัสผ่านตนเอง');
      return ok_({}, 'เปลี่ยนรหัสผ่านเรียบร้อย');
    });
  });
}

/* ============================================================================
 * User Management
 * ========================================================================== */
function listUsers(token) {
  return handle_(function () {
    const user = auth_(token);
    requireRole_(user, ['admin']);
    const ctx = context_();
    const items = readTable_('Users').rows.map(function (u) { return userView_(u, ctx); })
      .sort(function (a, b) { return a.username.localeCompare(b.username); });
    return ok_({ items: items });
  });
}

function userView_(u, ctx) {
  const dept = ctx.deptMap[u.departmentId];
  return {
    id: u.id, username: u.username, fullName: u.fullName, email: u.email, role: u.role,
    roleLabel: CONFIG.ROLES[u.role] || u.role, departmentId: u.departmentId, departmentName: dept ? dept.name : '',
    status: u.status, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, updatedAt: u.updatedAt
  };
}

function saveUser(token, data) {
  return handle_(function () {
    const user = auth_(token);
    requireRole_(user, ['admin']);
    const d = data || {};
    const input = {
      username: req_(str_(d.username, 30), 'ชื่อผู้ใช้'),
      fullName: req_(str_(d.fullName, 120), 'ชื่อ-นามสกุล'),
      email: str_(d.email, 120),
      role: oneOf_(d.role, CONFIG.ROLES, 'บทบาท'),
      departmentId: str_(d.departmentId, 50),
      status: oneOf_(d.status || 'active', CONFIG.USER_STATUS, 'สถานะ')
    };
    if (!/^[A-Za-z0-9._-]{3,30}$/.test(input.username)) throw appError_('ชื่อผู้ใช้ต้องเป็นภาษาอังกฤษ ตัวเลข หรือ . _ - ความยาว 3–30 ตัวอักษร');
    if (input.username.toLowerCase() === CONFIG.ADMIN_USERNAME.toLowerCase()) throw appError_('ชื่อผู้ใช้นี้สงวนไว้สำหรับผู้ดูแลระบบหลัก');
    if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw appError_('รูปแบบอีเมลไม่ถูกต้อง');
    if (input.role !== 'admin' && !input.departmentId) throw appError_('กรุณาเลือกหน่วยงานของผู้ใช้');
    const password = String(d.password || '');
    if (password && password.length < CONFIG.MIN_PASSWORD_LENGTH) throw appError_('รหัสผ่านต้องมีอย่างน้อย ' + CONFIG.MIN_PASSWORD_LENGTH + ' ตัวอักษร');
    if (password.length > 100) throw appError_('รหัสผ่านยาวเกินไป');
    return withLock_(function () {
      if (input.departmentId && !findById_('Departments', input.departmentId)) throw appError_('ไม่พบหน่วยงานที่เลือก');
      const users = readTable_('Users').rows;
      const dup = users.some(function (u) { return u.username.toLowerCase() === input.username.toLowerCase() && u.id !== d.id; });
      if (dup) throw appError_('ชื่อผู้ใช้ "' + input.username + '" มีอยู่แล้ว');
      let saved;
      if (d.id) {
        const cur = findById_('Users', d.id);
        if (!cur) throw appError_('ไม่พบผู้ใช้');
        const patch = Object.assign({}, input, { updatedAt: now_() });
        if (password) patch.password = password;
        saved = updateRow_('Users', cur, patch);
        audit_(user, 'update', 'User', cur.id, input.username + (password ? ' (ตั้งรหัสผ่านใหม่)' : ''));
      } else {
        if (!password) throw appError_('กรุณากำหนดรหัสผ่านเริ่มต้น');
        saved = Object.assign({ id: newId_('USR'), password: password, lastLoginAt: '', createdAt: now_(), updatedAt: now_() }, input);
        insertRows_('Users', [saved]);
        audit_(user, 'create', 'User', saved.id, input.username);
      }
      return ok_(userView_(saved, context_()), 'บันทึกผู้ใช้แล้ว');
    });
  });
}

function deleteUser(token, id) {
  return handle_(function () {
    const user = auth_(token);
    requireRole_(user, ['admin']);
    return withLock_(function () {
      const cur = findById_('Users', id);
      if (!cur) throw appError_('ไม่พบผู้ใช้');
      if (cur.id === user.id) throw appError_('ไม่สามารถลบบัญชีของตนเองได้');
      deleteWhere_('Users', function (u) { return u.id === cur.id; });
      audit_(user, 'delete', 'User', cur.id, cur.username);
      return ok_({ id: cur.id }, 'ลบผู้ใช้แล้ว');
    });
  });
}

/* ============================================================================
 * Department Management
 * ========================================================================== */
function listDepartments(token) {
  return handle_(function () {
    auth_(token);
    return ok_({ items: departmentList_(context_()) });
  });
}

function departmentList_(ctx) {
  const users = readTable_('Users').rows;
  return ctx.departments.map(function (dp) {
    return {
      id: dp.id, code: dp.code, name: dp.name, description: dp.description, createdAt: dp.createdAt, updatedAt: dp.updatedAt,
      userCount: users.filter(function (u) { return u.departmentId === dp.id; }).length,
      projectCount: ctx.projects.filter(function (p) { return p.departmentId === dp.id; }).length
    };
  }).sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); });
}

function saveDepartment(token, data) {
  return handle_(function () {
    const user = auth_(token);
    requireRole_(user, ['admin']);
    const d = data || {};
    const input = { code: str_(d.code, 30), name: req_(str_(d.name, 150), 'ชื่อหน่วยงาน'), description: str_(d.description, 1000) };
    return withLock_(function () {
      const rows = readTable_('Departments').rows;
      if (rows.some(function (r) { return r.name.toLowerCase() === input.name.toLowerCase() && r.id !== d.id; })) throw appError_('ชื่อหน่วยงานซ้ำ');
      if (input.code && rows.some(function (r) { return r.code.toLowerCase() === input.code.toLowerCase() && r.id !== d.id; })) throw appError_('รหัสหน่วยงานซ้ำ');
      let saved;
      if (d.id) {
        const cur = findById_('Departments', d.id);
        if (!cur) throw appError_('ไม่พบหน่วยงาน');
        saved = updateRow_('Departments', cur, Object.assign({}, input, { updatedAt: now_() }));
        audit_(user, 'update', 'Department', cur.id, input.name);
      } else {
        saved = Object.assign({ id: newId_('DEP'), createdAt: now_(), updatedAt: now_() }, input);
        insertRows_('Departments', [saved]);
        audit_(user, 'create', 'Department', saved.id, input.name);
      }
      return ok_(clean_(saved), 'บันทึกหน่วยงานแล้ว');
    });
  });
}

function deleteDepartment(token, id) {
  return handle_(function () {
    const user = auth_(token);
    requireRole_(user, ['admin']);
    return withLock_(function () {
      const cur = findById_('Departments', id);
      if (!cur) throw appError_('ไม่พบหน่วยงาน');
      const usedByUser = readTable_('Users').rows.some(function (u) { return u.departmentId === cur.id; });
      const usedByProject = readTable_('Projects').rows.some(function (p) { return p.departmentId === cur.id; });
      if (usedByUser || usedByProject) throw appError_('ไม่สามารถลบได้ เนื่องจากยังมีผู้ใช้หรือโครงการอยู่ในหน่วยงานนี้');
      deleteWhere_('Departments', function (r) { return r.id === cur.id; });
      audit_(user, 'delete', 'Department', cur.id, cur.name);
      return ok_({ id: cur.id }, 'ลบหน่วยงานแล้ว');
    });
  });
}

/* ============================================================================
 * Project CRUD
 * ========================================================================== */
function listProjects(token) {
  return handle_(function () {
    const user = auth_(token);
    const ctx = context_();
    const items = ctx.projects.filter(function (p) { return canSeeProject_(user, p); })
      .map(function (p) { return projectView_(p, ctx); })
      .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    return ok_({ items: items, lookups: lookups_(user, ctx) });
  });
}

function getProjectDetail(token, id) {
  return handle_(function () {
    const user = auth_(token);
    const p = projectFor_(user, id, false);
    const ctx = context_();
    const actMap = indexBy_(ctx.activities, 'id');
    const fileMap = indexBy_(readTable_('Files').rows, 'id');
    const activities = ctx.activities.filter(function (a) { return a.projectId === p.id; })
      .map(function (a) { return activityView_(a, ctx); })
      .sort(function (a, b) { return String(a.startDate).localeCompare(String(b.startDate)); });
    const expenses = ctx.expenses.filter(function (e) { return e.projectId === p.id; })
      .map(function (e) { return expenseView_(e, ctx, actMap, fileMap); })
      .sort(function (a, b) { return String(b.expenseDate).localeCompare(String(a.expenseDate)); });
    const progress = readTable_('Progress').rows.filter(function (r) { return r.projectId === p.id; })
      .map(function (r) { return progressView_(r, ctx, actMap); })
      .sort(function (a, b) { return String(b.reportDate + b.createdAt).localeCompare(String(a.reportDate + a.createdAt)); });
    const files = readTable_('Files').rows.filter(function (f) { return f.projectId === p.id; })
      .map(function (f) { return fileView_(f, ctx); })
      .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    return ok_({
      project: projectView_(p, ctx), activities: activities, expenses: expenses, progress: progress, files: files,
      canManage: canManageProject_(user, p), lookups: lookups_(user, ctx)
    });
  });
}

function saveProject(token, data) {
  return handle_(function () {
    const user = auth_(token);
    requireRole_(user, ['admin', 'manager']);
    const d = data || {};
    const input = {
      code: str_(d.code, 30),
      name: req_(str_(d.name, 200), 'ชื่อโครงการ'),
      departmentId: req_(str_(d.departmentId, 50), 'หน่วยงาน'),
      ownerName: str_(d.ownerName, 120),
      description: str_(d.description, 3000),
      budget: money_(d.budget, 'งบประมาณโครงการ', false),
      startDate: date_(d.startDate, 'วันที่เริ่ม', true),
      endDate: date_(d.endDate, 'วันที่สิ้นสุด', true),
      status: oneOf_(d.status || 'planning', CONFIG.PROJECT_STATUS, 'สถานะโครงการ')
    };
    dateOrder_(input.startDate, input.endDate);
    return withLock_(function () {
      if (!findById_('Departments', input.departmentId)) throw appError_('ไม่พบหน่วยงานที่เลือก');
      if (user.role !== 'admin' && input.departmentId !== user.departmentId) throw appError_('สร้างหรือแก้ไขได้เฉพาะโครงการของหน่วยงานตนเอง');
      const projects = readTable_('Projects').rows;
      if (input.code && projects.some(function (p) { return p.code.toLowerCase() === input.code.toLowerCase() && p.id !== d.id; })) throw appError_('รหัสโครงการ "' + input.code + '" ซ้ำ');
      let saved;
      if (d.id) {
        const cur = projectFor_(user, d.id, true);
        const st = context_().pStat[cur.id];
        if (input.budget < st.activityBudget) throw appError_('งบประมาณโครงการต้องไม่น้อยกว่างบกิจกรรมรวม (' + fmtMoney_(st.activityBudget) + ')');
        if (input.budget < st.committed) throw appError_('งบประมาณโครงการต้องไม่น้อยกว่ายอดเบิกจ่ายรวม (' + fmtMoney_(st.committed) + ')');
        saved = updateRow_('Projects', cur, Object.assign({}, input, { updatedAt: now_() }));
        audit_(user, 'update', 'Project', cur.id, input.name);
      } else {
        saved = Object.assign({ id: newId_('PRJ'), progress: 0, folderId: '', createdBy: user.username, createdAt: now_(), updatedAt: now_() }, input);
        insertRows_('Projects', [saved]);
        audit_(user, 'create', 'Project', saved.id, input.name);
      }
      return ok_(projectView_(saved, context_()), 'บันทึกโครงการแล้ว');
    });
  });
}

function deleteProject(token, id) {
  return handle_(function () {
    const user = auth_(token);
    requireRole_(user, ['admin', 'manager']);
    return withLock_(function () {
      const p = projectFor_(user, id, true);
      const files = deleteWhere_('Files', function (f) { return f.projectId === p.id; });
      files.forEach(function (f) { trashDriveFile_(f.driveId); });
      const reports = deleteWhere_('Reports', function (r) { return r.projectId === p.id; });
      reports.forEach(function (r) { if (r.fileId) trashDriveFile_(r.fileId); });
      const acts = deleteWhere_('Activities', function (a) { return a.projectId === p.id; });
      const exps = deleteWhere_('Expenses', function (e) { return e.projectId === p.id; });
      const prog = deleteWhere_('Progress', function (r) { return r.projectId === p.id; });
      deleteWhere_('Projects', function (r) { return r.id === p.id; });
      if (p.folderId) trashDriveFolder_(p.folderId);
      audit_(user, 'delete', 'Project', p.id, p.name + ' (กิจกรรม ' + acts.length + ', เบิกจ่าย ' + exps.length + ', ความก้าวหน้า ' + prog.length + ', ไฟล์ ' + files.length + ')');
      return ok_({ id: p.id }, 'ลบโครงการและข้อมูลที่เกี่ยวข้องแล้ว');
    });
  });
}

function projectView_(p, ctx) {
  const st = ctx.pStat[p.id] || emptyStat_();
  const dept = ctx.deptMap[p.departmentId];
  return {
    id: p.id, code: p.code, name: p.name, departmentId: p.departmentId, departmentName: dept ? dept.name : '',
    ownerName: p.ownerName, description: p.description, budget: p.budget, startDate: p.startDate, endDate: p.endDate,
    status: p.status, statusLabel: CONFIG.PROJECT_STATUS[p.status] || p.status, progress: p.progress,
    activityBudget: round2_(st.activityBudget), unallocated: round2_(p.budget - st.activityBudget),
    spent: round2_(st.spent), pending: round2_(st.pending), committed: round2_(st.committed),
    remaining: round2_(p.budget - st.committed), usedPct: p.budget > 0 ? round2_(st.committed / p.budget * 100) : 0,
    activityCount: st.activityCount, expenseCount: st.expenseCount,
    createdBy: p.createdBy, createdAt: p.createdAt, updatedAt: p.updatedAt
  };
}

/* ============================================================================
 * Activity CRUD
 * ========================================================================== */
function listActivities(token, projectId) {
  return handle_(function () {
    const user = auth_(token);
    const ctx = context_();
    const visible = {};
    ctx.projects.forEach(function (p) { if (canSeeProject_(user, p)) visible[p.id] = true; });
    const items = ctx.activities.filter(function (a) { return visible[a.projectId] && (!projectId || a.projectId === projectId); })
      .map(function (a) { return activityView_(a, ctx); })
      .sort(function (a, b) { return String(a.projectName + a.startDate).localeCompare(String(b.projectName + b.startDate), 'th'); });
    return ok_({ items: items, lookups: lookups_(user, ctx) });
  });
}

function saveActivity(token, data) {
  return handle_(function () {
    const user = auth_(token);
    requireRole_(user, ['admin', 'manager']);
    const d = data || {};
    const input = {
      projectId: req_(str_(d.projectId, 50), 'โครงการ'),
      name: req_(str_(d.name, 200), 'ชื่อกิจกรรม'),
      description: str_(d.description, 2000),
      responsible: str_(d.responsible, 120),
      budget: money_(d.budget, 'งบประมาณกิจกรรม', false),
      startDate: date_(d.startDate, 'วันที่เริ่ม', true),
      endDate: date_(d.endDate, 'วันที่สิ้นสุด', true),
      status: oneOf_(d.status || 'not_started', CONFIG.ACTIVITY_STATUS, 'สถานะกิจกรรม')
    };
    dateOrder_(input.startDate, input.endDate);
    return withLock_(function () {
      const p = projectFor_(user, input.projectId, true);
      const ctx = context_();
      const others = ctx.activities.filter(function (a) { return a.projectId === p.id && a.id !== d.id; })
        .reduce(function (t, a) { return t + a.budget; }, 0);
      if (others + input.budget > p.budget) {
        throw appError_('งบกิจกรรมรวมเกินงบโครงการ (งบโครงการ ' + fmtMoney_(p.budget) + ', จัดสรรแล้ว ' + fmtMoney_(others) + ', คงเหลือให้จัดสรร ' + fmtMoney_(p.budget - others) + ')');
      }
      let saved;
      if (d.id) {
        const cur = findById_('Activities', d.id);
        if (!cur) throw appError_('ไม่พบกิจกรรม');
        if (cur.projectId !== p.id) {
          const linked = ctx.expenses.some(function (e) { return e.activityId === cur.id; });
          if (linked) throw appError_('ไม่สามารถย้ายกิจกรรมที่มีรายการเบิกจ่ายไปโครงการอื่นได้');
          projectFor_(user, cur.projectId, true);
        }
        const st = ctx.aStat[cur.id] || emptyStat_();
        if (input.budget < st.committed) throw appError_('งบกิจกรรมต้องไม่น้อยกว่ายอดเบิกจ่ายของกิจกรรม (' + fmtMoney_(st.committed) + ')');
        saved = updateRow_('Activities', cur, Object.assign({}, input, { updatedAt: now_() }));
        audit_(user, 'update', 'Activity', cur.id, input.name);
      } else {
        saved = Object.assign({ id: newId_('ACT'), createdBy: user.username, createdAt: now_(), updatedAt: now_() }, input);
        insertRows_('Activities', [saved]);
        audit_(user, 'create', 'Activity', saved.id, input.name);
      }
      return ok_(activityView_(saved, context_()), 'บันทึกกิจกรรมแล้ว');
    });
  });
}

function deleteActivity(token, id) {
  return handle_(function () {
    const user = auth_(token);
    requireRole_(user, ['admin', 'manager']);
    return withLock_(function () {
      const cur = findById_('Activities', id);
      if (!cur) throw appError_('ไม่พบกิจกรรม');
      projectFor_(user, cur.projectId, true);
      const linked = readTable_('Expenses').rows.some(function (e) { return e.activityId === cur.id; });
      if (linked) throw appError_('ไม่สามารถลบกิจกรรมที่มีรายการเบิกจ่ายได้ กรุณาลบหรือย้ายรายการเบิกจ่ายก่อน');
      const prog = readTable_('Progress');
      const linkedProgress = prog.rows.filter(function (r) { return r.activityId === cur.id; });
      if (linkedProgress.length) {
        rewriteTable_('Progress', prog.rows.map(function (r) { return r.activityId === cur.id ? Object.assign({}, r, { activityId: '' }) : r; }));
      }
      deleteWhere_('Activities', function (a) { return a.id === cur.id; });
      audit_(user, 'delete', 'Activity', cur.id, cur.name);
      return ok_({ id: cur.id }, 'ลบกิจกรรมแล้ว');
    });
  });
}

function activityView_(a, ctx) {
  const st = ctx.aStat[a.id] || emptyStat_();
  const p = ctx.projectMap[a.projectId];
  return {
    id: a.id, projectId: a.projectId, projectName: p ? p.name : '', projectCode: p ? p.code : '',
    name: a.name, description: a.description, responsible: a.responsible, budget: a.budget,
    startDate: a.startDate, endDate: a.endDate, status: a.status, statusLabel: CONFIG.ACTIVITY_STATUS[a.status] || a.status,
    spent: round2_(st.spent), pending: round2_(st.pending), committed: round2_(st.committed), remaining: round2_(a.budget - st.committed),
    usedPct: a.budget > 0 ? round2_(st.committed / a.budget * 100) : 0,
    createdBy: a.createdBy, createdAt: a.createdAt, updatedAt: a.updatedAt
  };
}

/* ============================================================================
 * Expense CRUD
 * ========================================================================== */
function listExpenses(token) {
  return handle_(function () {
    const user = auth_(token);
    const ctx = context_();
    const actMap = indexBy_(ctx.activities, 'id');
    const fileMap = indexBy_(readTable_('Files').rows, 'id');
    const items = ctx.expenses.filter(function (e) { const p = ctx.projectMap[e.projectId]; return p && canSeeProject_(user, p); })
      .map(function (e) { return expenseView_(e, ctx, actMap, fileMap); })
      .sort(function (a, b) { return String(b.expenseDate + b.createdAt).localeCompare(String(a.expenseDate + a.createdAt)); });
    return ok_({ items: items, lookups: lookups_(user, ctx) });
  });
}

function saveExpense(token, data) {
  return handle_(function () {
    const user = auth_(token);
    const d = data || {};
    const input = {
      projectId: req_(str_(d.projectId, 50), 'โครงการ'),
      activityId: str_(d.activityId, 50),
      expenseDate: date_(d.expenseDate, 'วันที่เบิกจ่าย', true),
      description: req_(str_(d.description, 500), 'รายการ'),
      payee: str_(d.payee, 200),
      receiptNo: str_(d.receiptNo, 60),
      amount: money_(d.amount, 'จำนวนเงิน', true),
      note: str_(d.note, 1000)
    };
    const upload = d.file && d.file.data ? validateUpload_(d.file) : null;
    return withLock_(function () {
      const p = projectFor_(user, input.projectId, false);
      const ctx = context_();
      let cur = null;
      if (d.id) {
        cur = findById_('Expenses', d.id);
        if (!cur) throw appError_('ไม่พบรายการเบิกจ่าย');
        const oldProject = projectFor_(user, cur.projectId, false);
        const manager = canManageProject_(user, oldProject);
        if (!manager && !(cur.createdBy === user.username && cur.status === 'pending')) throw appError_('แก้ไขได้เฉพาะรายการของตนเองที่ยังรออนุมัติ');
        if (cur.projectId !== p.id && !canManageProject_(user, p) && !(cur.createdBy === user.username)) throw appError_('คุณไม่มีสิทธิ์ย้ายรายการไปโครงการนี้');
      }
      let act = null;
      if (input.activityId) {
        act = ctx.activities.filter(function (a) { return a.id === input.activityId; })[0];
        if (!act || act.projectId !== p.id) throw appError_('กิจกรรมที่เลือกไม่อยู่ในโครงการนี้');
      }
      const excludeId = cur ? cur.id : '';
      const countsInBudget = !cur || cur.status !== 'rejected';
      if (countsInBudget) checkExpenseBudget_(ctx, p, act, input.amount, excludeId);
      let fileId = cur ? cur.fileId : '';
      let saved;
      if (cur) {
        saved = updateRow_('Expenses', cur, Object.assign({}, input, { updatedAt: now_() }));
        audit_(user, 'update', 'Expense', cur.id, input.description + ' ' + fmtMoney_(input.amount));
      } else {
        saved = Object.assign({ id: newId_('EXP'), fileId: '', status: 'pending', createdBy: user.username, createdAt: now_(), updatedAt: now_(), approvedBy: '', approvedAt: '' }, input);
        insertRows_('Expenses', [saved]);
        audit_(user, 'create', 'Expense', saved.id, input.description + ' ' + fmtMoney_(input.amount));
      }
      if (upload) {
        if (fileId) removeFileRecord_(fileId);
        const rec = storeFile_(user, upload, p, 'expense', saved.id, 'หลักฐานการเบิกจ่าย: ' + input.description);
        fileId = rec.id;
        saved = updateRow_('Expenses', findById_('Expenses', saved.id), { fileId: fileId });
      }
      const fresh = context_();
      return ok_(expenseView_(saved, fresh, indexBy_(fresh.activities, 'id'), indexBy_(readTable_('Files').rows, 'id')), 'บันทึกรายการเบิกจ่ายแล้ว');
    });
  });
}

function checkExpenseBudget_(ctx, project, activity, amount, excludeId) {
  const projectUsed = ctx.expenses.filter(function (e) { return e.projectId === project.id && e.status !== 'rejected' && e.id !== excludeId; })
    .reduce(function (t, e) { return t + e.amount; }, 0);
  const projectLeft = round2_(project.budget - projectUsed);
  if (amount > projectLeft) throw appError_('จำนวนเงินเกินงบคงเหลือของโครงการ (คงเหลือ ' + fmtMoney_(projectLeft) + ')');
  if (activity) {
    const actUsed = ctx.expenses.filter(function (e) { return e.activityId === activity.id && e.status !== 'rejected' && e.id !== excludeId; })
      .reduce(function (t, e) { return t + e.amount; }, 0);
    const actLeft = round2_(activity.budget - actUsed);
    if (amount > actLeft) throw appError_('จำนวนเงินเกินงบคงเหลือของกิจกรรม (คงเหลือ ' + fmtMoney_(actLeft) + ')');
  }
}

function setExpenseStatus(token, id, status) {
  return handle_(function () {
    const user = auth_(token);
    requireRole_(user, ['admin', 'manager']);
    const next = oneOf_(status, CONFIG.EXPENSE_STATUS, 'สถานะ');
    return withLock_(function () {
      const cur = findById_('Expenses', id);
      if (!cur) throw appError_('ไม่พบรายการเบิกจ่าย');
      const p = projectFor_(user, cur.projectId, true);
      if (cur.status === next) return ok_({ id: cur.id }, 'สถานะไม่เปลี่ยนแปลง');
      if (cur.status === 'rejected' && next !== 'rejected') {
        const ctx = context_();
        const act = cur.activityId ? ctx.activities.filter(function (a) { return a.id === cur.activityId; })[0] : null;
        checkExpenseBudget_(ctx, p, act, cur.amount, cur.id);
      }
      const stamp = now_();
      updateRow_('Expenses', cur, {
        status: next, updatedAt: stamp,
        approvedBy: next === 'pending' ? '' : user.username, approvedAt: next === 'pending' ? '' : stamp
      });
      audit_(user, 'status_' + next, 'Expense', cur.id, cur.description + ' ' + fmtMoney_(cur.amount));
      return ok_({ id: cur.id, status: next }, 'เปลี่ยนสถานะเป็น "' + CONFIG.EXPENSE_STATUS[next] + '" แล้ว');
    });
  });
}

function deleteExpense(token, id) {
  return handle_(function () {
    const user = auth_(token);
    return withLock_(function () {
      const cur = findById_('Expenses', id);
      if (!cur) throw appError_('ไม่พบรายการเบิกจ่าย');
      const p = projectFor_(user, cur.projectId, false);
      if (!canManageProject_(user, p) && !(cur.createdBy === user.username && cur.status === 'pending')) throw appError_('ลบได้เฉพาะรายการของตนเองที่ยังรออนุมัติ');
      if (cur.fileId) removeFileRecord_(cur.fileId);
      deleteWhere_('Expenses', function (e) { return e.id === cur.id; });
      audit_(user, 'delete', 'Expense', cur.id, cur.description + ' ' + fmtMoney_(cur.amount));
      return ok_({ id: cur.id }, 'ลบรายการเบิกจ่ายแล้ว');
    });
  });
}

function expenseView_(e, ctx, actMap, fileMap) {
  const p = ctx.projectMap[e.projectId];
  const a = e.activityId ? actMap[e.activityId] : null;
  const f = e.fileId ? fileMap[e.fileId] : null;
  return {
    id: e.id, projectId: e.projectId, projectName: p ? p.name : '', projectCode: p ? p.code : '',
    activityId: e.activityId, activityName: a ? a.name : '', expenseDate: e.expenseDate, description: e.description,
    payee: e.payee, receiptNo: e.receiptNo, amount: e.amount, note: e.note,
    fileId: e.fileId, fileName: f ? f.name : '', fileUrl: f ? f.url : '',
    status: e.status, statusLabel: CONFIG.EXPENSE_STATUS[e.status] || e.status,
    createdBy: e.createdBy, createdAt: e.createdAt, updatedAt: e.updatedAt, approvedBy: e.approvedBy, approvedAt: e.approvedAt
  };
}

/* ============================================================================
 * Progress CRUD
 * ========================================================================== */
function listProgress(token) {
  return handle_(function () {
    const user = auth_(token);
    const ctx = context_();
    const actMap = indexBy_(ctx.activities, 'id');
    const items = readTable_('Progress').rows.filter(function (r) { const p = ctx.projectMap[r.projectId]; return p && canSeeProject_(user, p); })
      .map(function (r) { return progressView_(r, ctx, actMap); })
      .sort(function (a, b) { return String(b.reportDate + b.createdAt).localeCompare(String(a.reportDate + a.createdAt)); });
    return ok_({ items: items, lookups: lookups_(user, ctx) });
  });
}

function saveProgress(token, data) {
  return handle_(function () {
    const user = auth_(token);
    const d = data || {};
    const input = {
      projectId: req_(str_(d.projectId, 50), 'โครงการ'),
      activityId: str_(d.activityId, 50),
      reportDate: date_(d.reportDate, 'วันที่รายงาน', true),
      percent: percent_(d.percent),
      detail: req_(str_(d.detail, 3000), 'รายละเอียดความก้าวหน้า'),
      problems: str_(d.problems, 2000),
      nextSteps: str_(d.nextSteps, 2000)
    };
    return withLock_(function () {
      const p = projectFor_(user, input.projectId, false);
      if (input.activityId) {
        const act = findById_('Activities', input.activityId);
        if (!act || act.projectId !== p.id) throw appError_('กิจกรรมที่เลือกไม่อยู่ในโครงการนี้');
      }
      let saved;
      let oldProjectId = '';
      if (d.id) {
        const cur = findById_('Progress', d.id);
        if (!cur) throw appError_('ไม่พบรายงานความก้าวหน้า');
        const oldP = projectFor_(user, cur.projectId, false);
        if (!canManageProject_(user, oldP) && cur.createdBy !== user.username) throw appError_('แก้ไขได้เฉพาะรายงานของตนเอง');
        oldProjectId = cur.projectId;
        saved = updateRow_('Progress', cur, Object.assign({}, input, { updatedAt: now_() }));
        audit_(user, 'update', 'Progress', cur.id, p.name + ' ' + input.percent + '%');
      } else {
        saved = Object.assign({ id: newId_('PRG'), createdBy: user.username, createdAt: now_(), updatedAt: now_() }, input);
        insertRows_('Progress', [saved]);
        audit_(user, 'create', 'Progress', saved.id, p.name + ' ' + input.percent + '%');
      }
      recalcProjectProgress_(p.id);
      if (oldProjectId && oldProjectId !== p.id) recalcProjectProgress_(oldProjectId);
      const ctx = context_();
      return ok_(progressView_(saved, ctx, indexBy_(ctx.activities, 'id')), 'บันทึกความก้าวหน้าแล้ว');
    });
  });
}

function deleteProgress(token, id) {
  return handle_(function () {
    const user = auth_(token);
    return withLock_(function () {
      const cur = findById_('Progress', id);
      if (!cur) throw appError_('ไม่พบรายงานความก้าวหน้า');
      const p = projectFor_(user, cur.projectId, false);
      if (!canManageProject_(user, p) && cur.createdBy !== user.username) throw appError_('ลบได้เฉพาะรายงานของตนเอง');
      deleteWhere_('Progress', function (r) { return r.id === cur.id; });
      recalcProjectProgress_(p.id);
      audit_(user, 'delete', 'Progress', cur.id, p.name);
      return ok_({ id: cur.id }, 'ลบรายงานความก้าวหน้าแล้ว');
    });
  });
}

/** ความก้าวหน้าโครงการ = เปอร์เซ็นต์ของรายงานระดับโครงการล่าสุด (ถ้าไม่มี ใช้ค่าเฉลี่ยของรายงานล่าสุดของแต่ละกิจกรรม) */
function recalcProjectProgress_(projectId) {
  const p = findById_('Projects', projectId);
  if (!p) return;
  const rows = readTable_('Progress').rows.filter(function (r) { return r.projectId === projectId; })
    .sort(function (a, b) { return String(b.reportDate + b.createdAt).localeCompare(String(a.reportDate + a.createdAt)); });
  let value = 0;
  const projectLevel = rows.filter(function (r) { return !r.activityId; })[0];
  if (projectLevel) {
    value = projectLevel.percent;
  } else {
    const latestByAct = {};
    rows.forEach(function (r) { if (r.activityId && latestByAct[r.activityId] === undefined) latestByAct[r.activityId] = r.percent; });
    const vals = Object.keys(latestByAct).map(function (k) { return latestByAct[k]; });
    value = vals.length ? round2_(vals.reduce(function (t, v) { return t + v; }, 0) / vals.length) : 0;
  }
  if (p.progress !== value) updateRow_('Projects', p, { progress: value });
}

function progressView_(r, ctx, actMap) {
  const p = ctx.projectMap[r.projectId];
  const a = r.activityId ? actMap[r.activityId] : null;
  return {
    id: r.id, projectId: r.projectId, projectName: p ? p.name : '', activityId: r.activityId, activityName: a ? a.name : '',
    reportDate: r.reportDate, percent: r.percent, detail: r.detail, problems: r.problems, nextSteps: r.nextSteps,
    createdBy: r.createdBy, createdAt: r.createdAt, updatedAt: r.updatedAt
  };
}

/* ============================================================================
 * Report CRUD
 * ========================================================================== */
function listReports(token) {
  return handle_(function () {
    const user = auth_(token);
    const ctx = context_();
    const items = readTable_('Reports').rows.filter(function (r) { return canSeeReport_(user, r, ctx); })
      .map(function (r) { return reportView_(r, ctx); })
      .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    return ok_({ items: items, lookups: lookups_(user, ctx) });
  });
}

function canSeeReport_(user, r, ctx) {
  if (user.role === 'admin') return true;
  if (r.projectId) { const p = ctx.projectMap[r.projectId]; return !!p && canSeeProject_(user, p); }
  return r.departmentId === user.departmentId;
}

function saveReport(token, data) {
  return handle_(function () {
    const user = auth_(token);
    requireRole_(user, ['admin', 'manager']);
    const d = data || {};
    const input = {
      title: req_(str_(d.title, 200), 'ชื่อรายงาน'),
      reportType: oneOf_(d.reportType, CONFIG.REPORT_TYPES, 'ประเภทรายงาน'),
      projectId: str_(d.projectId, 50),
      departmentId: str_(d.departmentId, 50),
      startDate: date_(d.startDate, 'วันที่เริ่ม', false),
      endDate: date_(d.endDate, 'วันที่สิ้นสุด', false),
      note: str_(d.note, 2000)
    };
    if (input.startDate && input.endDate) dateOrder_(input.startDate, input.endDate);
    if (input.reportType === 'project' && !input.projectId) throw appError_('รายงานสรุปโครงการต้องเลือกโครงการ');
    if (input.reportType !== 'project') input.projectId = '';
    if (user.role !== 'admin') input.departmentId = user.departmentId;
    return withLock_(function () {
      if (input.projectId) projectFor_(user, input.projectId, false);
      if (input.departmentId && !findById_('Departments', input.departmentId)) throw appError_('ไม่พบหน่วยงานที่เลือก');
      let saved;
      if (d.id) {
        const cur = findById_('Reports', d.id);
        if (!cur || !canSeeReport_(user, cur, context_())) throw appError_('ไม่พบรายงาน');
        saved = updateRow_('Reports', cur, Object.assign({}, input, { updatedAt: now_() }));
        audit_(user, 'update', 'Report', cur.id, input.title);
      } else {
        saved = Object.assign({ id: newId_('RPT'), fileId: '', fileUrl: '', generatedAt: '', createdBy: user.username, createdAt: now_(), updatedAt: now_() }, input);
        insertRows_('Reports', [saved]);
        audit_(user, 'create', 'Report', saved.id, input.title);
      }
      return ok_(reportView_(saved, context_()), 'บันทึกรายงานแล้ว');
    });
  });
}

function deleteReport(token, id) {
  return handle_(function () {
    const user = auth_(token);
    requireRole_(user, ['admin', 'manager']);
    return withLock_(function () {
      const cur = findById_('Reports', id);
      if (!cur || !canSeeReport_(user, cur, context_())) throw appError_('ไม่พบรายงาน');
      if (cur.fileId) trashDriveFile_(cur.fileId);
      deleteWhere_('Reports', function (r) { return r.id === cur.id; });
      audit_(user, 'delete', 'Report', cur.id, cur.title);
      return ok_({ id: cur.id }, 'ลบรายงานแล้ว');
    });
  });
}

function getReportData(token, id) {
  return handle_(function () {
    const user = auth_(token);
    const r = findById_('Reports', id);
    const ctx = context_();
    if (!r || !canSeeReport_(user, r, ctx)) throw appError_('ไม่พบรายงาน');
    return ok_(buildReport_(user, r, ctx));
  });
}

function generateReportFile(token, id) {
  return handle_(function () {
    const user = auth_(token);
    requireRole_(user, ['admin', 'manager']);
    return withLock_(function () {
      const r = findById_('Reports', id);
      const ctx = context_();
      if (!r || !canSeeReport_(user, r, ctx)) throw appError_('ไม่พบรายงาน');
      const rep = buildReport_(user, r, ctx);
      const book = SpreadsheetApp.create(rep.title + ' (' + today_() + ')');
      const sh = book.getSheets()[0];
      sh.setName('รายงาน');
      const out = [];
      const boldRows = [];
      out.push([rep.title]);
      boldRows.push(out.length);
      out.push([rep.subtitle]);
      out.push(['']);
      rep.summary.forEach(function (s) { out.push([s.label, s.value]); });
      rep.sections.forEach(function (sec) {
        out.push(['']);
        out.push([sec.title]);
        boldRows.push(out.length);
        out.push(sec.columns.map(function (c) { return c.label; }));
        boldRows.push(out.length);
        sec.rows.forEach(function (row) { out.push(sec.columns.map(function (c) { return row[c.key] === undefined ? '' : row[c.key]; })); });
        if (sec.totals) out.push(sec.columns.map(function (c) { return sec.totals[c.key] === undefined ? '' : sec.totals[c.key]; }));
      });
      const width = out.reduce(function (m, row) { return Math.max(m, row.length); }, 1);
      const grid = out.map(function (row) { const copy = row.slice(); while (copy.length < width) copy.push(''); return copy; });
      sh.getRange(1, 1, grid.length, width).setValues(grid);
      boldRows.forEach(function (n) { sh.getRange(n, 1, 1, width).setFontWeight('bold'); });
      sh.getRange(1, 1).setFontSize(14);
      sh.autoResizeColumns(1, width);
      SpreadsheetApp.flush();
      const file = DriveApp.getFileById(book.getId());
      file.moveTo(subFolder_('reports'));
      applySharing_(file);
      if (r.fileId) trashDriveFile_(r.fileId);
      const stamp = now_();
      updateRow_('Reports', r, { fileId: file.getId(), fileUrl: file.getUrl(), generatedAt: stamp, updatedAt: stamp });
      audit_(user, 'generate', 'Report', r.id, rep.title);
      return ok_({ id: r.id, fileUrl: file.getUrl(), generatedAt: stamp }, 'สร้างไฟล์รายงานใน Google Drive แล้ว');
    });
  });
}

function reportView_(r, ctx) {
  const p = r.projectId ? ctx.projectMap[r.projectId] : null;
  const dp = r.departmentId ? ctx.deptMap[r.departmentId] : null;
  return {
    id: r.id, title: r.title, reportType: r.reportType, reportTypeLabel: CONFIG.REPORT_TYPES[r.reportType] || r.reportType,
    projectId: r.projectId, projectName: p ? p.name : '', departmentId: r.departmentId, departmentName: dp ? dp.name : '',
    startDate: r.startDate, endDate: r.endDate, note: r.note, fileId: r.fileId, fileUrl: r.fileUrl, generatedAt: r.generatedAt,
    createdBy: r.createdBy, createdAt: r.createdAt, updatedAt: r.updatedAt
  };
}

function inRange_(date, start, end) {
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

function buildReport_(user, r, ctx) {
  const currency = publicSettings_().currency;
  const scopeProjects = ctx.projects.filter(function (p) {
    if (!canSeeProject_(user, p)) return false;
    if (r.reportType === 'project') return p.id === r.projectId;
    if (r.departmentId && p.departmentId !== r.departmentId) return false;
    return true;
  });
  const ids = {};
  scopeProjects.forEach(function (p) { ids[p.id] = true; });
  const period = (r.startDate || r.endDate) ? ('ช่วงวันที่ ' + (r.startDate || 'เริ่มต้น') + ' ถึง ' + (r.endDate || 'ปัจจุบัน')) : 'ทุกช่วงเวลา';
  const dept = r.departmentId ? ctx.deptMap[r.departmentId] : null;
  const subtitle = [CONFIG.REPORT_TYPES[r.reportType], dept ? 'หน่วยงาน ' + dept.name : 'ทุกหน่วยงานที่เข้าถึงได้', period, 'ออกรายงาน ' + now_()].join(' | ');
  const actMap = indexBy_(ctx.activities, 'id');
  const exps = ctx.expenses.filter(function (e) { return ids[e.projectId] && inRange_(e.expenseDate, r.startDate, r.endDate); });
  const sections = [];
  let summary = [];

  if (r.reportType === 'project') {
    const p = scopeProjects[0];
    if (!p) throw appError_('ไม่พบโครงการของรายงานนี้');
    const v = projectView_(p, ctx);
    summary = [
      { label: 'โครงการ', value: (v.code ? v.code + ' ' : '') + v.name },
      { label: 'หน่วยงาน', value: v.departmentName },
      { label: 'ผู้รับผิดชอบ', value: v.ownerName },
      { label: 'ระยะเวลา', value: v.startDate + ' ถึง ' + v.endDate },
      { label: 'สถานะ', value: v.statusLabel },
      { label: 'ความก้าวหน้า (%)', value: v.progress },
      { label: 'งบประมาณ (' + currency + ')', value: v.budget },
      { label: 'เบิกจ่ายอนุมัติแล้ว (' + currency + ')', value: v.spent },
      { label: 'รออนุมัติ (' + currency + ')', value: v.pending },
      { label: 'คงเหลือ (' + currency + ')', value: v.remaining }
    ];
    const acts = ctx.activities.filter(function (a) { return a.projectId === p.id; }).map(function (a) { return activityView_(a, ctx); });
    sections.push({
      title: 'กิจกรรม',
      columns: [{ key: 'name', label: 'กิจกรรม' }, { key: 'responsible', label: 'ผู้รับผิดชอบ' }, { key: 'period', label: 'ระยะเวลา' }, { key: 'statusLabel', label: 'สถานะ' }, { key: 'budget', label: 'งบประมาณ', type: 'money' }, { key: 'committed', label: 'เบิกจ่าย', type: 'money' }, { key: 'remaining', label: 'คงเหลือ', type: 'money' }],
      rows: acts.map(function (a) { return { name: a.name, responsible: a.responsible, period: a.startDate + ' ถึง ' + a.endDate, statusLabel: a.statusLabel, budget: a.budget, committed: a.committed, remaining: a.remaining }; }),
      totals: { name: 'รวม', budget: round2_(sumBy_(acts, 'budget')), committed: round2_(sumBy_(acts, 'committed')), remaining: round2_(sumBy_(acts, 'remaining')) }
    });
    const projectExpenses = exps.slice().sort(function (a, b) { return String(a.expenseDate).localeCompare(String(b.expenseDate)); }).map(function (e) {
      const a = actMap[e.activityId];
      return { expenseDate: e.expenseDate, activity: a ? a.name : '', description: e.description, payee: e.payee, receiptNo: e.receiptNo, statusLabel: CONFIG.EXPENSE_STATUS[e.status] || e.status, amount: e.amount };
    });
    sections.push({
      title: 'รายการเบิกจ่าย',
      columns: [{ key: 'expenseDate', label: 'วันที่' }, { key: 'activity', label: 'กิจกรรม' }, { key: 'description', label: 'รายการ' }, { key: 'payee', label: 'ผู้รับเงิน' }, { key: 'receiptNo', label: 'เลขที่เอกสาร' }, { key: 'statusLabel', label: 'สถานะ' }, { key: 'amount', label: 'จำนวนเงิน', type: 'money' }],
      rows: projectExpenses,
      totals: { expenseDate: 'รวม', amount: round2_(sumBy_(projectExpenses, 'amount')) }
    });
    const progress = readTable_('Progress').rows.filter(function (x) { return x.projectId === p.id && inRange_(x.reportDate, r.startDate, r.endDate); })
      .sort(function (a, b) { return String(a.reportDate).localeCompare(String(b.reportDate)); });
    sections.push({
      title: 'ความก้าวหน้า',
      columns: [{ key: 'reportDate', label: 'วันที่' }, { key: 'activity', label: 'กิจกรรม' }, { key: 'percent', label: 'ร้อยละ', type: 'number' }, { key: 'detail', label: 'รายละเอียด' }, { key: 'problems', label: 'ปัญหา/อุปสรรค' }],
      rows: progress.map(function (x) { const a = actMap[x.activityId]; return { reportDate: x.reportDate, activity: a ? a.name : 'ภาพรวมโครงการ', percent: x.percent, detail: x.detail, problems: x.problems }; })
    });
  } else if (r.reportType === 'budget') {
    const views = scopeProjects.map(function (p) { return projectView_(p, ctx); });
    sections.push({
      title: 'สรุปงบประมาณรายโครงการ',
      columns: [{ key: 'code', label: 'รหัส' }, { key: 'name', label: 'โครงการ' }, { key: 'departmentName', label: 'หน่วยงาน' }, { key: 'statusLabel', label: 'สถานะ' }, { key: 'budget', label: 'งบประมาณ', type: 'money' }, { key: 'activityBudget', label: 'จัดสรรกิจกรรม', type: 'money' }, { key: 'spent', label: 'อนุมัติแล้ว', type: 'money' }, { key: 'pending', label: 'รออนุมัติ', type: 'money' }, { key: 'remaining', label: 'คงเหลือ', type: 'money' }, { key: 'progress', label: 'ก้าวหน้า (%)', type: 'number' }],
      rows: views,
      totals: { name: 'รวม', budget: round2_(sumBy_(views, 'budget')), activityBudget: round2_(sumBy_(views, 'activityBudget')), spent: round2_(sumBy_(views, 'spent')), pending: round2_(sumBy_(views, 'pending')), remaining: round2_(sumBy_(views, 'remaining')) }
    });
    const totalBudget = sumBy_(views, 'budget');
    const totalCommitted = sumBy_(views, 'committed');
    summary = [
      { label: 'จำนวนโครงการ', value: views.length },
      { label: 'งบประมาณรวม (' + currency + ')', value: round2_(totalBudget) },
      { label: 'เบิกจ่ายรวม (' + currency + ')', value: round2_(totalCommitted) },
      { label: 'คงเหลือรวม (' + currency + ')', value: round2_(totalBudget - totalCommitted) },
      { label: 'ใช้งบไปแล้ว (%)', value: totalBudget > 0 ? round2_(totalCommitted / totalBudget * 100) : 0 }
    ];
  } else {
    const rows = exps.slice().sort(function (a, b) { return String(a.expenseDate).localeCompare(String(b.expenseDate)); }).map(function (e) {
      const p = ctx.projectMap[e.projectId];
      const a = actMap[e.activityId];
      return { expenseDate: e.expenseDate, project: p ? p.name : '', activity: a ? a.name : '', description: e.description, payee: e.payee, receiptNo: e.receiptNo, statusLabel: CONFIG.EXPENSE_STATUS[e.status] || e.status, amount: e.amount };
    });
    sections.push({
      title: 'รายการเบิกจ่าย',
      columns: [{ key: 'expenseDate', label: 'วันที่' }, { key: 'project', label: 'โครงการ' }, { key: 'activity', label: 'กิจกรรม' }, { key: 'description', label: 'รายการ' }, { key: 'payee', label: 'ผู้รับเงิน' }, { key: 'receiptNo', label: 'เลขที่เอกสาร' }, { key: 'statusLabel', label: 'สถานะ' }, { key: 'amount', label: 'จำนวนเงิน', type: 'money' }],
      rows: rows,
      totals: { expenseDate: 'รวม', amount: round2_(sumBy_(rows, 'amount')) }
    });
    const byStatus = {};
    exps.forEach(function (e) { byStatus[e.status] = (byStatus[e.status] || 0) + e.amount; });
    summary = [{ label: 'จำนวนรายการ', value: exps.length }].concat(Object.keys(CONFIG.EXPENSE_STATUS).map(function (k) {
      return { label: CONFIG.EXPENSE_STATUS[k] + ' (' + currency + ')', value: round2_(byStatus[k] || 0) };
    }));
  }
  if (r.note) summary.push({ label: 'หมายเหตุ', value: r.note });
  return { id: r.id, title: r.title, subtitle: subtitle, summary: summary, sections: sections, fileUrl: r.fileUrl, generatedAt: r.generatedAt };
}

/* ============================================================================
 * File Management
 * ========================================================================== */
function listFiles(token) {
  return handle_(function () {
    const user = auth_(token);
    const ctx = context_();
    const items = readTable_('Files').rows.filter(function (f) { return canSeeFile_(user, f, ctx); })
      .map(function (f) { return fileView_(f, ctx); })
      .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    return ok_({ items: items, lookups: lookups_(user, ctx) });
  });
}

function canSeeFile_(user, f, ctx) {
  if (!f.projectId) return true;
  const p = ctx.projectMap[f.projectId];
  return !!p && canSeeProject_(user, p);
}

function uploadFile(token, data) {
  return handle_(function () {
    const user = auth_(token);
    const d = data || {};
    const upload = validateUpload_(d.file);
    const projectId = str_(d.projectId, 50);
    const description = str_(d.description, 500);
    return withLock_(function () {
      let p = null;
      if (projectId) p = projectFor_(user, projectId, false);
      else requireRole_(user, ['admin', 'manager']);
      const rec = storeFile_(user, upload, p, 'general', '', description);
      return ok_(fileView_(rec, context_()), 'อัปโหลดไฟล์แล้ว');
    });
  });
}

function deleteFile(token, id) {
  return handle_(function () {
    const user = auth_(token);
    return withLock_(function () {
      const f = findById_('Files', id);
      const ctx = context_();
      if (!f || !canSeeFile_(user, f, ctx)) throw appError_('ไม่พบไฟล์');
      const p = f.projectId ? ctx.projectMap[f.projectId] : null;
      const allowed = user.role === 'admin' || f.uploadedBy === user.username || (p ? canManageProject_(user, p) : false);
      if (!allowed) throw appError_('คุณไม่มีสิทธิ์ลบไฟล์นี้');
      removeFileRecord_(f.id);
      audit_(user, 'delete', 'File', f.id, f.name);
      return ok_({ id: f.id }, 'ลบไฟล์แล้ว');
    });
  });
}

function downloadFile(token, id) {
  return handle_(function () {
    const user = auth_(token);
    const f = findById_('Files', id);
    if (!f || !canSeeFile_(user, f, context_())) throw appError_('ไม่พบไฟล์');
    let blob;
    try { blob = DriveApp.getFileById(f.driveId).getBlob(); } catch (err) { throw appError_('ไม่พบไฟล์ใน Google Drive (อาจถูกลบไปแล้ว)'); }
    const bytes = blob.getBytes();
    if (bytes.length > maxUploadBytes_()) throw appError_('ไฟล์มีขนาดใหญ่เกินกว่าจะดาวน์โหลดผ่านระบบ กรุณาเปิดจาก Google Drive');
    audit_(user, 'download', 'File', f.id, f.name);
    return ok_({ name: f.name, mimeType: f.mimeType || blob.getContentType(), data: Utilities.base64Encode(bytes) });
  });
}

function validateUpload_(file) {
  if (!file || !file.data || !file.name) throw appError_('กรุณาเลือกไฟล์');
  const name = String(file.name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 180);
  const mimeType = String(file.mimeType || 'application/octet-stream').slice(0, 120);
  const b64 = String(file.data);
  if (!/^[A-Za-z0-9+/=]+$/.test(b64)) throw appError_('ข้อมูลไฟล์ไม่ถูกต้อง');
  const size = Math.floor(b64.length * 3 / 4);
  if (size <= 0) throw appError_('ไฟล์ว่างเปล่า');
  if (size > maxUploadBytes_()) throw appError_('ไฟล์มีขนาดเกิน ' + publicSettings_().maxUploadMB + ' MB');
  return { name: name, mimeType: mimeType, data: b64 };
}

function storeFile_(user, upload, project, refType, refId, description) {
  const folder = project ? projectFolder_(project) : subFolder_('general');
  const blob = Utilities.newBlob(Utilities.base64Decode(upload.data), upload.mimeType, upload.name);
  const file = folder.createFile(blob);
  applySharing_(file);
  const rec = {
    id: newId_('FIL'), name: upload.name, mimeType: upload.mimeType, size: blob.getBytes().length, driveId: file.getId(), url: file.getUrl(),
    refType: refType, refId: refId, projectId: project ? project.id : '', description: description, uploadedBy: user.username, createdAt: now_()
  };
  insertRows_('Files', [rec]);
  audit_(user, 'upload', 'File', rec.id, rec.name);
  return rec;
}

function removeFileRecord_(fileId) {
  const removed = deleteWhere_('Files', function (f) { return f.id === fileId; });
  removed.forEach(function (f) {
    trashDriveFile_(f.driveId);
    if (f.refType === 'expense' && f.refId) {
      const e = findById_('Expenses', f.refId);
      if (e && e.fileId === f.id) updateRow_('Expenses', e, { fileId: '' });
    }
  });
}

function fileView_(f, ctx) {
  const p = f.projectId ? ctx.projectMap[f.projectId] : null;
  return {
    id: f.id, name: f.name, mimeType: f.mimeType, size: f.size, url: f.url, refType: f.refType, refId: f.refId,
    projectId: f.projectId, projectName: p ? p.name : '', description: f.description, uploadedBy: f.uploadedBy, createdAt: f.createdAt
  };
}

function maxUploadBytes_() {
  const mb = Number(publicSettings_().maxUploadMB) || 10;
  return Math.min(Math.max(mb, 1), 40) * 1024 * 1024;
}

function rootFolder_() {
  try { return DriveApp.getFolderById(CONFIG.FOLDER_ID); } catch (err) { throw appError_('ไม่สามารถเข้าถึงโฟลเดอร์หลักของระบบใน Google Drive ได้'); }
}

function subFolder_(key) {
  const settingKey = 'sys:folder:' + key;
  const map = settingsMap_();
  if (map[settingKey]) {
    try {
      const f = DriveApp.getFolderById(map[settingKey]);
      if (!f.isTrashed()) return f;
    } catch (err) { /* โฟลเดอร์ถูกลบ สร้างใหม่ด้านล่าง */ }
  }
  const root = rootFolder_();
  const it = root.getFoldersByName(CONFIG.FOLDERS[key]);
  const folder = it.hasNext() ? it.next() : root.createFolder(CONFIG.FOLDERS[key]);
  setSettingValues_([[settingKey, folder.getId()]]);
  return folder;
}

function projectFolder_(project) {
  if (project.folderId) {
    try {
      const f = DriveApp.getFolderById(project.folderId);
      if (!f.isTrashed()) return f;
    } catch (err) { /* สร้างใหม่ */ }
  }
  const name = ((project.code ? project.code + ' ' : '') + project.name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 150);
  const folder = subFolder_('projects').createFolder(name);
  const cur = findById_('Projects', project.id);
  if (cur) updateRow_('Projects', cur, { folderId: folder.getId() });
  return folder;
}

function applySharing_(file) {
  const mode = publicSettings_().fileSharing;
  try {
    if (mode === 'domain') file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
    else if (mode === 'anyone') file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    console.warn('ตั้งค่าการแชร์ไฟล์ไม่สำเร็จ: ' + err);
  }
}

function trashDriveFile_(driveId) {
  if (!driveId) return;
  try { DriveApp.getFileById(driveId).setTrashed(true); } catch (err) { console.warn('ลบไฟล์ใน Drive ไม่สำเร็จ: ' + driveId); }
}

function trashDriveFolder_(folderId) {
  if (!folderId) return;
  try { DriveApp.getFolderById(folderId).setTrashed(true); } catch (err) { console.warn('ลบโฟลเดอร์ใน Drive ไม่สำเร็จ: ' + folderId); }
}

/* ============================================================================
 * Dashboard
 * ========================================================================== */
function getDashboard(token) {
  return handle_(function () {
    const user = auth_(token);
    return ok_(dashboard_(user, context_()));
  });
}

function dashboard_(user, ctx) {
  const today = today_();
  const in30 = Utilities.formatDate(new Date(Date.now() + 30 * 86400000), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  const projects = ctx.projects.filter(function (p) { return canSeeProject_(user, p); }).map(function (p) { return projectView_(p, ctx); });
  const ids = {};
  projects.forEach(function (p) { ids[p.id] = true; });
  const expenses = ctx.expenses.filter(function (e) { return ids[e.projectId]; });
  const totals = {
    projects: projects.length,
    activeProjects: projects.filter(function (p) { return p.status === 'active'; }).length,
    activities: ctx.activities.filter(function (a) { return ids[a.projectId]; }).length,
    budget: round2_(sumBy_(projects, 'budget')),
    spent: round2_(sumBy_(projects, 'spent')),
    pending: round2_(sumBy_(projects, 'pending')),
    committed: round2_(sumBy_(projects, 'committed')),
    remaining: round2_(sumBy_(projects, 'remaining')),
    pendingCount: expenses.filter(function (e) { return e.status === 'pending'; }).length,
    avgProgress: projects.length ? round2_(sumBy_(projects, 'progress') / projects.length) : 0
  };
  totals.usedPct = totals.budget > 0 ? round2_(totals.committed / totals.budget * 100) : 0;
  const byStatus = Object.keys(CONFIG.PROJECT_STATUS).map(function (k) {
    return { key: k, label: CONFIG.PROJECT_STATUS[k], count: projects.filter(function (p) { return p.status === k; }).length };
  });
  const deptAgg = {};
  projects.forEach(function (p) {
    const key = p.departmentId || '-';
    if (!deptAgg[key]) deptAgg[key] = { name: p.departmentName || 'ไม่ระบุหน่วยงาน', budget: 0, committed: 0, count: 0 };
    deptAgg[key].budget += p.budget;
    deptAgg[key].committed += p.committed;
    deptAgg[key].count += 1;
  });
  const byDepartment = Object.keys(deptAgg).map(function (k) {
    const d = deptAgg[k];
    return { name: d.name, count: d.count, budget: round2_(d.budget), committed: round2_(d.committed), usedPct: d.budget > 0 ? round2_(d.committed / d.budget * 100) : 0 };
  }).sort(function (a, b) { return b.budget - a.budget; });
  const open = function (p) { return p.status !== 'completed' && p.status !== 'cancelled'; };
  const upcoming = projects.filter(function (p) { return open(p) && p.endDate >= today && p.endDate <= in30; })
    .sort(function (a, b) { return a.endDate.localeCompare(b.endDate); }).slice(0, 8);
  const overdue = projects.filter(function (p) { return open(p) && p.endDate && p.endDate < today; })
    .sort(function (a, b) { return a.endDate.localeCompare(b.endDate); }).slice(0, 8);
  const actMap = indexBy_(ctx.activities, 'id');
  const fileMap = indexBy_(readTable_('Files').rows, 'id');
  const recentExpenses = expenses.slice().sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }).slice(0, 8)
    .map(function (e) { return expenseView_(e, ctx, actMap, fileMap); });
  const recentProgress = readTable_('Progress').rows.filter(function (r) { return ids[r.projectId]; })
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }).slice(0, 6)
    .map(function (r) { return progressView_(r, ctx, actMap); });
  const topProjects = projects.slice().sort(function (a, b) { return b.usedPct - a.usedPct; }).slice(0, 6);
  return { totals: totals, byStatus: byStatus, byDepartment: byDepartment, upcoming: upcoming, overdue: overdue, recentExpenses: recentExpenses, recentProgress: recentProgress, topProjects: topProjects, generatedAt: now_() };
}

/* ============================================================================
 * Settings
 * ========================================================================== */
function getSettings(token) {
  return handle_(function () {
    auth_(token);
    return ok_({ settings: publicSettings_(), dailyBackupActive: dailyBackupTrigger_() !== null });
  });
}

function saveSettings(token, data) {
  return handle_(function () {
    const user = auth_(token);
    requireRole_(user, ['admin']);
    const d = data || {};
    const maxMb = Number(d.maxUploadMB);
    if (!isFinite(maxMb) || maxMb < 1 || maxMb > 40) throw appError_('ขนาดไฟล์สูงสุดต้องอยู่ระหว่าง 1–40 MB');
    const retention = Number(d.backupRetention);
    if (!isFinite(retention) || retention < 1 || retention > 365 || Math.floor(retention) !== retention) throw appError_('จำนวนไฟล์สำรองที่เก็บต้องเป็นจำนวนเต็ม 1–365');
    const values = [
      ['orgName', str_(d.orgName, 200)],
      ['fiscalYear', str_(d.fiscalYear, 10)],
      ['currency', req_(str_(d.currency, 20), 'หน่วยเงิน')],
      ['maxUploadMB', String(maxMb)],
      ['fileSharing', oneOf_(d.fileSharing, CONFIG.FILE_SHARING, 'การแชร์ไฟล์')],
      ['backupRetention', String(retention)]
    ];
    return withLock_(function () {
      setSettingValues_(values);
      audit_(user, 'update', 'Settings', '', values.map(function (v) { return v[0] + '=' + v[1]; }).join(', '));
      return ok_({ settings: publicSettings_() }, 'บันทึกการตั้งค่าแล้ว');
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
  const t = readTable_('Settings');
  const rows = t.rows.map(function (r) { return Object.assign({}, r); });
  const stamp = now_();
  pairs.forEach(function (pair) {
    const existing = rows.filter(function (r) { return r.key === pair[0]; })[0];
    if (existing) { existing.value = pair[1]; existing.updatedAt = stamp; }
    else rows.push({ key: pair[0], value: pair[1], updatedAt: stamp });
  });
  rewriteTable_('Settings', rows);
}

/* ============================================================================
 * Backup
 * ========================================================================== */
function listBackups(token) {
  return handle_(function () {
    const user = auth_(token);
    requireRole_(user, ['admin']);
    return ok_({ items: backupFiles_(), dailyBackupActive: dailyBackupTrigger_() !== null, lastBackupAt: PropertiesService.getScriptProperties().getProperty('lastBackupAt') || '' });
  });
}

function createBackup(token) {
  return handle_(function () {
    const user = auth_(token);
    requireRole_(user, ['admin']);
    const item = withLock_(function () { return runBackup_('manual'); });
    audit_(user, 'backup', 'Backup', item.id, item.name);
    return ok_(item, 'สำรองข้อมูลแล้ว');
  });
}

function deleteBackup(token, fileId) {
  return handle_(function () {
    const user = auth_(token);
    requireRole_(user, ['admin']);
    const item = backupFiles_().filter(function (b) { return b.id === fileId; })[0];
    if (!item) throw appError_('ไม่พบไฟล์สำรองข้อมูล');
    trashDriveFile_(item.id);
    audit_(user, 'delete', 'Backup', item.id, item.name);
    return ok_({ id: item.id }, 'ลบไฟล์สำรองข้อมูลแล้ว');
  });
}

function setDailyBackup(token, enabled) {
  return handle_(function () {
    const user = auth_(token);
    requireRole_(user, ['admin']);
    const existing = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'dailyBackupJob'; });
    existing.forEach(function (t) { ScriptApp.deleteTrigger(t); });
    if (enabled) ScriptApp.newTrigger('dailyBackupJob').timeBased().everyDays(1).atHour(2).inTimezone(CONFIG.TIMEZONE).create();
    withLock_(function () { setSettingValues_([['dailyBackup', enabled ? 'on' : 'off']]); });
    audit_(user, 'update', 'Backup', '', enabled ? 'เปิดสำรองข้อมูลอัตโนมัติทุกวัน 02:00' : 'ปิดสำรองข้อมูลอัตโนมัติ');
    return ok_({ dailyBackupActive: !!enabled }, enabled ? 'เปิดสำรองข้อมูลอัตโนมัติทุกวันเวลา 02:00 แล้ว' : 'ปิดสำรองข้อมูลอัตโนมัติแล้ว');
  });
}

/** เรียกโดย Time-driven Trigger เท่านั้น — ป้องกันการสั่งซ้ำถี่เกินไปด้วยเวลาสำรองล่าสุด */
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
  const folder = subFolder_('backups');
  const it = folder.getFiles();
  const items = [];
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed()) continue;
    items.push({ id: f.getId(), name: f.getName(), url: f.getUrl(), size: f.getSize(), createdAt: Utilities.formatDate(f.getDateCreated(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss') });
  }
  return items.sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
}

function dailyBackupTrigger_() {
  const t = ScriptApp.getProjectTriggers().filter(function (x) { return x.getHandlerFunction() === 'dailyBackupJob'; })[0];
  return t || null;
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
    const user = auth_(token);
    requireRole_(user, ['admin']);
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
  if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) throw appError_('ระบบกำลังบันทึกข้อมูลของผู้ใช้อื่น กรุณาลองใหม่อีกครั้ง');
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
    try { SS_CACHE_ = SpreadsheetApp.openById(CONFIG.SHEET_ID); } catch (err) { throw appError_('ไม่สามารถเปิดฐานข้อมูล Google Sheets ได้ กรุณาติดต่อผู้ดูแลระบบ'); }
  }
  return SS_CACHE_;
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) {
    CacheService.getScriptCache().remove('setup:ok');
    throw appError_('ไม่พบชีต "' + name + '" กรุณาเข้าสู่ระบบใหม่เพื่อให้ระบบสร้างชีตอัตโนมัติ');
  }
  return sh;
}

function normalizeCell_(header, v) {
  if (CONFIG.NUMERIC_FIELDS.indexOf(header) >= 0) {
    const n = Number(v);
    return isFinite(n) ? n : 0;
  }
  if (v instanceof Date) {
    return Utilities.formatDate(v, CONFIG.TIMEZONE, /Date$/.test(header) ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss');
  }
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
  if (needed > 0) sh.insertRowsAfter(sh.getMaxRows(), needed + 100);
  sh.getRange(start, 1, objs.length, width).setValues(objs.map(function (o) { return toRow_(name, o); }));
  invalidate_(name);
}

function updateRow_(name, rowObj, patch) {
  const merged = Object.assign({}, rowObj, patch);
  sheet_(name).getRange(rowObj._row, 1, 1, CONFIG.SHEETS[name].length).setValues([toRow_(name, merged)]);
  invalidate_(name);
  return merged;
}

/** เขียนทั้งตารางใหม่ในครั้งเดียว (ใช้สำหรับลบหลายแถว/แก้หลายแถว) */
function rewriteTable_(name, rows) {
  const sh = sheet_(name);
  const width = CONFIG.SHEETS[name].length;
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, width).clearContent();
  if (rows.length) {
    const needed = rows.length + 1 - sh.getMaxRows();
    if (needed > 0) sh.insertRowsAfter(sh.getMaxRows(), needed + 100);
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

function emptyStat_() {
  return { activityBudget: 0, spent: 0, pending: 0, committed: 0, activityCount: 0, expenseCount: 0 };
}

/** อ่านตารางหลักครั้งเดียวแล้วคำนวณยอดงบทั้งหมดในหน่วยความจำ */
function context_() {
  const projects = readTable_('Projects').rows;
  const activities = readTable_('Activities').rows;
  const expenses = readTable_('Expenses').rows;
  const departments = readTable_('Departments').rows;
  const pStat = {};
  const aStat = {};
  projects.forEach(function (p) { pStat[p.id] = emptyStat_(); });
  activities.forEach(function (a) {
    aStat[a.id] = emptyStat_();
    if (pStat[a.projectId]) { pStat[a.projectId].activityBudget += a.budget; pStat[a.projectId].activityCount += 1; }
  });
  expenses.forEach(function (e) {
    const ps = pStat[e.projectId];
    const as = e.activityId ? aStat[e.activityId] : null;
    [ps, as].forEach(function (s) {
      if (!s) return;
      s.expenseCount += 1;
      if (e.status === 'rejected') return;
      s.committed += e.amount;
      if (e.status === 'approved') s.spent += e.amount;
      else s.pending += e.amount;
    });
  });
  return {
    projects: projects, activities: activities, expenses: expenses, departments: departments,
    projectMap: indexBy_(projects, 'id'), deptMap: indexBy_(departments, 'id'), pStat: pStat, aStat: aStat
  };
}

function lookups_(user, ctx) {
  const projects = ctx.projects.filter(function (p) { return canSeeProject_(user, p); });
  const ids = {};
  const list = projects.map(function (p) {
    ids[p.id] = true;
    const st = ctx.pStat[p.id] || emptyStat_();
    return {
      id: p.id, code: p.code, name: p.name, departmentId: p.departmentId, status: p.status, budget: p.budget,
      activityBudget: round2_(st.activityBudget), committed: round2_(st.committed), remaining: round2_(p.budget - st.committed),
      startDate: p.startDate, endDate: p.endDate, canManage: canManageProject_(user, p)
    };
  }).sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); });
  const acts = ctx.activities.filter(function (a) { return ids[a.projectId]; }).map(function (a) {
    const st = ctx.aStat[a.id] || emptyStat_();
    return { id: a.id, projectId: a.projectId, name: a.name, budget: a.budget, committed: round2_(st.committed), remaining: round2_(a.budget - st.committed) };
  }).sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); });
  return { projects: list, activities: acts };
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

function today_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function str_(v, max) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max || 500);
}

function req_(v, label) {
  if (v === undefined || v === null || String(v).trim() === '') throw appError_('กรุณากรอก ' + label);
  return v;
}

function money_(v, label, mustBePositive) {
  if (v === undefined || v === null || String(v).trim() === '') throw appError_('กรุณากรอก ' + label);
  const s = String(v).replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw appError_(label + ' ต้องเป็นตัวเลข');
  const n = Number(s);
  if (!isFinite(n)) throw appError_(label + ' ต้องเป็นตัวเลข');
  if (n < 0) throw appError_(label + ' ต้องไม่ติดลบ');
  if (mustBePositive && n <= 0) throw appError_(label + ' ต้องมากกว่า 0');
  if (n > 999999999999) throw appError_(label + ' มีค่ามากเกินไป');
  return round2_(n);
}

function percent_(v) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (s === '') throw appError_('กรุณากรอก ร้อยละความก้าวหน้า');
  if (!/^\d+(\.\d+)?$/.test(s)) throw appError_('ร้อยละความก้าวหน้าต้องเป็นตัวเลข');
  const n = Number(s);
  if (n < 0 || n > 100) throw appError_('ร้อยละความก้าวหน้าต้องอยู่ระหว่าง 0–100');
  return round2_(n);
}

function date_(v, label, required) {
  const s = str_(v, 10);
  if (!s) {
    if (required) throw appError_('กรุณาเลือก ' + label);
    return '';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw appError_(label + ' ไม่ถูกต้อง');
  const parts = s.split('-').map(Number);
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (dt.getUTCFullYear() !== parts[0] || dt.getUTCMonth() !== parts[1] - 1 || dt.getUTCDate() !== parts[2]) throw appError_(label + ' ไม่ถูกต้อง');
  return s;
}

function dateOrder_(start, end) {
  if (start && end && end < start) throw appError_('วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่ม');
}

function oneOf_(v, map, label) {
  const s = str_(v, 50);
  if (!Object.prototype.hasOwnProperty.call(map, s)) throw appError_(label + ' ไม่ถูกต้อง');
  return s;
}

function round2_(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function sumBy_(rows, key) {
  return rows.reduce(function (t, r) { return t + (Number(r[key]) || 0); }, 0);
}

function fmtMoney_(n) {
  const v = round2_(n);
  const parts = Math.abs(v).toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0 ? '-' : '') + parts.join('.');
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
