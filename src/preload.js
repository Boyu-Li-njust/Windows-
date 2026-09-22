'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deskTodo', {
  load: () => ipcRenderer.invoke('store:load'),
  save: (payload) => ipcRenderer.invoke('store:save', payload),
  getStartup: () => ipcRenderer.invoke('startup:get'),
  setStartup: (enabled) => ipcRenderer.invoke('startup:set', enabled),
  createShortcut: () => ipcRenderer.invoke('shortcut:create'),
  hide: () => ipcRenderer.send('window:hide'),
  quit: () => ipcRenderer.send('window:quit'),
  setCompact: (compact) => ipcRenderer.send('window:set-compact', compact),
  getWindowPosition: () => ipcRenderer.invoke('window:get-position'),
  moveWindowBy: (dx, dy) => ipcRenderer.send('window:move-by', dx, dy),
  setWindowPosition: (x, y) => ipcRenderer.send('window:set-position', x, y),
  showWindowMenu: () => ipcRenderer.send('window:show-menu'),
  minimize: () => ipcRenderer.send('window:minimize'),
  onCommand: (handler) => ipcRenderer.on('command', (_event, command) => handler(command))
});
