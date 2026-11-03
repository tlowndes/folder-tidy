'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { buildStats, trimFreed } = require('../lib/stats');

const NOW = new Date('2026-11-03T15:00:00').getTime();
const DAY = 24 * 60 * 60 * 1000;
const at = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();
const dl = path.resolve('Downloads');

test('buildStats: last 7 days by day, rule and folder; undone moves left out', () => {
  const moves = [
    { time: at(0), from: path.join(dl, 'a.pdf'), ruleId: 'docs', size: 100 },
    { time: at(0), from: path.join(dl, 'b.pdf'), ruleId: 'docs', size: 50, renamed: true },
    { time: at(2), from: path.join(dl, 'c.jpg'), ruleId: 'images', size: 10 },
    { time: at(1), from: path.join(dl, 'd.jpg'), ruleId: 'images', size: 10, undone: true },
    { time: at(9), from: path.join(dl, 'e.jpg'), ruleId: 'images', size: 10 },
  ];
  const s = buildStats({
    moves,
    rules: [{ id: 'docs', name: 'Documents' }, { id: 'images', name: 'Images' }],
    sources: [{ path: dl }],
    freed: [{ time: at(1), bytes: 1000, kind: 'clutter' }, { time: at(20), bytes: 5, kind: 'cleaner' }],
    archived: [{ time: at(3), size: 2000, originalRemoved: true }, { time: at(3), size: 99, originalRemoved: false }],
    now: NOW,
  });
  assert.equal(s.moved, 3);
  assert.equal(s.bytesMoved, 160);
  assert.equal(s.renamed, 1);
  assert.equal(s.previousWeek, 1);
  assert.equal(s.days.length, 7);
  assert.equal(s.days[6].count, 2);
  assert.equal(s.days[4].count, 1);
  assert.deepEqual(s.byRule.map((r) => [r.name, r.count]), [['Documents', 2], ['Images', 1]]);
  assert.deepEqual(s.bySource, [{ folder: dl, count: 3 }]);
  assert.equal(s.freed, 3000);
  assert.deepEqual(s.freedBy, { clutter: 1000, cleaner: 0, archive: 2000 });
});

test('trimFreed: keeps 90 days', () => {
  const kept = trimFreed([{ time: at(10), bytes: 1 }, { time: at(100), bytes: 2 }], NOW);
  assert.equal(kept.length, 1);
});
