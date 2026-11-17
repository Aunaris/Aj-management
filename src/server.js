'use strict';
const db = require('./db');
const { seedBase } = require('./seed');

db.open();
if (seedBase({ forceChange: true })) {
  console.log('สร้างข้อมูลรายวิชาตั้งต้นจาก OBE-3 แล้ว — บัญชีเริ่มต้น: admin/admin1234, thaksin/teacher1234, piriya/teacher1234 (ต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก)');
}

require('./services/course').migrateSections(require('./services/course').getCourse().id);

const { createApp } = require('./app');
const scheduler = require('./services/scheduler');

const app = createApp();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  console.log(`2D Animation Classroom พร้อมใช้งานที่ http://localhost:${port}`);
});
scheduler.start();
