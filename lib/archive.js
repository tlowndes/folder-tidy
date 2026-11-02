'use strict';

// Cold storage: zips project folders that haven't changed in a while, copies the zip to
// an archive folder (an external drive, a NAS or a synced cloud folder), checks every
// file in the zip against the original, and only then sends the original to the
// Recycle Bin. Nothing here runs on its own; main.js calls it after you approve.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const archiver = require('archiver');
const yauzl = require('yauzl');
const { uniquePath } = require('./mover');
const { isProtectedPath, isIgnored } = require('./safety');

const DAY = 24 * 60 * 60 * 1000;
// Spare room left on the archive drive, on top of the folder's size.
const SPACE_MARGIN = 50 * 1024 * 1024;

// Already compressed, so they're stored as they are. Squashing them again takes ages
// and saves next to nothing.
const STORE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.avif',
  '.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.wmv', '.mxf', '.braw', '.r3d',
  '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.flac',
  '.zip', '.7z', '.rar', '.gz', '.xz', '.bz2',
  '.pdf', '.docx', '.xlsx', '.pptx', '.fig', '.sketch',
]);

const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const isInside = (child, parent) => {
  const rel = path.relative(path.resolve(parent).toLowerCase(), path.resolve(child).toLowerCase());
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
const toZipName = (rel) => rel.split(path.sep).join('/');

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function formatSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function daysAgo(ms, now) {
  const days = Math.floor((now - ms) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return days >= 60 ? `${Math.floor(days / 30)} months ago` : `${days} days ago`;
}

// Everything inside a folder: files (with size and date), subfolders, and how many
// links or shortcuts to other places it holds. Links are never followed.
async function walkFolder(root) {
  const out = { files: [], dirs: [], links: 0, unreadable: 0, totalBytes: 0, newestMs: 0 };
  async function visit(dir, rel) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      out.unreadable += 1;
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const childRel = rel ? path.join(rel, entry.name) : entry.name;
      let stat;
      try {
        stat = await fsp.lstat(abs);
      } catch {
        out.unreadable += 1;
        continue;
      }
      out.newestMs = Math.max(out.newestMs, stat.mtimeMs);
      if (stat.isSymbolicLink()) {
        out.links += 1;
      } else if (stat.isDirectory()) {
        out.dirs.push(childRel);
        await visit(abs, childRel);
      } else if (stat.isFile()) {
        out.files.push({ rel: childRel, abs, size: stat.size, mtimeMs: stat.mtimeMs });
        out.totalBytes += stat.size;
      }
    }
  }
  await visit(root, '');
  return out;
}

// Looks at every folder straight inside each project folder and says whether it's ready
// to archive, and why not if it isn't. Nothing is changed.
// Returns { projects: [{ folder, name, parent, ready, reason, message, size, fileCount, newestMs }], missing: [parent] }.
async function findIdleProjects(parents, { idleDays = 30, now = Date.now(), ignored = [], destination = '' } = {}) {
  const projects = [];
  const missing = [];
  const seen = new Set();
  for (const parent of parents) {
    let entries;
    try {
      entries = await fsp.readdir(parent, { withFileTypes: true });
    } catch {
      missing.push(parent);
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folder = path.join(parent, entry.name);
      const key = path.resolve(folder).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const base = { folder, name: entry.name, parent, ready: false, size: 0, fileCount: 0, newestMs: 0 };
      const skip = (reason, message) => projects.push({ ...base, reason, message });

      if (isProtectedPath(folder)) { skip('protected', 'Protected folder, never touched'); continue; }
      if (isIgnored(folder, ignored)) { skip('ignored', 'You asked to leave this one alone'); continue; }
      if (destination && (isInside(destination, folder) || isInside(folder, destination))) {
        skip('archive-folder', 'This is your archive folder, or holds it'); continue;
      }

      const walk = await walkFolder(folder);
      // The folder's own date counts too, so renaming or deleting something inside it does.
      try { walk.newestMs = Math.max(walk.newestMs, (await fsp.stat(folder)).mtimeMs); } catch { /* checked below */ }
      const info = { ...base, size: walk.totalBytes, fileCount: walk.files.length, newestMs: walk.newestMs };
      const sizeText = `${plural(walk.files.length, 'file')}, ${formatSize(walk.totalBytes)}`;

      if (walk.unreadable) projects.push({ ...info, reason: 'unreadable', message: "Some of it couldn't be read, so it's left alone" });
      else if (walk.links) projects.push({ ...info, reason: 'links', message: 'Has links to other folders, so it\'s left alone' });
      else if (!walk.files.length) projects.push({ ...info, reason: 'empty', message: 'Empty, nothing to archive' });
      else if (now - walk.newestMs < idleDays * DAY) {
        projects.push({ ...info, reason: 'recent', message: `Changed ${daysAgo(walk.newestMs, now)} · ${sizeText}` });
      } else {
        projects.push({ ...info, ready: true, reason: 'idle', message: `Last changed ${daysAgo(walk.newestMs, now)} · ${sizeText}` });
      }
    }
  }
  projects.sort((a, b) => Number(b.ready) - Number(a.ready) || b.size - a.size);
  return { projects, missing };
}

// Passes data straight through while hashing it and counting bytes.
function hashTap(onBytes) {
  const hash = crypto.createHash('sha256');
  const tap = new Transform({
    transform(chunk, _enc, done) {
      hash.update(chunk);
      onBytes(chunk.length);
      done(null, chunk);
    },
  });
  tap.digest = () => hash.digest('hex');
  return tap;
}

// Writes the zip. Files go in one at a time (so a big project never opens thousands of
// files at once), each hashed on the way in. Returns Map(zip name -> { size, sha }).
async function writeZip(folder, walk, zipPath, onBytes) {
  const root = path.basename(folder);
  const expected = new Map();
  const output = fs.createWriteStream(zipPath, { flags: 'wx' });
  const archive = archiver('zip', { zlib: { level: 6 } });
  const closed = new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(output);
  // Stops waiting on an entry if the zip fails part way (a full drive, say).
  const failed = new Promise((_, reject) => archive.on('error', reject));
  failed.catch(() => {});

  // Adds one entry and waits until it's fully written before the next.
  const add = (source, data) => {
    const added = new Promise((resolve) => archive.once('entry', resolve));
    archive.append(source, data);
    return Promise.race([added, failed]);
  };

  // Folders are added too, so empty ones come back on a restore.
  for (const dir of walk.dirs) await add(Buffer.alloc(0), { name: `${root}/${toZipName(dir)}/` });
  for (const f of walk.files) {
    const tap = hashTap(onBytes);
    const name = `${root}/${toZipName(f.rel)}`;
    fs.createReadStream(f.abs).on('error', (err) => archive.emit('error', err)).pipe(tap);
    await add(tap, { name, date: new Date(f.mtimeMs), store: STORE_EXTENSIONS.has(path.extname(f.rel).toLowerCase()) });
    expected.set(name, { size: f.size, sha: tap.digest() });
  }
  archive.finalize();
  await Promise.race([closed, failed]);
  return expected;
}

function openZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true, autoClose: true }, (err, zip) => (err ? reject(err) : resolve(zip)));
  });
}

// Reads every entry of a zip, one at a time. onFile(entry, stream) handles each file.
async function eachEntry(zipPath, { onFile, onDir = () => {} }) {
  const zip = await openZip(zipPath);
  await new Promise((resolve, reject) => {
    zip.on('error', reject);
    zip.on('end', resolve);
    zip.on('entry', (entry) => {
      if (entry.fileName.endsWith('/')) {
        Promise.resolve(onDir(entry)).then(() => zip.readEntry(), reject);
        return;
      }
      zip.openReadStream(entry, (err, stream) => {
        if (err) return reject(err);
        Promise.resolve(onFile(entry, stream)).then(() => zip.readEntry(), reject);
      });
    });
    zip.readEntry();
  });
}

// Reads the zip back off the archive drive and checks every file is there, the right
// size, with exactly the same contents as the original. Returns null if it's all fine,
// or what was wrong.
async function verifyZip(zipPath, expected, onBytes = () => {}) {
  const seen = new Set();
  let problem = null;
  await eachEntry(zipPath, {
    onFile: async (entry, stream) => {
      const want = expected.get(entry.fileName);
      const tap = hashTap(onBytes);
      await pipeline(stream, tap, async function* (source) { for await (const _ of source); }); // eslint-disable-line no-unused-vars
      if (!want) problem = problem || `Unexpected file in zip: ${entry.fileName}`;
      else if (entry.uncompressedSize !== want.size) problem = problem || `${entry.fileName} is the wrong size in the zip`;
      else if (tap.digest() !== want.sha) problem = problem || `${entry.fileName} doesn't match the original`;
      seen.add(entry.fileName);
    },
  });
  if (problem) return problem;
  const lost = [...expected.keys()].filter((name) => !seen.has(name));
  return lost.length ? `${plural(lost.length, 'file')} missing from the zip, such as ${lost[0]}` : null;
}

// True if the folder now holds exactly the files it did when it was zipped.
function sameFiles(before, after) {
  if (before.files.length !== after.files.length || after.links || after.unreadable) return false;
  const was = new Map(before.files.map((f) => [f.rel, f]));
  return after.files.every((f) => {
    const old = was.get(f.rel);
    return old && old.size === f.size && old.mtimeMs === f.mtimeMs;
  });
}

async function freeBytes(folder) {
  try {
    const s = await fsp.statfs(folder);
    return s.bavail * s.bsize;
  } catch {
    return Infinity; // Can't tell (some network drives), so don't block on it.
  }
}

// Archives one project folder. Every step that could lose something is checked first:
//  1. it's still unchanged for idleDays, and the archive folder is there with room;
//  2. the zip is written as "<name>.zip.partial" in the archive folder;
//  3. the zip is read back and every file compared with the original;
//  4. the folder is checked again in case anything changed while zipping;
//  5. only then is the zip renamed into place and the original sent to the Recycle Bin.
// If any step fails, the original is left exactly as it was and the partial zip removed.
// trash(folder) does the Recycle Bin bit (Electron's shell.trashItem in the app).
async function archiveFolder(folder, { destination, idleDays = 30, now = Date.now(), trash, dryRun = false, onProgress = () => {} }) {
  const fail = (message) => ({ folder, ok: false, message });
  if (!destination) return fail('Choose an archive folder first');
  if (!fs.existsSync(destination)) return fail('Archive folder not found. Is the drive plugged in?');
  if (!fs.existsSync(folder)) return fail('No longer there');
  if (isInside(destination, folder) || isInside(folder, destination)) return fail('This is your archive folder, or holds it');

  const walk = await walkFolder(folder);
  try { walk.newestMs = Math.max(walk.newestMs, (await fsp.stat(folder)).mtimeMs); } catch { return fail('No longer there'); }
  if (walk.unreadable || walk.links) return fail('Some of it can\'t be read or links elsewhere, so it\'s left alone');
  if (!walk.files.length) return fail('Empty, nothing to archive');
  if (now - walk.newestMs < idleDays * DAY) return fail(`Changed ${daysAgo(walk.newestMs, now)}, so it's not idle any more`);

  const summary = { folder, size: walk.totalBytes, files: walk.files.length };
  if (dryRun) return { ...summary, ok: true, dryRun: true, zip: path.join(destination, `${path.basename(folder)}.zip`) };

  if (await freeBytes(destination) < walk.totalBytes + SPACE_MARGIN) {
    return fail(`Not enough space in the archive folder (needs about ${formatSize(walk.totalBytes)})`);
  }

  const zipPath = uniquePath(destination, `${path.basename(folder)}.zip`);
  const partial = `${zipPath}.partial`;
  const total = walk.totalBytes * 2; // written once, read back once
  let done = 0;
  const progress = (stage) => (n) => { done += n; onProgress({ folder, stage, done, total }); };

  try {
    onProgress({ folder, stage: 'zipping', done: 0, total });
    const expected = await writeZip(folder, walk, partial, progress('zipping'));
    onProgress({ folder, stage: 'checking', done, total });
    const problem = await verifyZip(partial, expected, progress('checking'));
    if (problem) throw new Error(`The zip didn't check out (${problem}). The original is untouched.`);
    if (!sameFiles(walk, await walkFolder(folder))) {
      throw new Error('Something in the folder changed while it was being zipped. The original is untouched.');
    }
    await fsp.rename(partial, zipPath);
  } catch (err) {
    await fsp.rm(partial, { force: true }).catch(() => {});
    const message = err.code === 'ENOSPC' ? 'The archive drive filled up. The original is untouched.'
      : ['EBUSY', 'EPERM', 'EACCES'].includes(err.code) ? 'A file is open in another app, or the archive folder is read-only. The original is untouched.'
      : err.code === 'ENOENT' ? 'A file went missing while zipping. The original is untouched.'
      : err.message;
    return fail(message);
  }

  onProgress({ folder, stage: 'binning', done: total, total });
  try {
    await trash(folder);
    return { ...summary, ok: true, zip: zipPath, originalRemoved: true };
  } catch {
    return {
      ...summary, ok: true, zip: zipPath, originalRemoved: false,
      message: "Zipped and checked, but the original couldn't go to the Recycle Bin. Close anything using it and remove it yourself.",
    };
  }
}

// Unzips an archive back to where the folder was. If something is already there, it goes
// next to it as "<name> (restored)". Unzips into a temporary folder first, so a failure
// never leaves half a project behind. Returns the folder it restored to.
async function restoreArchive(zipPath, originalFolder) {
  const parent = path.dirname(originalFolder);
  await fsp.mkdir(parent, { recursive: true });
  let target = originalFolder;
  for (let n = 1; fs.existsSync(target); n += 1) {
    target = path.join(parent, `${path.basename(originalFolder)} (restored${n > 1 ? ` ${n}` : ''})`);
  }
  const temp = `${target}.restoring`;
  await fsp.rm(temp, { recursive: true, force: true });
  await fsp.mkdir(temp);

  // Entry names are "<project>/<path inside>". The first part is dropped, and anything
  // that would land outside the folder (a "zip slip") is refused.
  const destFor = (fileName) => {
    const inner = fileName.split('/').slice(1).join(path.sep);
    const dest = path.resolve(temp, inner);
    if (!isInside(dest, temp)) throw new Error(`Unsafe path in zip: ${fileName}`);
    return dest;
  };

  try {
    await eachEntry(zipPath, {
      onDir: (entry) => fsp.mkdir(destFor(entry.fileName), { recursive: true }),
      onFile: async (entry, stream) => {
        const dest = destFor(entry.fileName);
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await pipeline(stream, fs.createWriteStream(dest, { flags: 'wx' }));
        const date = entry.getLastModDate();
        await fsp.utimes(dest, date, date).catch(() => {});
      },
    });
    await fsp.rename(temp, target);
  } catch (err) {
    await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
  return target;
}

module.exports = {
  walkFolder, findIdleProjects, archiveFolder, restoreArchive, verifyZip, writeZip, formatSize, isInside, samePath,
};
