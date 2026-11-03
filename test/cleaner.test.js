'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { junkCategories, expandRoot, scanJunk, cleanJunk, findBigFiles, isInside, DAY } = require('../lib/cleaner');
const { recycleBinInfo } = require('../lib/recyclebin');

const TEST_ROOT = path.join(__dirname, '..', 'tmp-tests-cleaner');
after(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));
function tempDir() {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TEST_ROOT, 'run-'));
}
function write(file, bytes, ageDays = 0) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes));
  const t = new Date(Date.now() - ageDays * DAY);
  fs.utimesSync(file, t, t);
}

test('junkCategories: browser profiles are found through "*"', async () => {
  const local = tempDir();
  fs.mkdirSync(path.join(local, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'), { recursive: true });
  fs.mkdirSync(path.join(local, 'Google', 'Chrome', 'User Data', 'Profile 1', 'Cache'), { recursive: true });
  const cats = junkCategories({ localAppData: local, temp: path.join(local, 'Temp') });
  const browsers = cats.find((c) => c.id === 'browsers');
  const found = await expandRoot(browsers.roots[0]);
  assert.equal(found.length, 2);
});

test('scanJunk + cleanJunk: clears old files only, keeps the folders, and dry run deletes nothing', async () => {
  const local = tempDir();
  const temp = path.join(local, 'Temp');
  write(path.join(temp, 'old.tmp'), 100, 3);
  write(path.join(temp, 'setup', 'old.cab'), 200, 3);
  write(path.join(temp, 'fresh.tmp'), 50, 0);
  const cats = junkCategories({ localAppData: local, temp }).filter((c) => c.id === 'temp');

  const [scan] = await scanJunk(cats);
  assert.equal(scan.count, 2);
  assert.equal(scan.size, 300);

  const [dry] = await cleanJunk(cats, ['temp'], { dryRun: true });
  assert.equal(dry.freed, 300);
  assert.ok(fs.existsSync(path.join(temp, 'old.tmp')));

  const [done] = await cleanJunk(cats, ['temp', 'nope'].slice(0, 1));
  assert.equal(done.deleted, 2);
  assert.ok(!fs.existsSync(path.join(temp, 'old.tmp')));
  assert.ok(!fs.existsSync(path.join(temp, 'setup')));
  assert.ok(fs.existsSync(path.join(temp, 'fresh.tmp')));
  assert.ok(fs.existsSync(temp));
});

test('cleanJunk: thumbnail cache only takes thumbcache files, and unknown ids do nothing', async () => {
  const local = tempDir();
  const explorer = path.join(local, 'Microsoft', 'Windows', 'Explorer');
  write(path.join(explorer, 'thumbcache_256.db'), 10, 3);
  write(path.join(explorer, 'other.db'), 10, 3);
  const cats = junkCategories({ localAppData: local, temp: path.join(local, 'Temp') });
  const results = await cleanJunk(cats, ['thumbs', 'everything']);
  assert.equal(results[0].deleted, 1);
  assert.ok(fs.existsSync(path.join(explorer, 'other.db')));
  assert.equal(results[1].ok, false);
});

test('findBigFiles: biggest files first, top folders by size, protected folders skipped', async () => {
  const home = tempDir();
  write(path.join(home, 'Videos', 'film.mp4'), 3000);
  write(path.join(home, 'Videos', 'clip.mp4'), 2000);
  write(path.join(home, 'Documents', 'note.txt'), 10);
  write(path.join(home, 'AppStuff', 'huge.bin'), 9000);
  const r = await findBigFiles([home], { minBytes: 1000, protectedPath: (p) => p.includes('AppStuff') });
  assert.deepEqual(r.files.map((f) => path.basename(f.file)), ['film.mp4', 'clip.mp4']);
  assert.equal(r.folders[0].folder, path.join(home, 'Videos'));
  assert.equal(r.folders[0].size, 5000);
  assert.ok(!r.folders.some((f) => f.folder.includes('AppStuff')));
});

test('isInside: only paths under the folder count', () => {
  assert.ok(isInside(path.resolve('a/b/c.txt'), path.resolve('a')));
  assert.ok(!isInside(path.resolve('a'), path.resolve('a')));
  assert.ok(!isInside(path.resolve('ab/c.txt'), path.resolve('a')));
});

test('recycleBinInfo: unavailable off Windows, parsed from PowerShell on it', async () => {
  assert.equal((await recycleBinInfo({ platform: 'linux' })).available, false);
  const run = (_cmd, _args, _opts, cb) => cb(null, '12 3456\r\n');
  assert.deepEqual(await recycleBinInfo({ platform: 'win32', run }), { available: true, count: 12, size: 3456 });
});
