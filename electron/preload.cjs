/**
 * OmniConverter Studio — Context-Isolated Preload Bridge (electron/preload.cjs)
 *
 * Exposes a narrow, read/control IPC surface on window.omniDesktop without
 * exposing Node.js primitives or raw ipcRenderer to the renderer context.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('omniDesktop', Object.freeze({
  isDesktopApp: true,
  platform: process.platform,
  arch: process.arch,
  getEngineConfig: () => ipcRenderer.invoke('omni:get-engine-config'),
  getReadiness: () => ipcRenderer.invoke('omni:get-readiness'),
  recheckReadiness: () => ipcRenderer.invoke('omni:recheck-readiness'),
  restartEngine: () => ipcRenderer.invoke('omni:restart-engine'),
  openThirdPartyNotices: () => ipcRenderer.invoke('omni:open-notices'),
  openComponentManager: () => ipcRenderer.invoke('omni:open-components'),
  onReadinessReport: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('omni:readiness-report', listener);
    return () => ipcRenderer.removeListener('omni:readiness-report', listener);
  },
  onEngineStopped: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('omni:engine-stopped', listener);
    return () => ipcRenderer.removeListener('omni:engine-stopped', listener);
  },
}));
