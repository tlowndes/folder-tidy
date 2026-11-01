'use strict';

const fs = require('fs');
const path = require('path');
const { matchRule, destinationFor } = require('./rules');
const { isProtectedPath, isPartialDownload, isIgnored } = require('./safety');
const { moveFile, moveBack } = require('./mover');

// Decides what to do with one file. Returns a plan object, or null to leave the file alone.
// Pure apart from reading the file's existence; nothing is moved here.
function planFile(filePath, rules, ignored = []) {
  const fileName = path.basename(filePath);
  if (isPartialDownload(fileName) || isProtectedPath(filePath) || isIgnored(filePath, ignored)) return null;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;

  const rule = matchRule(fileName, rules);
  if (!rule || !rule.destination) return null;

  // Already in its destination folder, so nothing to do. This also stops a moved
  // file from being picked up again when the watcher sees the new location.
  if (path.resolve(path.dirname(filePath)) === path.resolve(rule.destination)) return null;

  return { from: filePath, destDir: destinationFor(rule, fs.statSync(filePath).mtime), ruleId: rule.id };
}

// Applies a plan. In dry-run mode it returns the planned move without touching the file.
function applyPlan(plan, { dryRun, history }) {
  if (dryRun) return { ...plan, to: null, dryRun: true };
  const to = moveFile(plan.from, plan.destDir);
  const entry = history.add({ from: plan.from, to, ruleId: plan.ruleId });
  return { ...plan, to, dryRun: false, entryId: entry.id };
}

// Undoes one history entry. Returns { ok, reason }.
function undoEntry(entry, history) {
  if (entry.undone) return { ok: false, reason: 'Already undone' };
  if (!fs.existsSync(entry.to)) return { ok: false, reason: "Can't undo: file no longer there" };
  const restored = moveBack(entry.to, entry.from);
  history.markUndone(entry.id);
  return { ok: true, restoredTo: restored };
}

module.exports = { planFile, applyPlan, undoEntry };
