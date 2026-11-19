#!/usr/bin/env bash
# สำรองข้อมูลทั้งหมดของระบบ (ฐานข้อมูล + ไฟล์งานนักศึกษา + กุญแจเข้ารหัส) เป็นไฟล์ .tar.gz
# ใช้บนเซิร์ฟเวอร์:   sudo ./scripts/backup.sh
# ตั้งให้ทำทุกคืน:     sudo crontab -e  แล้วเพิ่มบรรทัด
#   30 2 * * * cd /opt/aj-management && ./scripts/backup.sh >> backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.prod.yml"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
TS="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# 1) snapshot ฐานข้อมูลจากในคอนเทนเนอร์ (ไม่ต้องหยุดระบบ)
$COMPOSE exec -T classroom node scripts/backup-db.js "/app/data/snapshot-$TS.db"

# 2) รวม snapshot + ไฟล์งาน + กุญแจ เป็นไฟล์เดียว
items=("snapshot-$TS.db")
[ -d data/storage ] && items+=("storage")
[ -f data/secret.key ] && items+=("secret.key")
tar -czf "$BACKUP_DIR/aj-backup-$TS.tar.gz" -C data "${items[@]}"
rm -f "data/snapshot-$TS.db"
chmod 600 "$BACKUP_DIR/aj-backup-$TS.tar.gz"

# 3) ลบไฟล์สำรองที่เก่ากว่า KEEP_DAYS วัน
find "$BACKUP_DIR" -name 'aj-backup-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

echo "$(date '+%F %T') สำรองข้อมูลแล้ว: $BACKUP_DIR/aj-backup-$TS.tar.gz ($(du -h "$BACKUP_DIR/aj-backup-$TS.tar.gz" | cut -f1))"
