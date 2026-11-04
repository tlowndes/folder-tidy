'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Config } = require('./lib/config');
const { History } = require('./lib/history');
const { Watcher } = require('./lib/watcher');
const { undoEntry, applyPlan } = require('./lib/organiser');
const { scanFolders, suggestRules, explainFile } = require('./lib/scan');
const { Updater } = require('./lib/updater');
const { NEEDS_LOOK, isDue, buildDigest } = require('./lib/digest');
const { findClutter } = require('./lib/clutter');
const { isProtectedPath } = require('./lib/safety');
const { buildStats, trimFreed } = require('./lib/stats');
const { junkCategories, scanJunk, cleanJunk, findBigFiles, MB } = require('./lib/cleaner');
const { recycleBinInfo, emptyRecycleBin } = require('./lib/recyclebin');
const { findIdleProjects, archiveFolder, restoreArchive, formatSize } = require('./lib/archive');

const DATA_DIR = path.join(app.getPath('appData'), 'folder-tidy');
const DEFAULT_SOURCES = [
  path.join(os.homedir(), 'Downloads'),
  path.join(os.homedir(), 'Documents'),
];

// Matches build.appId, so Windows ties notifications and the taskbar entry to the app's icon.
if (process.platform === 'win32') app.setAppUserModelId('uk.co.tomlowndes.foldertidy');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const config = new Config(path.join(DATA_DIR, 'config.json'), DEFAULT_SOURCES);
const history = new History(path.join(DATA_DIR, 'history.json'), config.data.settings.historyDays);
let win = null;
let tray = null;
let rebuildTray = () => {};

// .ico holds every size, so Windows picks a crisp one for the tray at any display scale.
const ICON_PATH = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const TRAY_ICON_PATH = process.platform === 'win32' ? ICON_PATH : path.join(__dirname, 'assets', 'tray.png');

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body });
  if (onClick) n.on('click', onClick);
  n.show();
}

// Dry-run moves aren't in the history, so the digest counts them here.
let dryRunCount = 0;

// Sends the daily summary once its time has passed. Checked every minute.
function sendDigestIfDue(now = Date.now()) {
  const { notifications, digestTime, digestLastSent } = config.data.settings;
  if (notifications !== 'daily' || !isDue(now, digestTime, digestLastSent)) return;
  const since = digestLastSent ? new Date(digestLastSent).getTime() : now - 24 * 60 * 60 * 1000;
  const moves = history.entries.filter((e) => new Date(e.time).getTime() > since);
  let needsLook = 0;
  try {
    needsLook = scanFolders(config.data.sources, config.data.rules, { ignored: config.data.ignored }).filter((r) => NEEDS_LOOK.includes(r.reason)).length;
  } catch (err) {
    console.error('[folder-tidy] digest scan', err);
  }
  const digest = buildDigest({ moves, dryRunCount, needsLook, rules: config.data.rules });
  if (digest) notify(digest.title, digest.body, () => (needsLook ? showCheck() : showPage('history')));
  dryRunCount = 0;
  config.data.settings.digestLastSent = new Date(now).toISOString();
  config.save();
}

function refreshUi() {
  rebuildTray();
  if (win && !win.isDestroyed()) win.webContents.send('state-changed');
}

const watcher = new Watcher({
  getRules: () => config.data.rules,
  getSettings: () => config.data.settings,
  getIgnored: () => config.data.ignored,
  history,
  onMove: (result) => {
    refreshUi();
    const mode = config.data.settings.notifications;
    if (mode !== 'each') {
      if (result.dryRun) dryRunCount += 1;
      return;
    }
    if (result.dryRun) {
      notify('Folder Tidy (dry run)', `Would move ${path.basename(result.from)} to ${result.destDir}`);
    } else {
      notify('Folder Tidy', `Moved ${path.basename(result.to)} to ${result.destDir}`);
    }
  },
  onError: (err) => console.error('[folder-tidy]', err),
});

const updater = new Updater({
  app,
  notify,
  isEnabled: () => config.data.settings.autoUpdate,
  onChange: () => { rebuildTray(); refreshUi(); },
});

function startWatching() {
  watcher.start(config.data.sources);
}

// Common folders worth offering with one click, if they aren't watched yet. Desktop moved
// into OneDrive counts as protected, so it isn't offered then.
function suggestedSources() {
  const watched = config.data.sources.map((s) => path.resolve(s.path).toLowerCase());
  return ['desktop'].map((name) => {
    try { return app.getPath(name); } catch { return null; }
  }).filter((p) => p && fs.existsSync(p) && !isProtectedPath(p) && !watched.includes(path.resolve(p).toLowerCase()));
}

function state() {
  return {
    suggestedSources: suggestedSources(),
    sources: config.data.sources,
    rules: config.data.rules,
    settings: config.data.settings,
    paused: watcher.paused,
    recent: history.entries.slice(0, 50),
    update: { status: updater.status, version: updater.version, current: app.getVersion() },
    archive: { ...config.data.archive, busy: archiveBusy },
    cleaner: { ...config.data.cleaner, searching: bigFolders() },
    stats: buildStats({
      moves: history.entries, freed: config.data.freed, archived: config.data.archive.log,
      rules: config.data.rules, sources: config.data.sources,
    }),
  };
}

function undoById(id) {
  const entry = history.get(id);
  if (!entry) return { ok: false, reason: 'Not found' };
  const result = undoEntry(entry, history);
  refreshUi();
  return result;
}

// Files the last check offered to bin, with their sizes. Only these can be binned, so the
// UI can never send anything else to the Recycle Bin.
let lastClutter = new Map();

// Notes space given back, for the This week page.
function logFreed(bytes, kind) {
  if (!bytes) return;
  config.data.freed = trimFreed([{ time: new Date().toISOString(), bytes, kind }, ...config.data.freed]);
  config.save();
}

// Where clutter is looked for: the watched folders, plus the Installers rule's folder.
function clutterFolders() {
  const folders = config.data.sources.filter((s) => s.enabled).map((s) => s.path);
  const installers = config.data.rules.find((r) => r.id === 'installers' && r.enabled && r.destination);
  if (installers) folders.push(installers.destination);
  return folders;
}

// Looks at every file in the watched folders now, without moving anything.
function checkNow() {
  // Forget ignored files that are gone, so the list doesn't grow for ever.
  config.data.ignored = config.data.ignored.filter((p) => fs.existsSync(p));
  const results = scanFolders(config.data.sources, config.data.rules, { ignored: config.data.ignored });
  let clutter = [];
  try {
    clutter = findClutter(clutterFolders(), { ignored: config.data.ignored });
  } catch (err) {
    console.error('[folder-tidy] clutter', err);
  }
  lastClutter = new Map(clutter.map((c) => [c.file, c.size]));
  return {
    time: new Date().toISOString(),
    dryRun: config.data.settings.dryRun,
    clutter,
    // Clutter is offered for the bin instead, so it isn't also offered for a move.
    toMove: results.filter((r) => r.action === 'move' && !lastClutter.has(r.file)),
    skipped: results.filter((r) => r.action === 'skip'),
    suggestions: suggestRules(results, config.data.rules),
  };
}

// Moves the files picked from a check. Each one is checked again first, as things may
// have changed since the preview. Returns what happened to each file.
function moveChecked(files) {
  const { dryRun } = config.data.settings;
  const watched = config.data.sources.filter((s) => s.enabled).map((s) => path.resolve(s.path).toLowerCase());
  const results = files.map((file) => {
    // Only files straight inside a watched folder, which is all a check ever offers.
    if (!watched.includes(path.resolve(path.dirname(file)).toLowerCase())) {
      return { file, ok: false, message: 'Not in a watched folder' };
    }
    try {
      const plan = explainFile(file, config.data.rules, { ignored: config.data.ignored });
      if (plan.action !== 'move') return { file, ok: false, message: plan.message };
      const done = applyPlan({ from: file, destDir: plan.destDir, ruleId: plan.ruleId, name: plan.name, size: plan.size }, { dryRun, history });
      return { file, ok: true, to: done.to, dryRun };
    } catch (err) {
      const message = err.code === 'ENOENT' ? 'No longer there'
        : ['EBUSY', 'EPERM', 'EACCES'].includes(err.code) ? 'Open in another app, or read-only'
        : err.message;
      return { file, ok: false, message };
    }
  });
  refreshUi();
  const moved = results.filter((r) => r.ok).length;
  if (moved) notify('Folder Tidy', dryRun ? `Dry run: would move ${moved} files` : `Moved ${moved} files`);
  return results;
}

// Sends files from the last check to the Recycle Bin, so they can still be restored.
async function binFiles(files) {
  const { dryRun } = config.data.settings;
  const results = [];
  let bytes = 0;
  for (const file of files) {
    if (!lastClutter.has(file)) {
      results.push({ file, ok: false, message: 'Not offered by the last check' });
      continue;
    }
    if (dryRun) {
      results.push({ file, ok: true, dryRun });
      continue;
    }
    try {
      await shell.trashItem(file);
      bytes += lastClutter.get(file) || 0;
      lastClutter.delete(file);
      results.push({ file, ok: true });
    } catch (err) {
      results.push({ file, ok: false, message: /no such file|ENOENT/i.test(err.message) ? 'No longer there' : 'Open in another app, or read-only' });
    }
  }
  logFreed(bytes, 'clutter');
  const binned = results.filter((r) => r.ok).length;
  if (binned) notify('Folder Tidy', dryRun ? `Dry run: would bin ${binned} files` : `Sent ${binned} files to the Recycle Bin`);
  return results;
}

// ---------- Disk cleaner ----------

let cleanBusy = false;
// Big files the last scan offered. Only these can be binned from the Clean page.
let lastBig = new Map();

function cleanProgress(stage, count) {
  if (win && !win.isDestroyed()) win.webContents.send('clean-progress', { stage, count });
}

async function busyGuard(fn) {
  if (cleanBusy) return { busy: true };
  cleanBusy = true;
  try { return await fn(); } finally { cleanBusy = false; cleanProgress(null, 0); }
}

function scanJunkNow() {
  return busyGuard(async () => {
    const categories = await scanJunk(junkCategories(), { onProgress: (n) => cleanProgress('junk', n) });
    return { time: new Date().toISOString(), dryRun: config.data.settings.dryRun, categories, recycleBin: await recycleBinInfo() };
  });
}

function cleanJunkNow(ids) {
  return busyGuard(async () => {
    const { dryRun } = config.data.settings;
    const results = await cleanJunk(junkCategories(), ids, { dryRun });
    const freed = results.reduce((sum, r) => sum + (r.freed || 0), 0);
    if (!dryRun) logFreed(freed, 'cleaner');
    if (freed) notify('Folder Tidy', dryRun ? `Dry run: would clear ${formatSize(freed)}` : `Cleared ${formatSize(freed)} of junk`);
    refreshUi();
    return results;
  });
}

async function emptyBinNow() {
  if (config.data.settings.dryRun) return { ok: true, dryRun: true };
  const before = await recycleBinInfo();
  const result = await emptyRecycleBin();
  if (result.ok) {
    logFreed(before.size, 'cleaner');
    if (before.size) notify('Folder Tidy', `Emptied the Recycle Bin (${formatSize(before.size)})`);
    refreshUi();
  }
  return result;
}

function bigFolders() {
  const chosen = config.data.cleaner.bigFolders;
  return chosen.length ? chosen : [os.homedir()];
}

function scanBigNow() {
  return busyGuard(async () => {
    const minBytes = Math.max(1, Number(config.data.cleaner.bigFileMB) || 500) * MB;
    const result = await findBigFiles(bigFolders(), { minBytes, onProgress: (n) => cleanProgress('big', n) });
    lastBig = new Map(result.files.map((f) => [f.file, f.size]));
    return { ...result, time: new Date().toISOString(), dryRun: config.data.settings.dryRun, searched: bigFolders() };
  });
}

async function binBigFiles(files) {
  const { dryRun } = config.data.settings;
  const results = [];
  let bytes = 0;
  for (const file of files) {
    if (!lastBig.has(file)) { results.push({ file, ok: false, message: 'Not offered by the last scan' }); continue; }
    if (dryRun) { results.push({ file, ok: true, dryRun }); continue; }
    try {
      await shell.trashItem(file);
      bytes += lastBig.get(file);
      lastBig.delete(file);
      results.push({ file, ok: true });
    } catch (err) {
      results.push({ file, ok: false, message: /no such file|ENOENT/i.test(err.message) ? 'No longer there' : 'Open in another app, or read-only' });
    }
  }
  logFreed(bytes, 'cleaner');
  if (bytes) notify('Folder Tidy', `Sent ${formatSize(bytes)} to the Recycle Bin. Empty it to free the space.`);
  refreshUi();
  return results;
}

// ---------- Cold storage ----------

const folderKey = (p) => path.resolve(p).toLowerCase();
// Folders the last archive check offered. Only these can be archived, so the UI can never
// zip and bin anything else.
let lastArchiveOffer = new Set();
let archiveBusy = false;
let archiveChecking = false;

async function archiveScan() {
  const a = config.data.archive;
  const { projects, missing } = await findIdleProjects(a.parents, { idleDays: a.idleDays, ignored: a.ignored, destination: a.destination });
  lastArchiveOffer = new Set(projects.filter((p) => p.ready).map((p) => folderKey(p.folder)));
  return {
    time: new Date().toISOString(),
    dryRun: config.data.settings.dryRun,
    projects,
    missingParents: missing,
    destinationMissing: !!a.destination && !fs.existsSync(a.destination),
  };
}

// Zips, checks and bins the folders picked from the last archive check, one at a time.
async function archiveFolders(folders) {
  if (archiveBusy) return folders.map((folder) => ({ folder, ok: false, message: 'Already archiving, try again in a moment' }));
  archiveBusy = true;
  refreshUi();
  const a = config.data.archive;
  const { dryRun } = config.data.settings;
  const results = [];
  let lastSent = 0;
  const onProgress = (p) => {
    const now = Date.now();
    if (p.stage === 'zipping' && p.done && now - lastSent < 150) return;
    lastSent = now;
    if (win && !win.isDestroyed()) win.webContents.send('archive-progress', p);
  };
  try {
    for (const folder of folders) {
      if (!lastArchiveOffer.has(folderKey(folder))) {
        results.push({ folder, ok: false, message: 'Not offered by the last check' });
        continue;
      }
      const result = await archiveFolder(folder, {
        destination: a.destination, idleDays: a.idleDays, dryRun, onProgress, trash: (f) => shell.trashItem(f),
      });
      if (result.ok && !result.dryRun) {
        lastArchiveOffer.delete(folderKey(folder));
        a.log.unshift({
          id: crypto.randomUUID(), time: new Date().toISOString(), folder, zip: result.zip,
          size: result.size, files: result.files, originalRemoved: result.originalRemoved,
        });
        a.log = a.log.slice(0, 200);
        config.save();
      }
      results.push(result);
    }
  } finally {
    archiveBusy = false;
    refreshUi();
  }
  const done = results.filter((r) => r.ok);
  if (done.length) {
    const size = formatSize(done.reduce((sum, r) => sum + r.size, 0));
    notify('Folder Tidy', dryRun ? `Dry run: would archive ${done.length} folders (${size})` : `Archived ${done.length} ${done.length === 1 ? 'folder' : 'folders'} (${size})`);
  }
  return results;
}

async function restoreById(id) {
  const entry = config.data.archive.log.find((e) => e.id === id);
  if (!entry) return { ok: false, message: 'Not found' };
  if (!fs.existsSync(entry.zip)) return { ok: false, message: 'Zip not found. Is the archive drive plugged in?' };
  try {
    const to = await restoreArchive(entry.zip, entry.folder);
    entry.restoredTo = to;
    entry.restoredAt = new Date().toISOString();
    config.save();
    refreshUi();
    return { ok: true, to };
  } catch (err) {
    return { ok: false, message: err.code === 'ENOSPC' ? 'Not enough space to restore it' : err.message };
  }
}

// Once a day, looks for idle projects and asks before doing anything with them.
async function archiveCheckIfDue(now = Date.now()) {
  const a = config.data.archive;
  if (!a.dailyCheck || !a.parents.length || !a.destination || archiveBusy || archiveChecking) return;
  if (!isDue(now, a.checkTime, a.lastChecked)) return;
  archiveChecking = true;
  try {
    const scan = await archiveScan();
    const ready = scan.projects.filter((p) => p.ready);
    if (ready.length) {
      const size = formatSize(ready.reduce((sum, p) => sum + p.size, 0));
      const what = ready.length === 1 ? `"${ready[0].name}" hasn't` : `${ready.length} project folders haven't`;
      const drive = scan.destinationMissing ? ' Plug in your archive drive first.' : '';
      notify('Ready for the archive', `${what} changed in ${a.idleDays} days (${size}). Review and archive?${drive}`, () => showArchive());
    }
  } catch (err) {
    console.error('[folder-tidy] archive check', err);
  } finally {
    a.lastChecked = new Date(now).toISOString();
    config.save();
    archiveChecking = false;
  }
}

function showArchive() {
  win.show();
  win.focus();
  win.webContents.send('run-archive-scan');
}

function showCheck() {
  win.show();
  win.focus();
  win.webContents.send('run-check');
}

function showPage(page) {
  win.show();
  win.focus();
  win.webContents.send('show-page', page);
}

function setLoginItem(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled });
}

function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 760,
    minHeight: 520,
    title: 'Folder Tidy',
    icon: ICON_PATH,
    backgroundColor: '#f6f6f6',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.on('close', (e) => {
    // Closing the window hides it; the app keeps running in the tray.
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(TRAY_ICON_PATH);
  if (icon.isEmpty()) console.warn(`Tray icon not found at ${TRAY_ICON_PATH}`);
  tray = new Tray(icon);
  tray.setToolTip('Folder Tidy');
  const rebuild = rebuildTray = () => {
    const today = history.movedToday();
    const summary = today === 0 ? 'Nothing tidied yet today' : `${today} ${today === 1 ? 'file' : 'files'} tidied today`;
    tray.setToolTip(`Folder Tidy · ${watcher.paused ? 'Paused' : summary}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: summary, enabled: false },
      { type: 'separator' },
      { label: 'Open', click: () => { win.show(); win.focus(); } },
      { label: watcher.paused ? 'Resume' : 'Pause', click: () => { watcher.paused ? watcher.resume() : watcher.pause(); rebuild(); refreshUi(); } },
      { label: 'Check now', click: () => showCheck() },
      { label: 'Archive old projects', click: () => showArchive() },
      { label: 'Undo last move', click: () => {
        const last = history.undoable(1)[0];
        if (last) undoById(last.id);
        else notify('Folder Tidy', 'Nothing to undo');
      } },
      { type: 'separator' },
      updater.status === 'ready'
        ? { label: `Restart to update (${updater.version})`, click: () => updater.installNow() }
        : { label: 'Check for updates', click: () => updater.check(true) },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
    ]));
  };
  rebuild();
  tray.on('click', () => { win.show(); win.focus(); });
}

ipcMain.handle('get-state', () => state());
ipcMain.handle('set-paused', (_e, paused) => {
  paused ? watcher.pause() : watcher.resume();
  refreshUi();
  return state();
});
ipcMain.handle('save-rules', (_e, rules) => {
  config.data.rules = rules;
  config.save();
  return state();
});
ipcMain.handle('save-sources', (_e, sources) => {
  config.data.sources = sources;
  config.save();
  startWatching();
  return state();
});
ipcMain.handle('save-settings', (_e, settings) => {
  config.data.settings = { ...config.data.settings, ...settings };
  config.save();
  setLoginItem(config.data.settings.startWithWindows);
  return state();
});
ipcMain.handle('undo', (_e, id) => undoById(id));
ipcMain.handle('check-now', () => checkNow());
ipcMain.handle('check-updates', () => { updater.check(true); return state(); });
ipcMain.handle('install-update', () => updater.installNow());
ipcMain.handle('move-checked', (_e, files) => moveChecked(files));
ipcMain.handle('bin-files', (_e, files) => binFiles(files));
// Leave a file alone from now on (or stop ignoring it), then check again.
ipcMain.handle('set-ignored', (_e, file, ignore) => {
  const others = config.data.ignored.filter((p) => path.resolve(p).toLowerCase() !== path.resolve(file).toLowerCase());
  config.data.ignored = ignore ? [...others, file] : others;
  config.save();
  return checkNow();
});
ipcMain.handle('open-folder', (_e, folder) => shell.openPath(folder));
ipcMain.handle('show-item', (_e, file) => shell.showItemInFolder(file));
ipcMain.handle('save-archive', (_e, patch) => {
  const allowed = ['parents', 'destination', 'idleDays', 'dailyCheck', 'checkTime'];
  for (const k of allowed) if (k in patch) config.data.archive[k] = patch[k];
  config.data.archive.idleDays = Math.max(1, Math.round(Number(config.data.archive.idleDays) || 30));
  config.save();
  return state();
});
ipcMain.handle('clean-scan-junk', () => scanJunkNow());
ipcMain.handle('clean-junk', (_e, ids) => cleanJunkNow(ids));
ipcMain.handle('empty-bin', () => emptyBinNow());
ipcMain.handle('clean-scan-big', () => scanBigNow());
ipcMain.handle('clean-bin-big', (_e, files) => binBigFiles(files));
ipcMain.handle('save-cleaner', (_e, patch) => {
  const c = config.data.cleaner;
  if ('bigFolders' in patch) c.bigFolders = patch.bigFolders.filter((p) => typeof p === 'string');
  if ('bigFileMB' in patch) c.bigFileMB = Math.max(1, Math.round(Number(patch.bigFileMB) || 500));
  config.save();
  return state();
});
ipcMain.handle('archive-scan', () => archiveScan());
ipcMain.handle('archive-run', (_e, folders) => archiveFolders(folders));
ipcMain.handle('archive-restore', (_e, id) => restoreById(id));
// Leave a project folder alone from now on (or stop), then check again.
ipcMain.handle('archive-ignore', (_e, folder, ignore) => {
  const a = config.data.archive;
  const others = a.ignored.filter((p) => folderKey(p) !== folderKey(folder));
  a.ignored = ignore ? [...others, folder] : others;
  config.save();
  return archiveScan();
});
ipcMain.handle('pick-folder', async (_e, title) => {
  const result = await dialog.showOpenDialog(win, {
    title: title || 'Choose a folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  startWatching();
  setLoginItem(config.data.settings.startWithWindows);
  updater.start();
  sendDigestIfDue();
  setInterval(() => { sendDigestIfDue(); archiveCheckIfDue(); rebuildTray(); }, 60 * 1000);
  // A little after start-up, so it doesn't slow the app opening.
  setTimeout(() => archiveCheckIfDue(), 30 * 1000);
  app.on('activate', () => { win.show(); });
});

app.on('second-instance', () => {
  if (win) { win.show(); win.focus(); }
});

app.on('before-quit', () => {
  watcher.stop();
  updater.stop();
  config.save();
});
