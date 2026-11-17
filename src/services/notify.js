'use strict';
const { get, uuid, now } = require('../db');

/**
 * In-app Notification (FR-08.1). ช่องทางเริ่มต้นคือ in_app และบันทึก delivery
 * เพื่อให้ขยายเป็น Email / LINE OA ได้ภายหลังโดยเพิ่ม channel ใหม่
 * dedupe_key ป้องกันการแจ้งเตือนซ้ำจากเหตุการณ์เดียวกัน
 */
function isEnabled(userId, eventType) {
  const pref = get()
    .prepare("SELECT enabled FROM notification_preferences WHERE user_id = ? AND event_type = ? AND channel = 'in_app'")
    .get(userId, eventType);
  return !pref || pref.enabled === 1;
}

function send(recipientId, { eventType, title, message, link, entityType, entityId, dedupeKey, mandatory = false }) {
  if (!mandatory && !isEnabled(recipientId, eventType)) return null;
  const db = get();
  const id = uuid();
  const info = db
    .prepare(`INSERT OR IGNORE INTO notifications (id, recipient_id, event_type, title, message, link, related_entity_type, related_entity_id, dedupe_key, mandatory, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, recipientId, eventType, title, message || null, link || null, entityType || null, entityId || null, dedupeKey || null, mandatory ? 1 : 0, now());
  if (info.changes === 0) return null; // duplicate
  db.prepare('INSERT INTO notification_deliveries (id, notification_id, channel, delivery_status, sent_at) VALUES (?,?,?,?,?)')
    .run(uuid(), id, 'in_app', 'delivered', now());
  return id;
}

function sendMany(recipientIds, payload) {
  for (const rid of recipientIds) {
    send(rid, { ...payload, dedupeKey: payload.dedupeKey ? `${payload.dedupeKey}` : null });
  }
}

function list(userId, limit = 100) {
  return get().prepare('SELECT * FROM notifications WHERE recipient_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit);
}

function unreadCount(userId) {
  return get().prepare('SELECT COUNT(*) c FROM notifications WHERE recipient_id = ? AND read_at IS NULL').get(userId).c;
}

function markRead(userId, id) {
  const db = get();
  if (id) db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND recipient_id = ? AND read_at IS NULL').run(now(), id, userId);
  else db.prepare('UPDATE notifications SET read_at = ? WHERE recipient_id = ? AND read_at IS NULL').run(now(), userId);
}

const EVENT_TYPES = {
  assignment_new: 'มีงานใหม่',
  assignment_changed: 'มีการแก้ไขโจทย์/กำหนดส่ง',
  due_reminder: 'เตือนกำหนดส่ง',
  overdue: 'งานเลยกำหนดส่ง',
  submission_status: 'สถานะการส่งงานเปลี่ยน',
  grade_published: 'เผยแพร่คะแนน/Feedback',
  revision_requested: 'ขอให้แก้ไขงาน',
  submission_new: 'มีการส่งงานใหม่ (ผู้สอน)',
  link_check: 'ลิงก์ที่ต้องตรวจสอบ (ผู้สอน)',
  risk_event: 'เหตุการณ์เสี่ยงการเช็คชื่อ (ผู้สอน)',
  appeal: 'คำร้อง/อุทธรณ์',
  announcement: 'ประกาศ',
};

function preferences(userId) {
  const rows = get().prepare("SELECT event_type, enabled FROM notification_preferences WHERE user_id = ? AND channel = 'in_app'").all(userId);
  const map = Object.fromEntries(rows.map((r) => [r.event_type, r.enabled === 1]));
  return Object.entries(EVENT_TYPES).map(([key, label]) => ({ key, label, enabled: map[key] !== false }));
}

function setPreference(userId, eventType, enabled) {
  if (!EVENT_TYPES[eventType]) return;
  get().prepare(`INSERT INTO notification_preferences (id, user_id, event_type, channel, enabled) VALUES (?,?,?, 'in_app', ?)
    ON CONFLICT(user_id, event_type, channel) DO UPDATE SET enabled = excluded.enabled`).run(uuid(), userId, eventType, enabled ? 1 : 0);
}

module.exports = { send, sendMany, list, unreadCount, markRead, preferences, setPreference, EVENT_TYPES };
