'use strict';

const path = require('path');

// Default rules, checked top to bottom. The first enabled rule that matches wins.
const DEFAULT_RULES = [
  { id: 'images', name: 'Images', enabled: true, extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic'], namePattern: '', destination: '' },
  { id: 'documents', name: 'Documents', enabled: true, extensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv'], namePattern: '', destination: '' },
  { id: 'installers', name: 'Installers', enabled: true, extensions: ['.exe', '.msi'], namePattern: '', destination: '' },
  { id: 'archives', name: 'Archives', enabled: true, extensions: ['.zip', '.rar', '.7z', '.tar', '.gz'], namePattern: '', destination: '' },
  { id: 'video', name: 'Video', enabled: true, extensions: ['.mp4', '.mov', '.mkv', '.avi'], namePattern: '', destination: '' },
  { id: 'audio', name: 'Audio', enabled: true, extensions: ['.mp3', '.wav', '.flac', '.m4a'], namePattern: '', destination: '' },
];

// Returns the first enabled rule that matches the file name, or null.
// A rule matches when the extension is in its list (case-insensitive) and,
// if namePattern is set, the file name contains that text (case-insensitive).
function matchRule(fileName, rules) {
  const ext = path.extname(fileName).toLowerCase();
  const lowerName = fileName.toLowerCase();
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!rule.extensions.map((e) => e.toLowerCase()).includes(ext)) continue;
    if (rule.namePattern && !lowerName.includes(rule.namePattern.toLowerCase())) continue;
    return rule;
  }
  return null;
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

module.exports = { DEFAULT_RULES, matchRule, destinationFor };
