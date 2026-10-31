'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const os = require('os');
const { Config } = require('./lib/config');
const { History } = require('./lib/history');
const { Watcher } = require('./lib/watcher');
const { undoEntry, applyPlan } = require('./lib/organiser');
const { scanFolders, suggestRules, explainFile } = require('./lib/scan');
const { Updater } = require('./lib/updater');
const { NEEDS_LOOK, isDue, buildDigest } = require('./lib/digest');

const DATA_DIR = path.join(app.getPath('appData'), 'folder-tidy');
const DEFAULT_SOURCES = [
  path.join(os.homedir(), 'Downloads'),
  path.join(os.homedir(), 'Documents'),
];

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const config = new Config(path.join(DATA_DIR, 'config.json'), DEFAULT_SOURCES);
const history = new History(path.join(DATA_DIR, 'history.json'), config.data.settings.historyDays);
let win = null;
let tray = null;
let rebuildTray = () => {};

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
    needsLook = scanFolders(config.data.sources, config.data.rules).filter((r) => NEEDS_LOOK.includes(r.reason)).length;
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
  if (win && !win.isDestroyed()) win.webContents.send('state-changed');
}

const watcher = new Watcher({
  getRules: () => config.data.rules,
  getSettings: () => config.data.settings,
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

function state() {
  return {
    sources: config.data.sources,
    rules: config.data.rules,
    settings: config.data.settings,
    paused: watcher.paused,
    recent: history.entries.slice(0, 50),
    update: { status: updater.status, version: updater.version, current: app.getVersion() },
  };
}

function undoById(id) {
  const entry = history.get(id);
  if (!entry) return { ok: false, reason: 'Not found' };
  const result = undoEntry(entry, history);
  refreshUi();
  return result;
}

// Looks at every file in the watched folders now, without moving anything.
function checkNow() {
  const results = scanFolders(config.data.sources, config.data.rules);
  return {
    time: new Date().toISOString(),
    dryRun: config.data.settings.dryRun,
    toMove: results.filter((r) => r.action === 'move'),
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
      const plan = explainFile(file, config.data.rules);
      if (plan.action !== 'move') return { file, ok: false, message: plan.message };
      const done = applyPlan({ from: file, destDir: plan.destDir, ruleId: plan.ruleId }, { dryRun, history });
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
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Folder Tidy');
  const rebuild = rebuildTray = () => {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open', click: () => { win.show(); win.focus(); } },
      { label: watcher.paused ? 'Resume' : 'Pause', click: () => { watcher.paused ? watcher.resume() : watcher.pause(); rebuild(); refreshUi(); } },
      { label: 'Check now', click: () => showCheck() },
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
ipcMain.handle('open-folder', (_e, folder) => shell.openPath(folder));
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
  setInterval(() => sendDigestIfDue(), 60 * 1000);
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
