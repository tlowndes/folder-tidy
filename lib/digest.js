'use strict';

// The daily tidy-up summary: one pop-up a day instead of one for every file.

// Reasons a file was left that a rule change would fix, so they're worth a look.
const NEEDS_LOOK = ['no-rule', 'no-destination', 'rule-off', 'name-mismatch'];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The time today the digest is due, from "HH:MM".
function dueTime(now, time) {
  const [h, m] = String(time || '18:00').split(':').map(Number);
  const due = new Date(now);
  due.setHours(h || 0, m || 0, 0, 0);
  return due.getTime();
}

// True once today's digest time has passed and it hasn't been sent since. If the PC was
// off or asleep at that time, it goes out as soon as the app is running again.
function isDue(now, time, lastSent) {
  const due = dueTime(now, time);
  return now >= due && (!lastSent || new Date(lastSent).getTime() < due);
}

// Builds the pop-up text. Returns null when there's nothing worth saying.
// moves: history entries since the last digest. rules: to name each move's rule.
function buildDigest({ moves, dryRunCount = 0, needsLook = 0, rules = [] }) {
  const done = moves.filter((m) => !m.undone);
  if (!done.length && !dryRunCount && !needsLook) return null;

  const parts = [];
  if (done.length) {
    const byRule = new Map();
    for (const m of done) {
      const name = rules.find((r) => r.id === m.ruleId)?.name || 'Other';
      byRule.set(name, (byRule.get(name) || 0) + 1);
    }
    const breakdown = [...byRule].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, n]) => `${name} ${n}`);
    parts.push(`Moved ${plural(done.length, 'file')} (${breakdown.join(', ')}).`);
  }
  if (dryRunCount) parts.push(`Dry run: would have moved ${plural(dryRunCount, 'file')}.`);
  if (needsLook) parts.push(`${plural(needsLook, 'file')} ${needsLook === 1 ? 'needs' : 'need'} a look.`);

  return { title: 'Your tidy-up today', body: parts.join(' ') };
}

module.exports = { NEEDS_LOOK, dueTime, isDue, buildDigest };
