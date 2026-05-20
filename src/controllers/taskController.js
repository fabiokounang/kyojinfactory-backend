const taskModel = require('../models/taskModel');

function toPublic(t) {
  if (!t) return null;
  return {
    id: t.id,
    type: t.type,
    referenceType: t.reference_type,
    referenceId: t.reference_id,
    title: t.title,
    notes: t.notes,
    assigneeUserId: t.assignee_user_id,
    dueDate: t.due_date,
    status: t.status,
    doneAt: t.done_at,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

async function index(req, res, next) {
  try {
    const tasks = await taskModel.list({ status: req.query.status });
    res.json({ data: tasks.map(toPublic) });
  } catch (err) {
    next(err);
  }
}

async function markDone(req, res, next) {
  try {
    const existing = await taskModel.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Task tidak ditemukan' });
    const updated = await taskModel.markDone(req.params.id);
    res.json({ data: toPublic(updated) });
  } catch (err) {
    next(err);
  }
}

async function reopen(req, res, next) {
  try {
    const existing = await taskModel.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Task tidak ditemukan' });
    const updated = await taskModel.reopen(req.params.id);
    res.json({ data: toPublic(updated) });
  } catch (err) {
    next(err);
  }
}

module.exports = { index, markDone, reopen };
