'use strict';
/** FR-05 Grading & Rubric + Quick Grading ระหว่างคาบ */
const { get, uuid, now, tx } = require('../db');
const audit = require('./audit');
const notify = require('./notify');
const assignSvc = require('./assignments');
const { ValidationError } = assignSvc;
const { round2 } = require('../util');

/**
 * คะแนนรวมจาก Rubric = Σ(คะแนนเกณฑ์ ÷ คะแนนเต็มเกณฑ์ × น้ำหนัก) ÷ Σน้ำหนัก × คะแนนเต็มงาน
 * (ค่าเริ่มต้น น้ำหนัก = คะแนนเต็มของเกณฑ์ จึงเท่ากับผลรวมคะแนนเกณฑ์เมื่อคะแนนเต็มรวมตรงกับงาน)
 */
function computeTotal(assignment, rubric, scores) {
  if (!rubric || !rubric.criteria.length) return null;
  let weighted = 0;
  let weights = 0;
  for (const c of rubric.criteria) {
    const s = scores[c.id];
    if (s === undefined || s === null || s === '') return null; // ยังให้คะแนนไม่ครบทุกเกณฑ์
    weighted += (Number(s) / c.max_score) * c.weight;
    weights += c.weight;
  }
  return Math.min(assignment.max_score, round2((weighted / weights) * assignment.max_score));
}

function getGrade(assignmentId, studentId) {
  const g = get().prepare('SELECT * FROM grading_records WHERE assignment_id = ? AND student_id = ?').get(assignmentId, studentId);
  if (!g) return null;
  const rows = get().prepare('SELECT * FROM rubric_scores WHERE grading_record_id = ?').all(g.id);
  g.scores = Object.fromEntries(rows.map((r) => [r.criterion_id, r.score]));
  g.comments = Object.fromEntries(rows.map((r) => [r.criterion_id, r.comment]));
  return g;
}

function num(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * บันทึกผลการตรวจ
 * @param {object} p
 * @param {'draft'|'publish'|'revision'} p.action
 */
function saveGrade({ assignmentId, studentId, scores = {}, comments = {}, directScore, feedback, action = 'draft', reason, actorId }) {
  const a = assignSvc.getAssignment(assignmentId);
  if (!a) throw new ValidationError('ไม่พบงาน');
  const course = get().prepare('SELECT * FROM courses WHERE id = ?').get(a.course_id);
  if (course.scores_locked_at) throw new ValidationError('คะแนนรายวิชาถูกล็อกแล้ว');
  if (!get().prepare("SELECT 1 FROM course_enrollments WHERE course_id = ? AND user_id = ? AND enrollment_status = 'active'").get(a.course_id, studentId)) {
    throw new ValidationError('นักศึกษาไม่ได้อยู่ในรายวิชา');
  }
  const existing = getGrade(assignmentId, studentId);
  if (existing && existing.status === 'locked') throw new ValidationError('คะแนนนี้ถูกล็อกแล้ว');

  const rubric = assignSvc.rubric(assignmentId);
  const errors = [];
  const cleanScores = {};
  if (rubric) {
    for (const c of rubric.criteria) {
      const v = num(scores[c.id]);
      if (v === null) continue;
      if (Number.isNaN(v) || v < 0 || v > c.max_score) errors.push(`"${c.criterion_name}" ต้องอยู่ระหว่าง 0–${c.max_score}`);
      else cleanScores[c.id] = v;
    }
  }
  let total;
  if (rubric) {
    total = computeTotal(a, rubric, cleanScores);
    if (total === null && Object.keys(cleanScores).length === 0) {
      const d = num(directScore);
      if (d !== null) errors.push('งานนี้มี Rubric กรุณาให้คะแนนรายเกณฑ์');
    }
  } else {
    const d = num(directScore);
    if (d !== null && (Number.isNaN(d) || d < 0 || d > a.max_score)) errors.push(`คะแนนต้องอยู่ระหว่าง 0–${a.max_score}`);
    total = d === null || Number.isNaN(d) ? null : round2(d);
  }
  if (action === 'publish' && (total === null || total === undefined)) errors.push('ต้องให้คะแนนครบทุกเกณฑ์ก่อนเผยแพร่');
  if (total !== null && total > a.max_score) errors.push('คะแนนรวมเกินคะแนนเต็มของงาน');
  const cleanReason = String(reason || '').trim();
  const wasPublished = existing && existing.status === 'published';
  const scoreChanged = existing && existing.total_score !== (total ?? null);
  if (wasPublished && scoreChanged && !cleanReason) errors.push('คะแนนนี้เผยแพร่แล้ว การแก้ไขต้องระบุเหตุผล');
  if (action === 'revision' && !String(feedback || '').trim()) errors.push('กรุณาเขียน Feedback ระบุสิ่งที่ต้องแก้ไข');
  if (errors.length) throw new ValidationError(errors);

  const newStatus = action === 'publish' ? 'published' : action === 'revision' ? 'revision_requested' : wasPublished && !scoreChanged ? 'published' : 'draft';
  const ts = now();
  const sub = get().prepare('SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ? ORDER BY version DESC LIMIT 1').get(assignmentId, studentId);
  const fb = String(feedback ?? existing?.feedback ?? '').trim();
  const id = existing ? existing.id : uuid();

  tx(() => {
    if (existing) {
      get().prepare(`UPDATE grading_records SET submission_id = ?, grader_id = ?, total_score = ?, feedback = ?, status = ?, graded_at = ?,
        published_at = CASE WHEN ? = 'published' THEN COALESCE(?, published_at) ELSE published_at END WHERE id = ?`)
        .run(sub ? sub.id : existing.submission_id, actorId, total ?? null, fb || null, newStatus, ts, newStatus, action === 'publish' ? ts : null, id);
    } else {
      get().prepare(`INSERT INTO grading_records (id, assignment_id, student_id, submission_id, grader_id, total_score, feedback, status, graded_at, published_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, assignmentId, studentId, sub ? sub.id : null, actorId, total ?? null, fb || null, newStatus, ts, newStatus === 'published' ? ts : null);
    }
    if (rubric) {
      for (const c of rubric.criteria) {
        if (cleanScores[c.id] === undefined) {
          get().prepare('DELETE FROM rubric_scores WHERE grading_record_id = ? AND criterion_id = ?').run(id, c.id);
          continue;
        }
        get().prepare(`INSERT INTO rubric_scores (id, grading_record_id, criterion_id, score, comment) VALUES (?,?,?,?,?)
          ON CONFLICT(grading_record_id, criterion_id) DO UPDATE SET score = excluded.score, comment = excluded.comment`)
          .run(uuid(), id, c.id, cleanScores[c.id], String(comments[c.id] || '').trim() || null);
      }
    }
    if (!existing || existing.total_score !== (total ?? null) || existing.status !== newStatus) {
      get().prepare(`INSERT INTO score_adjustments (id, grading_record_id, old_score, new_score, old_status, new_status, reason, changed_by, changed_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(uuid(), id, existing ? existing.total_score : null, total ?? null, existing ? existing.status : null, newStatus, cleanReason || null, actorId, ts);
    }
    if (fb && fb !== (existing?.feedback || '')) {
      get().prepare('INSERT INTO feedbacks (id, assignment_id, student_id, submission_id, author_id, content, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(uuid(), assignmentId, studentId, sub ? sub.id : null, actorId, fb, ts);
    }
    if (sub) {
      const subStatus = newStatus === 'published' ? 'reviewed' : newStatus === 'revision_requested' ? 'revision_requested' : 'under_review';
      get().prepare('UPDATE submissions SET status = ? WHERE id = ?').run(subStatus, sub.id);
    }
  });
  audit.log(actorId, `grade.${action}`, 'grading_record', id, {
    assignmentId, studentId, old: existing ? { score: existing.total_score, status: existing.status } : null, new: { score: total ?? null, status: newStatus }, reason: cleanReason || null,
  });
  if (newStatus === 'published' && (!existing || existing.status !== 'published' || scoreChanged)) {
    notify.send(studentId, {
      eventType: 'grade_published', title: `เผยแพร่คะแนน: ${a.title}`, message: `ได้ ${total}/${a.max_score} คะแนน`,
      link: `/student/assignments/${assignmentId}`, entityType: 'grading_record', entityId: id, dedupeKey: `grade:${id}:${ts}`,
    });
  }
  if (newStatus === 'revision_requested') {
    notify.send(studentId, {
      eventType: 'revision_requested', title: `ผู้สอนขอให้แก้ไขงาน: ${a.title}`, message: fb.slice(0, 200),
      link: `/student/assignments/${assignmentId}`, entityType: 'grading_record', entityId: id, dedupeKey: `revision:${id}:${ts}`,
    });
  }
  return getGrade(assignmentId, studentId);
}

/** เผยแพร่คะแนน Draft ทั้งหมดของงาน */
function publishAll(assignmentId, actorId) {
  const drafts = get().prepare("SELECT * FROM grading_records WHERE assignment_id = ? AND status = 'draft' AND total_score IS NOT NULL").all(assignmentId);
  let count = 0;
  for (const g of drafts) {
    const cur = getGrade(assignmentId, g.student_id);
    saveGrade({ assignmentId, studentId: g.student_id, scores: cur.scores, comments: cur.comments, directScore: cur.total_score, feedback: cur.feedback, action: 'publish', actorId });
    count += 1;
  }
  return count;
}

function history(assignmentId, studentId) {
  return get().prepare(`SELECT sa.*, u.full_name AS changed_by_name FROM score_adjustments sa JOIN grading_records g ON g.id = sa.grading_record_id
    JOIN users u ON u.id = sa.changed_by WHERE g.assignment_id = ? AND g.student_id = ? ORDER BY sa.changed_at DESC`).all(assignmentId, studentId);
}

function feedbackHistory(assignmentId, studentId) {
  return get().prepare(`SELECT f.*, u.full_name AS author_name FROM feedbacks f JOIN users u ON u.id = f.author_id
    WHERE f.assignment_id = ? AND f.student_id = ? ORDER BY f.created_at DESC`).all(assignmentId, studentId);
}

/** มุมมองนักศึกษา: เห็นคะแนน/Feedback เมื่อเผยแพร่แล้วเท่านั้น */
function studentView(assignmentId, studentId) {
  const g = getGrade(assignmentId, studentId);
  if (!g) return null;
  if (['published', 'locked'].includes(g.status)) return g;
  if (g.status === 'revision_requested') return { status: g.status, feedback: g.feedback, total_score: null, scores: {}, comments: {} };
  return null;
}

/** ล็อกคะแนนเมื่อผู้สอนอนุมัติ (Final Assessment Workflow) */
function lockCourse(courseId, actorId) {
  const pendingDrafts = get().prepare(`SELECT COUNT(*) c FROM grading_records g JOIN assignments a ON a.id = g.assignment_id
    WHERE a.course_id = ? AND g.status = 'draft' AND a.deleted_at IS NULL`).get(courseId).c;
  if (pendingDrafts) throw new ValidationError(`ยังมีคะแนน Draft ที่ยังไม่เผยแพร่ ${pendingDrafts} รายการ`);
  tx(() => {
    get().prepare(`UPDATE grading_records SET status = 'locked' WHERE status = 'published' AND assignment_id IN (SELECT id FROM assignments WHERE course_id = ?)`).run(courseId);
    get().prepare('UPDATE courses SET scores_locked_at = ?, scores_locked_by = ? WHERE id = ?').run(now(), actorId, courseId);
  });
  audit.log(actorId, 'scores.lock', 'course', courseId);
}

function unlockCourse(courseId, actorId, reason) {
  if (!String(reason || '').trim()) throw new ValidationError('กรุณาระบุเหตุผลการปลดล็อก');
  tx(() => {
    get().prepare(`UPDATE grading_records SET status = 'published' WHERE status = 'locked' AND assignment_id IN (SELECT id FROM assignments WHERE course_id = ?)`).run(courseId);
    get().prepare('UPDATE courses SET scores_locked_at = NULL, scores_locked_by = NULL WHERE id = ?').run(courseId);
  });
  audit.log(actorId, 'scores.unlock', 'course', courseId, { reason: reason.trim() });
}

module.exports = { computeTotal, getGrade, saveGrade, publishAll, history, feedbackHistory, studentView, lockCourse, unlockCourse };
