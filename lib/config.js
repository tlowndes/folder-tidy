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
  autoUpdate: true,
  notifications: 'daily', // 'each' move, a 'daily' summary, or 'off'
  digestTime: '18:00',
  digestLastSent: null,
  setupDone: false,
};

// Cold storage. Off until you pick project folders and an archive folder.
const DEFAULT_ARCHIVE = {
  parents: [],        // folders whose subfolders are projects
  destination: '',    // where the zips go: an external drive, NAS or synced cloud folder
  idleDays: 30,       // a project counts as idle once nothing in it has changed for this long
  dailyCheck: true,   // look once a day and send a notification if anything is idle
  checkTime: '10:00',
  lastChecked: null,
  ignored: [],        // project folders to leave alone, by full path
  log: [],            // what was archived, newest first, so it can be restored
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
      // Files the user asked to leave alone, by full path.
      ignored: saved.ignored || [],
      archive: { ...DEFAULT_ARCHIVE, ...(saved.archive || {}) },
      // People who used the app before first-run setup existed don't need to see it.
      settings: { ...DEFAULT_SETTINGS, ...(saved.settings ? { setupDone: true } : {}), ...(saved.settings || {}) },
    };
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }
}

module.exports = { Config, DEFAULT_SETTINGS, DEFAULT_ARCHIVE, defaultRules };
