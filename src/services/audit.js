'use strict';
const { get, uuid, now } = require('../db');

/** บันทึก Audit Log (NFR-07) — การแก้ไขคะแนน การเช็คชื่อ การเผยแพร่ผล ฯลฯ */
function log(actorId, action, entityType, entityId, metadata) {
  get()
    .prepare('INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(uuid(), actorId || null, action, entityType, entityId || null, metadata ? JSON.stringify(metadata) : null, now());
}

function list({ entityType, entityId, limit = 200 } = {}) {
  const where = [];
  const args = [];
  if (entityType) { where.push('a.entity_type = ?'); args.push(entityType); }
  if (entityId) { where.push('a.entity_id = ?'); args.push(entityId); }
  const sql = `SELECT a.*, u.full_name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.created_at DESC LIMIT ?`;
  return get().prepare(sql).all(...args, limit).map((r) => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null }));
}

module.exports = { log, list };
