'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const ejs = require('ejs');
const db = require('./db');
const auth = require('./services/auth');
const notify = require('./services/notify');
const courseSvc = require('./services/course');
const util = require('./util');
const { verifyCsrf } = require('./routes/guard');

const SECURE_COOKIES = process.env.COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production';
const VIEWS = path.join(__dirname, '..', 'views');

function createApp() {
  const app = express();
  app.set('trust proxy', process.env.TRUST_PROXY === '1');
  app.set('views', VIEWS);
  app.set('view engine', 'ejs');
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), microphone=(), camera=(self)');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'", "img-src 'self' data: blob:", "media-src 'self' blob:", "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com",
      "frame-ancestors 'none'", "form-action 'self'", "base-uri 'self'",
    ].join('; '));
    next();
  });
  // บันทึกคำขอลงไฟล์ (โหมดโปรแกรม PC) เพื่อใช้ตรวจปัญหา — เขียนแบบ async ไม่บล็อกระบบ
  if (process.env.REQUEST_LOG) {
    const fsMod = require('fs');
    app.use((req, res, next) => {
      const t0 = Date.now();
      res.on('finish', () => {
        if (req.path.startsWith('/static') || req.path.endsWith('/qr.json') || req.path.endsWith('/roster.json')) return;
        fsMod.appendFile(process.env.REQUEST_LOG, `[${new Date().toISOString()}] ${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Date.now() - t0}ms ${req.ip}\n`, () => {});
      });
      next();
    });
  }
  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(express.json({ limit: '1mb' }));

  // Device ID (สุ่ม เก็บใน cookie) ใช้สำหรับ Device Anomaly Detection — ไม่ใช่หลักฐานยืนยันตัวบุคคล
  app.use((req, res, next) => {
    let did = req.cookies.did;
    if (!did || !/^[A-Za-z0-9_-]{20,64}$/.test(did)) {
      did = crypto.randomBytes(18).toString('base64url');
      res.cookie('did', did, { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIES, maxAge: 400 * 86400000 });
    }
    req.deviceId = did;
    next();
  });

  // Session
  app.use((req, res, next) => {
    const s = auth.resolveSession(req.cookies.sid);
    req.user = s || null;
    res.locals.user = s;
    res.locals.csrf = s ? s.csrf_token : '';
    res.locals.course = courseSvc.getCourse();
    res.locals.u = util;
    res.locals.path = req.path;
    res.locals.unread = s ? notify.unreadCount(s.user_id) : 0;
    res.locals.studentUrl = process.env.DESKTOP_MODE ? process.env.BASE_URL : null;
    // กลุ่มเรียนที่ผู้สอนเลือกดูอยู่ (cookie "sec") — ว่าง = ทุกกลุ่ม
    req.section = null;
    res.locals.sections = [];
    res.locals.currentSection = null;
    if (s && s.role !== 'student' && res.locals.course) {
      res.locals.sections = courseSvc.sections(res.locals.course.id);
      req.section = res.locals.sections.find((x) => x.id === req.cookies.sec) || null;
      res.locals.currentSection = req.section;
    }
    if (s && s.role === 'student' && res.locals.course) {
      const code = courseSvc.studentSectionCode(res.locals.course.id, s.user_id);
      res.locals.mySection = code ? courseSvc.sectionByCode(res.locals.course.id, code) : null;
    }
    res.locals.flash = req.cookies.flash ? safeJson(req.cookies.flash) : null;
    if (req.cookies.flash) res.clearCookie('flash');
    next();
  });

  // page renderer with layout
  app.use((req, res, next) => {
    res.page = (view, locals = {}, opts = {}) => {
      const data = { ...res.locals, ...locals };
      ejs.renderFile(path.join(VIEWS, `${view}.ejs`), data, { views: [VIEWS] }, (err, body) => {
        if (err) return next(err);
        if (opts.bare) return res.status(opts.status || 200).send(body);
        ejs.renderFile(path.join(VIEWS, 'layout.ejs'), { ...data, body, title: locals.title || '' }, { views: [VIEWS] }, (err2, html) => {
          if (err2) return next(err2);
          res.status(opts.status || 200).send(html);
        });
      });
    };
    res.flash = (type, message) => {
      res.cookie('flash', JSON.stringify({ type, message: Array.isArray(message) ? message : [message] }), { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIES, maxAge: 60000 });
    };
    res.back = (fallback = '/') => {
      const ref = req.get('referer');
      try {
        const u = ref ? new URL(ref) : null;
        if (u && u.host === req.get('host')) return res.redirect(u.pathname + u.search + u.hash);
      } catch { /* ignore */ }
      return res.redirect(fallback);
    };
    next();
  });

  // CSRF สำหรับคำขอที่เปลี่ยนแปลงข้อมูล (multipart ตรวจหลัง multer ใน route)
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    if (req.path === '/login') return next();
    // หน้าเช็คชื่อแบบไม่ต้องมีบัญชี ใช้ token ของตัวเอง (double-submit cookie) — ตรวจใน routes/checkin.js
    if (!req.user && (req.path === '/checkin' || req.path === '/checkin/verify')) return next();
    if ((req.get('content-type') || '').startsWith('multipart/form-data')) return next();
    return verifyCsrf(req, res, next);
  });

  // บังคับเปลี่ยนรหัสผ่านครั้งแรก
  app.use((req, res, next) => {
    if (req.user && req.user.must_change_password && !['/account/password', '/logout'].includes(req.path) && !req.path.startsWith('/static')) {
      return res.redirect('/account/password');
    }
    next();
  });

  app.use(require('./routes/auth'));
  app.use(require('./routes/common'));
  app.use('/teacher', require('./routes/teacher'));
  app.use('/teacher', require('./routes/grading'));
  app.use('/teacher', require('./routes/reports'));
  app.use('/teacher', require('./routes/mail'));
  app.use('/student', require('./routes/student'));
  app.use(require('./routes/checkin'));
  app.use('/admin', require('./routes/admin'));

  app.use((req, res) => res.page('error', { title: 'ไม่พบหน้า', message: 'ไม่พบหน้าที่ต้องการ', code: 404 }, { status: 404 }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'ไฟล์มีขนาดใหญ่เกินกำหนด' : status === 500 ? 'เกิดข้อผิดพลาดภายในระบบ' : err.message;
    if (status === 500) console.error(err);
    if (req.accepts(['html', 'json']) === 'json' || req.xhr || (req.get('content-type') || '').includes('json')) {
      return res.status(status).json({ ok: false, error: message, errors: err.errors || [message], code: err.code });
    }
    if (err.errors && status === 400 && req.method === 'POST') {
      res.flash('error', err.errors);
      return res.back();
    }
    return res.page('error', { title: 'ข้อผิดพลาด', message, code: status }, { status });
  });
  return app;
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

module.exports = { createApp, verifyCsrf, SECURE_COOKIES, db };
