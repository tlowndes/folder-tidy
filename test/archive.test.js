'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { findIdleProjects, archiveFolder, restoreArchive, walkFolder, writeZip, verifyZip } = require('../lib/archive');

// Inside the project, not the temp folder, as the temp folder is under AppData (protected).
const TEST_ROOT = path.join(__dirname, '..', 'tmp-tests-archive');
after(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

const DAY = 24 * 60 * 60 * 1000;
const rmTrash = (folder) => fs.promises.rm(folder, { recursive: true });

function tempDir() {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TEST_ROOT, 'run-'));
}

// Makes a project folder with a few files, an empty subfolder, and every date set
// `ageDays` ago. Returns its path.
function makeProject(parent, name, ageDays = 40) {
  const folder = path.join(parent, name);
  fs.mkdirSync(path.join(folder, 'exports', 'empty'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'brief.txt'), 'the brief '.repeat(500));
  fs.writeFileSync(path.join(folder, 'exports', 'hero.png'), Buffer.from(Array.from({ length: 50000 }, (_, i) => (i * 7) % 256)));
  setAge(folder, ageDays);
  return folder;
}

function setAge(folder, ageDays) {
  const when = new Date(Date.now() - ageDays * DAY);
  const visit = (p) => {
    if (fs.statSync(p).isDirectory()) for (const c of fs.readdirSync(p)) visit(path.join(p, c));
    fs.utimesSync(p, when, when);
  };
  visit(folder);
}

// Every file under a folder with its contents, for comparing before and after.
function snapshot(folder) {
  const out = {};
  const visit = (p, rel) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { out[`${r}/`] = ''; visit(path.join(p, e.name), r); } else out[r] = fs.readFileSync(path.join(p, e.name)).toString('base64');
    }
  };
  visit(folder, '');
  return out;
}

test('findIdleProjects: says which projects are idle and why the others are not', async () => {
  const root = tempDir();
  const parent = path.join(root, 'Projects');
  const dest = path.join(parent, 'Archive');
  makeProject(parent, 'Old job', 40);
  makeProject(parent, 'Current job', 3);
  makeProject(parent, 'Ignored job', 90);
  fs.mkdirSync(path.join(parent, 'Empty job'));
  fs.mkdirSync(dest);
  fs.writeFileSync(path.join(parent, 'loose file.txt'), 'not a project');

  const { projects, missing } = await findIdleProjects([parent, path.join(root, 'Nope')], {
    idleDays: 30, ignored: [path.join(parent, 'Ignored job')], destination: dest,
  });
  const by = Object.fromEntries(projects.map((p) => [p.name, p]));
  assert.deepEqual(Object.keys(by).sort(), ['Archive', 'Current job', 'Empty job', 'Ignored job', 'Old job']);
  assert.equal(by['Old job'].ready, true);
  assert.equal(by['Old job'].fileCount, 2);
  assert.equal(by['Current job'].reason, 'recent');
  assert.equal(by['Ignored job'].reason, 'ignored');
  assert.equal(by['Empty job'].reason, 'empty');
  assert.equal(by.Archive.reason, 'archive-folder');
  assert.deepEqual(missing, [path.join(root, 'Nope')]);
  assert.equal(projects[0].name, 'Old job'); // ready ones first
});

test('archiveFolder then restoreArchive: zipped, checked, binned, and restored exactly', async () => {
  const root = tempDir();
  const dest = path.join(root, 'Archive');
  fs.mkdirSync(dest);
  const folder = makeProject(path.join(root, 'Projects'), 'Logo job');
  const before = snapshot(folder);
  const stages = new Set();

  const result = await archiveFolder(folder, { destination: dest, trash: rmTrash, onProgress: (p) => stages.add(p.stage) });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.originalRemoved, true);
  assert.equal(result.zip, path.join(dest, 'Logo job.zip'));
  assert.ok(fs.existsSync(result.zip));
  assert.ok(!fs.existsSync(`${result.zip}.partial`));
  assert.ok(!fs.existsSync(folder));
  assert.deepEqual([...stages], ['zipping', 'checking', 'binning']);

  const to = await restoreArchive(result.zip, folder);
  assert.equal(to, folder);
  assert.deepEqual(snapshot(folder), before);
  assert.ok(Date.now() - fs.statSync(path.join(folder, 'brief.txt')).mtimeMs > 39 * DAY, 'dates come back too');
});

test('archiveFolder: a second archive of the same name gets a number, not an overwrite', async () => {
  const root = tempDir();
  const dest = path.join(root, 'Archive');
  fs.mkdirSync(dest);
  fs.writeFileSync(path.join(dest, 'Logo job.zip'), 'an older archive');
  const folder = makeProject(path.join(root, 'Projects'), 'Logo job');
  const result = await archiveFolder(folder, { destination: dest, trash: rmTrash });
  assert.equal(result.zip, path.join(dest, 'Logo job (2).zip'));
  assert.equal(fs.readFileSync(path.join(dest, 'Logo job.zip'), 'utf8'), 'an older archive');
});

test('archiveFolder: refuses when the drive is missing or the project changed, and touches nothing', async () => {
  const root = tempDir();
  const folder = makeProject(path.join(root, 'Projects'), 'Logo job');
  const before = snapshot(folder);
  const trash = () => assert.fail('should not bin');

  const missing = await archiveFolder(folder, { destination: path.join(root, 'Unplugged'), trash });
  assert.equal(missing.ok, false);
  assert.match(missing.message, /plugged in/);

  const dest = path.join(root, 'Archive');
  fs.mkdirSync(dest);
  fs.writeFileSync(path.join(folder, 'new note.txt'), 'just added');
  const recent = await archiveFolder(folder, { destination: dest, trash });
  assert.equal(recent.ok, false);
  assert.match(recent.message, /not idle/);
  assert.deepEqual(fs.readdirSync(dest), []);
  assert.deepEqual(snapshot(folder), { ...before, 'new note.txt': Buffer.from('just added').toString('base64') });
});

test('archiveFolder: a file changing while zipping stops it, removes the zip, and keeps the original', async () => {
  const root = tempDir();
  const dest = path.join(root, 'Archive');
  fs.mkdirSync(dest);
  const folder = makeProject(path.join(root, 'Projects'), 'Logo job');
  let changed = false;
  const result = await archiveFolder(folder, {
    destination: dest,
    trash: () => assert.fail('should not bin'),
    onProgress: (p) => {
      if (p.stage === 'checking' && !changed) {
        changed = true;
        fs.appendFileSync(path.join(folder, 'brief.txt'), ' and an edit');
      }
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /changed while/);
  assert.ok(fs.existsSync(path.join(folder, 'brief.txt')));
  assert.deepEqual(fs.readdirSync(dest), []);
});

test('archiveFolder: if the Recycle Bin step fails, the zip is kept and so is the original', async () => {
  const root = tempDir();
  const dest = path.join(root, 'Archive');
  fs.mkdirSync(dest);
  const folder = makeProject(path.join(root, 'Projects'), 'Logo job');
  const result = await archiveFolder(folder, { destination: dest, trash: async () => { throw new Error('in use'); } });
  assert.equal(result.ok, true);
  assert.equal(result.originalRemoved, false);
  assert.ok(fs.existsSync(result.zip));
  assert.ok(fs.existsSync(folder));
});

test('archiveFolder: dry run writes nothing and bins nothing', async () => {
  const root = tempDir();
  const dest = path.join(root, 'Archive');
  fs.mkdirSync(dest);
  const folder = makeProject(path.join(root, 'Projects'), 'Logo job');
  const result = await archiveFolder(folder, { destination: dest, dryRun: true, trash: () => assert.fail('should not bin') });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.deepEqual(fs.readdirSync(dest), []);
  assert.ok(fs.existsSync(folder));
});

test('verifyZip: spots a file whose contents do not match the original', async () => {
  const root = tempDir();
  const folder = makeProject(root, 'Logo job');
  const zip = path.join(root, 'check.zip');
  const expected = await writeZip(folder, await walkFolder(folder), zip, () => {});
  assert.equal(await verifyZip(zip, expected), null);

  const wrong = new Map(expected);
  wrong.set('Logo job/brief.txt', { ...expected.get('Logo job/brief.txt'), sha: '0'.repeat(64) });
  assert.match(await verifyZip(zip, wrong), /doesn't match/);

  const extra = new Map(expected);
  extra.set('Logo job/missing.txt', { size: 1, sha: 'x' });
  assert.match(await verifyZip(zip, extra), /missing from the zip/);
});

test('restoreArchive: never overwrites a folder that is already there', async () => {
  const root = tempDir();
  const dest = path.join(root, 'Archive');
  fs.mkdirSync(dest);
  const folder = makeProject(path.join(root, 'Projects'), 'Logo job');
  const result = await archiveFolder(folder, { destination: dest, trash: rmTrash });
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'new work.txt'), 'keep me');

  const to = await restoreArchive(result.zip, folder);
  assert.equal(to, path.join(root, 'Projects', 'Logo job (restored)'));
  assert.equal(fs.readFileSync(path.join(folder, 'new work.txt'), 'utf8'), 'keep me');
  assert.ok(fs.existsSync(path.join(to, 'brief.txt')));
  assert.ok(!fs.existsSync(`${to}.restoring`));
});
