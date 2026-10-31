'use strict';

const path = require('path');

// Partial downloads are left alone until the browser renames them.
const PARTIAL_EXTENSIONS = ['.crdownload', '.part', '.tmp'];

// Windows puts these junctions inside Documents. They point at other folders, and
// watching them fails with EPERM, so they are skipped.
const WINDOWS_JUNCTIONS = ['my music', 'my pictures', 'my videos'];

// Folder names that are never touched, even inside a watched folder.
function isProtectedSegment(segment) {
  const lower = segment.toLowerCase();
  return segment.startsWith('@') || segment.startsWith('.') || WINDOWS_JUNCTIONS.includes(lower);
}

// True if any part of the path is protected: a "@" or "." folder, or a system/sync location.
// pathApi and home can be swapped in tests, so Windows paths can be checked on any system.
function isProtectedPath(filePath, { pathApi = path, home: homeDir = process.env.USERPROFILE } = {}) {
  const normalised = pathApi.resolve(filePath).toLowerCase();
  const home = (homeDir || '').toLowerCase();
  const blockedRoots = [
    `${home}\\appdata`,
    `${home}\\onedrive`,
    `${home}\\proton drive`,
    'c:\\windows',
    'c:\\program files',
    'c:\\program files (x86)',
  ].filter(Boolean);
  if (blockedRoots.some((root) => normalised === root || normalised.startsWith(root + pathApi.sep))) {
    return true;
  }
  return pathApi.resolve(filePath).split(pathApi.sep).some(isProtectedSegment);
}

function isPartialDownload(fileName) {
  return PARTIAL_EXTENSIONS.includes(path.extname(fileName).toLowerCase());
}

// True if the file sits straight inside one of the folders, not in a subfolder.
// Subfolders are the user's own (project folders, sorted folders), so they are never tidied.
function isTopLevel(filePath, folders) {
  const dir = path.resolve(path.dirname(filePath)).toLowerCase();
  return folders.some((f) => path.resolve(f).toLowerCase() === dir);
}

// True if the user asked Folder Tidy to leave this exact file alone.
function isIgnored(filePath, ignored = []) {
  const key = path.resolve(filePath).toLowerCase();
  return ignored.some((p) => path.resolve(p).toLowerCase() === key);
}

module.exports = { isProtectedPath, isPartialDownload, isTopLevel, isIgnored };
