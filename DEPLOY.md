# ติดตั้งใช้งานจริงบนเซิร์ฟเวอร์มหาวิทยาลัย

คู่มือนี้พาติดตั้งระบบเป็นเว็บที่นักศึกษาเข้าได้จากทุกที่ผ่าน HTTPS โดยใช้ Docker และ Caddy ซึ่งขอและต่ออายุใบรับรอง HTTPS ให้อัตโนมัติ

```
มือถือนักศึกษา ──HTTPS──▶ Caddy (พอร์ต 80/443) ──▶ ระบบ (พอร์ต 3000 ภายในเครื่อง) ──▶ โฟลเดอร์ data/
```

## 1. ขอเครื่องจากฝ่ายไอที

ส่งข้อความนี้ให้ฝ่ายไอทีได้เลย

> ขอเครื่องเซิร์ฟเวอร์ (VM) สำหรับระบบเช็คชื่อและส่งงานรายวิชา 10801327 นักศึกษาประมาณ 220 คน
> - ระบบปฏิบัติการ Linux (Ubuntu 22.04/24.04 หรือ Debian 12), 2 vCPU, RAM 2 GB, ดิสก์ 40 GB
> - ติดตั้ง Docker Engine และ Docker Compose plugin
> - โดเมนย่อย 1 ชื่อ เช่น `anim.xxx.ac.th` ชี้ DNS (A record) มาที่ IP ของเครื่อง
> - เปิดพอร์ต 80 และ 443 (TCP) ให้เข้าถึงได้จากอินเทอร์เน็ต เพราะนักศึกษาใช้ 4G และต้องใช้พอร์ต 80 ขอใบรับรอง HTTPS
> - สิทธิ์ SSH พร้อม sudo สำหรับผู้ดูแลระบบ
> - (ถ้ามี) ช่วง IP ขาออกของ Wi-Fi ในอาคาร InC สำหรับตั้งค่าจำกัดเครือข่ายเวลาเช็คชื่อ
>
> ระบบเก็บข้อมูลส่วนบุคคลของนักศึกษา (ชื่อ รหัส คะแนน ไฟล์งาน) ไว้บนเครื่องนี้เท่านั้น

**ถ้าฝ่ายไอทีมี reverse proxy หรือใบรับรองของมหาวิทยาลัยอยู่แล้ว** หรือเครื่องอยู่ในเครือข่ายภายในและเปิดพอร์ต 80 ออกอินเทอร์เน็ตไม่ได้ ให้ดูหัวข้อ 8 แทนการใช้ Caddy

## 2. ติดตั้งระบบ

SSH เข้าเครื่อง แล้วรันทีละบรรทัด

```bash
sudo git clone -b claude/attendance-grading-system-0wm6ov https://github.com/Aunaris/Aj-management.git /opt/aj-management
cd /opt/aj-management
sudo cp .env.example .env
sudo nano .env
```

แก้ค่าในไฟล์ `.env` อย่างน้อย `DOMAIN` ให้เป็นโดเมนที่ได้รับ บันทึกด้วย Ctrl+O, Enter แล้วออกด้วย Ctrl+X จากนั้นเริ่มระบบ

```bash
sudo docker compose -f docker-compose.prod.yml up -d --build
sudo docker compose -f docker-compose.prod.yml logs -f
```

รอจนเห็น `certificate obtained successfully` (Caddy ได้ใบรับรองแล้ว) และ `พร้อมใช้งาน` (ระบบเริ่มแล้ว) จากนั้นกด Ctrl+C เพื่อออกจากการดู log ระบบยังทำงานต่อ

เปิด `https://โดเมนของคุณ` จะเห็นหน้าแรกนักศึกษา

## 3. ข้อมูลเริ่มต้น เลือก 1 ทาง

**ทาง ก. เริ่มใหม่ (แนะนำ)** ไม่มีข้อมูลทดสอบติดมา

1. เข้า `https://โดเมน/login` ด้วย `admin` / `admin1234` และ `aunalyst` / `teacher1234` ระบบจะบังคับให้เปลี่ยนรหัสผ่านทันที
2. ที่เมนู **นักศึกษา** นำเข้าไฟล์ ClassRoster ทั้ง 3 ไฟล์พร้อมกัน ระบบสร้างกลุ่ม 1–3 และบัญชีนักศึกษา (รหัสผ่านครั้งแรก `123456`) ให้
3. ที่เมนู **กลุ่มเรียน (Section)** ตรวจวันเปิดภาคเรียนและวันเรียนของแต่ละกลุ่ม

**ทาง ข. ย้ายข้อมูลจากเครื่องที่ทดสอบ** ใช้เมื่อมีข้อมูลจริงอยู่แล้ว

1. บนเครื่องเดิม หยุดระบบก่อน แล้วบีบอัดโฟลเดอร์ `data` ทั้งโฟลเดอร์
2. คัดลอกไปที่เซิร์ฟเวอร์ เช่น `scp data.zip user@เซิร์ฟเวอร์:/tmp/`
3. บนเซิร์ฟเวอร์

```bash
cd /opt/aj-management
sudo docker compose -f docker-compose.prod.yml down
sudo unzip /tmp/data.zip -d /opt/aj-management/
sudo docker compose -f docker-compose.prod.yml up -d
sudo rm /tmp/data.zip
```

ถ้าย้ายข้อมูลมา **ต้องเปลี่ยนรหัสผ่าน** `admin`, `aunalyst` และ `piriya` ทันที เพราะรหัสผ่านเริ่มต้นเขียนไว้ใน README บน GitHub แล้วลบงานและคาบที่สร้างไว้ตอนทดสอบออก

## 4. ตรวจก่อนเปิดให้นักศึกษาใช้

- [ ] หน้าเว็บขึ้นรูปกุญแจ (HTTPS) ทั้งบนคอมพิวเตอร์และมือถือ
- [ ] เปลี่ยนรหัสผ่านอาจารย์และ admin แล้ว
- [ ] วันเปิดภาคเรียนและตารางเรียนถูกต้อง (หน้าแรกรายวิชา → ปฏิทิน)
- [ ] ทดลองเปิดเช็คชื่อ แล้วสแกน QR ด้วยมือถือ 2–3 เครื่อง ทั้งผ่าน 4G และ Wi-Fi มหาวิทยาลัย
- [ ] ที่หน้า **ตรวจสอบการเช็คชื่อ** IP ที่บันทึกต้องเป็น IP ของมือถือแต่ละเครื่อง ถ้าทุกเครื่องได้ IP เดียวกัน แปลว่ามี proxy อีกชั้น ให้ตั้ง `TRUST_PROXY=2` ใน `.env` แล้วรัน `up -d` ใหม่
- [ ] ถ้าเปิด GPS ให้ตั้งจุดห้องเรียน InC 204 ที่หน้า **ตั้งค่ารายวิชา** ขณะอยู่ในห้อง
- [ ] ตั้งสำรองข้อมูลอัตโนมัติตามหัวข้อ 5 แล้ว

## 5. สำรองข้อมูล

สำรองฐานข้อมูล ไฟล์งานนักศึกษา และกุญแจเข้ารหัสรหัสผ่านอีเมล รวมเป็นไฟล์เดียว ทำได้ขณะระบบทำงานอยู่

```bash
cd /opt/aj-management
sudo ./scripts/backup.sh
```

ไฟล์อยู่ที่ `/opt/aj-management/backups/aj-backup-วันที่-เวลา.tar.gz` ระบบเก็บไว้ 30 วัน

**ตั้งให้ทำทุกคืนตอนตี 2 ครึ่ง** รัน `sudo crontab -e` แล้วเพิ่มบรรทัดนี้

```
30 2 * * * cd /opt/aj-management && ./scripts/backup.sh >> backups/backup.log 2>&1
```

ควรขอฝ่ายไอทีให้คัดลอกโฟลเดอร์ `backups` ไปเก็บอีกเครื่องด้วย ถ้าดิสก์เครื่องนี้เสีย ไฟล์สำรองในเครื่องเดียวกันจะหายไปพร้อมกัน

**กู้คืนจากไฟล์สำรอง**

```bash
cd /opt/aj-management
sudo docker compose -f docker-compose.prod.yml down
sudo mv data data.old
sudo mkdir data && sudo tar -xzf backups/aj-backup-XXXX.tar.gz -C data
sudo mv data/snapshot-*.db data/classroom.db
sudo docker compose -f docker-compose.prod.yml up -d
```

## 6. อัปเดตระบบเป็นเวอร์ชันใหม่

```bash
cd /opt/aj-management
sudo ./scripts/backup.sh
sudo git pull
sudo docker compose -f docker-compose.prod.yml up -d --build
```

ข้อมูลในโฟลเดอร์ `data` ไม่หาย หน้าเว็บโหลดไฟล์ CSS/JS ใหม่ให้เอง ผู้ใช้ไม่ต้องล้าง cache

## 7. คำสั่งที่ใช้บ่อย

| ต้องการ | คำสั่ง (รันใน `/opt/aj-management`) |
|---|---|
| ดูสถานะ | `sudo docker compose -f docker-compose.prod.yml ps` |
| ดู log ล่าสุด | `sudo docker compose -f docker-compose.prod.yml logs --tail 100 classroom` |
| รีสตาร์ท | `sudo docker compose -f docker-compose.prod.yml restart` |
| หยุดระบบ | `sudo docker compose -f docker-compose.prod.yml down` |
| เข้าสู่ระบบไม่ได้ / ลืมรหัสผ่าน | `sudo docker compose -f docker-compose.prod.yml exec classroom node scripts/reset-password.js aunalyst รหัสใหม่` |

ระบบเริ่มใหม่เองเมื่อเครื่องรีบูต เพราะตั้ง `restart: unless-stopped` ไว้

## 8. กรณีมหาวิทยาลัยมี reverse proxy หรือใบรับรองอยู่แล้ว

ไม่ต้องใช้ Caddy ให้ฝ่ายไอทีตั้ง proxy ของมหาวิทยาลัย (เช่น nginx) ส่งต่อไปที่พอร์ต 3000 ของเครื่องนี้ และส่ง header `X-Forwarded-For` กับ `X-Forwarded-Proto` มาด้วย

1. แก้ `docker-compose.prod.yml` ส่วน `classroom` เปลี่ยน `expose: - "3000"` เป็น `ports: - "3000:3000"` และลบส่วน `caddy` ทั้งหมด
2. ใน `.env` ตั้ง `TRUST_PROXY=1` (ถ้ามี proxy 2 ชั้นให้ตั้ง 2)
3. ตัวอย่างสำหรับ nginx

```nginx
location / {
    proxy_pass http://ip-ของเครื่อง:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    client_max_body_size 1g;
}
```

เปิดพอร์ต 3000 ให้เฉพาะเครื่อง proxy เข้าได้ ห้ามเปิดออกอินเทอร์เน็ตตรง

## ความปลอดภัยและข้อมูลส่วนบุคคล

- ไม่อัปโหลดไฟล์ ClassRoster โฟลเดอร์ `data` หรือ `backups` ขึ้น GitHub (`.gitignore` กันไว้แล้ว)
- ผู้ที่ SSH เข้าเครื่องได้จะเข้าถึงข้อมูลนักศึกษาได้ทั้งหมด ควรจำกัดเฉพาะผู้ดูแล
- เมื่อจบภาคเรียน ส่งออกคะแนนจากหน้า **รายงาน / ส่งออก** แล้วพิจารณาลบข้อมูลตามนโยบายของมหาวิทยาลัย
