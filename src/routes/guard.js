'use strict';
const crypto = require('crypto');
/** RBAC — ตรวจสอบสิทธิ์ฝั่ง Server ทุกครั้ง (ไม่พึ่งการซ่อนเมนูเพียงอย่างเดียว) */

function wantsJson(req) {
  return req.xhr || (req.get('accept') || '').includes('application/json') || (req.get('content-type') || '').includes('json');
}

function allow(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      if (wantsJson(req)) return res.status(401).json({ ok: false, error: 'กรุณาเข้าสู่ระบบ' });
      return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    }
    if (roles.length && !roles.includes(req.user.role)) {
      const err = new Error('คุณไม่มีสิทธิ์เข้าถึงหน้านี้');
      err.status = 403;
      return next(err);
    }
    return next();
  };
}

/** ห่อ handler ที่โยน ValidationError ให้ตอบกลับเป็น flash + redirect หรือ JSON */
function action(fn, { back } = {}) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      if (err.status && err.status < 500) {
        if (wantsJson(req)) return res.status(err.status).json({ ok: false, error: err.message, errors: err.errors || [err.message], code: err.code });
        res.flash('error', err.errors || [err.message]);
        return back ? res.redirect(typeof back === 'function' ? back(req) : back) : res.back();
      }
      return next(err);
    }
  };
}

function verifyCsrf(req, res, next) {
  const token = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (!req.user || !token || typeof token !== 'string' || token.length !== req.user.csrf_token.length
    || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(req.user.csrf_token))) {
    const err = new Error(req.user ? 'คำขอไม่ถูกต้อง (CSRF) กรุณารีเฟรชหน้าแล้วลองใหม่' : 'กรุณาเข้าสู่ระบบ');
    err.status = req.user ? 403 : 401;
    return next(err);
  }
  return next();
}

module.exports = { allow, action, wantsJson, verifyCsrf };
