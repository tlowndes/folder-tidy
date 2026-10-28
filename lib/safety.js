'use strict';

const path = require('path');

// Partial downloads are left alone until the browser renames them.
const PARTIAL_EXTENSIONS = ['.crdownload', '.part', '.tmp'];

// Folder names that are never touched, even inside a watched folder.
function isProtectedSegment(segment) {
  return segment.startsWith('@') || segment.startsWith('.');
}

// True if any part of the path is protected: a "@" or "." folder, or a system/sync location.
function isProtectedPath(filePath) {
  const normalised = path.resolve(filePath).toLowerCase();
  const home = (process.env.USERPROFILE || '').toLowerCase();
  const blockedRoots = [
    `${home}\\appdata`,
    `${home}\\onedrive`,
    `${home}\\proton drive`,
    'c:\\windows',
    'c:\\program files',
    'c:\\program files (x86)',
  ].filter(Boolean);
  if (blockedRoots.some((root) => normalised === root || normalised.startsWith(root + path.sep))) {
    return true;
  }
  return path.resolve(filePath).split(path.sep).some(isProtectedSegment);
}

function isPartialDownload(fileName) {
  return PARTIAL_EXTENSIONS.includes(path.extname(fileName).toLowerCase());
}

module.exports = { isProtectedPath, isPartialDownload };
