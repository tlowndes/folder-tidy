'use strict';

const path = require('path');

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

// Default rules, checked top to bottom. The first enabled rule that matches wins.
const DEFAULT_RULES = [
  { id: 'images', name: 'Images', enabled: true, extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic'], namePattern: '', destination: '' },
  { id: 'documents', name: 'Documents', enabled: true, extensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv'], namePattern: '', destination: '' },
  { id: 'installers', name: 'Installers', enabled: true, extensions: ['.exe', '.msi'], namePattern: '', destination: '' },
  { id: 'archives', name: 'Archives', enabled: true, extensions: ['.zip', '.rar', '.7z', '.tar', '.gz'], namePattern: '', destination: '' },
  { id: 'video', name: 'Video', enabled: true, extensions: ['.mp4', '.mov', '.mkv', '.avi'], namePattern: '', destination: '' },
  { id: 'audio', name: 'Audio', enabled: true, extensions: ['.mp3', '.wav', '.flac', '.m4a'], namePattern: '', destination: '' },
];

// Shortcuts and settings files that an "Any type" rule leaves alone, so it can't sweep the
// Desktop clean of shortcuts. A rule that lists them by name still takes them.
const ANY_TYPE_SKIPS = ['.lnk', '.url', '.ini'];

// True if the rule takes this file type. "Any type" rules take everything (apart from
// shortcuts), including files with no type at all.
function typeMatches(rule, ext) {
  if (rule.anyType) return !ANY_TYPE_SKIPS.includes(ext);
  return (rule.extensions || []).map((e) => e.toLowerCase()).includes(ext);
}

// Why a rule doesn't take a file: 'type', 'name', 'size' or 'age', or null if it does.
// info is { size, mtimeMs, now }. Size and age conditions only match when they're known.
function ruleMismatch(rule, fileName, info = {}) {
  const ext = path.extname(fileName).toLowerCase();
  if (!typeMatches(rule, ext)) return 'type';
  if (rule.namePattern && !fileName.toLowerCase().includes(rule.namePattern.toLowerCase())) return 'name';
  if (rule.minSizeMB > 0 && !(info.size >= rule.minSizeMB * MB)) return 'size';
  if (rule.olderThanDays > 0 && !((info.now ?? Date.now()) - info.mtimeMs >= rule.olderThanDays * DAY)) return 'age';
  return null;
}

// Returns the first enabled rule that matches the file, or null.
// A rule matches when the type fits (or it takes any type) and every condition it has
// is met: name contains some text, bigger than so many MB, older than so many days.
function matchRule(fileName, rules, info = {}) {
  return rules.find((rule) => rule.enabled && ruleMismatch(rule, fileName, info) === null) || null;
}

// Plain-English version of a rule's extra conditions, e.g. "over 500 MB, older than 90 days".
function describeConditions(rule) {
  const parts = [];
  if (rule.namePattern) parts.push(`name contains "${rule.namePattern}"`);
  if (rule.minSizeMB > 0) parts.push(`over ${rule.minSizeMB} MB`);
  if (rule.olderThanDays > 0) parts.push(`older than ${rule.olderThanDays} ${rule.olderThanDays === 1 ? 'day' : 'days'}`);
  return parts.join(', ');
}

// Where a file goes for a rule. Rules can sort into dated subfolders by the file's date:
// subfolders 'year' gives Pictures\2026, 'month' gives Pictures\2026\10.
function destinationFor(rule, date = new Date()) {
  if (!rule.destination) return '';
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  if (rule.subfolders === 'year') return path.join(rule.destination, year);
  if (rule.subfolders === 'month') return path.join(rule.destination, year, month);
  return rule.destination;
}

module.exports = { DEFAULT_RULES, matchRule, ruleMismatch, typeMatches, describeConditions, destinationFor, MB, DAY };
