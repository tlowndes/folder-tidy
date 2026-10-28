'use strict';

const fs = require('fs');
const path = require('path');

// Returns a path in dir that does not exist yet: "invoice.pdf", then "invoice (2).pdf", and so on.
function uniquePath(dir, fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let candidate = path.join(dir, fileName);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${n})${ext}`);
    n += 1;
  }
  return candidate;
}

// Moves a file to an exact new path, creating folders as needed. Never overwrites.
// Falls back to copy + remove across drives. Files are never deleted by a failed move.
function relocate(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    fs.unlinkSync(from);
  }
  return to;
}

// Moves a file into destDir under a name that is not taken. Returns the final path.
function moveFile(from, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  return relocate(from, uniquePath(destDir, path.basename(from)));
}

// Puts a file back at its original path (used by undo). If that name is now taken,
// it gets a numbered suffix instead of overwriting. Returns the final path.
function moveBack(current, original) {
  fs.mkdirSync(path.dirname(original), { recursive: true });
  return relocate(current, uniquePath(path.dirname(original), path.basename(original)));
}

module.exports = { uniquePath, moveFile, moveBack };
