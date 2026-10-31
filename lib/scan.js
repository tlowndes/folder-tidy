'use strict';

const fs = require('fs');
const path = require('path');
const { matchRule, destinationFor } = require('./rules');
const { isProtectedPath, isPartialDownload } = require('./safety');

// Files changed this recently may still be being written, so a manual check leaves them.
const RECENT_MS = 10 * 1000;

// Extensions that clearly belong with one of the default rules. Used to suggest adding
// a type to a rule you already have, instead of making a new one.
const FAMILIES = {
  images: ['.bmp', '.tif', '.tiff', '.svg', '.avif', '.ico', '.raw', '.cr2', '.nef', '.dng'],
  documents: ['.rtf', '.odt', '.ods', '.odp', '.md', '.pages', '.numbers', '.key', '.epub', '.json', '.xml'],
  installers: ['.msix', '.msixbundle', '.appx', '.appxbundle', '.bat', '.cmd'],
  archives: ['.bz2', '.xz', '.tgz', '.iso', '.cab'],
  video: ['.webm', '.wmv', '.m4v', '.flv', '.mpg', '.mpeg'],
  audio: ['.ogg', '.aac', '.wma', '.opus', '.aiff', '.mid'],
};

// Types that do not fit a default rule but are common enough to name a new rule after.
const NEW_RULE_NAMES = {
  'Design files': ['.psd', '.ai', '.fig', '.sketch', '.xd', '.indd', '.afdesign', '.afphoto', '.eps'],
  Fonts: ['.ttf', '.otf', '.woff', '.woff2'],
  '3D files': ['.stl', '.obj', '.fbx', '.blend', '.3mf'],
  Code: ['.js', '.ts', '.py', '.html', '.css', '.ps1'],
  Torrents: ['.torrent'],
  Calendar: ['.ics'],
};

// True if another app has the file open in a way that would stop a move, or it is read-only.
function isLocked(filePath) {
  try {
    fs.closeSync(fs.openSync(filePath, 'r+'));
    return false;
  } catch (err) {
    return ['EBUSY', 'EPERM', 'EACCES'].includes(err.code);
  }
}

// Works out what would happen to one file, and why. Returns
// { file, action: 'move' | 'skip', reason, message, ruleId?, destDir? }.
// Nothing is moved here.
function explainFile(filePath, rules, { now = Date.now(), locked = isLocked } = {}) {
  const fileName = path.basename(filePath);
  const ext = path.extname(fileName).toLowerCase();
  const skip = (reason, message, extra = {}) => ({ file: filePath, action: 'skip', reason, message, ext, ...extra });

  if (isProtectedPath(filePath)) return skip('protected', 'In a protected folder');
  if (isPartialDownload(fileName)) return skip('downloading', 'Still downloading');

  const rule = matchRule(fileName, rules);
  if (!rule) {
    if (!ext) return skip('no-extension', 'Has no file type, so no rule can match it');
    const off = rules.find((r) => !r.enabled && r.extensions.map((e) => e.toLowerCase()).includes(ext));
    if (off) return skip('rule-off', `Only matches "${off.name}", which is turned off`, { ruleId: off.id });
    const named = rules.find((r) => r.enabled && r.extensions.map((e) => e.toLowerCase()).includes(ext));
    if (named) return skip('name-mismatch', `"${named.name}" handles ${ext} files, but only when the name contains "${named.namePattern}"`, { ruleId: named.id });
    return skip('no-rule', `No rule for ${ext} files`);
  }
  if (!rule.destination) return skip('no-destination', `Matches "${rule.name}", but that rule has no folder yet`, { ruleId: rule.id });
  if (path.resolve(path.dirname(filePath)) === path.resolve(rule.destination)) {
    return skip('already-there', `Already in the "${rule.name}" folder`, { ruleId: rule.id });
  }

  const stat = fs.statSync(filePath);
  if (now - stat.mtimeMs < RECENT_MS) return skip('too-new', 'Changed in the last few seconds, so it may still be saving', { ruleId: rule.id });
  if (locked(filePath)) return skip('locked', 'Open in another app, or read-only', { ruleId: rule.id });

  const destDir = destinationFor(rule, stat.mtime);
  return { file: filePath, action: 'move', reason: 'match', message: `Goes to ${destDir}`, ext, ruleId: rule.id, destDir };
}

// Checks the files at the top of each enabled source folder. Subfolders are left out on
// purpose: they are often folders you sorted yourself, and the app should not undo that.
function scanFolders(sources, rules, opts = {}) {
  const results = [];
  for (const source of sources.filter((s) => s.enabled)) {
    let names;
    try {
      names = fs.readdirSync(source.path, { withFileTypes: true });
    } catch (err) {
      results.push({ file: source.path, action: 'skip', reason: 'unreadable', message: `Could not read this folder (${err.code})`, ext: '' });
      continue;
    }
    for (const entry of names) {
      if (!entry.isFile()) continue;
      results.push(explainFile(path.join(source.path, entry.name), rules, opts));
    }
  }
  return results;
}

// Groups files that no rule matched by type, and suggests either adding the type to an
// existing rule or making a new one. Most common types come first.
function suggestRules(results, rules) {
  const byExt = new Map();
  for (const r of results) {
    if (r.reason !== 'no-rule') continue;
    if (!byExt.has(r.ext)) byExt.set(r.ext, []);
    byExt.get(r.ext).push(path.basename(r.file));
  }

  const suggestions = [];
  const newGroups = new Map();
  for (const [ext, files] of byExt) {
    const familyId = Object.keys(FAMILIES).find((id) => FAMILIES[id].includes(ext));
    const target = familyId && rules.find((r) => r.id === familyId && r.enabled);
    if (target) {
      suggestions.push({ kind: 'extend', ruleId: target.id, name: target.name, extensions: [ext], count: files.length, examples: files.slice(0, 3) });
      continue;
    }
    const groupName = Object.keys(NEW_RULE_NAMES).find((n) => NEW_RULE_NAMES[n].includes(ext)) || `${ext.slice(1).toUpperCase()} files`;
    const group = newGroups.get(groupName) || { kind: 'new', name: groupName, extensions: [], count: 0, examples: [] };
    group.extensions.push(ext);
    group.count += files.length;
    group.examples.push(...files.slice(0, 3 - group.examples.length));
    newGroups.set(groupName, group);
  }
  suggestions.push(...newGroups.values());
  return suggestions.sort((a, b) => b.count - a.count);
}

module.exports = { explainFile, scanFolders, suggestRules, isLocked, RECENT_MS };
