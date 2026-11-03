'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { isProtectedPath } = require('./safety');

// Disk cleaner. Two halves:
// - Junk: temp files and app caches that rebuild themselves. Deleted for good, because
//   binning a cache doesn't free anything. Only files inside the known folders below, and
//   never anything changed in the last day (it's probably in use).
// - Big files: the largest files in your folders, for you to pick from. They go to the
//   Recycle Bin, so you can get them back.
// Nothing is deleted here without being asked for by category id or exact path.

const DAY = 24 * 60 * 60 * 1000;
const MB = 1024 * 1024;

// Each category is a list of folders whose contents are safe to clear. "*" matches any one
// folder name (a browser profile, for example).
function junkCategories({ localAppData = process.env.LOCALAPPDATA, windir = process.env.WINDIR, temp = process.env.TEMP } = {}) {
  const local = (...p) => (localAppData ? path.join(localAppData, ...p) : null);
  const chromium = (...root) => ['Cache', 'Code Cache', 'GPUCache'].map((c) => local(...root, 'User Data', '*', c));
  return [
    { id: 'temp', name: 'Temporary files', description: 'Left behind by installers and apps', roots: [temp || local('Temp'), windir && path.join(windir, 'Temp')] },
    { id: 'browsers', name: 'Browser caches', description: 'Chrome, Edge, Brave and Firefox. Close them first to clear the most', roots: [
      ...chromium('Google', 'Chrome'),
      ...chromium('Microsoft', 'Edge'),
      ...chromium('BraveSoftware', 'Brave-Browser'),
      local('Mozilla', 'Firefox', 'Profiles', '*', 'cache2'),
    ] },
    { id: 'crash', name: 'Crash reports', description: 'Saved when an app crashes. Only useful for bug reports', roots: [local('CrashDumps'), local('Microsoft', 'Windows', 'WER', 'ReportArchive')] },
    { id: 'thumbs', name: 'Thumbnail cache', description: 'Windows makes these again when you next open a folder', roots: [local('Microsoft', 'Windows', 'Explorer')], match: /^(thumbcache|iconcache)_.*\.db$/i },
  ].map((c) => ({ ...c, roots: c.roots.filter(Boolean) }));
}

// Expands "*" segments into the folders that exist.
async function expandRoot(root) {
  const parts = root.split(/[\\/]/);
  const star = parts.indexOf('*');
  if (star === -1) return [root];
  const base = parts.slice(0, star).join(path.sep) || path.sep;
  let names;
  try {
    names = (await fsp.readdir(base, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) out.push(...await expandRoot([base, name, ...parts.slice(star + 1)].join(path.sep)));
  return out;
}

// Every file under dir (never following links or junctions), as { file, size, mtimeMs }.
// Folders that can't be read are skipped quietly.
async function walk(dir, { onFile, match, maxDepth = 20, skipDir = () => false } = {}, depth = 0) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (depth < maxDepth && !skipDir(full)) await walk(full, { onFile, match, maxDepth, skipDir }, depth + 1);
      continue;
    }
    if (!entry.isFile() || (match && !match.test(entry.name))) continue;
    try {
      const st = await fsp.lstat(full);
      onFile({ file: full, size: st.size, mtimeMs: st.mtimeMs });
    } catch {
      // Gone since the folder was listed.
    }
  }
}

// Files in a category that can go: inside its folders, and not changed in the last day.
async function junkFiles(category, { now = Date.now(), minAgeMs = DAY, onProgress } = {}) {
  const files = [];
  let seen = 0;
  const roots = [];
  for (const r of category.roots) roots.push(...await expandRoot(r));
  for (const root of roots) {
    // Only the thumbnail cache looks at a single folder level.
    await walk(root, {
      match: category.match,
      maxDepth: category.match ? 0 : 20,
      onFile: (f) => {
        seen += 1;
        if (onProgress && seen % 500 === 0) onProgress(seen);
        if (now - f.mtimeMs >= minAgeMs) files.push(f);
      },
    });
  }
  return { roots, files };
}

// Sizes up each junk category. Returns [{ id, name, description, size, count }].
async function scanJunk(categories, opts = {}) {
  const out = [];
  for (const c of categories) {
    const { files } = await junkFiles(c, opts);
    out.push({ id: c.id, name: c.name, description: c.description, size: files.reduce((s, f) => s + f.size, 0), count: files.length });
  }
  return out;
}

// Deletes the junk in the chosen categories, file by file. Files in use are skipped.
// Empty folders left behind are removed too, but never the category's own folders.
// Returns [{ id, ok, freed, deleted, skipped }].
async function cleanJunk(categories, ids, { dryRun = false, now = Date.now(), minAgeMs = DAY, remove = (f) => fsp.unlink(f) } = {}) {
  const results = [];
  for (const id of ids) {
    const c = categories.find((x) => x.id === id);
    if (!c) { results.push({ id, ok: false, message: 'Unknown category' }); continue; }
    const { roots, files } = await junkFiles(c, { now, minAgeMs });
    let freed = 0, deleted = 0, skipped = 0;
    for (const f of files) {
      // Belt and braces: the file must still be inside one of the category's folders.
      if (!roots.some((r) => isInside(f.file, r))) { skipped += 1; continue; }
      if (dryRun) { freed += f.size; deleted += 1; continue; }
      try {
        await remove(f.file);
        freed += f.size;
        deleted += 1;
      } catch {
        skipped += 1;
      }
    }
    if (!dryRun && !c.match) for (const r of roots) await removeEmptyDirs(r, true);
    results.push({ id, ok: true, freed, deleted, skipped, dryRun });
  }
  return results;
}

function isInside(file, root) {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function removeEmptyDirs(dir, isRoot = false) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) if (e.isDirectory() && !e.isSymbolicLink()) await removeEmptyDirs(path.join(dir, e.name));
  if (isRoot) return;
  try { await fsp.rmdir(dir); } catch { /* not empty or in use */ }
}

// The biggest files under the given folders, and how much space each top-level folder takes.
// Protected places (AppData, OneDrive, system folders, "." and "@" folders) are left out.
// Returns { files: [{ file, size, mtimeMs }], folders: [{ folder, size }], scanned }.
async function findBigFiles(folders, { minBytes = 500 * MB, limit = 100, onProgress, protectedPath = isProtectedPath } = {}) {
  const big = [];
  const totals = new Map();
  let scanned = 0;
  for (const root of folders) {
    let children;
    try {
      children = await fsp.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      const full = path.join(root, child.name);
      if (child.isSymbolicLink() || protectedPath(full)) continue;
      const count = (f) => {
        scanned += 1;
        if (onProgress && scanned % 1000 === 0) onProgress(scanned);
        totals.set(full, (totals.get(full) || 0) + f.size);
        if (f.size >= minBytes) big.push(f);
      };
      if (child.isDirectory()) {
        await walk(full, { onFile: count, skipDir: (d) => protectedPath(d) });
      } else if (child.isFile()) {
        try {
          const st = await fsp.lstat(full);
          count({ file: full, size: st.size, mtimeMs: st.mtimeMs });
        } catch { /* gone */ }
      }
    }
  }
  big.sort((a, b) => b.size - a.size);
  const tops = [...totals.entries()].map(([folder, size]) => ({ folder, size, isFile: !fs.existsSync(folder) || fs.statSync(folder).isFile() }))
    .filter((t) => !t.isFile && t.size > 0)
    .sort((a, b) => b.size - a.size)
    .slice(0, 10)
    .map(({ folder, size }) => ({ folder, size }));
  return { files: big.slice(0, limit), folders: tops, scanned };
}

module.exports = { junkCategories, expandRoot, junkFiles, scanJunk, cleanJunk, findBigFiles, isInside, DAY, MB };
