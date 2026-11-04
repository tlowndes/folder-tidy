'use strict';

const path = require('path');

// Rules can tidy a file's name as it moves. Undo puts the old name back, because the
// history keeps the original path.

const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

// Strips the bits Windows and browsers add to copies: "Copy of x", "x - Copy",
// "x - Copy (2)", "x (1)", "x(3)". Also squashes extra spaces and lower-cases the type.
// Leaves the name alone if cleaning would leave nothing.
function cleanName(fileName) {
  const ext = path.extname(fileName);
  let base = path.basename(fileName, ext);
  const before = base;
  base = base
    .replace(/^copy of\s+/i, '')
    .replace(/\s*-\s*copy(\s*\(\d+\))?$/i, '')
    .replace(/\s*\(\d+\)$/, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s._-]+|[\s_-]+$/g, '');
  if (!base) base = before;
  return base + ext.toLowerCase();
}

function dateStamp(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// "Brief.pdf" becomes "2026-11-03 Brief.pdf". Names that already start with a date are left.
function addDatePrefix(fileName, date) {
  return DATE_PREFIX.test(fileName) ? fileName : `${dateStamp(date)} ${fileName}`;
}

// The name a file gets when a rule moves it. Returns the same name if the rule doesn't rename.
function renameFor(fileName, rule, date = new Date()) {
  let name = fileName;
  if (rule.cleanName) name = cleanName(name);
  if (rule.datePrefix) name = addDatePrefix(name, date);
  return name;
}

module.exports = { cleanName, addDatePrefix, renameFor, dateStamp };
