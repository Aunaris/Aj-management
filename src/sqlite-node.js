'use strict';
/**
 * ตัวแปลงให้ node:sqlite (มากับ Node.js 22.5+) ใช้แทน better-sqlite3 ได้
 * ใช้ในโปรแกรมสำหรับ PC (ไม่ต้องคอมไพล์ native module แยกตามระบบปฏิบัติการ)
 * รองรับเฉพาะ API ที่ระบบนี้ใช้: prepare/exec/pragma/transaction/backup/close
 */
const sqlite = require('node:sqlite');

class Database {
  constructor(file) {
    this.db = new sqlite.DatabaseSync(file);
    this.file = file;
    this.depth = 0;
    this.sp = 0;
  }

  prepare(sql) {
    return this.db.prepare(sql);
  }

  exec(sql) {
    this.db.exec(sql);
    return this;
  }

  pragma(text) {
    return this.db.prepare(`PRAGMA ${text}`).all();
  }

  /** คืนฟังก์ชันที่ห่อด้วย transaction (ซ้อนกันได้ด้วย SAVEPOINT เหมือน better-sqlite3) */
  transaction(fn) {
    return (...args) => {
      const nested = this.depth > 0;
      const name = `sp_${(this.sp += 1)}`;
      this.db.exec(nested ? `SAVEPOINT ${name}` : 'BEGIN');
      this.depth += 1;
      try {
        const out = fn(...args);
        this.depth -= 1;
        this.db.exec(nested ? `RELEASE ${name}` : 'COMMIT');
        return out;
      } catch (err) {
        this.depth -= 1;
        try { this.db.exec(nested ? `ROLLBACK TO ${name}; RELEASE ${name}` : 'ROLLBACK'); } catch { /* ignore */ }
        throw err;
      }
    };
  }

  async backup(dest) {
    if (typeof sqlite.backup === 'function') return sqlite.backup(this.db, dest);
    this.db.prepare('VACUUM INTO ?').run(dest);
    return undefined;
  }

  close() {
    this.db.close();
  }
}

module.exports = Database;
