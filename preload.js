'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The only way the UI talks to the main process.
contextBridge.exposeInMainWorld('folderTidy', {
  getState: () => ipcRenderer.invoke('get-state'),
  setPaused: (paused) => ipcRenderer.invoke('set-paused', paused),
  saveRules: (rules) => ipcRenderer.invoke('save-rules', rules),
  saveSources: (sources) => ipcRenderer.invoke('save-sources', sources),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  undo: (id) => ipcRenderer.invoke('undo', id),
  openFolder: (folder) => ipcRenderer.invoke('open-folder', folder),
  pickFolder: (title) => ipcRenderer.invoke('pick-folder', title),
  checkNow: () => ipcRenderer.invoke('check-now'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  moveChecked: (files) => ipcRenderer.invoke('move-checked', files),
  binFiles: (files) => ipcRenderer.invoke('bin-files', files),
  onRunCheck: (callback) => ipcRenderer.on('run-check', () => callback()),
  onShowPage: (callback) => ipcRenderer.on('show-page', (_e, page) => callback(page)),
  onStateChanged: (callback) => ipcRenderer.on('state-changed', () => callback()),
});
