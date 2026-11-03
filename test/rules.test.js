'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { matchRule, describeConditions, MB, DAY } = require('../lib/rules');
const { cleanName, addDatePrefix, renameFor } = require('../lib/naming');
const { planFile, applyPlan, undoEntry } = require('../lib/organiser');
const { explainFile } = require('../lib/scan');
const { History } = require('../lib/history');

const TEST_ROOT = path.join(__dirname, '..', 'tmp-tests-rules');
after(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));
function tempDir() {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TEST_ROOT, 'run-'));
}

const NOW = new Date('2026-11-03T12:00:00').getTime();

test('matchRule: "any type" rules take every file, even ones with no type', () => {
  const rules = [{ id: 'inv', enabled: true, anyType: true, extensions: [], namePattern: 'invoice', destination: 'X' }];
  assert.equal(matchRule('Invoice-May.pdf', rules).id, 'inv');
  assert.equal(matchRule('invoice', rules).id, 'inv');
  assert.equal(matchRule('photo.jpg', rules), null);
  // Shortcuts are never swept up by an "any type" rule.
  const all = [{ id: 'all', enabled: true, anyType: true, extensions: [], destination: 'X' }];
  assert.equal(matchRule('Invoice app.lnk', all), null);
});

test('planFile: system files like desktop.ini are never moved', () => {
  const dir = tempDir();
  const file = path.join(dir, 'desktop.ini');
  fs.writeFileSync(file, '[.ShellClassInfo]');
  const rules = [{ id: 'all', enabled: true, extensions: ['.ini'], destination: path.join(dir, 'out') }];
  assert.equal(planFile(file, rules), null);
});

test('matchRule: size and age conditions, which only match when known', () => {
  const rules = [
    { id: 'big', enabled: true, extensions: ['.mp4'], minSizeMB: 500, destination: 'X' },
    { id: 'old', enabled: true, anyType: true, olderThanDays: 90, destination: 'Y' },
    { id: 'video', enabled: true, extensions: ['.mp4'], destination: 'Z' },
  ];
  assert.equal(matchRule('clip.mp4', rules, { size: 600 * MB, mtimeMs: NOW, now: NOW }).id, 'big');
  assert.equal(matchRule('clip.mp4', rules, { size: 10 * MB, mtimeMs: NOW, now: NOW }).id, 'video');
  assert.equal(matchRule('clip.mp4', rules, { size: 10 * MB, mtimeMs: NOW - 100 * DAY, now: NOW }).id, 'old');
  // Without file info, conditional rules are passed over rather than guessed at.
  assert.equal(matchRule('clip.mp4', rules).id, 'video');
  assert.equal(describeConditions(rules[0]), 'over 500 MB');
});

test('cleanName: strips copy markers and tidies spaces, but never empties a name', () => {
  assert.equal(cleanName('Brief (1).pdf'), 'Brief.pdf');
  assert.equal(cleanName('Brief(12).PDF'), 'Brief.pdf');
  assert.equal(cleanName('Brief - Copy.docx'), 'Brief.docx');
  assert.equal(cleanName('Brief - Copy (2).docx'), 'Brief.docx');
  assert.equal(cleanName('Copy of Logo  final.png'), 'Logo final.png');
  assert.equal(cleanName('IMG_2034.JPG'), 'IMG_2034.jpg');
  assert.equal(cleanName('(1).txt'), '(1).txt');
});

test('addDatePrefix and renameFor: date in front, unless one is already there', () => {
  const d = new Date('2026-03-07T10:00:00');
  assert.equal(addDatePrefix('Brief.pdf', d), '2026-03-07 Brief.pdf');
  assert.equal(addDatePrefix('2025-01-01 Brief.pdf', d), '2025-01-01 Brief.pdf');
  assert.equal(renameFor('Brief (1).pdf', { cleanName: true, datePrefix: true }, d), '2026-03-07 Brief.pdf');
  assert.equal(renameFor('Brief (1).pdf', {}, d), 'Brief (1).pdf');
});

test('planFile + applyPlan: renames on the way, logs the size, and undo restores the old name', () => {
  const dir = tempDir();
  const src = path.join(dir, 'Downloads');
  const dest = path.join(dir, 'Sorted');
  fs.mkdirSync(src);
  const file = path.join(src, 'Invoice - Copy.pdf');
  fs.writeFileSync(file, 'hello');
  const rules = [{ id: 'docs', enabled: true, extensions: ['.pdf'], destination: dest, cleanName: true }];
  const history = new History(path.join(dir, 'history.json'));

  const plan = planFile(file, rules);
  assert.equal(plan.name, 'Invoice.pdf');
  const result = applyPlan(plan, { dryRun: false, history });
  assert.equal(result.to, path.join(dest, 'Invoice.pdf'));
  assert.equal(history.entries[0].size, 5);

  undoEntry(history.entries[0], history);
  assert.ok(fs.existsSync(file));
});

test('explainFile: says when a rule\'s size or age condition is why a file was left', () => {
  const dir = tempDir();
  const file = path.join(dir, 'small.mp4');
  fs.writeFileSync(file, 'x');
  const old = new Date(NOW - 60 * 1000);
  fs.utimesSync(file, old, old);
  const rules = [{ id: 'big', name: 'Big videos', enabled: true, extensions: ['.mp4'], minSizeMB: 500, destination: path.join(dir, 'out') }];
  const r = explainFile(file, rules, { now: NOW, locked: () => false });
  assert.equal(r.reason, 'condition');
  assert.match(r.message, /over 500 MB/);

  rules[0].minSizeMB = 0;
  rules[0].datePrefix = true;
  const moved = explainFile(file, rules, { now: NOW, locked: () => false });
  assert.equal(moved.action, 'move');
  assert.match(moved.name, /^\d{4}-\d{2}-\d{2} small\.mp4$/);
});
