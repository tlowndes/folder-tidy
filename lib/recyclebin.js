'use strict';

const { execFile } = require('child_process');

// Reads and empties the Recycle Bin through PowerShell. Windows only; elsewhere it
// reports as unavailable.

function powershell(command, run = execFile) {
  return new Promise((resolve, reject) => {
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 60 * 1000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout).trim());
    });
  });
}

// Returns { available, count, size }.
async function recycleBinInfo({ platform = process.platform, run } = {}) {
  if (platform !== 'win32') return { available: false, count: 0, size: 0 };
  try {
    const out = await powershell('$b=(New-Object -ComObject Shell.Application).NameSpace(10);$n=0;$t=0;foreach($i in $b.Items()){$n++;$t+=$i.Size};"$n $t"', run);
    const [count, size] = out.split(/\s+/).map(Number);
    return { available: true, count: count || 0, size: size || 0 };
  } catch {
    return { available: false, count: 0, size: 0 };
  }
}

// Empties it for good. Returns { ok }.
async function emptyRecycleBin({ platform = process.platform, run } = {}) {
  if (platform !== 'win32') return { ok: false, message: 'Only works on Windows' };
  try {
    await powershell('Clear-RecycleBin -Force -ErrorAction SilentlyContinue', run);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

module.exports = { recycleBinInfo, emptyRecycleBin };
