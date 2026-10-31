'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isProtectedPath, isIgnored } = require('./safety');

// Finds files that are safe to bin: installers you've probably already run, exact
// duplicates, and downloads that stalled and never finished. Only the top level of
// each folder is looked at, the same as Check now. Nothing is deleted here.

const DAY = 24 * 60 * 60 * 1000;
const INSTALLER_EXTENSIONS = ['.exe', '.msi', '.msix', '.msixbundle', '.appx', '.appxbundle'];
const PARTIAL_EXTENSIONS = ['.crdownload', '.part', '.tmp'];
// Big files are skipped when looking for duplicates, so a check never stalls on hashing.
const MAX_HASH_BYTES = 2 * 1024 * 1024 * 1024;

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function listFiles(folders, ignored = []) {
  const files = [];
  const seen = new Set();
  for (const folder of folders) {
    let entries;
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const file = path.join(folder, entry.name);
      const key = path.resolve(file).toLowerCase();
      if (!entry.isFile() || seen.has(key) || isProtectedPath(file) || isIgnored(file, ignored)) continue;
      seen.add(key);
      try {
        const stat = fs.statSync(file);
        files.push({ file, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // Gone or unreadable since the folder was listed.
      }
    }
  }
  return files;
}

// The copy to keep from a set of duplicates: the oldest, then the shortest name
// (so "photo.jpg" is kept over "photo (2).jpg").
function pickOriginal(group) {
  return [...group].sort((a, b) => a.mtimeMs - b.mtimeMs || path.basename(a.file).length - path.basename(b.file).length)[0];
}

const ago = (ms) => {
  const days = Math.floor(ms / DAY);
  return days >= 60 ? `${Math.floor(days / 30)} months` : `${days} days`;
};

// Returns [{ file, kind: 'duplicate' | 'installer' | 'partial', message, size }].
function findClutter(folders, { now = Date.now(), installerDays = 30, partialDays = 7, hash = hashFile, ignored = [] } = {}) {
  const files = listFiles(folders, ignored);
  const found = new Map();

  // Exact duplicates: same size first (cheap), then same contents.
  const bySize = new Map();
  for (const f of files) {
    if (f.size === 0 || f.size > MAX_HASH_BYTES) continue;
    if (!bySize.has(f.size)) bySize.set(f.size, []);
    bySize.get(f.size).push(f);
  }
  for (const group of bySize.values()) {
    if (group.length < 2) continue;
    const byHash = new Map();
    for (const f of group) {
      let h;
      try { h = hash(f.file); } catch { continue; }
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h).push(f);
    }
    for (const same of byHash.values()) {
      if (same.length < 2) continue;
      const original = pickOriginal(same);
      for (const f of same) {
        if (f === original) continue;
        found.set(f.file, { file: f.file, kind: 'duplicate', size: f.size, message: `Same as ${path.basename(original.file)}${path.dirname(original.file) === path.dirname(f.file) ? '' : ` in ${path.basename(path.dirname(original.file))}`}` });
      }
    }
  }

  for (const f of files) {
    if (found.has(f.file)) continue;
    const ext = path.extname(f.file).toLowerCase();
    const age = now - f.mtimeMs;
    if (INSTALLER_EXTENSIONS.includes(ext) && age >= installerDays * DAY) {
      found.set(f.file, { file: f.file, kind: 'installer', size: f.size, message: `Installer from ${ago(age)} ago, probably already installed` });
    } else if (PARTIAL_EXTENSIONS.includes(ext) && age >= partialDays * DAY) {
      found.set(f.file, { file: f.file, kind: 'partial', size: f.size, message: `Download that stopped ${ago(age)} ago and never finished` });
    }
  }

  const order = { duplicate: 0, installer: 1, partial: 2 };
  return [...found.values()].sort((a, b) => order[a.kind] - order[b.kind] || b.size - a.size);
}

module.exports = { findClutter, hashFile, pickOriginal };
