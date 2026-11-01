'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_DAYS = 30;

// A JSON-backed log of moves. Each entry records where a file came from and went to,
// so it can be moved back. Entries older than `days` are dropped when the log is saved.
class History {
  constructor(filePath, days = DEFAULT_DAYS, now = () => Date.now()) {
    this.filePath = filePath;
    this.days = days;
    this.now = now;
    this.entries = this.load();
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      return [];
    }
  }

  save() {
    const cutoff = this.now() - this.days * 24 * 60 * 60 * 1000;
    this.entries = this.entries.filter((e) => new Date(e.time).getTime() >= cutoff);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2));
  }

  add({ from, to, ruleId }) {
    const entry = {
      id: crypto.randomUUID(),
      time: new Date(this.now()).toISOString(),
      from,
      to,
      ruleId,
      undone: false,
    };
    this.entries.unshift(entry);
    this.save();
    return entry;
  }

  get(id) {
    return this.entries.find((e) => e.id === id) || null;
  }

  markUndone(id) {
    const entry = this.get(id);
    if (entry) {
      entry.undone = true;
      this.save();
    }
    return entry;
  }

  // How many files were moved since midnight and not undone.
  movedToday(now = this.now()) {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    return this.entries.filter((e) => !e.undone && new Date(e.time) >= midnight).length;
  }

  // Most recent entries that can still be undone.
  undoable(limit = Infinity) {
    return this.entries.filter((e) => !e.undone).slice(0, limit);
  }
}

module.exports = { History, DEFAULT_DAYS };
