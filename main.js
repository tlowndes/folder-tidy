'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const os = require('os');
const { Config } = require('./lib/config');
const { History } = require('./lib/history');
const { Watcher } = require('./lib/watcher');
const { undoEntry } = require('./lib/organiser');

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

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body }).show();
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
    if (result.dryRun) {
      notify('Folder Tidy (dry run)', `Would move ${path.basename(result.from)} to ${result.destDir}`);
    } else {
      notify('Folder Tidy', `Moved ${path.basename(result.to)} to ${result.destDir}`);
    }
  },
  onError: (err) => console.error('[folder-tidy]', err),
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
  };
}

function undoById(id) {
  const entry = history.get(id);
  if (!entry) return { ok: false, reason: 'Not found' };
  const result = undoEntry(entry, history);
  refreshUi();
  return result;
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
  const rebuild = () => {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open', click: () => { win.show(); win.focus(); } },
      { label: watcher.paused ? 'Resume' : 'Pause', click: () => { watcher.paused ? watcher.resume() : watcher.pause(); rebuild(); refreshUi(); } },
      { label: 'Undo last move', click: () => {
        const last = history.undoable(1)[0];
        if (last) undoById(last.id);
        else notify('Folder Tidy', 'Nothing to undo');
      } },
      { type: 'separator' },
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
  app.on('activate', () => { win.show(); });
});

app.on('second-instance', () => {
  if (win) { win.show(); win.focus(); }
});

app.on('before-quit', () => {
  watcher.stop();
  config.save();
});
