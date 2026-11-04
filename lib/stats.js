'use strict';

const path = require('path');

const DAY = 24 * 60 * 60 * 1000;
// A rough guess at how long sorting one file by hand takes: find it, drag it, rename it.
const SECONDS_PER_FILE = 10;

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// The numbers for the "This week" page: the last 7 days, today included.
// moves are history entries, freed is [{ time, bytes, kind }] for things binned or cleaned,
// archived is the archive log. Undone moves don't count.
function buildStats({ moves = [], freed = [], archived = [], rules = [], sources = [], now = Date.now() } = {}) {
  const today = startOfDay(now);
  const since = today - 6 * DAY;
  const prevSince = since - 7 * DAY;
  const t = (e) => new Date(e.time).getTime();
  const live = moves.filter((e) => !e.undone);
  const week = live.filter((e) => t(e) >= since);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const start = since + i * DAY;
    // Days are counted by calendar date, so clock changes don't shift a move into the wrong day.
    const key = new Date(start).toDateString();
    const these = week.filter((e) => new Date(t(e)).toDateString() === key);
    days.push({ date: new Date(start).toISOString(), count: these.length, bytes: these.reduce((s, e) => s + (e.size || 0), 0) });
  }

  const ruleName = (id) => rules.find((r) => r.id === id)?.name || 'Old rule';
  const byRule = new Map();
  for (const e of week) {
    const row = byRule.get(e.ruleId) || { id: e.ruleId, name: ruleName(e.ruleId), count: 0, bytes: 0 };
    row.count += 1;
    row.bytes += e.size || 0;
    byRule.set(e.ruleId, row);
  }

  const watched = sources.map((s) => s.path);
  const bySource = new Map();
  for (const e of week) {
    const dir = path.dirname(e.from);
    const folder = watched.find((p) => path.resolve(p).toLowerCase() === path.resolve(dir).toLowerCase()) || dir;
    bySource.set(folder, (bySource.get(folder) || 0) + 1);
  }

  const freedWeek = freed.filter((f) => t(f) >= since);
  const archivedWeek = archived.filter((a) => a.originalRemoved && t(a) >= since);
  const freedBy = { clutter: 0, cleaner: 0, archive: 0 };
  for (const f of freedWeek) freedBy[f.kind] = (freedBy[f.kind] || 0) + (f.bytes || 0);
  freedBy.archive += archivedWeek.reduce((s, a) => s + (a.size || 0), 0);

  return {
    since: new Date(since).toISOString(),
    days,
    moved: week.length,
    bytesMoved: week.reduce((s, e) => s + (e.size || 0), 0),
    renamed: week.filter((e) => e.renamed).length,
    previousWeek: live.filter((e) => t(e) >= prevSince && t(e) < since).length,
    minutesSaved: Math.round((week.length * SECONDS_PER_FILE) / 60),
    byRule: [...byRule.values()].sort((a, b) => b.count - a.count),
    bySource: [...bySource.entries()].map(([folder, count]) => ({ folder, count })).sort((a, b) => b.count - a.count),
    freed: Object.values(freedBy).reduce((s, n) => s + n, 0),
    freedBy,
  };
}

// Keeps the freed-space log short: 90 days is plenty for a weekly view.
function trimFreed(freed, now = Date.now()) {
  return freed.filter((f) => now - new Date(f.time).getTime() < 90 * DAY);
}

module.exports = { buildStats, trimFreed, SECONDS_PER_FILE };
