'use strict';

const chokidar = require('chokidar');
const { planFile, applyPlan } = require('./organiser');
const { isProtectedPath, isTopLevel } = require('./safety');

// Watches the enabled source folders and tidies new files after a delay.
// Existing files are left alone (ignoreInitial), so only new downloads or saves are moved.
// Only the top level of each folder is watched, the same as Check now.
class Watcher {
  constructor({ getRules, getSettings, history, onMove, onError }) {
    this.getRules = getRules;
    this.getSettings = getSettings;
    this.history = history;
    this.onMove = onMove || (() => {});
    this.onError = onError || (() => {});
    this.watcher = null;
    this.timers = new Map();
    this.paused = false;
    this.folders = [];
  }

  start(sources) {
    this.stop();
    const folders = sources.filter((s) => s.enabled).map((s) => s.path);
    this.folders = folders;
    if (folders.length === 0) return;

    this.watcher = chokidar.watch(folders, {
      ignoreInitial: true,
      depth: 0,
      ignored: (p) => isProtectedPath(p),
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 200 },
    });
    this.watcher.on('add', (filePath) => this.schedule(filePath));
    this.watcher.on('error', (err) => this.onError(err));
  }

  stop() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  schedule(filePath) {
    if (this.paused) return;
    if (!isTopLevel(filePath, this.folders)) return;
    const { delaySeconds } = this.getSettings();
    clearTimeout(this.timers.get(filePath));
    const timer = setTimeout(() => {
      this.timers.delete(filePath);
      this.process(filePath);
    }, delaySeconds * 1000);
    this.timers.set(filePath, timer);
  }

  process(filePath) {
    try {
      const plan = planFile(filePath, this.getRules());
      if (!plan) return;
      const result = applyPlan(plan, { dryRun: this.getSettings().dryRun, history: this.history });
      this.onMove(result);
    } catch (err) {
      this.onError(err);
    }
  }
}

module.exports = { Watcher };
