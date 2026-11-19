'use strict';
/**
 * สำรองฐานข้อมูลแบบปลอดภัยขณะระบบทำงาน (SQLite online backup)
 * ใช้: node scripts/backup-db.js <ไฟล์ปลายทาง.db>
 */
const path = require('path');
const db = require('../src/db');

(async () => {
  const dest = process.argv[2];
  if (!dest) { console.error('ระบุไฟล์ปลายทาง เช่น node scripts/backup-db.js /app/data/backups/db.db'); process.exit(2); }
  require('fs').mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
  db.open();
  await db.get().backup(dest);
  db.close();
  console.log(`สำรองฐานข้อมูลแล้ว: ${dest}`);
})().catch((e) => { console.error(e); process.exit(1); });
