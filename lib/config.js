'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFAULT_RULES } = require('./rules');

const DEFAULT_SETTINGS = {
  startWithWindows: false,
  delaySeconds: 300,
  dryRun: false,
  historyDays: 30,
};

// Where each default rule sends files. Rules without an entry keep an empty destination,
// which means "do nothing" until the user sets one.
function defaultRules(home = os.homedir()) {
  const destinations = {
    images: path.join(home, 'Pictures', 'Downloads'),
    documents: path.join(home, 'Documents', 'Sorted'),
    installers: path.join(home, 'Downloads', 'Installers'),
    archives: path.join(home, 'Documents', 'Archives'),
    video: path.join(home, 'Videos'),
    audio: path.join(home, 'Music'),
  };
  return DEFAULT_RULES.map((r) => ({ ...r, destination: destinations[r.id] || '' }));
}

// Reads and writes config.json. Missing or broken files fall back to the defaults.
class Config {
  constructor(filePath, defaultSources) {
    this.filePath = filePath;
    this.data = this.load(defaultSources);
  }

  load(defaultSources) {
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      saved = {};
    }
    return {
      sources: saved.sources || defaultSources.map((p) => ({ path: p, enabled: true })),
      rules: saved.rules || defaultRules(),
      settings: { ...DEFAULT_SETTINGS, ...(saved.settings || {}) },
    };
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }
}

module.exports = { Config, DEFAULT_SETTINGS, defaultRules };
