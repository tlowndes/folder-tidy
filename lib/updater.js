'use strict';

// Checks GitHub Releases for a newer version, downloads it in the background and
// installs it the next time the app quits. Only runs in the installed app: the dev
// build and the portable exe can't update themselves.
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

function canUpdate(app, env = process.env) {
  return app.isPackaged && !env.PORTABLE_EXECUTABLE_DIR;
}

class Updater {
  constructor({ app, notify, isEnabled, onChange }) {
    this.app = app;
    this.notify = notify;
    this.isEnabled = isEnabled;
    this.onChange = onChange || (() => {});
    this.status = canUpdate(app) ? 'idle' : 'unavailable';
    this.version = null;
    this.timer = null;
    this.manual = false;
    this.autoUpdater = null;
  }

  start() {
    if (this.status === 'unavailable') return;
    // Loaded here so the dev build and tests never need it.
    const { autoUpdater } = require('electron-updater');
    this.autoUpdater = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => this.set('checking'));
    autoUpdater.on('update-not-available', () => {
      this.set('up-to-date');
      if (this.manual) this.notify('Folder Tidy', `You're on the latest version (${this.app.getVersion()}).`);
      this.manual = false;
    });
    autoUpdater.on('update-available', (info) => this.set('downloading', info.version));
    autoUpdater.on('update-downloaded', (info) => {
      this.set('ready', info.version);
      this.notify('Folder Tidy update ready', `Version ${info.version} installs next time Folder Tidy restarts.`);
      this.manual = false;
    });
    autoUpdater.on('error', (err) => {
      console.error('[folder-tidy] update', err);
      this.set('error');
      if (this.manual) this.notify('Folder Tidy', "Couldn't check for updates. Try again later.");
      this.manual = false;
    });

    if (this.isEnabled()) this.check();
    this.timer = setInterval(() => { if (this.isEnabled()) this.check(); }, CHECK_EVERY_MS);
  }

  // manual = the user asked, so tell them the result even if there's nothing new.
  check(manual = false) {
    if (!this.autoUpdater) {
      if (manual) this.notify('Folder Tidy', 'Updates only work in the installed app.');
      return;
    }
    if (['checking', 'downloading'].includes(this.status)) return;
    if (this.status === 'ready') {
      if (manual) this.notify('Folder Tidy', `Version ${this.version} is ready. Restart to install it.`);
      return;
    }
    this.manual = manual;
    this.autoUpdater.checkForUpdates().catch(() => {});
  }

  installNow() {
    if (this.status !== 'ready') return;
    this.app.isQuitting = true;
    this.autoUpdater.quitAndInstall();
  }

  set(status, version = this.version) {
    this.status = status;
    this.version = version;
    this.onChange();
  }

  stop() {
    clearInterval(this.timer);
  }
}

module.exports = { Updater, canUpdate };
