'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { DEFAULT_RULES, matchRule } = require('../lib/rules');
const { uniquePath, moveFile, moveBack } = require('../lib/mover');
const { History } = require('../lib/history');
const { isProtectedPath, isPartialDownload, isTopLevel } = require('../lib/safety');
const { planFile, applyPlan, undoEntry } = require('../lib/organiser');

// Test folders live inside the project, not in the temp folder. The temp folder is under
// AppData, which the app treats as protected, so planFile would correctly skip it.
const TEST_ROOT = path.join(__dirname, '..', 'tmp-tests');
after(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

function tempDir() {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TEST_ROOT, 'run-'));
}

test('matchRule: first enabled match wins, case-insensitive', () => {
  const rules = [
    { id: 'a', enabled: true, extensions: ['.pdf'], namePattern: 'invoice', destination: 'X' },
    { id: 'b', enabled: true, extensions: ['.pdf'], namePattern: '', destination: 'Y' },
  ];
  assert.equal(matchRule('Invoice-May.PDF', rules).id, 'a');
  assert.equal(matchRule('notes.pdf', rules).id, 'b');
});

test('matchRule: disabled rules are skipped and unknown types return null', () => {
  const rules = [{ id: 'a', enabled: false, extensions: ['.zip'], namePattern: '', destination: 'X' }];
  assert.equal(matchRule('pack.zip', rules), null);
  assert.equal(matchRule('mystery.xyz', DEFAULT_RULES), null);
});

test('uniquePath: adds a number instead of overwriting', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'invoice.pdf'), 'a');
  fs.writeFileSync(path.join(dir, 'invoice (2).pdf'), 'b');
  assert.equal(uniquePath(dir, 'invoice.pdf'), path.join(dir, 'invoice (3).pdf'));
});

test('moveFile then moveBack restores the file to its original place', () => {
  const src = tempDir();
  const dest = path.join(tempDir(), 'Sorted');
  const original = path.join(src, 'photo.jpg');
  fs.writeFileSync(original, 'pixels');

  const moved = moveFile(original, dest);
  assert.ok(!fs.existsSync(original));
  assert.equal(fs.readFileSync(moved, 'utf8'), 'pixels');

  const restored = moveBack(moved, original);
  assert.equal(restored, original);
  assert.equal(fs.readFileSync(original, 'utf8'), 'pixels');
});

test('History: add, undoable, markUndone, and days-based cleanup', () => {
  const file = path.join(tempDir(), 'history.json');
  let now = Date.parse('2026-10-01T00:00:00Z');
  const history = new History(file, 30, () => now);

  const first = history.add({ from: 'a', to: 'b', ruleId: 'r' });
  assert.equal(history.undoable().length, 1);
  history.markUndone(first.id);
  assert.equal(history.undoable().length, 0);

  history.add({ from: 'c', to: 'd', ruleId: 'r' });
  now += 31 * 24 * 60 * 60 * 1000;
  history.add({ from: 'e', to: 'f', ruleId: 'r' });
  assert.equal(history.entries.length, 1, 'entries older than 30 days are dropped');
});

test('isProtectedPath: "@" and "." folders and system locations are protected', () => {
  assert.equal(isProtectedPath('C:\\Users\\tom\\Documents\\@archives\\x.pdf'), true);
  assert.equal(isProtectedPath('C:\\Users\\tom\\Documents\\.git\\x.txt'), true);
  assert.equal(isProtectedPath('C:\\Windows\\System32\\x.dll'), true);
  assert.equal(isProtectedPath('C:\\Users\\tom\\Documents\\Invoices\\x.pdf'), false);
});

test('isProtectedPath: Windows junctions inside Documents (My Music etc.) are protected', () => {
  assert.equal(isProtectedPath('C:\\Users\\tom\\Documents\\My Music'), true);
  assert.equal(isProtectedPath('C:\\Users\\tom\\Documents\\my pictures\\x.jpg'), true);
  assert.equal(isProtectedPath('C:\\Users\\tom\\Documents\\My Videos'), true);
});

test('isPartialDownload: browser partial files are skipped', () => {
  assert.equal(isPartialDownload('file.crdownload'), true);
  assert.equal(isPartialDownload('file.part'), true);
  assert.equal(isPartialDownload('file.pdf'), false);
});

test('planFile: skips files already in their destination folder (no loop)', () => {
  const dest = path.join(tempDir(), 'Invoices');
  fs.mkdirSync(dest, { recursive: true });
  const file = path.join(dest, 'invoice.pdf');
  fs.writeFileSync(file, 'x');
  const rules = [{ id: 'docs', enabled: true, extensions: ['.pdf'], namePattern: '', destination: dest }];
  assert.equal(planFile(file, rules), null);
});

test('planFile + applyPlan: moves a matching file and logs it; dry-run moves nothing', () => {
  const downloads = tempDir();
  const dest = path.join(tempDir(), 'Documents');
  const file = path.join(downloads, 'report.pdf');
  fs.writeFileSync(file, 'x');
  const rules = [{ id: 'docs', enabled: true, extensions: ['.pdf'], namePattern: '', destination: dest }];
  const history = new History(path.join(tempDir(), 'h.json'));

  const dry = applyPlan(planFile(file, rules), { dryRun: true, history });
  assert.equal(dry.dryRun, true);
  assert.ok(fs.existsSync(file), 'dry-run must not move the file');

  const done = applyPlan(planFile(file, rules), { dryRun: false, history });
  assert.ok(!fs.existsSync(file));
  assert.ok(fs.existsSync(done.to));
  assert.equal(history.undoable().length, 1);
});

test('undoEntry: restores a moved file and reports when it is missing', () => {
  const downloads = tempDir();
  const dest = path.join(tempDir(), 'Documents');
  const file = path.join(downloads, 'report.pdf');
  fs.writeFileSync(file, 'x');
  const rules = [{ id: 'docs', enabled: true, extensions: ['.pdf'], namePattern: '', destination: dest }];
  const history = new History(path.join(tempDir(), 'h.json'));

  const done = applyPlan(planFile(file, rules), { dryRun: false, history });
  const entry = history.get(done.entryId);
  assert.deepEqual(undoEntry(entry, history).ok, true);
  assert.ok(fs.existsSync(file));
  assert.equal(history.get(entry.id).undone, true);

  const again = { ...entry, undone: false, to: path.join(dest, 'gone.pdf') };
  assert.equal(undoEntry(again, history).reason, "Can't undo: file no longer there");
});

const { explainFile, scanFolders, suggestRules } = require('../lib/scan');

// A file old enough that the "just changed" check does not apply.
function oldFile(filePath, text = 'x') {
  fs.writeFileSync(filePath, text);
  const past = new Date(Date.now() - 60 * 1000);
  fs.utimesSync(filePath, past, past);
  return filePath;
}

test('explainFile: gives a reason for every file it would leave alone', () => {
  const dir = tempDir();
  const dest = path.join(dir, 'Docs');
  const rules = [
    { id: 'docs', name: 'Docs', enabled: true, extensions: ['.pdf'], namePattern: '', destination: dest },
    { id: 'inv', name: 'Invoices', enabled: true, extensions: ['.xlsx'], namePattern: 'invoice', destination: dest },
    { id: 'zip', name: 'Archives', enabled: false, extensions: ['.zip'], namePattern: '', destination: dest },
    { id: 'img', name: 'Images', enabled: true, extensions: ['.png'], namePattern: '', destination: '' },
  ];
  const reason = (name, opts) => explainFile(oldFile(path.join(dir, name)), rules, opts).reason;

  assert.equal(reason('report.pdf'), 'match');
  assert.equal(reason('mystery.xyz'), 'no-rule');
  assert.equal(reason('README'), 'no-extension');
  assert.equal(reason('pack.zip'), 'rule-off');
  assert.equal(reason('budget.xlsx'), 'name-mismatch');
  assert.equal(reason('shot.png'), 'no-destination');
  assert.equal(reason('film.crdownload'), 'downloading');
  assert.equal(reason('locked.pdf', { locked: () => true }), 'locked');

  fs.writeFileSync(path.join(dir, 'fresh.pdf'), 'x');
  assert.equal(explainFile(path.join(dir, 'fresh.pdf'), rules).reason, 'too-new');

  fs.mkdirSync(dest, { recursive: true });
  assert.equal(explainFile(oldFile(path.join(dest, 'done.pdf')), rules).reason, 'already-there');
});

test('scanFolders: checks the top of each enabled folder only', () => {
  const downloads = tempDir();
  const other = tempDir();
  oldFile(path.join(downloads, 'a.pdf'));
  fs.mkdirSync(path.join(downloads, 'Mine'));
  oldFile(path.join(downloads, 'Mine', 'b.pdf'));
  oldFile(path.join(other, 'c.pdf'));
  const rules = [{ id: 'docs', name: 'Docs', enabled: true, extensions: ['.pdf'], namePattern: '', destination: path.join(tempDir(), 'D') }];

  const results = scanFolders([{ path: downloads, enabled: true }, { path: other, enabled: false }], rules);
  assert.deepEqual(results.map((r) => path.basename(r.file)), ['a.pdf']);
  assert.ok(fs.existsSync(path.join(downloads, 'a.pdf')), 'a scan never moves anything');
});

test('suggestRules: extends a matching default rule, or groups types into a new rule', () => {
  const rules = DEFAULT_RULES.map((r) => ({ ...r, destination: 'X' }));
  const results = ['a.svg', 'b.svg', 'c.psd', 'd.ai', 'e.qqq'].map((name) => ({ file: name, ext: path.extname(name), reason: 'no-rule' }));
  results.push({ file: 'f.pdf', ext: '.pdf', reason: 'match' });

  const suggestions = suggestRules(results, rules);
  assert.deepEqual(suggestions[0], { kind: 'extend', ruleId: 'images', name: 'Images', extensions: ['.svg'], count: 2, examples: ['a.svg', 'b.svg'] });
  const design = suggestions.find((s) => s.name === 'Design files');
  assert.deepEqual(design.extensions, ['.psd', '.ai']);
  assert.equal(design.count, 2);
  assert.ok(suggestions.some((s) => s.kind === 'new' && s.name === 'QQQ files'));
  assert.equal(suggestions.length, 3);
});

test('isTopLevel: only files straight inside a watched folder are tidied', () => {
  const docs = path.join(path.sep, 'home', 'tom', 'Documents');
  assert.equal(isTopLevel(path.join(docs, 'invoice.pdf'), [docs]), true);
  assert.equal(isTopLevel(path.join(docs, 'Work', 'Client', 'brief.pdf'), [docs]), false);
  assert.equal(isTopLevel(path.join(docs, 'Sorted', 'old.pdf'), [docs]), false);
  assert.equal(isTopLevel(path.join(docs.toUpperCase(), 'a.pdf'), [docs]), true, 'case does not matter on Windows');
  assert.equal(isTopLevel(path.join(docs, 'a.pdf'), []), false);
});
